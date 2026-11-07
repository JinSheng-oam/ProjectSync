use super::*;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateAccountInput {
    pub name: String,
    pub url: String,
    pub username: String,
    pub password: Option<String>,
    pub tls_verify: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteEntryDto {
    pub path: String,
    pub name: String,
    pub is_collection: bool,
    pub size: u64,
    pub modified_at: i64,
    pub etag: Option<String>,
}

#[tauri::command]
pub async fn list_webdav_accounts(state: State<'_, AppState>) -> ApiResult<Vec<WebDavAccountDto>> {
    api(state.db.accounts().await)
}

#[tauri::command]
pub async fn create_webdav_account(
    state: State<'_, AppState>,
    mut account: WebDavAccountInput,
) -> ApiResult<WebDavAccountDto> {
    let result = async {
        if account.name.trim().is_empty()
            || account.username.trim().is_empty()
            || account.password.is_empty()
        {
            return Err(crate::domain::AppError::new(
                "ACCOUNT_INVALID",
                "账号名称、用户名和密码不能为空",
            ));
        }
        let normalized = validate_webdav_url(&account.url)?.to_string();
        account.url = normalized;
        let capabilities = state
            .sync
            .test_connection(
                &account.url,
                &account.username,
                account.password.clone(),
                account.tls_verify,
            )
            .await?;
        let id = uuid::Uuid::new_v4().to_string();
        let reference = format!("ProjectSync/WebDAV/{id}");
        CredentialStore::set(&reference, &account.password)?;
        if let Err(error) = state.db.insert_account(&id, &account, &reference).await {
            let _ = CredentialStore::delete(&reference);
            return Err(error);
        }
        state
            .db
            .save_capabilities(&id, &capabilities, "ONLINE")
            .await?;
        Ok(state.db.account(&id).await?.into())
    }
    .await;
    account.password.zeroize();
    api(result)
}

#[tauri::command]
pub async fn update_webdav_account(
    state: State<'_, AppState>,
    account_id: String,
    mut account: UpdateAccountInput,
) -> ApiResult<WebDavAccountDto> {
    let result = async {
        let current = state.db.account(&account_id).await?;
        let url = validate_webdav_url(&account.url)?.to_string();
        let password = Zeroizing::new(match account.password.as_ref().filter(|v| !v.is_empty()) {
            Some(value) => value.clone(),
            None => CredentialStore::get(&current.credential_ref)?,
        });
        let capabilities = state
            .sync
            .test_connection(
                &url,
                &account.username,
                password.to_string(),
                account.tls_verify,
            )
            .await?;
        if account
            .password
            .as_ref()
            .is_some_and(|value| !value.is_empty())
        {
            CredentialStore::set(&current.credential_ref, &password)?;
        }
        state
            .db
            .update_account(
                &account_id,
                &account.name,
                &url,
                &account.username,
                account.tls_verify,
                None,
            )
            .await?;
        state
            .db
            .save_capabilities(&account_id, &capabilities, "ONLINE")
            .await?;
        Ok(state.db.account(&account_id).await?.into())
    }
    .await;
    if let Some(password) = account.password.as_mut() {
        password.zeroize();
    }
    api(result)
}

#[tauri::command]
pub async fn delete_webdav_account(
    state: State<'_, AppState>,
    account_id: String,
) -> ApiResult<()> {
    api(async {
        let reference = state.db.delete_account(&account_id).await?;
        CredentialStore::delete(&reference)?;
        Ok(())
    }
    .await)
}

#[tauri::command]
pub async fn test_webdav_connection(
    state: State<'_, AppState>,
    url: String,
    username: String,
    mut password: String,
    tls_verify: bool,
) -> ApiResult<WebDavCapabilities> {
    let result = state
        .sync
        .test_connection(&url, &username, password.clone(), tls_verify)
        .await;
    password.zeroize();
    api(result)
}

#[tauri::command]
pub async fn browse_remote_directory(
    state: State<'_, AppState>,
    account_id: String,
    path: String,
) -> ApiResult<Vec<RemoteEntryDto>> {
    api(async {
        let path = normalize_remote_path(&path)?;
        let (_, client) = state.sync.client_for(&account_id).await?;
        let entries = client.propfind(&path, 1).await?;
        let mut result = Vec::new();
        for entry in entries {
            let remote_path = href_to_dav_path(&client, &entry.path, &path)?;
            if !is_direct_remote_child(&path, &remote_path) {
                continue;
            }
            let name = remote_path
                .rsplit('/')
                .next()
                .unwrap_or_default()
                .to_owned();
            result.push(RemoteEntryDto {
                path: remote_path,
                name,
                is_collection: entry.is_collection,
                size: entry.size,
                modified_at: entry.modified_at,
                etag: entry.etag,
            });
        }
        result.sort_by(|a, b| {
            b.is_collection
                .cmp(&a.is_collection)
                .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
                .then_with(|| a.name.cmp(&b.name))
        });
        Ok(result)
    }
    .await)
}

fn is_direct_remote_child(parent: &str, child: &str) -> bool {
    let prefix = if parent == "/" {
        "/".to_owned()
    } else {
        format!("{parent}/")
    };
    child
        .strip_prefix(&prefix)
        .is_some_and(|name| !name.is_empty() && !name.contains('/'))
}

#[cfg(test)]
mod browse_tests {
    use super::is_direct_remote_child;

    #[test]
    fn only_immediate_children_are_listed() {
        assert!(!is_direct_remote_child("/", "/"));
        assert!(is_direct_remote_child("/", "/projects"));
        assert!(!is_direct_remote_child("/", "/projects/nested"));
        assert!(!is_direct_remote_child("/projects", "/projects"));
        assert!(is_direct_remote_child("/projects", "/projects/中文 文件"));
        assert!(!is_direct_remote_child(
            "/projects",
            "/projects/nested/file"
        ));
        assert!(!is_direct_remote_child("/projects", "/projects-other/file"));
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredProject {
    account_id: String,
    remote_path: String,
    remote_project_id: Option<String>,
    name: String,
}

#[tauri::command]
pub async fn discover_remote_projects(
    state: State<'_, AppState>,
    account_id: String,
) -> ApiResult<Vec<DiscoveredProject>> {
    api(async {
        let (_, client) = state.sync.client_for(&account_id).await?;
        let roots = state.db.roots().await?;
        let bound = roots
            .iter()
            .map(|r| r.remote_project_id.clone())
            .collect::<HashSet<_>>();
        let bound_paths = roots
            .iter()
            .filter(|r| r.account_id == account_id)
            .map(|r| r.remote_path.trim_end_matches('/').to_owned())
            .collect::<HashSet<_>>();
        let mut queue = std::collections::VecDeque::from(["/".to_owned()]);
        let mut seen = HashSet::new();
        let mut result = Vec::new();
        while let Some(path) = queue.pop_front() {
            if !seen.insert(path.clone()) {
                continue;
            }
            if seen.len() > 500 {
                return Err(crate::domain::AppError::new(
                    "DISCOVERY_LIMIT",
                    "远端目录超过 500 项，无法完成项目发现",
                ));
            }
            let manifest_path = format!("{}/.projectsync/root.json", path.trim_end_matches('/'));
            let mut project_root = false;
            match client.get_bytes(&manifest_path).await {
                Ok(bytes) => {
                    project_root = true;
                    let value: serde_json::Value =
                        serde_json::from_slice(&bytes).map_err(|_| {
                            crate::domain::AppError::new(
                                "DAV_INVALID_RESPONSE",
                                "远端项目标识格式无效",
                            )
                        })?;
                    let id = value
                        .get("remote_project_id")
                        .and_then(|v| v.as_str())
                        .filter(|v| !v.trim().is_empty())
                        .ok_or_else(|| {
                            crate::domain::AppError::new("DAV_INVALID_RESPONSE", "远端项目标识缺失")
                        })?;
                    if value.get("schema_version").and_then(|v| v.as_u64()) != Some(1) {
                        return Err(crate::domain::AppError::new(
                            "DAV_INVALID_RESPONSE",
                            "远端项目标识版本不支持",
                        ));
                    }
                    if !bound.contains(id) && !bound_paths.contains(&path) {
                        result.push(DiscoveredProject {
                            account_id: account_id.clone(),
                            remote_path: path.clone(),
                            remote_project_id: Some(id.to_owned()),
                            name: path
                                .rsplit('/')
                                .next()
                                .filter(|s| !s.is_empty())
                                .unwrap_or("远端项目")
                                .to_owned(),
                        });
                    }
                }
                Err(e) if e.code == "DAV_NOT_FOUND" => {
                    if is_direct_remote_child("/projects", &path) {
                        project_root = true;
                        if !bound_paths.contains(&path) {
                            result.push(DiscoveredProject {
                                account_id: account_id.clone(),
                                remote_path: path.clone(),
                                remote_project_id: None,
                                name: path.rsplit('/').next().unwrap_or("远端项目").to_owned(),
                            });
                        }
                    }
                }
                Err(e) => return Err(e),
            }
            if project_root {
                continue;
            }
            let entries = client.propfind(&path, 1).await?;
            for entry in entries.into_iter().filter(|e| e.is_collection) {
                let child = href_to_dav_path(&client, &entry.path, &path)?;
                if is_direct_remote_child(&path, &child)
                    && !child
                        .rsplit('/')
                        .next()
                        .is_some_and(|name| name.eq_ignore_ascii_case(".projectsync"))
                {
                    queue.push_back(child);
                }
            }
        }
        result.sort_by(|a, b| a.remote_path.cmp(&b.remote_path));
        Ok(result)
    }
    .await)
}
