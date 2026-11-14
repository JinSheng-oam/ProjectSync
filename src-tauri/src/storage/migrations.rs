use super::*;

pub(super) async fn reconcile_migration_line_endings(
    pool: &SqlitePool,
    migrator: &sqlx::migrate::Migrator,
) -> AppResult<()> {
    let mut tx = pool.begin().await?;
    for migration in migrator.iter() {
        let Some(row) = sqlx::query(
            "SELECT checksum FROM _sqlx_migrations WHERE version = ? AND success = 1",
        )
        .bind(migration.version)
        .fetch_optional(&mut *tx)
        .await?
        else {
            continue;
        };
        let applied_checksum: Vec<u8> = row.try_get("checksum")?;
        if applied_checksum.as_slice() == migration.checksum.as_ref() {
            continue;
        }

        let normalized_sql = migration.sql.replace("\r\n", "\n");
        let lf_checksum = checksum_for_migration_sql(migration, normalized_sql.clone());
        let crlf_checksum =
            checksum_for_migration_sql(migration, normalized_sql.replace('\n', "\r\n"));
        if applied_checksum != lf_checksum && applied_checksum != crlf_checksum {
            return Err(AppError::new(
                "DATABASE_MIGRATION_FAILED",
                format!(
                    "迁移 {} 的校验和与当前内容不一致，且无法解释为换行符差异；为保护数据库，已停止启动。",
                    migration.version
                ),
            ));
        }

        let updated = sqlx::query(
            "UPDATE _sqlx_migrations SET checksum = ? WHERE version = ? AND success = 1 AND checksum = ?",
        )
        .bind(&migration.checksum[..])
        .bind(migration.version)
        .bind(&applied_checksum)
        .execute(&mut *tx)
        .await?;
        if updated.rows_affected() != 1 {
            return Err(AppError::retryable(
                "DATABASE_MIGRATION_FAILED",
                format!("迁移 {} 的校验和记录发生并发变化，请重启后重试。", migration.version),
            ));
        }
    }
    tx.commit().await?;
    Ok(())
}

fn checksum_for_migration_sql(migration: &sqlx::migrate::Migration, sql: String) -> Vec<u8> {
    sqlx::migrate::Migration::new(
        migration.version,
        migration.description.clone(),
        migration.migration_type.clone(),
        Cow::Owned(sql),
        migration.no_tx,
    )
    .checksum
    .into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn upgrade_preserves_project_history_and_allows_rebinding_and_account_deletion() {
        let dir = std::env::temp_dir().join(format!("projectsync-migration-{}", uuid::Uuid::new_v4()));
        tokio::fs::create_dir(&dir).await.unwrap();
        let path = dir.join("data.db");
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(SqliteConnectOptions::new().filename(&path).create_if_missing(true).foreign_keys(true))
            .await.unwrap();
        let all = sqlx::migrate!("./migrations");
        let old = sqlx::migrate::Migrator {
            migrations: Cow::Owned(all.iter().filter(|m| m.version <= 4).cloned().collect()),
            ..sqlx::migrate::Migrator::DEFAULT
        };
        old.run(&pool).await.unwrap();
        sqlx::query("INSERT INTO webdav_accounts(id,name,base_url,username,credential_ref,created_at,updated_at) VALUES ('a','node','https://example.test','u','secret-ref',1,1)")
            .execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO sync_roots(id,remote_project_id,account_id,name,local_path,remote_path,created_at,updated_at) VALUES ('old','shared','a','project','C:/project','/projects/project',1,1)")
            .execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO sync_rules(root_id,rule_type,pattern,created_at) VALUES ('old','INCLUDE','*.md',1)")
            .execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO sync_history(root_id,operation,result,created_at) VALUES ('old','UPLOAD_NEW','SUCCESS',1)")
            .execute(&pool).await.unwrap();
        pool.close().await;

        let db = Database::open(&path).await.unwrap();
        assert_eq!(sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM sync_rules WHERE root_id='old'").fetch_one(&db.pool).await.unwrap(), 1);
        assert_eq!(db.delete_account("a").await.unwrap_err().code, "ACCOUNT_IN_USE");
        db.delete_root("old").await.unwrap();
        let insert = "INSERT INTO sync_roots(id,remote_project_id,account_id,name,local_path,remote_path,created_at,updated_at) VALUES (?,'shared','a','project','C:/project','/projects/project',2,2)";
        sqlx::query(insert).bind("new").execute(&db.pool).await.unwrap();
        assert!(sqlx::query(insert).bind("duplicate").execute(&db.pool).await.is_err());
        db.delete_root("new").await.unwrap();
        assert_eq!(db.delete_account("a").await.unwrap(), "secret-ref");
        assert_eq!(sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM sync_roots WHERE account_id IS NULL AND deleted_at IS NOT NULL").fetch_one(&db.pool).await.unwrap(), 2);
        assert_eq!(sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM sync_history WHERE root_id='old'").fetch_one(&db.pool).await.unwrap(), 1);
        assert_eq!(sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM pragma_foreign_key_check").fetch_one(&db.pool).await.unwrap(), 0);
        db.pool.close().await;
        drop(db);
        // SQLite's Windows worker can release its file handles just after close.
        for attempt in 0..20 {
            match tokio::fs::remove_dir_all(&dir).await {
                Ok(()) => break,
                Err(error) if attempt < 19 && error.kind() == std::io::ErrorKind::PermissionDenied
                    || attempt < 19 && error.raw_os_error() == Some(32) =>
                {
                    tokio::time::sleep(Duration::from_millis(50)).await;
                }
                Err(error) => panic!("cannot remove migration test directory: {error}"),
            }
        }
    }
}
