mod accounts;
mod roots;
mod baselines;
mod tasks;
mod history;
mod conflicts;
mod migrations;

use migrations::reconcile_migration_line_endings;

use crate::{domain::*, filesystem::is_generated_conflict_copy, security::unix_ms};
use sqlx::{
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous},
    Row, SqlitePool,
};
use std::{
    borrow::Cow,
    collections::HashSet,
    path::{Path, PathBuf},
    time::Duration,
};

#[derive(Clone)]
pub struct Database {
    pub pool: SqlitePool,
    path: PathBuf,
}

impl Database {
    pub async fn open(path: &Path) -> AppResult<Self> {
        if let Some(parent) = path.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }
        let options = SqliteConnectOptions::new()
            .filename(path)
            .create_if_missing(true)
            .foreign_keys(true)
            .journal_mode(SqliteJournalMode::Wal)
            .synchronous(SqliteSynchronous::Full)
            .busy_timeout(Duration::from_secs(5));
        let pool = SqlitePoolOptions::new()
            .max_connections(5)
            .connect_with(options)
            .await?;
        let migrator = sqlx::migrate!("./migrations");
        let has_migration_table: bool = sqlx::query_scalar::<_, i32>(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='_sqlx_migrations'",
        )
        .fetch_one(&pool)
        .await
        .map(|count| count > 0)?;

        if has_migration_table {
            reconcile_migration_line_endings(&pool, &migrator).await?;
        }

        migrator
            .run(&pool)
            .await
            .map_err(|e| AppError::new("DATABASE_MIGRATION_FAILED", e.to_string()))?;
        let db = Self {
            pool,
            path: path.to_path_buf(),
        };
        db.ensure_identity().await?;
        Ok(db)
    }

    pub async fn backup_to(&self, destination: &Path) -> AppResult<u64> {
        let parent = destination
            .parent()
            .ok_or_else(|| AppError::new("BACKUP_PATH_INVALID", "数据库备份路径无效"))?;
        tokio::fs::create_dir_all(parent).await?;
        let parent = tokio::fs::canonicalize(parent).await?;
        let filename = destination
            .file_name()
            .ok_or_else(|| AppError::new("BACKUP_PATH_INVALID", "数据库备份文件名无效"))?;
        let destination = parent.join(filename);
        let active = tokio::fs::canonicalize(&self.path).await?;
        if destination == active {
            return Err(AppError::new(
                "BACKUP_PATH_INVALID",
                "不能将数据库备份覆盖当前运行数据库",
            ));
        }
        if tokio::fs::try_exists(&destination).await? {
            return Err(AppError::new(
                "BACKUP_TARGET_EXISTS",
                "备份目标已存在；请选择新文件名",
            ));
        }
        let target = destination.to_string_lossy().into_owned();
        if let Err(error) = sqlx::query("VACUUM INTO ?")
            .bind(&target)
            .execute(&self.pool)
            .await
        {
            let _ = tokio::fs::remove_file(&destination).await;
            return Err(AppError::new("DATABASE_BACKUP_FAILED", error.to_string()));
        }
        let file = tokio::fs::OpenOptions::new()
            .read(true)
            .open(&destination)
            .await?;
        file.sync_all().await?;
        Ok(file.metadata().await?.len())
    }

    async fn ensure_identity(&self) -> AppResult<()> {
        if self.setting("device_id").await?.is_none() {
            self.set_setting("device_id", &uuid::Uuid::new_v4().to_string())
                .await?;
        }
        let device_name = std::env::var("COMPUTERNAME")
            .or_else(|_| std::env::var("HOSTNAME"))
            .unwrap_or_else(|_| "ProjectSync Device".to_owned());
        if self.setting("device_name").await?.is_none() {
            self.set_setting("device_name", &device_name).await?;
        }
        Ok(())
    }

    pub async fn setting(&self, key: &str) -> AppResult<Option<String>> {
        Ok(sqlx::query("SELECT value FROM app_settings WHERE key = ?")
            .bind(key)
            .fetch_optional(&self.pool)
            .await?
            .map(|r| r.get("value")))
    }

    pub async fn set_setting(&self, key: &str, value: &str) -> AppResult<()> {
        sqlx::query("INSERT INTO app_settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at")
            .bind(key).bind(value).bind(unix_ms()).execute(&self.pool).await?;
        Ok(())
    }

    pub async fn device_id(&self) -> AppResult<String> {
        Ok(self
            .setting("device_id")
            .await?
            .unwrap_or_else(|| "unknown-device".to_owned()))
    }
    pub async fn device_name(&self) -> AppResult<String> {
        Ok(self
            .setting("device_name")
            .await?
            .unwrap_or_else(|| "ProjectSync Device".to_owned()))
    }

    pub async fn status(&self, root_id: &str) -> AppResult<SyncStatusDto> {
        let root = self.root(root_id).await?;
        let pending:i64=sqlx::query("SELECT COUNT(*) AS n FROM sync_tasks WHERE root_id=? AND status IN ('PENDING','RUNNING','RETRY_WAIT')").bind(root_id).fetch_one(&self.pool).await?.get("n");
        let conflicts: i64 = sqlx::query(
            "SELECT COUNT(*) AS n FROM sync_conflicts WHERE root_id=? AND status='UNRESOLVED'",
        )
        .bind(root_id)
        .fetch_one(&self.pool)
        .await?
        .get("n");
        Ok(SyncStatusDto {
            root_id: root_id.to_owned(),
            status: root.status,
            pending_tasks: pending.max(0) as u64,
            unresolved_conflicts: conflicts.max(0) as u64,
            last_sync_at: root.last_sync_at,
        })
    }

    pub async fn finish_sync(&self, root_id: &str, status: &str) -> AppResult<()> {
        sqlx::query("UPDATE sync_roots SET sync_status=?,last_sync_at=?,updated_at=? WHERE id=?")
            .bind(status)
            .bind(unix_ms())
            .bind(unix_ms())
            .bind(root_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn recover_interrupted(&self) -> AppResult<()> {
        let now = unix_ms();
        sqlx::query("UPDATE sync_tasks SET status='RETRY_WAIT',next_retry_at=?,last_error_code='PROCESS_RESTARTED',last_error_message='任务将在重新扫描并核对两端状态后恢复',updated_at=? WHERE status='RUNNING'")
            .bind(now).bind(now).execute(&self.pool).await?;
        sqlx::query("UPDATE sync_roots SET sync_status=CASE WHEN enabled=0 THEN 'DISABLED' WHEN sync_status='PAUSED' THEN 'PAUSED' ELSE 'IDLE' END,updated_at=? WHERE deleted_at IS NULL")
            .bind(now).execute(&self.pool).await?;
        Ok(())
    }


}
