use super::*;

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
