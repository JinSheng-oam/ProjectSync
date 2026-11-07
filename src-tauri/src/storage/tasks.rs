use super::*;

impl Database {
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

    pub async fn cancel_generated_conflict_copy_tasks(&self, root_id: &str) -> AppResult<u64> {
        let rows = sqlx::query(
            "SELECT id,relative_path FROM sync_tasks WHERE root_id=? AND status IN ('PENDING','RETRY_WAIT','RUNNING','FAILED','BLOCKED')",
        )
        .bind(root_id)
        .fetch_all(&self.pool)
        .await?;
        let now = unix_ms();
        let mut cancelled = 0;
        for row in rows {
            let relative_path: String = row.get("relative_path");
            if !is_generated_conflict_copy(&relative_path) {
                continue;
            }
            let id: String = row.get("id");
            let result = sqlx::query(
                "UPDATE sync_tasks SET status='CANCELLED',last_error_code='CONFLICT_COPY_IGNORED',last_error_message='自动生成的冲突副本已排除本地同步；远端副本保留。',next_retry_at=NULL,updated_at=?,completed_at=? WHERE id=? AND root_id=? AND status IN ('PENDING','RETRY_WAIT','RUNNING','FAILED','BLOCKED')",
            )
            .bind(now)
            .bind(now)
            .bind(id)
            .bind(root_id)
            .execute(&self.pool)
            .await?;
            cancelled += result.rows_affected();
        }
        Ok(cancelled)
    }

    pub async fn cancel_tasks_for_paths(
        &self,
        root_id: &str,
        paths: &HashSet<String>,
        error_code: &str,
        error_message: &str,
    ) -> AppResult<u64> {
        if paths.is_empty() {
            return Ok(0);
        }
        let rows = sqlx::query(
            "SELECT id,relative_path FROM sync_tasks WHERE root_id=? AND status IN ('PENDING','RETRY_WAIT','RUNNING','FAILED','BLOCKED')",
        )
        .bind(root_id)
        .fetch_all(&self.pool)
        .await?;
        let now = unix_ms();
        let mut cancelled = 0;
        for row in rows {
            let relative_path: String = row.get("relative_path");
            if !paths.contains(&crate::security::path_key(&relative_path)) {
                continue;
            }
            let id: String = row.get("id");
            let result = sqlx::query(
                "UPDATE sync_tasks SET status='CANCELLED',last_error_code=?,last_error_message=?,next_retry_at=NULL,updated_at=?,completed_at=? WHERE id=? AND root_id=? AND status IN ('PENDING','RETRY_WAIT','RUNNING','FAILED','BLOCKED')",
            )
            .bind(error_code)
            .bind(error_message)
            .bind(now)
            .bind(now)
            .bind(id)
            .bind(root_id)
            .execute(&self.pool)
            .await?;
            cancelled += result.rows_affected();
        }
        Ok(cancelled)
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
}
