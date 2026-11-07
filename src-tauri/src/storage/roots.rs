use super::*;

impl Database {
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
        sqlx::query("INSERT INTO sync_roots(id,remote_project_id,account_id,name,local_path,remote_path,enabled,sync_mode,conflict_policy,delete_policy,poll_interval_seconds,debounce_ms,max_parallel_transfers,initial_sync_completed,initial_sync_confirmed,exclude_git_tracked,sync_status,created_at,updated_at) VALUES(?,?,?,?,?,?,1,'BIDIRECTIONAL','KEEP_BOTH','TRASH',?,?,2,0,1,?,'IDLE',?,?)")
            .bind(&root.id).bind(&root.remote_project_id).bind(&root.account_id).bind(&root.name).bind(root.local_path.to_string_lossy().as_ref()).bind(&root.remote_path).bind(root.poll_interval_seconds as i64).bind(root.debounce_ms as i64).bind(root.exclude_git_tracked as i64).bind(now).bind(now).execute(&mut *tx).await?;
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
        exclude_git_tracked: bool,
    ) -> AppResult<()> {
        let result = sqlx::query("UPDATE sync_roots SET name=?,poll_interval_seconds=?,debounce_ms=?,exclude_git_tracked=?,updated_at=? WHERE id=? AND deleted_at IS NULL")
            .bind(name.trim()).bind(poll.clamp(10, 86_400) as i64).bind(debounce.clamp(100, 30_000) as i64).bind(exclude_git_tracked as i64).bind(unix_ms()).bind(id).execute(&self.pool).await?;
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
        exclude_git_tracked: r.get::<i64, _>("exclude_git_tracked") != 0,
        status: r.get("sync_status"),
        poll_interval_seconds: r.get::<i64, _>("poll_interval_seconds").max(10) as u32,
        debounce_ms: r.get::<i64, _>("debounce_ms").max(100) as u32,
        max_parallel_transfers: r.get::<i64, _>("max_parallel_transfers").clamp(1, 8) as u32,
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
        exclude_git_tracked: r.get::<i64, _>("exclude_git_tracked") != 0,
        status,
        poll_interval_seconds: r.get::<i64, _>("poll_interval_seconds").max(0) as u32,
        debounce_ms: r.get::<i64, _>("debounce_ms").max(0) as u32,
        last_sync_at: r.get("last_sync_at"),
        file_count: Some(r.get::<i64, _>("file_count").max(0) as u64),
        pending_changes: Some(r.get::<i64, _>("pending_count").max(0) as u64),
    })
}
