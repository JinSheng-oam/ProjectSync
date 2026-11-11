use super::*;

impl Database {
    pub async fn baselines(&self, root_id: &str) -> AppResult<Vec<BaselineEntry>> {
        let rows = sqlx::query("SELECT relative_path,path_key,baseline_state,sync_state,base_hash,base_remote_hash,base_size,base_mtime_ms,local_exists,local_hash,remote_exists,remote_hash,remote_etag,local_size,remote_size,local_mtime_ns,remote_mtime_ms FROM sync_files WHERE root_id=?").bind(root_id).fetch_all(&self.pool).await?;
        Ok(rows
            .iter()
            .map(|r| BaselineEntry {
                relative_path: r.get("relative_path"),
                path_key: r.get("path_key"),
                baseline_state: r.get("baseline_state"),
                sync_state: r.get("sync_state"),
                base_hash: r.get("base_hash"),
                base_remote_hash: r.get("base_remote_hash"),
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
            sqlx::query("UPDATE sync_files SET baseline_state='UNKNOWN',base_hash=NULL,base_remote_hash=NULL,base_size=NULL,base_mtime_ms=NULL,sync_state='UNKNOWN',updated_at=? WHERE root_id=? AND path_key=? AND sync_state='IGNORED'")
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
            sqlx::query("UPDATE sync_files SET local_exists=0 WHERE root_id=? AND local_exists=1").bind(root_id).execute(&mut *tx).await?;
        }
        if remote_complete {
            sqlx::query("UPDATE sync_files SET remote_exists=0 WHERE root_id=? AND remote_exists=1").bind(root_id).execute(&mut *tx).await?;
        }
        let now = unix_ms();
        for file in local {
            sqlx::query("INSERT INTO sync_files(root_id,relative_path,path_key,local_exists,local_hash,local_size,local_mtime_ns,last_observed_at,created_at,updated_at) VALUES(?,?,?,1,?,?,?,?,?,?) ON CONFLICT(root_id,path_key) DO UPDATE SET sync_state=CASE WHEN sync_state='LINE_ENDINGS_EQUIVALENT' AND local_hash IS NOT excluded.local_hash THEN 'UNKNOWN' ELSE sync_state END,relative_path=excluded.relative_path,local_exists=1,local_hash=excluded.local_hash,local_size=excluded.local_size,local_mtime_ns=excluded.local_mtime_ns,last_observed_at=excluded.last_observed_at,updated_at=excluded.updated_at")
                .bind(root_id).bind(&file.relative_path).bind(&file.path_key).bind(&file.hash).bind(file.size as i64).bind(file.mtime_ns).bind(now).bind(now).bind(now).execute(&mut *tx).await?;
        }
        for file in remote {
            sqlx::query("INSERT INTO sync_files(root_id,relative_path,path_key,remote_exists,remote_hash,remote_etag,remote_size,remote_mtime_ms,last_observed_at,created_at,updated_at) VALUES(?,?,?,1,?,?,?,?,?,?,?) ON CONFLICT(root_id,path_key) DO UPDATE SET sync_state=CASE WHEN sync_state='LINE_ENDINGS_EQUIVALENT' AND remote_hash IS NOT excluded.remote_hash THEN 'UNKNOWN' ELSE sync_state END,relative_path=excluded.relative_path,remote_exists=1,remote_hash=excluded.remote_hash,remote_etag=excluded.remote_etag,remote_size=excluded.remote_size,remote_mtime_ms=excluded.remote_mtime_ms,last_observed_at=excluded.last_observed_at,updated_at=excluded.updated_at")
                .bind(root_id).bind(&file.relative_path).bind(&file.path_key).bind(&file.hash).bind(&file.etag).bind(file.size as i64).bind(file.modified_at).bind(now).bind(now).bind(now).execute(&mut *tx).await?;
        }
        if local_complete {
            sqlx::query("UPDATE sync_files SET local_hash=NULL,local_size=NULL,local_mtime_ns=NULL,updated_at=? WHERE root_id=? AND local_exists=0 AND local_hash IS NOT NULL")
                .bind(now).bind(root_id).execute(&mut *tx).await?;
        }
        if remote_complete {
            sqlx::query("UPDATE sync_files SET remote_hash=NULL,remote_etag=NULL,remote_size=NULL,remote_mtime_ms=NULL,updated_at=? WHERE root_id=? AND remote_exists=0 AND remote_hash IS NOT NULL")
                .bind(now).bind(root_id).execute(&mut *tx).await?;
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
        sqlx::query("INSERT INTO sync_files(root_id,relative_path,path_key,baseline_state,base_hash,base_remote_hash,base_size,base_mtime_ms,local_exists,local_hash,local_size,local_mtime_ns,remote_exists,remote_hash,remote_etag,remote_size,remote_mtime_ms,last_synced_at,last_observed_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(root_id,path_key) DO UPDATE SET relative_path=excluded.relative_path,baseline_state=excluded.baseline_state,base_hash=excluded.base_hash,base_remote_hash=excluded.base_remote_hash,base_size=excluded.base_size,base_mtime_ms=excluded.base_mtime_ms,local_exists=excluded.local_exists,local_hash=excluded.local_hash,local_size=excluded.local_size,local_mtime_ns=excluded.local_mtime_ns,remote_exists=excluded.remote_exists,remote_hash=excluded.remote_hash,remote_etag=excluded.remote_etag,remote_size=excluded.remote_size,remote_mtime_ms=excluded.remote_mtime_ms,last_synced_at=excluded.last_synced_at,last_observed_at=excluded.last_observed_at,updated_at=excluded.updated_at")
            .bind(root_id).bind(path).bind(key).bind(if hash.is_some(){"PRESENT"}else{"DELETED"}).bind(hash).bind(hash.and(remote.map(|v| v.hash.as_str()))).bind(base_size).bind(base_mtime_ms)
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
                let sync_state = r.get::<String, _>("sync_state");
                let state = if sync_state == "IGNORED" {
                    "IGNORED"
                } else if local_exists
                    && remote_exists
                    && (local_hash == remote_hash || sync_state == "LINE_ENDINGS_EQUIVALENT")
                {
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

    pub async fn mark_line_endings_equivalent(&self, root_id: &str, path: &str) -> AppResult<()> {
        sqlx::query("UPDATE sync_files SET sync_state='LINE_ENDINGS_EQUIVALENT',updated_at=? WHERE root_id=? AND path_key=?")
            .bind(unix_ms()).bind(root_id).bind(path.to_lowercase()).execute(&self.pool).await?;
        Ok(())
    }
}
