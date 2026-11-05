use crate::{domain::*, security::unix_ms};
use sqlx::{
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous},
    Row, SqlitePool,
};
use std::{
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
        sqlx::migrate!("./migrations")
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

    pub async fn accounts(&self) -> AppResult<Vec<WebDavAccountDto>> {
        let rows = sqlx::query("SELECT * FROM webdav_accounts ORDER BY created_at DESC")
            .fetch_all(&self.pool)
            .await?;
        rows.into_iter()
            .map(|r| account_from_row(&r).map(Into::into))
            .collect()
    }

    pub async fn account(&self, id: &str) -> AppResult<AccountRecord> {
        let row = sqlx::query("SELECT * FROM webdav_accounts WHERE id = ?")
            .bind(id)
            .fetch_optional(&self.pool)
            .await?
            .ok_or_else(|| AppError::new("ACCOUNT_NOT_FOUND", "WebDAV 账号不存在"))?;
        account_from_row(&row)
    }

    pub async fn insert_account(
        &self,
        id: &str,
        input: &WebDavAccountInput,
        credential_ref: &str,
    ) -> AppResult<()> {
        let now = unix_ms();
        sqlx::query("INSERT INTO webdav_accounts(id,name,base_url,username,credential_ref,tls_verify,connection_status,created_at,updated_at) VALUES(?,?,?,?,?,?, 'UNKNOWN', ?, ?)")
            .bind(id).bind(input.name.trim()).bind(input.url.trim()).bind(input.username.trim()).bind(credential_ref).bind(input.tls_verify as i64).bind(now).bind(now).execute(&self.pool).await?;
        Ok(())
    }

    pub async fn update_account(
        &self,
        id: &str,
        name: &str,
        url: &str,
        username: &str,
        tls_verify: bool,
        credential_ref: Option<&str>,
    ) -> AppResult<()> {
        let result = sqlx::query("UPDATE webdav_accounts SET name=?,base_url=?,username=?,tls_verify=?,credential_ref=COALESCE(?,credential_ref),updated_at=? WHERE id=?")
            .bind(name.trim()).bind(url.trim()).bind(username.trim()).bind(tls_verify as i64).bind(credential_ref).bind(unix_ms()).bind(id).execute(&self.pool).await?;
        if result.rows_affected() == 0 {
            return Err(AppError::new("ACCOUNT_NOT_FOUND", "WebDAV 账号不存在"));
        }
        Ok(())
    }

    pub async fn set_account_status(&self, id: &str, status: &str) -> AppResult<()> {
        sqlx::query("UPDATE webdav_accounts SET connection_status=?,updated_at=? WHERE id=?")
            .bind(status)
            .bind(unix_ms())
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn delete_account(&self, id: &str) -> AppResult<String> {
        let account = self.account(id).await?;
        let references: i64 =
            sqlx::query("SELECT COUNT(*) AS count FROM sync_roots WHERE account_id=?")
                .bind(id)
                .fetch_one(&self.pool)
                .await?
                .get("count");
        if references > 0 {
            return Err(AppError::new(
                "ACCOUNT_IN_USE",
                "仍有同步项目使用此账号，不能删除",
            ));
        }
        sqlx::query("DELETE FROM webdav_accounts WHERE id=?")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(account.credential_ref)
    }

    pub async fn save_capabilities(
        &self,
        account_id: &str,
        capabilities: &WebDavCapabilities,
        status: &str,
    ) -> AppResult<()> {
        let now = unix_ms();
        let value = serde_json::to_string(capabilities)
            .map_err(|e| AppError::new("SERIALIZATION_ERROR", e.to_string()))?;
        sqlx::query("UPDATE webdav_accounts SET capability_json=?,connection_status=?,last_connected_at=?,updated_at=? WHERE id=?")
            .bind(&value).bind(status).bind(now).bind(now).bind(account_id).execute(&self.pool).await?;
        let id = uuid::Uuid::new_v4().to_string();
        sqlx::query("INSERT INTO server_capability_probes(id,account_id,probed_at,propfind_ok,etag_observed,if_match_put_safe,if_none_match_safe,lock_exclusion_safe,safe_update_existing,safe_create_only,safe_delete,move_no_overwrite_safe,report_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)")
            .bind(id).bind(account_id).bind(now).bind(capabilities.propfind_depth1_supported as i64).bind((capabilities.etag_type != "None") as i64)
            .bind(capabilities.supports_if_match as i64).bind(capabilities.supports_if_none_match as i64)
            .bind(capabilities.supports_lock as i64)
            .bind(capabilities.safe_update_existing as i64).bind(capabilities.safe_create_only as i64).bind(capabilities.safe_delete as i64)
            .bind(capabilities.safe_move_no_overwrite as i64).bind(&value).execute(&self.pool).await?;
        Ok(())
    }

    pub async fn roots(&self) -> AppResult<Vec<SyncRootDto>> {
        let rows = sqlx::query("SELECT r.*, (SELECT COUNT(*) FROM sync_files f WHERE f.root_id=r.id AND (f.local_exists=1 OR f.remote_exists=1 OR f.sync_state='IGNORED')) AS file_count, (SELECT COUNT(*) FROM sync_tasks t WHERE t.root_id=r.id AND t.status IN ('PENDING','RUNNING','RETRY_WAIT')) AS pending_count FROM sync_roots r WHERE r.deleted_at IS NULL ORDER BY r.created_at DESC")
            .fetch_all(&self.pool).await?;
        rows.iter().map(root_dto_from_row).collect()
    }

    pub async fn root(&self, id: &str) -> AppResult<RootRecord> {
        let row = sqlx::query("SELECT * FROM sync_roots WHERE id=? AND deleted_at IS NULL")
            .bind(id)
            .fetch_optional(&self.pool)
            .await?
            .ok_or_else(|| AppError::new("ROOT_NOT_FOUND", "同步项目不存在"))?;
        root_from_row(&row)
    }

    pub async fn create_root(&self, root: &RootRecord, rules: &[SyncRuleDto]) -> AppResult<()> {
        let mut tx = self.pool.begin().await?;
        let now = unix_ms();
        sqlx::query("INSERT INTO sync_roots(id,remote_project_id,account_id,name,local_path,remote_path,enabled,sync_mode,conflict_policy,delete_policy,poll_interval_seconds,debounce_ms,max_parallel_transfers,initial_sync_completed,initial_sync_confirmed,sync_status,created_at,updated_at) VALUES(?,?,?,?,?,?,1,'BIDIRECTIONAL','KEEP_BOTH','TRASH',?,?,2,0,1,'IDLE',?,?)")
            .bind(&root.id).bind(&root.remote_project_id).bind(&root.account_id).bind(&root.name).bind(root.local_path.to_string_lossy().as_ref()).bind(&root.remote_path).bind(root.poll_interval_seconds as i64).bind(root.debounce_ms as i64).bind(now).bind(now).execute(&mut *tx).await?;
        for rule in rules {
            sqlx::query("INSERT INTO sync_rules(root_id,rule_type,pattern,priority,enabled,created_at) VALUES(?,?,?,?,?,?)")
                .bind(&root.id).bind(match rule.rule_type { RuleType::Include => "INCLUDE", RuleType::Exclude => "EXCLUDE" }).bind(&rule.pattern).bind(rule.priority).bind(rule.enabled as i64).bind(now).execute(&mut *tx).await?;
        }
        tx.commit().await?;
        Ok(())
    }

    pub async fn update_root(
        &self,
        id: &str,
        name: &str,
        poll: u32,
        debounce: u32,
    ) -> AppResult<()> {
        let result = sqlx::query("UPDATE sync_roots SET name=?,poll_interval_seconds=?,debounce_ms=?,updated_at=? WHERE id=? AND deleted_at IS NULL")
            .bind(name.trim()).bind(poll.clamp(10, 86_400) as i64).bind(debounce.clamp(100, 30_000) as i64).bind(unix_ms()).bind(id).execute(&self.pool).await?;
        if result.rows_affected() == 0 {
            return Err(AppError::new("ROOT_NOT_FOUND", "同步项目不存在"));
        }
        Ok(())
    }

    pub async fn set_root_enabled(&self, id: &str, enabled: bool) -> AppResult<()> {
        let result = sqlx::query("UPDATE sync_roots SET enabled=?,sync_status=?,updated_at=? WHERE id=? AND deleted_at IS NULL")
            .bind(enabled as i64).bind(if enabled { "IDLE" } else { "DISABLED" }).bind(unix_ms()).bind(id).execute(&self.pool).await?;
        if result.rows_affected() == 0 {
            return Err(AppError::new("ROOT_NOT_FOUND", "同步项目不存在"));
        }
        Ok(())
    }

    pub async fn delete_root(&self, id: &str) -> AppResult<()> {
        let result = sqlx::query("UPDATE sync_roots SET enabled=0,deleted_at=?,sync_status='DISABLED',updated_at=? WHERE id=? AND deleted_at IS NULL")
            .bind(unix_ms()).bind(unix_ms()).bind(id).execute(&self.pool).await?;
        if result.rows_affected() == 0 {
            return Err(AppError::new("ROOT_NOT_FOUND", "同步项目不存在"));
        }
        Ok(())
    }

    pub async fn set_root_status(&self, id: &str, status: &str) -> AppResult<()> {
        sqlx::query("UPDATE sync_roots SET sync_status=?,updated_at=? WHERE id=?")
            .bind(status)
            .bind(unix_ms())
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn mark_initial_confirmed(&self, id: &str) -> AppResult<()> {
        let result = sqlx::query("UPDATE sync_roots SET initial_sync_confirmed=1,updated_at=? WHERE id=? AND deleted_at IS NULL").bind(unix_ms()).bind(id).execute(&self.pool).await?;
        if result.rows_affected() == 0 {
            return Err(AppError::new("ROOT_NOT_FOUND", "同步项目不存在"));
        }
        Ok(())
    }

    pub async fn mark_initial_completed(&self, id: &str) -> AppResult<()> {
        sqlx::query("UPDATE sync_roots SET initial_sync_completed=1,updated_at=? WHERE id=?")
            .bind(unix_ms())
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn rules(&self, root_id: &str) -> AppResult<Vec<SyncRuleDto>> {
        let _ = self.root(root_id).await?;
        let rows = sqlx::query("SELECT id,rule_type,pattern,enabled,priority FROM sync_rules WHERE root_id=? ORDER BY priority,id").bind(root_id).fetch_all(&self.pool).await?;
        rows.iter()
            .map(|r| {
                let kind: String = r.get("rule_type");
                Ok(SyncRuleDto {
                    id: Some(r.get("id")),
                    rule_type: if kind == "EXCLUDE" {
                        RuleType::Exclude
                    } else {
                        RuleType::Include
                    },
                    pattern: r.get("pattern"),
                    enabled: r.get::<i64, _>("enabled") != 0,
                    priority: r.get("priority"),
                })
            })
            .collect()
    }

    pub async fn replace_rules(&self, root_id: &str, rules: &[SyncRuleDto]) -> AppResult<()> {
        let _ = self.root(root_id).await?;
        let mut tx = self.pool.begin().await?;
        sqlx::query("DELETE FROM sync_rules WHERE root_id=?")
            .bind(root_id)
            .execute(&mut *tx)
            .await?;
        let now = unix_ms();
        for rule in rules {
            sqlx::query("INSERT INTO sync_rules(root_id,rule_type,pattern,priority,enabled,created_at) VALUES(?,?,?,?,?,?)")
                .bind(root_id).bind(match rule.rule_type { RuleType::Include => "INCLUDE", RuleType::Exclude => "EXCLUDE" }).bind(&rule.pattern).bind(rule.priority).bind(rule.enabled as i64).bind(now).execute(&mut *tx).await?;
        }
        tx.commit().await?;
        Ok(())
    }

    pub async fn baselines(&self, root_id: &str) -> AppResult<Vec<BaselineEntry>> {
        let rows = sqlx::query("SELECT relative_path,path_key,baseline_state,sync_state,base_hash,base_size,base_mtime_ms,local_exists,local_hash,remote_exists,remote_hash,remote_etag,local_size,remote_size,local_mtime_ns,remote_mtime_ms FROM sync_files WHERE root_id=?").bind(root_id).fetch_all(&self.pool).await?;
        Ok(rows
            .iter()
            .map(|r| BaselineEntry {
                relative_path: r.get("relative_path"),
                path_key: r.get("path_key"),
                baseline_state: r.get("baseline_state"),
                sync_state: r.get("sync_state"),
                base_hash: r.get("base_hash"),
                base_size: r
                    .get::<Option<i64>, _>("base_size")
                    .unwrap_or_default()
                    .max(0) as u64,
                base_mtime_ms: r.get::<Option<i64>, _>("base_mtime_ms").unwrap_or_default(),
                local_exists: r.get::<i64, _>("local_exists") != 0,
                local_hash: r.get("local_hash"),
                remote_exists: r.get::<i64, _>("remote_exists") != 0,
                remote_hash: r.get("remote_hash"),
                remote_etag: r.get("remote_etag"),
                local_size: r
                    .get::<Option<i64>, _>("local_size")
                    .unwrap_or_default()
                    .max(0) as u64,
                remote_size: r
                    .get::<Option<i64>, _>("remote_size")
                    .unwrap_or_default()
                    .max(0) as u64,
                local_mtime_ns: r
                    .get::<Option<i64>, _>("local_mtime_ns")
                    .unwrap_or_default(),
                remote_mtime_ms: r
                    .get::<Option<i64>, _>("remote_mtime_ms")
                    .unwrap_or_default(),
            })
            .collect())
    }

    pub async fn apply_rule_state(
        &self,
        root_id: &str,
        ignored: &[String],
        reenabled: &[String],
    ) -> AppResult<()> {
        let mut tx = self.pool.begin().await?;
        for path in ignored {
            sqlx::query("UPDATE sync_files SET sync_state='IGNORED',updated_at=? WHERE root_id=? AND path_key=?")
                .bind(unix_ms())
                .bind(root_id)
                .bind(path.to_lowercase())
                .execute(&mut *tx)
                .await?;
        }
        for path in reenabled {
            sqlx::query("UPDATE sync_files SET baseline_state='UNKNOWN',base_hash=NULL,base_size=NULL,base_mtime_ms=NULL,sync_state='UNKNOWN',updated_at=? WHERE root_id=? AND path_key=? AND sync_state='IGNORED'")
                .bind(unix_ms())
                .bind(root_id)
                .bind(path.to_lowercase())
                .execute(&mut *tx)
                .await?;
        }
        tx.commit().await?;
        Ok(())
    }

    pub async fn update_scan(
        &self,
        root_id: &str,
        local: &[LocalEntry],
        remote: &[RemoteEntry],
        local_complete: bool,
        remote_complete: bool,
    ) -> AppResult<()> {
        let mut tx = self.pool.begin().await?;
        if local_complete {
            sqlx::query("UPDATE sync_files SET local_exists=0,local_hash=NULL,local_size=NULL,local_mtime_ns=NULL,updated_at=? WHERE root_id=?").bind(unix_ms()).bind(root_id).execute(&mut *tx).await?;
        }
        if remote_complete {
            sqlx::query("UPDATE sync_files SET remote_exists=0,remote_hash=NULL,remote_etag=NULL,remote_size=NULL,remote_mtime_ms=NULL,updated_at=? WHERE root_id=?").bind(unix_ms()).bind(root_id).execute(&mut *tx).await?;
        }
        let now = unix_ms();
        for file in local {
            sqlx::query("INSERT INTO sync_files(root_id,relative_path,path_key,local_exists,local_hash,local_size,local_mtime_ns,last_observed_at,created_at,updated_at) VALUES(?,?,?,1,?,?,?,?,?,?) ON CONFLICT(root_id,path_key) DO UPDATE SET relative_path=excluded.relative_path,local_exists=1,local_hash=excluded.local_hash,local_size=excluded.local_size,local_mtime_ns=excluded.local_mtime_ns,last_observed_at=excluded.last_observed_at,updated_at=excluded.updated_at")
                .bind(root_id).bind(&file.relative_path).bind(&file.path_key).bind(&file.hash).bind(file.size as i64).bind(file.mtime_ns).bind(now).bind(now).bind(now).execute(&mut *tx).await?;
        }
        for file in remote {
            sqlx::query("INSERT INTO sync_files(root_id,relative_path,path_key,remote_exists,remote_hash,remote_etag,remote_size,remote_mtime_ms,last_observed_at,created_at,updated_at) VALUES(?,?,?,1,?,?,?,?,?,?,?) ON CONFLICT(root_id,path_key) DO UPDATE SET relative_path=excluded.relative_path,remote_exists=1,remote_hash=excluded.remote_hash,remote_etag=excluded.remote_etag,remote_size=excluded.remote_size,remote_mtime_ms=excluded.remote_mtime_ms,last_observed_at=excluded.last_observed_at,updated_at=excluded.updated_at")
                .bind(root_id).bind(&file.relative_path).bind(&file.path_key).bind(&file.hash).bind(&file.etag).bind(file.size as i64).bind(file.modified_at).bind(now).bind(now).bind(now).execute(&mut *tx).await?;
        }
        if local_complete && remote_complete {
            sqlx::query("UPDATE sync_roots SET last_full_scan_at=?,updated_at=? WHERE id=?")
                .bind(now)
                .bind(now)
                .bind(root_id)
                .execute(&mut *tx)
                .await?;
        }
        tx.commit().await?;
        Ok(())
    }

    pub async fn update_base(
        &self,
        root_id: &str,
        path: &str,
        hash: Option<&str>,
        local: Option<&LocalEntry>,
        remote: Option<&RemoteEntry>,
    ) -> AppResult<()> {
        let key = path.to_lowercase();
        let now = unix_ms();
        let base_size = hash.map(|_| {
            local
                .map(|v| v.size)
                .or_else(|| remote.map(|v| v.size))
                .unwrap_or_default() as i64
        });
        let base_mtime_ms = hash.map(|_| {
            local
                .map(|v| v.mtime_ns / 1_000_000)
                .or_else(|| remote.map(|v| v.modified_at))
                .unwrap_or(now)
        });
        sqlx::query("INSERT INTO sync_files(root_id,relative_path,path_key,baseline_state,base_hash,base_size,base_mtime_ms,local_exists,local_hash,local_size,local_mtime_ns,remote_exists,remote_hash,remote_etag,remote_size,remote_mtime_ms,last_synced_at,last_observed_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(root_id,path_key) DO UPDATE SET relative_path=excluded.relative_path,baseline_state=excluded.baseline_state,base_hash=excluded.base_hash,base_size=excluded.base_size,base_mtime_ms=excluded.base_mtime_ms,local_exists=excluded.local_exists,local_hash=excluded.local_hash,local_size=excluded.local_size,local_mtime_ns=excluded.local_mtime_ns,remote_exists=excluded.remote_exists,remote_hash=excluded.remote_hash,remote_etag=excluded.remote_etag,remote_size=excluded.remote_size,remote_mtime_ms=excluded.remote_mtime_ms,last_synced_at=excluded.last_synced_at,last_observed_at=excluded.last_observed_at,updated_at=excluded.updated_at")
            .bind(root_id).bind(path).bind(key).bind(if hash.is_some(){"PRESENT"}else{"DELETED"}).bind(hash).bind(base_size).bind(base_mtime_ms)
            .bind(local.is_some() as i64).bind(local.map(|v|v.hash.as_str())).bind(local.map(|v|v.size as i64)).bind(local.map(|v|v.mtime_ns))
            .bind(remote.is_some() as i64).bind(remote.map(|v|v.hash.as_str())).bind(remote.and_then(|v|v.etag.as_deref())).bind(remote.map(|v|v.size as i64)).bind(remote.map(|v|v.modified_at))
            .bind(now).bind(now).bind(now).bind(now).execute(&self.pool).await?;
        Ok(())
    }

    pub async fn files(&self, root_id: &str) -> AppResult<Vec<SyncFileItemDto>> {
        let rows = sqlx::query("SELECT * FROM sync_files WHERE root_id=? AND (local_exists=1 OR remote_exists=1 OR sync_state='IGNORED') ORDER BY relative_path").bind(root_id).fetch_all(&self.pool).await?;
        Ok(rows
            .iter()
            .map(|r| {
                let local_exists = r.get::<i64, _>("local_exists") != 0;
                let remote_exists = r.get::<i64, _>("remote_exists") != 0;
                let local_hash: Option<String> = r.get("local_hash");
                let remote_hash: Option<String> = r.get("remote_hash");
                let state = if r.get::<String, _>("sync_state") == "IGNORED" {
                    "IGNORED"
                } else if local_exists && remote_exists && local_hash == remote_hash {
                    "IN_SYNC"
                } else if local_exists
                    && remote_exists
                    && local_hash.is_some()
                    && remote_hash.is_some()
                {
                    "CONFLICT"
                } else if local_exists {
                    "MODIFIED_LOCAL"
                } else {
                    "MODIFIED_REMOTE"
                };
                SyncFileItemDto {
                    relative_path: r.get("relative_path"),
                    status: state.to_owned(),
                    size_bytes: r
                        .get::<Option<i64>, _>("local_size")
                        .or_else(|| r.get("remote_size"))
                        .unwrap_or_default()
                        .max(0) as u64,
                    local_modified_at: r
                        .get::<Option<i64>, _>("local_mtime_ns")
                        .unwrap_or_default()
                        / 1_000_000,
                    remote_modified_at: r.get("remote_mtime_ms"),
                    blake3_hash: local_hash.or(remote_hash).unwrap_or_default(),
                }
            })
            .collect())
    }

    pub async fn prepare_task(
        &self,
        root_id: &str,
        path: &str,
        action: &SyncAction,
        total: u64,
        expected_hash: Option<&str>,
        etag: Option<&str>,
    ) -> AppResult<(String, bool)> {
        let pending=sqlx::query("SELECT id,status,next_retry_at FROM sync_tasks WHERE root_id=? AND relative_path=? AND status IN ('PENDING','RETRY_WAIT') ORDER BY created_at DESC LIMIT 1")
            .bind(root_id).bind(path).fetch_optional(&self.pool).await?;
        if let Some(row) = pending {
            let id: String = row.get("id");
            let status: String = row.get("status");
            let next_retry: Option<i64> = row.get("next_retry_at");
            if status == "RETRY_WAIT" && next_retry.is_some_and(|value| value > unix_ms()) {
                return Ok((id, false));
            }
            sqlx::query("UPDATE sync_tasks SET operation=?,status='PENDING',expected_local_hash=?,expected_remote_etag=?,bytes_total=?,last_error_code=NULL,last_error_message=NULL,next_retry_at=NULL,updated_at=? WHERE id=?")
                .bind(action.as_db()).bind(expected_hash).bind(etag).bind(total as i64).bind(unix_ms()).bind(&id).execute(&self.pool).await?;
            return Ok((id, true));
        }
        let terminal=sqlx::query("SELECT id FROM sync_tasks WHERE root_id=? AND relative_path=? AND operation=? AND expected_local_hash IS ? AND expected_remote_etag IS ? AND status IN ('FAILED','BLOCKED') ORDER BY created_at DESC LIMIT 1")
            .bind(root_id).bind(path).bind(action.as_db()).bind(expected_hash).bind(etag).fetch_optional(&self.pool).await?;
        if let Some(row) = terminal {
            return Ok((row.get("id"), false));
        }
        let id = uuid::Uuid::new_v4().to_string();
        let now = unix_ms();
        sqlx::query("INSERT INTO sync_tasks(id,root_id,relative_path,operation,status,priority,expected_local_hash,expected_remote_etag,idempotency_key,bytes_total,created_at,updated_at) VALUES(?,?,?,?,'PENDING',100,?,?,?,?,?,?)")
            .bind(&id).bind(root_id).bind(path).bind(action.as_db()).bind(expected_hash).bind(etag).bind(uuid::Uuid::new_v4().to_string()).bind(total as i64).bind(now).bind(now).execute(&self.pool).await?;
        Ok((id, true))
    }

    pub async fn set_task(
        &self,
        id: &str,
        status: TaskStatus,
        transferred: u64,
        error: Option<(&str, &str)>,
    ) -> AppResult<()> {
        let now = unix_ms();
        let (code, message) = error
            .map(|(c, m)| (Some(c), Some(m)))
            .unwrap_or((None, None));
        sqlx::query("UPDATE sync_tasks SET status=?,bytes_transferred=?,attempts=attempts+CASE WHEN ?='RUNNING' THEN 1 ELSE 0 END,last_error_code=?,last_error_message=?,next_retry_at=CASE WHEN ?='RETRY_WAIT' THEN ?+MIN(300000,2000*(1 << MIN(MAX(attempts-1,0),8))) ELSE NULL END,updated_at=?,completed_at=CASE WHEN ? IN ('SUCCEEDED','FAILED','BLOCKED','CANCELLED') THEN ? ELSE NULL END WHERE id=?")
            .bind(status.as_db()).bind(transferred as i64).bind(status.as_db()).bind(code).bind(message).bind(status.as_db()).bind(now).bind(now).bind(status.as_db()).bind(now).bind(id).execute(&self.pool).await?;
        Ok(())
    }

    pub async fn tasks(&self, limit: u32) -> AppResult<Vec<TaskDto>> {
        let rows = sqlx::query("SELECT * FROM sync_tasks WHERE status NOT IN ('SUCCEEDED','CANCELLED') ORDER BY CASE status WHEN 'RUNNING' THEN 0 WHEN 'PENDING' THEN 1 WHEN 'RETRY_WAIT' THEN 2 ELSE 3 END,created_at DESC LIMIT ?").bind(limit.clamp(1,500) as i64).fetch_all(&self.pool).await?;
        Ok(rows
            .iter()
            .map(|r| TaskDto {
                id: r.get("id"),
                root_id: r.get("root_id"),
                path: r.get("relative_path"),
                action: SyncAction::from_db(&r.get::<String, _>("operation")),
                status: TaskStatus::from_db(&r.get::<String, _>("status")),
                bytes_transferred: r.get::<i64, _>("bytes_transferred").max(0) as u64,
                total_bytes: r.get::<i64, _>("bytes_total").max(0) as u64,
                error: r.get("last_error_message"),
                error_code: r.get("last_error_code"),
                retries: r.get::<i64, _>("attempts").max(0) as u32,
                created_at: r.get("created_at"),
                updated_at: r.get("updated_at"),
            })
            .collect())
    }

    pub async fn retry_task(&self, task_id: &str) -> AppResult<String> {
        let row = sqlx::query("SELECT root_id,status FROM sync_tasks WHERE id=?")
            .bind(task_id)
            .fetch_optional(&self.pool)
            .await?
            .ok_or_else(|| AppError::new("TASK_NOT_FOUND", "同步任务不存在"))?;
        let status: String = row.get("status");
        if !matches!(status.as_str(), "FAILED" | "BLOCKED" | "RETRY_WAIT") {
            return Err(AppError::new("TASK_NOT_RETRYABLE", "此任务当前不能重试"));
        }
        sqlx::query("UPDATE sync_tasks SET status='PENDING',next_retry_at=NULL,last_error_code=NULL,last_error_message=NULL,updated_at=? WHERE id=?").bind(unix_ms()).bind(task_id).execute(&self.pool).await?;
        Ok(row.get("root_id"))
    }

    pub async fn has_due_retry(&self, root_id: &str) -> AppResult<bool> {
        let now = unix_ms();
        let count:i64=sqlx::query("SELECT COUNT(*) AS n FROM sync_tasks WHERE root_id=? AND status='RETRY_WAIT' AND COALESCE(next_retry_at,0)<=?")
            .bind(root_id).bind(now).fetch_one(&self.pool).await?.get("n");
        Ok(count > 0)
    }

    pub async fn task_attempts(&self, task_id: &str) -> AppResult<u32> {
        let row = sqlx::query("SELECT attempts FROM sync_tasks WHERE id=?")
            .bind(task_id)
            .fetch_optional(&self.pool)
            .await?
            .ok_or_else(|| AppError::new("TASK_NOT_FOUND", "同步任务不存在"))?;
        Ok(row.get::<i64, _>("attempts").max(0) as u32)
    }

    pub async fn reconcile_tasks_for_path(
        &self,
        root_id: &str,
        path: &str,
        succeeded: bool,
    ) -> AppResult<()> {
        let status = if succeeded { "SUCCEEDED" } else { "CANCELLED" };
        let eligible = if succeeded {
            "'PENDING','RETRY_WAIT','RUNNING','FAILED','BLOCKED'"
        } else {
            "'PENDING','RETRY_WAIT'"
        };
        let query=format!("UPDATE sync_tasks SET status=?,last_error_code=CASE WHEN ?='CANCELLED' THEN 'PLAN_SUPERSEDED' ELSE NULL END,last_error_message=CASE WHEN ?='CANCELLED' THEN '两端状态已变化；任务经重新规划后不再执行' ELSE NULL END,next_retry_at=NULL,updated_at=?,completed_at=? WHERE root_id=? AND relative_path=? AND status IN ({eligible})");
        sqlx::query(&query)
            .bind(status)
            .bind(status)
            .bind(status)
            .bind(unix_ms())
            .bind(unix_ms())
            .bind(root_id)
            .bind(path)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn add_history(&self, entry: HistoryEntry<'_>) -> AppResult<i64> {
        let (code, message) = entry
            .error
            .map(|(c, m)| (Some(c), Some(m)))
            .unwrap_or((None, None));
        let result=sqlx::query("INSERT INTO sync_history(root_id,task_id,relative_path,operation,direction,result,file_size,duration_ms,error_code,error_message,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
            .bind(entry.root_id).bind(entry.task_id).bind(entry.path).bind(entry.action.as_db()).bind(match entry.action { SyncAction::UploadNew|SyncAction::UploadUpdate => "UPLOAD", SyncAction::DownloadNew|SyncAction::DownloadUpdate => "DOWNLOAD", _ => "LOCAL" }).bind(entry.status).bind(entry.bytes as i64).bind(entry.duration_ms as i64).bind(code).bind(message).bind(unix_ms()).execute(&self.pool).await?;
        Ok(result.last_insert_rowid())
    }

    pub async fn add_tombstone(
        &self,
        root_id: &str,
        path: &str,
        side: &str,
        previous_hash: Option<&str>,
        counterpart_hash: Option<&str>,
        status: Option<&str>,
    ) -> AppResult<()> {
        sqlx::query("INSERT INTO sync_tombstones(root_id,relative_path,side,previous_hash,observed_counterpart_hash,device_id,trash_path,status,created_at,completed_at) VALUES(?,?,?,?,?,?,NULL,?,?,?)")
            .bind(root_id).bind(path).bind(side).bind(previous_hash).bind(counterpart_hash).bind(self.device_id().await?).bind(status.unwrap_or("COMPLETED")).bind(unix_ms()).bind(unix_ms()).execute(&self.pool).await?;
        Ok(())
    }

    pub async fn history(
        &self,
        keyword: &str,
        root_id: Option<&str>,
        limit: u32,
        offset: u32,
    ) -> AppResult<Vec<HistoryItemDto>> {
        let like = format!("%{}%", keyword.replace('%', "\\%").replace('_', "\\_"));
        let rows = sqlx::query("SELECT h.*,r.name AS project_name FROM sync_history h JOIN sync_roots r ON r.id=h.root_id WHERE (?='' OR h.relative_path LIKE ? ESCAPE '\\' OR r.name LIKE ? ESCAPE '\\') AND (? IS NULL OR h.root_id=?) ORDER BY h.created_at DESC,h.id DESC LIMIT ? OFFSET ?")
            .bind(keyword).bind(&like).bind(&like).bind(root_id).bind(root_id).bind(limit.clamp(1,500) as i64).bind(offset as i64).fetch_all(&self.pool).await?;
        Ok(rows
            .iter()
            .map(|r| HistoryItemDto {
                id: r.get::<i64, _>("id").to_string(),
                root_id: r.get("root_id"),
                project_name: r.get("project_name"),
                relative_path: r
                    .get::<Option<String>, _>("relative_path")
                    .unwrap_or_default(),
                action: SyncAction::from_db(&r.get::<String, _>("operation")),
                status: r.get("result"),
                bytes: r.get::<i64, _>("file_size").max(0) as u64,
                timestamp: r.get("created_at"),
                error_code: r.get("error_code"),
                error_message: r.get("error_message"),
            })
            .collect())
    }

    pub async fn create_conflict(
        &self,
        root_id: &str,
        item: &PlannedAction,
        base_hash: Option<&str>,
    ) -> AppResult<(String, bool)> {
        let existing = sqlx::query("SELECT id FROM sync_conflicts WHERE root_id=? AND relative_path=? AND status='UNRESOLVED' ORDER BY created_at DESC LIMIT 1").bind(root_id).bind(&item.path).fetch_optional(&self.pool).await?;
        if let Some(row) = existing {
            return Ok((row.get("id"), false));
        }
        let id = uuid::Uuid::new_v4().to_string();
        let now = unix_ms();
        sqlx::query("INSERT INTO sync_conflicts(id,root_id,relative_path,conflict_type,local_hash,remote_hash,base_hash,remote_etag,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,'UNRESOLVED',?,?)")
            .bind(&id).bind(root_id).bind(&item.path).bind(item.conflict.as_ref().map(ConflictType::as_db).unwrap_or("CONCURRENT_MODIFICATION"))
            .bind(item.local.as_ref().map(|v|v.hash.as_str())).bind(item.remote.as_ref().map(|v|v.hash.as_str())).bind(base_hash).bind(item.remote.as_ref().and_then(|v|v.etag.as_deref())).bind(now).bind(now).execute(&self.pool).await?;
        Ok((id, true))
    }

    pub async fn conflict_copy_path(&self, id: &str) -> AppResult<Option<String>> {
        let row = sqlx::query("SELECT local_snapshot_path FROM sync_conflicts WHERE id=?")
            .bind(id)
            .fetch_optional(&self.pool)
            .await?
            .ok_or_else(|| AppError::new("CONFLICT_NOT_FOUND", "冲突不存在"))?;
        Ok(row.get("local_snapshot_path"))
    }

    pub async fn set_conflict_copy_paths(
        &self,
        id: &str,
        local_path: Option<&str>,
        remote_path: Option<&str>,
    ) -> AppResult<()> {
        sqlx::query("UPDATE sync_conflicts SET local_snapshot_path=?,conflict_copy_path=?,updated_at=? WHERE id=?")
            .bind(local_path).bind(remote_path).bind(unix_ms()).bind(id).execute(&self.pool).await?;
        Ok(())
    }

    pub async fn conflicts(
        &self,
        conflict_id: Option<&str>,
        root_id: Option<&str>,
    ) -> AppResult<Vec<ConflictItemDto>> {
        let rows = sqlx::query("SELECT c.*,f.base_size,f.base_mtime_ms,f.local_size,f.local_mtime_ns,f.remote_size,f.remote_mtime_ms, dn.value AS device_name, di.value AS device_id FROM sync_conflicts c LEFT JOIN sync_files f ON f.root_id=c.root_id AND f.path_key=lower(c.relative_path) LEFT JOIN app_settings dn ON dn.key='device_name' LEFT JOIN app_settings di ON di.key='device_id' WHERE c.status='UNRESOLVED' AND (? IS NULL OR c.id=?) AND (? IS NULL OR c.root_id=?) ORDER BY c.created_at DESC")
            .bind(conflict_id).bind(conflict_id).bind(root_id).bind(root_id).fetch_all(&self.pool).await?;
        rows.iter()
            .map(|r| {
                let local_hash: Option<String> = r.get("local_hash");
                let base_hash: Option<String> = r.get("base_hash");
                let local_size = r
                    .get::<Option<i64>, _>("local_size")
                    .unwrap_or_default()
                    .max(0) as u64;
                let remote_size = r
                    .get::<Option<i64>, _>("remote_size")
                    .unwrap_or_default()
                    .max(0) as u64;
                Ok(ConflictItemDto {
                    id: r.get("id"),
                    root_id: r.get("root_id"),
                    relative_path: r.get("relative_path"),
                    conflict_type: ConflictType::from_db(&r.get::<String, _>("conflict_type")),
                    status: r.get("status"),
                    detected_at: r.get("created_at"),
                    base_version: base_hash.map(|hash| FileVersionDto {
                        blake3_hash: hash,
                        size_bytes: r
                            .get::<Option<i64>, _>("base_size")
                            .unwrap_or_default()
                            .max(0) as u64,
                        modified_at: r.get::<Option<i64>, _>("base_mtime_ms").unwrap_or_default(),
                        device_id: r.get::<Option<String>, _>("device_id").unwrap_or_default(),
                        author_device: r.get::<String, _>("device_name"),
                    }),
                    local_version: FileVersionDto {
                        blake3_hash: local_hash.unwrap_or_default(),
                        size_bytes: local_size,
                        modified_at: r
                            .get::<Option<i64>, _>("local_mtime_ns")
                            .unwrap_or_default()
                            / 1_000_000,
                        device_id: r.get::<Option<String>, _>("device_id").unwrap_or_default(),
                        author_device: r.get::<String, _>("device_name"),
                    },
                    remote_version: RemoteVersionDto {
                        etag: r
                            .get::<Option<String>, _>("remote_etag")
                            .unwrap_or_default(),
                        size_bytes: remote_size,
                        modified_at: r
                            .get::<Option<i64>, _>("remote_mtime_ms")
                            .unwrap_or_default(),
                    },
                })
            })
            .collect()
    }

    pub async fn conflict_record(
        &self,
        id: &str,
    ) -> AppResult<(
        String,
        String,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
    )> {
        let r=sqlx::query("SELECT root_id,relative_path,local_hash,remote_hash,base_hash,remote_etag FROM sync_conflicts WHERE id=? AND status='UNRESOLVED'").bind(id).fetch_optional(&self.pool).await?.ok_or_else(|| AppError::new("CONFLICT_NOT_FOUND", "冲突不存在或已解决"))?;
        Ok((
            r.get("root_id"),
            r.get("relative_path"),
            r.get("local_hash"),
            r.get("remote_hash"),
            r.get("base_hash"),
            r.get("remote_etag"),
        ))
    }

    pub async fn resolve_conflict(
        &self,
        id: &str,
        resolution: ConflictResolution,
    ) -> AppResult<()> {
        let label = match resolution {
            ConflictResolution::KeepLocal => "KEEP_LOCAL",
            ConflictResolution::KeepRemote => "KEEP_REMOTE",
            ConflictResolution::KeepBoth => "KEEP_BOTH",
        };
        let result=sqlx::query("UPDATE sync_conflicts SET status='RESOLVED',resolution=?,resolved_at=?,updated_at=? WHERE id=? AND status='UNRESOLVED'").bind(label).bind(unix_ms()).bind(unix_ms()).bind(id).execute(&self.pool).await?;
        if result.rows_affected() == 0 {
            return Err(AppError::new("CONFLICT_NOT_FOUND", "冲突不存在或已解决"));
        }
        Ok(())
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

    pub async fn root_has_unresolved_conflicts(&self, root_id: &str) -> AppResult<bool> {
        let n: i64 = sqlx::query(
            "SELECT COUNT(*) AS n FROM sync_conflicts WHERE root_id=? AND status='UNRESOLVED'",
        )
        .bind(root_id)
        .fetch_one(&self.pool)
        .await?
        .get("n");
        Ok(n > 0)
    }
}

fn account_from_row(r: &sqlx::sqlite::SqliteRow) -> AppResult<AccountRecord> {
    let capability_json: Option<String> = r.get("capability_json");
    let capabilities = capability_json
        .map(|json| serde_json::from_str(&json))
        .transpose()
        .map_err(|e| AppError::new("DATABASE_ERROR", e.to_string()))?;
    Ok(AccountRecord {
        id: r.get("id"),
        name: r.get("name"),
        url: r.get("base_url"),
        username: r.get("username"),
        credential_ref: r.get("credential_ref"),
        tls_verify: r.get::<i64, _>("tls_verify") != 0,
        capabilities,
        last_connected_at: r.get("last_connected_at"),
        status: match r.get::<String, _>("connection_status").as_str() {
            "ONLINE" => "ONLINE",
            "OFFLINE" => "OFFLINE",
            "AUTH_FAILED" => "AUTH_FAILED",
            _ => "UNTESTED",
        }
        .to_owned(),
    })
}

fn root_from_row(r: &sqlx::sqlite::SqliteRow) -> AppResult<RootRecord> {
    Ok(RootRecord {
        id: r.get("id"),
        remote_project_id: r.get("remote_project_id"),
        name: r.get("name"),
        account_id: r.get("account_id"),
        local_path: r.get::<String, _>("local_path").into(),
        remote_path: r.get("remote_path"),
        enabled: r.get::<i64, _>("enabled") != 0,
        status: r.get("sync_status"),
        poll_interval_seconds: r.get::<i64, _>("poll_interval_seconds").max(10) as u32,
        debounce_ms: r.get::<i64, _>("debounce_ms").max(100) as u32,
        last_sync_at: r.get("last_sync_at"),
        initial_sync_completed: r.get::<i64, _>("initial_sync_completed") != 0,
        initial_sync_confirmed: r.get::<i64, _>("initial_sync_confirmed") != 0,
    })
}

fn root_dto_from_row(r: &sqlx::sqlite::SqliteRow) -> AppResult<SyncRootDto> {
    let stored_status: String = r.get("sync_status");
    let status = match stored_status.as_str() {
        "SCANNING_LOCAL" | "SCANNING_REMOTE" | "PLANNING" | "SYNCING" => "SYNCING",
        "DISABLED" => "DISABLED",
        "RETRY_WAIT" | "NEEDS_ATTENTION" => "ERROR",
        other => other,
    }
    .to_owned();
    Ok(SyncRootDto {
        id: r.get("id"),
        remote_project_id: r.get("remote_project_id"),
        name: r.get("name"),
        account_id: r.get("account_id"),
        local_path: r.get("local_path"),
        remote_path: r.get("remote_path"),
        enabled: r.get::<i64, _>("enabled") != 0,
        status,
        poll_interval_seconds: r.get::<i64, _>("poll_interval_seconds").max(0) as u32,
        debounce_ms: r.get::<i64, _>("debounce_ms").max(0) as u32,
        last_sync_at: r.get("last_sync_at"),
        file_count: Some(r.get::<i64, _>("file_count").max(0) as u64),
        pending_changes: Some(r.get::<i64, _>("pending_count").max(0) as u64),
    })
}
