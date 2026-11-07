use crate::{
    app::AppState,
    credentials::CredentialStore,
    domain::{
        api, AiMergePreviewDto, ApiResult, AppSettingsDto, ConflictResolution, HistoryItemDto,
        InitialSyncPreviewDto, RuleImpactDto, SyncFileItemDto, SyncRootDto, SyncRuleDto,
        SyncStatusDto, SyncSummaryDto, TaskDto, WebDavAccountDto, WebDavAccountInput,
        WebDavCapabilities,
    },
    filesystem::{scan_local_cached_excluding, RuleEngine},
    security::{normalize_remote_path, validate_relative_path, validate_webdav_url},
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
    #[serde(default = "default_exclude_git_tracked")]
    pub exclude_git_tracked: bool,
}

fn default_exclude_git_tracked() -> bool {
    false
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateRootInput {
    pub name: String,
    pub poll_interval_seconds: u32,
    pub debounce_ms: u32,
    #[serde(default)]
    pub exclude_git_tracked: bool,
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
                data.exclude_git_tracked,
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
            data.exclude_git_tracked,
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
    exclude_git_tracked: Option<bool>,
) -> ApiResult<InitialSyncPreviewDto> {
    api(state
        .sync
        .preview(
            &account_id,
            &local_path,
            &remote_path,
            &rules,
            exclude_git_tracked.unwrap_or(false),
        )
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
pub async fn cancel_sync_task(state: State<'_, AppState>, task_id: String) -> ApiResult<()> {
    api(state.sync.cancel_task(&task_id).await)
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
pub fn explain_sync_rule(path: String, rules: Vec<SyncRuleDto>) -> ApiResult<String> {
    api((|| {
        let path = validate_relative_path(&path.replace('\\', "/"))?;
        let engine = RuleEngine::compile(&rules)?;
        if path
            .split('/')
            .any(|part| part.eq_ignore_ascii_case(".projectsync"))
        {
            return Ok("ProjectSync 内部目录不会同步。".to_string());
        }
        for rule in rules
            .iter()
            .filter(|r| r.enabled && r.rule_type == crate::domain::RuleType::Exclude)
        {
            if !RuleEngine::compile(std::slice::from_ref(rule))?.includes(&path) {
                return Ok(format!("不会同步：匹配排除规则 {}", rule.pattern));
            }
        }
        if engine.includes(&path) {
            Ok("会纳入同步范围；实际操作还取决于文件状态及同步预览。".to_string())
        } else {
            Ok("不会同步：未匹配任何启用的包含规则。".to_string())
        }
    })())
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
        let git_tracked_paths = if root.exclude_git_tracked {
            crate::git::tracked_paths(&root.local_path)?
        } else {
            HashSet::new()
        };
        let old = scan_local_cached_excluding(&root.local_path, &old_rules, &[], &git_tracked_paths)?
            .into_iter()
            .map(|entry| entry.relative_path)
            .collect::<HashSet<_>>();
        let new = scan_local_cached_excluding(&root.local_path, &rules, &[], &git_tracked_paths)?
            .into_iter()
            .map(|entry| entry.relative_path)
            .collect::<HashSet<_>>();
        let mut newly_included = new.difference(&old).cloned().collect::<Vec<_>>();
        let mut newly_excluded = old.difference(&new).cloned().collect::<Vec<_>>();
        newly_included.sort();
        newly_excluded.sort();
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

fn escape_glob_literal(value: &str) -> String {
    let mut escaped = String::with_capacity(value.len());
    for character in value.chars() {
        if matches!(character, '\\' | '*' | '?' | '[' | ']' | '{' | '}') {
            escaped.push('\\');
        }
        escaped.push(character);
    }
    escaped
}

#[tauri::command]
pub async fn exclude_conflict_file(
    state: State<'_, AppState>,
    conflict_id: String,
) -> ApiResult<serde_json::Value> {
    api(async {
        let conflict = state
            .db
            .conflicts(Some(&conflict_id), None)
            .await?
            .into_iter()
            .next()
            .ok_or_else(|| crate::domain::AppError::new("CONFLICT_NOT_FOUND", "冲突不存在或已解决"))?;
        let root_id = conflict.root_id;
        let path = validate_relative_path(&conflict.relative_path)?;
        let mut rules = state.db.rules(&root_id).await?;
        let already_excluded = rules.iter().any(|rule| {
            rule.enabled
                && rule.rule_type == crate::domain::RuleType::Exclude
                && RuleEngine::compile(std::slice::from_ref(rule))
                    .is_ok_and(|engine| !engine.includes(&path))
        });
        if !already_excluded {
            let priority = rules
                .iter()
                .map(|rule| rule.priority)
                .max()
                .unwrap_or_default()
                .saturating_add(1);
            rules.push(SyncRuleDto {
                id: None,
                rule_type: crate::domain::RuleType::Exclude,
                pattern: escape_glob_literal(&path),
                enabled: true,
                priority,
            });
            let _ = RuleEngine::compile(&rules)?;
            state.db.replace_rules(&root_id, &rules).await?;
        }
        state.db.resolve_conflict_as(&conflict_id, "EXCLUDED").await?;
        Ok(serde_json::json!({
            "success": true,
            "message": format!("已将 {path} 加入排除规则；本地和远端现有文件均保留，后续同步将跳过此文件。")
        }))
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
pub async fn preview_ai_merge(
    state: State<'_, AppState>,
    conflict_id: String,
) -> ApiResult<AiMergePreviewDto> {
    api(state.sync.preview_ai_merge(&conflict_id).await)
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RefineAiMergeInput {
    pub conflict_id: String,
    pub preview_id: String,
    pub instruction: String,
    pub current_content: Option<String>,
}

#[tauri::command]
pub async fn refine_ai_merge(
    state: State<'_, AppState>,
    input: RefineAiMergeInput,
) -> ApiResult<AiMergePreviewDto> {
    api(state
        .sync
        .refine_ai_merge(
            &input.conflict_id,
            &input.preview_id,
            &input.instruction,
            input.current_content.as_deref(),
        )
        .await)
}

#[tauri::command]
pub async fn apply_ai_merge(
    state: State<'_, AppState>,
    conflict_id: String,
    preview_id: String,
) -> ApiResult<serde_json::Value> {
    api(async {
        let message = state.sync.apply_ai_merge(&conflict_id, &preview_id).await?;
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
        crate::ai::get_ai_settings,
        crate::ai::save_ai_settings,
        crate::ai::test_ai_settings,
        crate::ai::list_ai_models,
        crate::ai_scope::list_ai_scope_paths,
        crate::ai_scope::suggest_ai_scope,
        list_webdav_accounts,
        create_webdav_account,
        update_webdav_account,
        delete_webdav_account,
        test_webdav_connection,
        browse_remote_directory,
        discover_remote_projects,
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
        cancel_sync_task,
        retry_failed_task,
        get_sync_rules,
        replace_sync_rules,
        preview_rule_impact,
        explain_sync_rule,
        list_files,
        list_conflicts,
        get_conflict_detail,
        exclude_conflict_file,
        resolve_conflict,
        preview_ai_merge,
        refine_ai_merge,
        apply_ai_merge,
        query_sync_history,
        export_diagnostics,
        backup_database,
        get_app_settings,
        update_app_settings
    ])
}
