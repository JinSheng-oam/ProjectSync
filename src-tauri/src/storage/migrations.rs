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
