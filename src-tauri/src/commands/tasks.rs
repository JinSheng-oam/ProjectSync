use super::*;

#[tauri::command]
pub async fn get_pending_tasks(state: State<'_, AppState>) -> ApiResult<Vec<TaskDto>> {
    api(state.db.tasks(200).await)
}

#[tauri::command]
pub async fn cancel_sync_task(state: State<'_, AppState>, task_id: String) -> ApiResult<()> {
    api(state.sync.cancel_task(&task_id).await)
}

#[tauri::command]
pub async fn handle_retained_remote_file(
    state: State<'_, AppState>,
    task_id: String,
    restore: bool,
) -> ApiResult<()> {
    api(state.sync.handle_retained_remote_file(&task_id, restore).await)
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
