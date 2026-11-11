use super::*;

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
pub async fn check_local_directory(path: String) -> ApiResult<()> {
    api(async {
        let path = std::path::Path::new(path.trim());
        if !path.is_absolute() {
            return Err(crate::domain::AppError::new("LOCAL_ROOT_INVALID", "请输入本地目录的绝对路径。"));
        }
        tokio::fs::read_dir(path)
            .await
            .map(|_| ())
            .map_err(|error| {
                crate::domain::AppError::new(
                    "LOCAL_ROOT_INVALID",
                    format!("无法读取本地目录：{error}"),
                )
            })
    }.await)
}

#[tauri::command]
pub fn explain_sync_rule(path: String, rules: Vec<SyncRuleDto>, local_path: Option<String>, exclude_git_tracked: Option<bool>) -> ApiResult<String> {
    api((|| {
        let path = validate_relative_path(&path.replace('\\', "/"))?;
        let engine = RuleEngine::compile(&rules)?;
        if path
            .split('/')
            .any(|part| part.eq_ignore_ascii_case(".projectsync"))
        {
            return Ok("ProjectSync 内部目录不会同步。".to_string());
        }
        if crate::filesystem::is_generated_conflict_copy(&path) {
            return Ok("不会同步：这是 ProjectSync 的历史冲突副本。".into());
        }
        if exclude_git_tracked.unwrap_or(false) {
            let local_path = local_path.as_deref().filter(|path| !path.trim().is_empty())
                .ok_or_else(|| crate::domain::AppError::new("LOCAL_ROOT_INVALID", "请先选择本地目录"))?;
            if crate::git::tracked_paths(std::path::Path::new(local_path))?.contains(&crate::security::path_key(&path)) {
                return Ok("不会同步：该文件已被 Git 跟踪，且开启了 Git 排除。".into());
            }
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
