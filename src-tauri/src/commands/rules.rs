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
