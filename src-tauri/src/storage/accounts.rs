use super::*;

impl Database {
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
