mod webdav;
mod projects;
mod tasks;
mod rules;
mod conflicts;
mod settings;

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

pub fn register_commands(builder: tauri::Builder<tauri::Wry>) -> tauri::Builder<tauri::Wry> {
    builder.invoke_handler(tauri::generate_handler![
        crate::ai::get_ai_settings,
        crate::ai::save_ai_settings,
        crate::ai::test_ai_settings,
        crate::ai::list_ai_models,
        crate::ai_scope::list_ai_scope_paths,
        crate::ai_scope::suggest_ai_scope,
        webdav::list_webdav_accounts,
        webdav::create_webdav_account,
        webdav::update_webdav_account,
        webdav::delete_webdav_account,
        webdav::test_webdav_connection,
        webdav::browse_remote_directory,
        webdav::discover_remote_projects,
        projects::list_sync_roots,
        projects::create_sync_root,
        projects::update_sync_root,
        projects::delete_sync_root,
        projects::enable_sync_root,
        projects::disable_sync_root,
        projects::preview_initial_sync,
        projects::confirm_initial_sync,
        projects::sync_now,
        projects::pause_sync,
        projects::resume_sync,
        projects::get_sync_status,
        tasks::get_pending_tasks,
        tasks::cancel_sync_task,
        tasks::retry_failed_task,
        rules::get_sync_rules,
        rules::replace_sync_rules,
        rules::preview_rule_impact,
        rules::explain_sync_rule,
        rules::list_files,
        conflicts::list_conflicts,
        conflicts::get_conflict_detail,
        conflicts::exclude_conflict_file,
        conflicts::resolve_conflict,
        conflicts::preview_ai_merge,
        conflicts::refine_ai_merge,
        conflicts::apply_ai_merge,
        settings::query_sync_history,
        settings::export_diagnostics,
        settings::backup_database,
        settings::get_app_settings,
        settings::update_app_settings
    ])
}
