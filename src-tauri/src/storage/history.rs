use super::*;

impl Database {
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
}
