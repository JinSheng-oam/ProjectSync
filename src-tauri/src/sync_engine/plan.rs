use crate::{
    domain::{
        BaselineEntry, ConflictType, InitialSyncPreviewDto, LocalEntry, PlannedAction,
        PreviewItemDto, RemoteEntry, SyncAction, SyncRuleDto, WebDavCapabilities,
    },
    filesystem::RuleEngine,
};
use std::collections::{BTreeSet, HashMap, HashSet};

pub(super) const REMOTE_TRASH_CAPABILITY_MESSAGE: &str =
    "本地文件已删除，但 WebDAV 未验证受保护的 MOVE；远端文件已保留。请重新探测节点，或把远端文件恢复到本地。";

pub(super) fn remote_trash_etag<'a>(capabilities: &WebDavCapabilities, remote: &'a RemoteEntry) -> Option<&'a str> {
    if !capabilities.safe_move_no_overwrite || !capabilities.safe_update_existing {
        return None;
    }
    remote.etag.as_deref().map(str::trim).filter(|etag| {
        etag.strip_prefix('"').and_then(|rest| rest.strip_suffix('"'))
            .is_some_and(|opaque| !opaque.contains('"'))
    })
}

pub(super) fn build_plan(
    local: &[LocalEntry],
    remote: &[RemoteEntry],
    baseline: &[BaselineEntry],
    line_ending_equivalent: &HashSet<String>,
    rules: &[SyncRuleDto],
    local_complete: bool,
    remote_complete: bool,
    capabilities: &WebDavCapabilities,
) -> Vec<PlannedAction> {
    let rule_engine = RuleEngine::compile(rules).ok();
    let local_map: HashMap<&str, &LocalEntry> =
        local.iter().map(|v| (v.path_key.as_str(), v)).collect();
    let remote_map: HashMap<&str, &RemoteEntry> =
        remote.iter().map(|v| (v.path_key.as_str(), v)).collect();
    let base_map: HashMap<&str, &crate::domain::BaselineEntry> =
        baseline.iter().map(|v| (v.path_key.as_str(), v)).collect();
    let mut keys = BTreeSet::new();
    keys.extend(local.iter().map(|v| v.path_key.clone()));
    keys.extend(remote.iter().map(|v| v.path_key.clone()));
    keys.extend(baseline.iter().map(|v| v.path_key.clone()));
    let mut plan = Vec::new();
    for key in keys {
        let l = local_map.get(key.as_str()).copied();
        let r = remote_map.get(key.as_str()).copied();
        let b = base_map.get(key.as_str()).copied();
        let path = l
            .map(|v| v.relative_path.as_str())
            .or_else(|| r.map(|v| v.relative_path.as_str()))
            .or_else(|| b.map(|v| v.relative_path.as_str()))
            .unwrap_or_default()
            .to_owned();
        if b.is_some_and(|entry| entry.sync_state == "IGNORED") {
            continue;
        }
        if rule_engine
            .as_ref()
            .is_some_and(|engine| !engine.includes(&path))
        {
            continue;
        }
        if let (Some(local), Some(remote)) = (l, r) {
            if local.relative_path != remote.relative_path {
                plan.push(plan_item(
                    &path,
                    SyncAction::CreateConflictCopy,
                    Some(ConflictType::CaseCollision),
                    Some((*local).clone()),
                    Some((*remote).clone()),
                    "远端与本地路径存在大小写冲突",
                ));
                continue;
            }
        }
        let state = b.map(|v| v.baseline_state.as_str()).unwrap_or("UNKNOWN");
        let base_hash = b.and_then(|v| v.base_hash.as_deref());
        match (l, r) {
            (Some(local), Some(remote)) => {
                let line_endings_only = line_ending_equivalent.contains(&key);
                if local.hash == remote.hash || line_endings_only {
                    plan.push(plan_item(
                        &path,
                        SyncAction::MarkClean,
                        None,
                        Some((*local).clone()),
                        Some((*remote).clone()),
                        if line_endings_only {
                            "两端仅换行符格式不同，视为内容一致"
                        } else {
                            "两端内容一致"
                        },
                    ));
                    continue;
                }
                if state == "PRESENT" {
                    let local_changed = Some(local.hash.as_str()) != base_hash;
                    let remote_changed = Some(remote.hash.as_str()) != base_hash;
                    if local_changed && !remote_changed {
                        if capabilities.safe_update_existing {
                            plan.push(with_etag(
                                plan_item(
                                    &path,
                                    SyncAction::UploadUpdate,
                                    None,
                                    Some((*local).clone()),
                                    Some((*remote).clone()),
                                    "仅本地版本变化",
                                ),
                                remote.etag.clone(),
                            ));
                        } else {
                            plan.push(plan_item(
                                &path,
                                SyncAction::Blocked,
                                None,
                                Some((*local).clone()),
                                Some((*remote).clone()),
                                "服务端没有经过验证的安全覆盖能力",
                            ));
                        }
                    } else if !local_changed && remote_changed {
                        plan.push(plan_item(
                            &path,
                            SyncAction::DownloadUpdate,
                            None,
                            Some((*local).clone()),
                            Some((*remote).clone()),
                            "仅远端版本变化",
                        ));
                    } else {
                        plan.push(plan_item(
                            &path,
                            SyncAction::CreateConflictCopy,
                            Some(ConflictType::ConcurrentModification),
                            Some((*local).clone()),
                            Some((*remote).clone()),
                            "本地与远端同时修改",
                        ));
                    }
                } else {
                    plan.push(plan_item(
                        &path,
                        SyncAction::CreateConflictCopy,
                        Some(ConflictType::InitialSyncDifferent),
                        Some((*local).clone()),
                        Some((*remote).clone()),
                        "初始同步时两端同名文件内容不同",
                    ));
                }
            }
            (Some(local), None) if remote_complete => {
                if state == "PRESENT" {
                    if Some(local.hash.as_str()) == base_hash {
                        plan.push(plan_item(
                            &path,
                            SyncAction::MoveLocalToTrash,
                            None,
                            Some((*local).clone()),
                            None,
                            "远端已删除且本地仍为基线版本；移入本地回收站",
                        ));
                    } else {
                        plan.push(plan_item(
                            &path,
                            SyncAction::CreateConflictCopy,
                            Some(ConflictType::RemoteDeleteLocalModified),
                            Some((*local).clone()),
                            None,
                            "远端删除与本地修改冲突",
                        ));
                    }
                } else if capabilities.safe_create_only {
                    plan.push(plan_item(
                        &path,
                        SyncAction::UploadNew,
                        None,
                        Some((*local).clone()),
                        None,
                        "本地新文件",
                    ));
                } else {
                    plan.push(plan_item(
                        &path,
                        SyncAction::Blocked,
                        None,
                        Some((*local).clone()),
                        None,
                        "服务端未验证 create-only 新建能力",
                    ));
                }
            }
            (Some(local), None) => {
                let _ = local;
            }
            (None, Some(remote)) if local_complete => {
                if state == "PRESENT" {
                    if Some(remote.hash.as_str()) == base_hash {
                        if let Some(etag) = remote_trash_etag(capabilities, remote) {
                            plan.push(with_etag(
                                plan_item(
                                    &path,
                                    SyncAction::MoveRemoteToTrash,
                                    None,
                                    None,
                                    Some((*remote).clone()),
                                    "本地已删除且远端仍为基线版本；移入远端回收站",
                                ),
                                Some(etag.to_owned()),
                            ));
                        } else {
                            plan.push(plan_item(
                                &path,
                                SyncAction::Blocked,
                                None,
                                None,
                                Some((*remote).clone()),
                                if capabilities.safe_move_no_overwrite && capabilities.safe_update_existing {
                                    "本地文件已删除，但远端文件没有可用的强 ETag；远端文件已保留。"
                                } else {
                                    REMOTE_TRASH_CAPABILITY_MESSAGE
                                },
                            ));
                        }
                    } else {
                        plan.push(plan_item(
                            &path,
                            SyncAction::CreateConflictCopy,
                            Some(ConflictType::LocalDeleteRemoteModified),
                            None,
                            Some((*remote).clone()),
                            "本地删除与远端修改冲突",
                        ));
                    }
                } else {
                    plan.push(plan_item(
                        &path,
                        SyncAction::DownloadNew,
                        None,
                        None,
                        Some((*remote).clone()),
                        "远端新文件",
                    ));
                }
            }
            (None, Some(_)) => {}
            (None, None) if local_complete && remote_complete && state == "PRESENT" => {
                plan.push(plan_item(
                    &path,
                    SyncAction::MarkClean,
                    None,
                    None,
                    None,
                    "两端文件均已删除；确认 tombstone",
                ))
            }
            (None, None) => {}
        }
    }
    plan
}

fn plan_item(
    path: &str,
    action: SyncAction,
    conflict: Option<ConflictType>,
    local: Option<LocalEntry>,
    remote: Option<RemoteEntry>,
    reason: &str,
) -> PlannedAction {
    PlannedAction {
        path: path.to_owned(),
        action,
        conflict,
        local,
        remote,
        expected_remote_etag: None,
        reason: reason.to_owned(),
    }
}
fn with_etag(mut item: PlannedAction, etag: Option<String>) -> PlannedAction {
    item.expected_remote_etag = etag;
    item
}

pub(super) fn preview_from_plan(root_id: &str, plan: Vec<PlannedAction>) -> InitialSyncPreviewDto {
    let mut preview = InitialSyncPreviewDto {
        root_id: root_id.to_owned(),
        uploads_count: 0,
        downloads_count: 0,
        identical_count: 0,
        conflicts_count: 0,
        blocked_count: 0,
        total_upload_bytes: 0,
        total_download_bytes: 0,
        items: Vec::new(),
    };
    for item in plan {
        let size = item
            .local
            .as_ref()
            .map(|v| v.size)
            .or_else(|| item.remote.as_ref().map(|v| v.size))
            .unwrap_or_default();
        match item.action {
            SyncAction::UploadNew | SyncAction::UploadUpdate => {
                preview.uploads_count += 1;
                preview.total_upload_bytes += size;
            }
            SyncAction::DownloadNew | SyncAction::DownloadUpdate => {
                preview.downloads_count += 1;
                preview.total_download_bytes += size;
            }
            SyncAction::MarkClean => preview.identical_count += 1,
            SyncAction::CreateConflictCopy => preview.conflicts_count += 1,
            SyncAction::Blocked | SyncAction::MoveRemoteToTrash | SyncAction::MoveLocalToTrash => {
                preview.blocked_count += 1
            }
            _ => {}
        }
        preview.items.push(PreviewItemDto {
            relative_path: item.path,
            action: item.action,
            size_bytes: size,
            reason: item.reason,
        });
    }
    preview
}
