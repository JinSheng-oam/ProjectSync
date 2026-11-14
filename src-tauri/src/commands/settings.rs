use super::*;
use crate::domain::SyncAction;

#[tauri::command]
pub async fn query_sync_history(
    state: State<'_, AppState>,
    keyword: Option<String>,
    root_id: Option<String>,
    limit: Option<u32>,
    offset: Option<u32>,
    action: Option<SyncAction>,
    status: Option<String>,
    before_timestamp: Option<i64>,
    before_id: Option<String>,
) -> ApiResult<Vec<HistoryItemDto>> {
    api(async {
        let before = match (before_timestamp, before_id.as_deref()) {
            (None, None) => None,
            (Some(time), Some(id)) => Some((time, id.parse::<i64>().map_err(|_| crate::domain::AppError::new("HISTORY_CURSOR_INVALID", "日志分页位置无效"))?)),
            _ => return Err(crate::domain::AppError::new("HISTORY_CURSOR_INVALID", "日志分页位置不完整")),
        };
        if status.as_deref().is_some_and(|value| !matches!(value, "SUCCESS" | "FAILED" | "BLOCKED")) {
            return Err(crate::domain::AppError::new("HISTORY_FILTER_INVALID", "日志状态筛选无效"));
        }
        state.db.history(
            keyword.as_deref().unwrap_or(""),
            root_id.as_deref(),
            limit.unwrap_or(100),
            offset.unwrap_or(0),
            action.as_ref().map(SyncAction::as_db),
            status.as_deref(),
            before,
        )
        .await
    }.await)
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
            ignore_remote_delete_warnings: setting_bool(&state, "ignoreRemoteDeleteWarnings", false).await,
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
        if let Some(ignore) = settings.get("ignoreRemoteDeleteWarnings").and_then(|v| v.as_bool()) {
            state.db.set_setting("ignoreRemoteDeleteWarnings", if ignore { "true" } else { "false" }).await?;
        }
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
