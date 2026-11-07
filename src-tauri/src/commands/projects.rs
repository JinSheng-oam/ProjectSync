use super::*;

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
