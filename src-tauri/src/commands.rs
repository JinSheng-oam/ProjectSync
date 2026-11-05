use crate::{
    app::AppState,
    credentials::CredentialStore,
    domain::{
        api, ApiResult, AppSettingsDto, ConflictResolution, HistoryItemDto, InitialSyncPreviewDto,
        RuleImpactDto, SyncFileItemDto, SyncRootDto, SyncRuleDto, SyncStatusDto, SyncSummaryDto,
        TaskDto, WebDavAccountDto, WebDavAccountInput, WebDavCapabilities,
    },
    filesystem::{scan_local, RuleEngine},
    security::{normalize_remote_path, validate_webdav_url},
    webdav::href_to_dav_path,
};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use tauri::State;
use zeroize::{Zeroize, Zeroizing};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateRootInput {
    pub name: String,
    pub account_id: String,
    pub local_path: String,
    pub remote_path: String,
    pub rules: Vec<SyncRuleDto>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateRootInput {
    pub name: String,
    pub poll_interval_seconds: u32,
    pub debounce_ms: u32,
}

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
        let entries = match client.propfind(&path, 1).await {
            Ok(entries) => entries,
            Err(error) if error.code == "DAV_NOT_FOUND" => return Ok(Vec::new()),
            Err(error) => return Err(error),
        };
        entries
            .into_iter()
            .map(|entry| {
                let remote_path = href_to_dav_path(&client, &entry.path, &path)?;
                let name = remote_path
                    .trim_end_matches('/')
                    .rsplit('/')
                    .next()
                    .unwrap_or_default()
                    .to_owned();
                Ok(RemoteEntryDto {
                    path: remote_path,
                    name,
                    is_collection: entry.is_collection,
                    size: entry.size,
                    modified_at: entry.modified_at,
                    etag: entry.etag,
                })
            })
            .collect()
    }
    .await)
}

#[tauri::command]
pub async fn list_sync_roots(state: State<'_, AppState>) -> ApiResult<Vec<SyncRootDto>> {
    api(state.db.roots().await)
}

#[tauri::command]
pub async fn create_sync_root(
    state: State<'_, AppState>,
    data: CreateRootInput,
) -> ApiResult<SyncRootDto> {
    api(async {
        let root = state
            .sync
            .create_root(
                data.name,
                data.account_id,
                data.local_path,
                data.remote_path,
                data.rules,
            )
            .await?;
        if let Err(error) = state.install_watcher(&root) {
            tracing::warn!(root_id=%root.id,error=%error,"local watcher unavailable; periodic scans remain active");
        }
        let sync = state.sync.clone();
        let root_id = root.id.clone();
        tauri::async_runtime::spawn(async move {
            if let Err(error) = sync.sync_now(&root_id).await {
                tracing::warn!(root_id=%root_id,error=%error,"initial sync did not complete");
            }
        });
        Ok(root)
    }
    .await)
}

#[tauri::command]
pub async fn update_sync_root(
    state: State<'_, AppState>,
    root_id: String,
    data: UpdateRootInput,
) -> ApiResult<()> {
    api(state
        .db
        .update_root(
            &root_id,
            &data.name,
            data.poll_interval_seconds,
            data.debounce_ms,
        )
        .await)
}

#[tauri::command]
pub async fn delete_sync_root(state: State<'_, AppState>, root_id: String) -> ApiResult<()> {
    api(async {
        state.db.delete_root(&root_id).await?;
        state.sync.cancel_root(&root_id);
        state.remove_watcher(&root_id);
        Ok(())
    }
    .await)
}

#[tauri::command]
pub async fn enable_sync_root(state: State<'_, AppState>, root_id: String) -> ApiResult<()> {
    api(async {
        state.db.set_root_enabled(&root_id, true).await?;
        let root = state
            .db
            .roots()
            .await?
            .into_iter()
            .find(|r| r.id == root_id)
            .ok_or_else(|| crate::domain::AppError::new("ROOT_NOT_FOUND", "同步项目不存在"))?;
        state.install_watcher(&root)?;
        let _ = state.sync.sync_now(&root_id).await?;
        Ok(())
    }
    .await)
}

#[tauri::command]
pub async fn disable_sync_root(state: State<'_, AppState>, root_id: String) -> ApiResult<()> {
    api(async {
        state.db.set_root_enabled(&root_id, false).await?;
        state.sync.cancel_root(&root_id);
        state.remove_watcher(&root_id);
        Ok(())
    }
    .await)
}

#[tauri::command]
pub async fn preview_initial_sync(
    state: State<'_, AppState>,
    account_id: String,
    local_path: String,
    remote_path: String,
    rules: Vec<SyncRuleDto>,
) -> ApiResult<InitialSyncPreviewDto> {
    api(state
        .sync
        .preview(&account_id, &local_path, &remote_path, &rules)
        .await)
}

#[tauri::command]
pub async fn confirm_initial_sync(
    state: State<'_, AppState>,
    root_id: String,
) -> ApiResult<SyncSummaryDto> {
    api(state.sync.confirm_initial_sync(&root_id).await)
}

#[tauri::command]
pub async fn sync_now(state: State<'_, AppState>, root_id: String) -> ApiResult<SyncSummaryDto> {
    api(state.sync.sync_now(&root_id).await)
}

#[tauri::command]
pub async fn pause_sync(state: State<'_, AppState>, root_id: String) -> ApiResult<()> {
    api(state.sync.pause(&root_id).await)
}

#[tauri::command]
pub async fn resume_sync(state: State<'_, AppState>, root_id: String) -> ApiResult<()> {
    api(state.sync.resume(&root_id).await)
}

#[tauri::command]
pub async fn get_sync_status(
    state: State<'_, AppState>,
    root_id: String,
) -> ApiResult<SyncStatusDto> {
    api(state.db.status(&root_id).await)
}

#[tauri::command]
pub async fn get_pending_tasks(state: State<'_, AppState>) -> ApiResult<Vec<TaskDto>> {
    api(state.db.tasks(200).await)
}

#[tauri::command]
pub async fn retry_failed_task(
    state: State<'_, AppState>,
    task_id: String,
) -> ApiResult<SyncSummaryDto> {
    api(async {
        let root_id = state.db.retry_task(&task_id).await?;
        state.sync.sync_now(&root_id).await
    }
    .await)
}

#[tauri::command]
pub async fn get_sync_rules(
    state: State<'_, AppState>,
    root_id: String,
) -> ApiResult<Vec<SyncRuleDto>> {
    api(state.db.rules(&root_id).await)
}

#[tauri::command]
pub async fn replace_sync_rules(
    state: State<'_, AppState>,
    root_id: String,
    rules: Vec<SyncRuleDto>,
) -> ApiResult<()> {
    api(async {
        let _ = RuleEngine::compile(&rules)?;
        state.db.replace_rules(&root_id, &rules).await
    }
    .await)
}

#[tauri::command]
pub async fn preview_rule_impact(
    state: State<'_, AppState>,
    root_id: String,
    rules: Vec<SyncRuleDto>,
) -> ApiResult<RuleImpactDto> {
    api(async {
        let root = state.db.root(&root_id).await?;
        let old_rules = state.db.rules(&root_id).await?;
        let old = scan_local(&root.local_path, &old_rules)?
            .into_iter()
            .map(|entry| entry.relative_path)
            .collect::<HashSet<_>>();
        let new = scan_local(&root.local_path, &rules)?
            .into_iter()
            .map(|entry| entry.relative_path)
            .collect::<HashSet<_>>();
        let newly_included = new.difference(&old).cloned().collect::<Vec<_>>();
        let newly_excluded = old.difference(&new).cloned().collect::<Vec<_>>();
        let unchanged = old.intersection(&new).count() as u64;
        Ok(RuleImpactDto {
            newly_included,
            newly_excluded,
            unchanged,
        })
    }
    .await)
}

#[tauri::command]
pub async fn list_files(
    state: State<'_, AppState>,
    root_id: String,
) -> ApiResult<Vec<SyncFileItemDto>> {
    api(state.db.files(&root_id).await)
}

#[tauri::command]
pub async fn list_conflicts(
    state: State<'_, AppState>,
) -> ApiResult<Vec<crate::domain::ConflictItemDto>> {
    api(state.db.conflicts(None, None).await)
}

#[tauri::command]
pub async fn get_conflict_detail(
    state: State<'_, AppState>,
    conflict_id: String,
) -> ApiResult<crate::domain::ConflictItemDto> {
    api(async {
        state
            .db
            .conflicts(Some(&conflict_id), None)
            .await?
            .into_iter()
            .next()
            .ok_or_else(|| crate::domain::AppError::new("CONFLICT_NOT_FOUND", "冲突不存在或已解决"))
    }
    .await)
}

#[tauri::command]
pub async fn resolve_conflict(
    state: State<'_, AppState>,
    conflict_id: String,
    resolution: ConflictResolution,
) -> ApiResult<serde_json::Value> {
    api(async {
        let message = state
            .sync
            .resolve_conflict(&conflict_id, resolution)
            .await?;
        Ok(serde_json::json!({"success":true,"message":message}))
    }
    .await)
}

#[tauri::command]
pub async fn query_sync_history(
    state: State<'_, AppState>,
    keyword: Option<String>,
    root_id: Option<String>,
    limit: Option<u32>,
    offset: Option<u32>,
) -> ApiResult<Vec<HistoryItemDto>> {
    api(state
        .db
        .history(
            keyword.as_deref().unwrap_or(""),
            root_id.as_deref(),
            limit.unwrap_or(100),
            offset.unwrap_or(0),
        )
        .await)
}

#[tauri::command]
pub async fn export_diagnostics(state: State<'_, AppState>, destination: String) -> ApiResult<()> {
    api(state
        .export_diagnostics(std::path::Path::new(&destination))
        .await)
}

#[tauri::command]
pub async fn backup_database(state: State<'_, AppState>, destination: String) -> ApiResult<u64> {
    api(state.db.backup_to(std::path::Path::new(&destination)).await)
}

#[tauri::command]
pub async fn get_app_settings(state: State<'_, AppState>) -> ApiResult<AppSettingsDto> {
    api(async {
        Ok(AppSettingsDto {
            device_id: state.db.device_id().await?,
            device_name: state.db.device_name().await?,
            poll_interval_seconds: setting_u32(&state, "pollIntervalSeconds", 60).await,
            debounce_ms: setting_u32(&state, "debounceMs", 1200).await,
            auto_start: crate::startup::is_enabled()?,
            start_minimized: setting_bool(&state, "startMinimized", false).await,
            retry_limit: setting_u32(&state, "retryLimit", 5).await,
        })
    }
    .await)
}

#[tauri::command]
pub async fn update_app_settings(
    state: State<'_, AppState>,
    settings: serde_json::Value,
) -> ApiResult<()> {
    api(async {
        if let Some(name) = settings.get("deviceName").and_then(|v| v.as_str()) {
            let name = name.trim();
            if name.is_empty() || name.len() > 64 {
                return Err(crate::domain::AppError::new(
                    "SETTING_INVALID",
                    "设备名称必须为 1 至 64 个字符",
                ));
            }
            state.db.set_setting("device_name", name).await?;
        }
        for (field, key, min, max) in [
            (
                "pollIntervalSeconds",
                "pollIntervalSeconds",
                10_u64,
                86_400_u64,
            ),
            ("debounceMs", "debounceMs", 100, 30_000),
            ("retryLimit", "retryLimit", 1, 20),
        ] {
            if let Some(value) = settings.get(field).and_then(|v| v.as_u64()) {
                if value < min || value > max {
                    return Err(crate::domain::AppError::new(
                        "SETTING_INVALID",
                        format!("{field} 超出允许范围"),
                    ));
                }
                state.db.set_setting(key, &value.to_string()).await?;
            }
        }
        let auto_start = settings.get("autoStart").and_then(|v| v.as_bool());
        let start_minimized = settings.get("startMinimized").and_then(|v| v.as_bool());
        if auto_start.is_some() || start_minimized.is_some() {
            let current_auto = crate::startup::is_enabled()?;
            let current_minimized = setting_bool(&state, "startMinimized", false).await;
            let next_auto = auto_start.unwrap_or(current_auto);
            let next_minimized = start_minimized.unwrap_or(current_minimized);
            crate::startup::set_enabled(next_auto, next_minimized)?;
            state
                .db
                .set_setting("autoStart", if next_auto { "true" } else { "false" })
                .await?;
            state
                .db
                .set_setting(
                    "startMinimized",
                    if next_minimized { "true" } else { "false" },
                )
                .await?;
        }
        Ok(())
    }
    .await)
}

async fn setting_u32(state: &AppState, key: &str, default: u32) -> u32 {
    state
        .db
        .setting(key)
        .await
        .ok()
        .flatten()
        .and_then(|v| v.parse().ok())
        .unwrap_or(default)
}
async fn setting_bool(state: &AppState, key: &str, default: bool) -> bool {
    state
        .db
        .setting(key)
        .await
        .ok()
        .flatten()
        .and_then(|v| v.parse().ok())
        .unwrap_or(default)
}

pub fn register_commands(builder: tauri::Builder<tauri::Wry>) -> tauri::Builder<tauri::Wry> {
    builder.invoke_handler(tauri::generate_handler![
        list_webdav_accounts,
        create_webdav_account,
        update_webdav_account,
        delete_webdav_account,
        test_webdav_connection,
        browse_remote_directory,
        list_sync_roots,
        create_sync_root,
        update_sync_root,
        delete_sync_root,
        enable_sync_root,
        disable_sync_root,
        preview_initial_sync,
        confirm_initial_sync,
        sync_now,
        pause_sync,
        resume_sync,
        get_sync_status,
        get_pending_tasks,
        retry_failed_task,
        get_sync_rules,
        replace_sync_rules,
        preview_rule_impact,
        list_files,
        list_conflicts,
        get_conflict_detail,
        resolve_conflict,
        query_sync_history,
        export_diagnostics,
        backup_database,
        get_app_settings,
        update_app_settings
    ])
}
