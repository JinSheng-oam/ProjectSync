use super::*;

impl Database {
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
        self.resolve_conflict_as(id, label).await
    }

    pub async fn resolve_conflict_as(&self, id: &str, label: &str) -> AppResult<()> {
        let result=sqlx::query("UPDATE sync_conflicts SET status='RESOLVED',resolution=?,resolved_at=?,updated_at=? WHERE id=? AND status='UNRESOLVED'").bind(label).bind(unix_ms()).bind(unix_ms()).bind(id).execute(&self.pool).await?;
        if result.rows_affected() == 0 {
            return Err(AppError::new("CONFLICT_NOT_FOUND", "冲突不存在或已解决"));
        }
        Ok(())
    }

    pub async fn resolve_conflicts_for_path(&self, root_id: &str, path: &str) -> AppResult<()> {
        let now = unix_ms();
        sqlx::query("UPDATE sync_conflicts SET status='RESOLVED',resolution='CONTENT_MATCH',resolved_at=?,updated_at=? WHERE root_id=? AND lower(relative_path)=lower(?) AND status='UNRESOLVED'")
            .bind(now).bind(now).bind(root_id).bind(path).execute(&self.pool).await?;
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
