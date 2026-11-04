use crate::{
    credentials::CredentialStore,
    domain::{
        AppError, AppResult, ConflictResolution, ConflictType, HistoryEntry, InitialSyncPreviewDto,
        LocalEntry, PlannedAction, PreviewItemDto, RemoteEntry, RootRecord, SyncAction,
        SyncRuleDto, SyncSummaryDto, WebDavCapabilities,
    },
    filesystem::{
        atomic_replace, ensure_safe_parent, hash_file, move_to_trash, scan_local,
        scan_local_cached, RuleEngine,
    },
    security::{normalize_remote_path, path_key, unix_ms, validate_relative_path},
    storage::Database,
    webdav::{href_to_dav_path, PutCondition, WebDavClient},
};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeSet, HashMap},
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::Instant,
};
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex as AsyncMutex;

#[derive(Clone)]
pub struct SyncCoordinator {
    db: Database,
    data_dir: PathBuf,
    app: AppHandle,
    root_locks: Arc<Mutex<HashMap<String, Arc<AsyncMutex<()>>>>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct RootManifest {
    schema_version: u32,
    remote_project_id: String,
}

impl SyncCoordinator {
    pub fn new(db: Database, data_dir: PathBuf, app: AppHandle) -> Self {
        Self {
            db,
            data_dir,
            app,
            root_locks: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    fn lock_for(&self, root_id: &str) -> AppResult<Arc<AsyncMutex<()>>> {
        let mut locks = self
            .root_locks
            .lock()
            .map_err(|_| AppError::new("ENGINE_LOCK_FAILED", "同步调度锁不可用"))?;
        Ok(locks
            .entry(root_id.to_owned())
            .or_insert_with(|| Arc::new(AsyncMutex::new(())))
            .clone())
    }

    pub async fn client_for(
        &self,
        account_id: &str,
    ) -> AppResult<(crate::domain::AccountRecord, WebDavClient)> {
        let account = self.db.account(account_id).await?;
        let password = CredentialStore::get(&account.credential_ref)?;
        let client = WebDavClient::new(
            &account.url,
            &account.username,
            password,
            account.tls_verify,
        )?;
        Ok((account, client))
    }

    pub async fn test_connection(
        &self,
        url: &str,
        username: &str,
        password: String,
        tls_verify: bool,
    ) -> AppResult<WebDavCapabilities> {
        let client = WebDavClient::new(url, username, password, tls_verify)?;
        let result = client.test_connection().await;
        self.emit(
            "sync://network-status",
            serde_json::json!({"online":result.is_ok(),"checkedAt":unix_ms()}),
        );
        result
    }

    pub async fn create_root(
        &self,
        name: String,
        account_id: String,
        local_path: String,
        remote_path: String,
        rules: Vec<SyncRuleDto>,
    ) -> AppResult<crate::domain::SyncRootDto> {
        let name = name.trim().to_owned();
        if name.is_empty() {
            return Err(AppError::new("ROOT_NAME_INVALID", "项目名称不能为空"));
        }
        let local = fs::canonicalize(&local_path).map_err(|e| {
            AppError::new(
                "LOCAL_ROOT_INVALID",
                format!("本地目录不存在或无法访问：{e}"),
            )
        })?;
        if !local.is_dir() {
            return Err(AppError::new("LOCAL_ROOT_INVALID", "本地同步路径不是目录"));
        }
        let remote_path = normalize_remote_path(&remote_path)?;
        let _ = RuleEngine::compile(&rules)?;
        let (account, client) = self.client_for(&account_id).await?;
        let capabilities = account.capabilities.unwrap_or_else(unsafe_capabilities);
        let manifest_path = format!(
            "{}/.projectsync/root.json",
            remote_path.trim_end_matches('/')
        );
        client.ensure_collection(&remote_path).await?;
        client
            .ensure_collection(&format!(
                "{}/.projectsync",
                remote_path.trim_end_matches('/')
            ))
            .await?;
        let remote_project_id = match client.get_bytes(&manifest_path).await {
            Ok(bytes) => parse_manifest(&bytes)?.remote_project_id,
            Err(error) if error.code == "DAV_NOT_FOUND" => {
                let id = uuid::Uuid::new_v4().to_string();
                let manifest = RootManifest {
                    schema_version: 1,
                    remote_project_id: id.clone(),
                };
                let path = self
                    .data_dir
                    .join("staging")
                    .join(format!("manifest-{}.json", uuid::Uuid::new_v4()));
                fs::create_dir_all(path.parent().unwrap_or(&self.data_dir))?;
                tokio::fs::write(
                    &path,
                    serde_json::to_vec_pretty(&manifest)
                        .map_err(|e| AppError::new("SERIALIZATION_ERROR", e.to_string()))?,
                )
                .await?;
                let create = if capabilities.safe_create_only {
                    PutCondition::CreateOnly
                } else {
                    let _ = tokio::fs::remove_file(&path).await;
                    return Err(AppError::new(
                        "BLOCKED_SERVER_CAPABILITY",
                        "WebDAV 尚未验证 create-only，无法安全创建项目标识",
                    ));
                };
                match client.put_file(&path, &manifest_path, create).await {
                    Ok(()) => {}
                    Err(write_error) if write_error.code == "DAV_PRECONDITION_FAILED" => {}
                    Err(write_error) => {
                        let _ = tokio::fs::remove_file(&path).await;
                        return Err(write_error);
                    }
                }
                let _ = tokio::fs::remove_file(&path).await;
                parse_manifest(&client.get_bytes(&manifest_path).await?)?.remote_project_id
            }
            Err(error) => return Err(error),
        };
        let poll_interval_seconds = self
            .db
            .setting("pollIntervalSeconds")
            .await?
            .and_then(|v| v.parse().ok())
            .unwrap_or(60_u32)
            .clamp(10, 86_400);
        let debounce_ms = self
            .db
            .setting("debounceMs")
            .await?
            .and_then(|v| v.parse().ok())
            .unwrap_or(1200_u32)
            .clamp(100, 30_000);
        let root = RootRecord {
            id: uuid::Uuid::new_v4().to_string(),
            remote_project_id,
            name,
            account_id,
            local_path: local,
            remote_path,
            enabled: true,
            status: "IDLE".to_owned(),
            poll_interval_seconds,
            debounce_ms,
            last_sync_at: None,
            initial_sync_completed: false,
            initial_sync_confirmed: false,
        };
        self.db.create_root(&root, &rules).await?;
        let dto = self
            .db
            .roots()
            .await?
            .into_iter()
            .find(|item| item.id == root.id)
            .ok_or_else(|| AppError::new("DATABASE_ERROR", "读取刚创建的同步项目失败"))?;
        Ok(dto)
    }

    pub async fn preview(
        &self,
        account_id: &str,
        local_path: &str,
        remote_path: &str,
        rules: &[SyncRuleDto],
    ) -> AppResult<InitialSyncPreviewDto> {
        let _ = RuleEngine::compile(rules)?;
        let local_root = fs::canonicalize(local_path).map_err(|e| {
            AppError::new(
                "LOCAL_ROOT_INVALID",
                format!("本地目录不存在或无法访问：{e}"),
            )
        })?;
        let normalized_remote = normalize_remote_path(remote_path)?;
        let (account, client) = self.client_for(account_id).await?;
        let capabilities = account.capabilities.unwrap_or_else(unsafe_capabilities);
        let local = scan_local(&local_root, rules)?;
        let remote =
            match scan_remote(&client, &normalized_remote, rules, &self.data_dir, &[]).await {
                Ok(entries) => entries,
                Err(error) if error.code == "DAV_NOT_FOUND" => Vec::new(),
                Err(error) => return Err(error),
            };
        let root_id = format!("preview-{}", uuid::Uuid::new_v4().simple());
        let plan = build_plan(&local, &remote, &[], rules, true, true, &capabilities);
        Ok(preview_from_plan(&root_id, plan))
    }

    pub async fn confirm_initial_sync(&self, root_id: &str) -> AppResult<SyncSummaryDto> {
        self.db.mark_initial_confirmed(root_id).await?;
        self.sync_now(root_id).await
    }

    pub async fn sync_now(&self, root_id: &str) -> AppResult<SyncSummaryDto> {
        let lock = self.lock_for(root_id)?;
        let _guard = lock.lock().await;
        let started_at = unix_ms();
        let mut summary = SyncSummaryDto {
            root_id: root_id.to_owned(),
            uploaded: 0,
            downloaded: 0,
            skipped: 0,
            conflicts: 0,
            blocked: 0,
            failed: 0,
            started_at,
            finished_at: None,
        };
        let root = self.db.root(root_id).await?;
        if !root.enabled {
            return Err(AppError::new("ROOT_DISABLED", "同步项目已停用"));
        }
        if !root.initial_sync_confirmed {
            return Err(AppError::new(
                "INITIAL_SYNC_NOT_CONFIRMED",
                "请先预览并确认该项目的初次同步",
            ));
        }
        if root.status == "PAUSED" {
            return Err(AppError::new("ROOT_PAUSED", "同步项目已暂停"));
        }
        self.db.set_root_status(root_id, "SCANNING_LOCAL").await?;
        let result = self.sync_locked(&root, &mut summary).await;
        if let Err(error) = result.as_ref() {
            let account_status = match error.code.as_str() {
                "DAV_AUTH_FAILED" => Some("AUTH_FAILED"),
                "DAV_CONNECTION_FAILED" => Some("OFFLINE"),
                _ => None,
            };
            if let Some(account_status) = account_status {
                let _ = self
                    .db
                    .set_account_status(&root.account_id, account_status)
                    .await;
            }
        }
        let has_conflicts = self
            .db
            .root_has_unresolved_conflicts(root_id)
            .await
            .unwrap_or(false);
        let status = if has_conflicts {
            "CONFLICT"
        } else if result.is_err() || summary.failed > 0 || summary.blocked > 0 {
            "ERROR"
        } else {
            "IDLE"
        };
        let _ = self.db.finish_sync(root_id, status).await;
        summary.finished_at = Some(unix_ms());
        self.emit(
            "sync://root-status",
            serde_json::json!({"rootId":root_id,"status":status,"timestamp":summary.finished_at}),
        );
        result.map(|_| summary)
    }

    async fn sync_locked(&self, root: &RootRecord, summary: &mut SyncSummaryDto) -> AppResult<()> {
        let (_, client) = self.client_for(&root.account_id).await?;
        let account = self.db.account(&root.account_id).await?;
        let capabilities = account.capabilities.unwrap_or_else(unsafe_capabilities);
        let rules = self.db.rules(&root.id).await?;
        let old_baseline = self.db.baselines(&root.id).await?;
        let rule_engine = RuleEngine::compile(&rules)?;
        let ignored = old_baseline
            .iter()
            .filter(|entry| !rule_engine.includes(&entry.relative_path))
            .map(|entry| entry.relative_path.clone())
            .collect::<Vec<_>>();
        let reenabled = old_baseline
            .iter()
            .filter(|entry| {
                entry.sync_state == "IGNORED" && rule_engine.includes(&entry.relative_path)
            })
            .map(|entry| entry.relative_path.clone())
            .collect::<Vec<_>>();
        self.db
            .apply_rule_state(&root.id, &ignored, &reenabled)
            .await?;
        self.db.set_root_status(&root.id, "SCANNING_LOCAL").await?;
        let local = scan_local_cached(&root.local_path, &rules, &old_baseline)?;
        self.db.set_root_status(&root.id, "SCANNING_REMOTE").await?;
        let remote = scan_remote(
            &client,
            &root.remote_path,
            &rules,
            &self.data_dir,
            &old_baseline,
        )
        .await?;
        self.db
            .set_account_status(&root.account_id, "ONLINE")
            .await?;
        self.db
            .update_scan(&root.id, &local, &remote, true, true)
            .await?;
        let baseline = self.db.baselines(&root.id).await?;
        self.db.set_root_status(&root.id, "PLANNING").await?;
        let plan = build_plan(
            &local,
            &remote,
            &baseline,
            &rules,
            true,
            true,
            &capabilities,
        );
        self.db.set_root_status(&root.id, "SYNCING").await?;
        for item in plan {
            match item.action {
                SyncAction::Skip => summary.skipped += 1,
                SyncAction::MarkClean => {
                    let hash = item
                        .local
                        .as_ref()
                        .map(|v| v.hash.as_str())
                        .or_else(|| item.remote.as_ref().map(|v| v.hash.as_str()));
                    if item.local.is_none() && item.remote.is_none() {
                        self.db
                            .add_tombstone(
                                &root.id,
                                &item.path,
                                "BOTH",
                                None,
                                None,
                                Some("CONFIRMED_DELETED"),
                            )
                            .await?;
                    }
                    self.db
                        .update_base(
                            &root.id,
                            &item.path,
                            hash,
                            item.local.as_ref(),
                            item.remote.as_ref(),
                        )
                        .await?;
                    self.db
                        .reconcile_tasks_for_path(&root.id, &item.path, true)
                        .await?;
                    summary.skipped += 1;
                }
                SyncAction::CreateConflictCopy => {
                    let base = baseline
                        .iter()
                        .find(|b| b.path_key == path_key(&item.path))
                        .and_then(|b| b.base_hash.as_deref());
                    let (conflict_id, created) =
                        self.db.create_conflict(&root.id, &item, base).await?;
                    if self.db.conflict_copy_path(&conflict_id).await?.is_none() {
                        let mut local_copy_rel = None;
                        if let Some(local) = item.local.as_ref() {
                            if hash_file(&local.absolute_path).ok().as_deref()
                                == Some(local.hash.as_str())
                            {
                                let candidate = crate::filesystem::unique_conflict_path(
                                    &item.path,
                                    &self.db.device_name().await?,
                                );
                                if let Ok(conflict_path) = candidate {
                                    if let Ok(target) =
                                        ensure_safe_parent(&root.local_path, &conflict_path)
                                    {
                                        if crate::filesystem::copy_create_new(
                                            &local.absolute_path,
                                            &target,
                                        )
                                        .is_ok()
                                        {
                                            local_copy_rel = Some(conflict_path);
                                        }
                                    }
                                }
                            }
                        }
                        let mut remote_copy_rel = None;
                        if let (Some(local_path), true) =
                            (&local_copy_rel, capabilities.safe_create_only)
                        {
                            if let Ok(source) = ensure_safe_parent(&root.local_path, local_path) {
                                if let Ok(remote_copy) =
                                    remote_file_path(&root.remote_path, local_path)
                                {
                                    if ensure_remote_parent(&client, &remote_copy).await.is_ok()
                                        && client
                                            .put_file(
                                                &source,
                                                &remote_copy,
                                                PutCondition::CreateOnly,
                                            )
                                            .await
                                            .is_ok()
                                    {
                                        let source_hash = item
                                            .local
                                            .as_ref()
                                            .map(|v| v.hash.as_str())
                                            .unwrap_or_default();
                                        if verify_remote_hash(
                                            &client,
                                            &remote_copy,
                                            &self.data_dir,
                                            source_hash,
                                        )
                                        .await
                                        .is_ok()
                                        {
                                            remote_copy_rel = Some(remote_copy);
                                        }
                                    }
                                }
                            }
                        }
                        let marker = local_copy_rel
                            .as_deref()
                            .or_else(|| item.local.is_none().then_some("NONE"));
                        if marker.is_some() {
                            let _ = self
                                .db
                                .set_conflict_copy_paths(
                                    &conflict_id,
                                    marker,
                                    remote_copy_rel.as_deref(),
                                )
                                .await;
                        }
                    }
                    summary.conflicts += 1;
                    if created {
                        self.emit("sync://conflict-created",serde_json::json!({"conflictId":conflict_id,"rootId":root.id,"path":item.path,"conflictType":item.conflict}));
                        if let Ok(history_id) = self
                            .db
                            .add_history(HistoryEntry {
                                root_id: &root.id,
                                task_id: None,
                                path: &item.path,
                                action: &item.action,
                                status: "BLOCKED",
                                bytes: 0,
                                duration_ms: 0,
                                error: Some(("SYNC_CONFLICT", &item.reason)),
                            })
                            .await
                        {
                            self.emit(
                                "sync://history-updated",
                                serde_json::json!({"rootId":root.id,"historyId":history_id}),
                            );
                        }
                    }
                    self.db
                        .reconcile_tasks_for_path(&root.id, &item.path, false)
                        .await?;
                }
                SyncAction::Blocked => {
                    let total = item
                        .local
                        .as_ref()
                        .map(|v| v.size)
                        .or_else(|| item.remote.as_ref().map(|v| v.size))
                        .unwrap_or_default();
                    let (task, ready) = self
                        .db
                        .prepare_task(
                            &root.id,
                            &item.path,
                            &item.action,
                            total,
                            item.local.as_ref().map(|v| v.hash.as_str()),
                            item.expected_remote_etag.as_deref(),
                        )
                        .await?;
                    if !ready {
                        summary.skipped += 1;
                        continue;
                    }
                    self.db
                        .set_task(
                            &task,
                            crate::domain::TaskStatus::Blocked,
                            0,
                            Some(("BLOCKED_SERVER_CAPABILITY", &item.reason)),
                        )
                        .await?;
                    let history_id = self
                        .db
                        .add_history(HistoryEntry {
                            root_id: &root.id,
                            task_id: Some(&task),
                            path: &item.path,
                            action: &item.action,
                            status: "BLOCKED",
                            bytes: 0,
                            duration_ms: 0,
                            error: Some(("BLOCKED_SERVER_CAPABILITY", &item.reason)),
                        })
                        .await?;
                    self.emit(
                        "sync://history-updated",
                        serde_json::json!({"rootId":root.id,"historyId":history_id}),
                    );
                    summary.blocked += 1;
                }
                action => {
                    let bytes = item
                        .local
                        .as_ref()
                        .map(|v| v.size)
                        .or_else(|| item.remote.as_ref().map(|v| v.size))
                        .unwrap_or_default();
                    let (task, ready) = self
                        .db
                        .prepare_task(
                            &root.id,
                            &item.path,
                            &action,
                            bytes,
                            item.local.as_ref().map(|v| v.hash.as_str()),
                            item.expected_remote_etag.as_deref(),
                        )
                        .await?;
                    if !ready {
                        summary.skipped += 1;
                        continue;
                    }
                    self.db
                        .set_task(&task, crate::domain::TaskStatus::Running, 0, None)
                        .await?;
                    self.emit(
                        "sync://progress",
                        serde_json::json!({"rootId":root.id,"taskId":task,"path":item.path,"operation":action,"bytesTransferred":0,"totalBytes":bytes}),
                    );
                    let started = Instant::now();
                    match self
                        .execute_item(root, &client, &capabilities, &item, &task)
                        .await
                    {
                        Ok(transfer_bytes) => {
                            self.db
                                .set_task(
                                    &task,
                                    crate::domain::TaskStatus::Succeeded,
                                    transfer_bytes,
                                    None,
                                )
                                .await?;
                            let history_id = self
                                .db
                                .add_history(HistoryEntry {
                                    root_id: &root.id,
                                    task_id: Some(&task),
                                    path: &item.path,
                                    action: &action,
                                    status: "SUCCESS",
                                    bytes: transfer_bytes,
                                    duration_ms: started.elapsed().as_millis() as u64,
                                    error: None,
                                })
                                .await?;
                            self.emit(
                                "sync://progress",
                                serde_json::json!({"rootId":root.id,"taskId":task,"path":item.path,"operation":action,"bytesTransferred":transfer_bytes,"totalBytes":bytes}),
                            );
                            self.emit(
                                "sync://history-updated",
                                serde_json::json!({"rootId":root.id,"historyId":history_id}),
                            );
                            match action {
                                SyncAction::UploadNew | SyncAction::UploadUpdate => {
                                    summary.uploaded += 1
                                }
                                SyncAction::DownloadNew | SyncAction::DownloadUpdate => {
                                    summary.downloaded += 1
                                }
                                _ => summary.skipped += 1,
                            }
                            self.emit("sync://task-completed",serde_json::json!({"taskId":task,"rootId":root.id,"path":item.path,"result":"SUCCESS"}));
                        }
                        Err(error) => {
                            let attempts = self.db.task_attempts(&task).await?;
                            let retry_limit = self
                                .db
                                .setting("retryLimit")
                                .await?
                                .and_then(|v| v.parse().ok())
                                .unwrap_or(5_u32);
                            let task_status = if error.code.starts_with("BLOCKED_") {
                                crate::domain::TaskStatus::Blocked
                            } else if error.retryable && attempts < retry_limit {
                                crate::domain::TaskStatus::RetryWait
                            } else {
                                crate::domain::TaskStatus::Failed
                            };
                            self.db
                                .set_task(
                                    &task,
                                    task_status,
                                    0,
                                    Some((&error.code, &error.message)),
                                )
                                .await?;
                            let history_id = self
                                .db
                                .add_history(HistoryEntry {
                                    root_id: &root.id,
                                    task_id: Some(&task),
                                    path: &item.path,
                                    action: &action,
                                    status: if error.code.starts_with("BLOCKED_") {
                                        "BLOCKED"
                                    } else {
                                        "FAILED"
                                    },
                                    bytes: 0,
                                    duration_ms: started.elapsed().as_millis() as u64,
                                    error: Some((&error.code, &error.message)),
                                })
                                .await?;
                            self.emit(
                                "sync://history-updated",
                                serde_json::json!({"rootId":root.id,"historyId":history_id}),
                            );
                            if error.code == "DAV_CONNECTION_FAILED" {
                                self.emit(
                                    "sync://network-status",
                                    serde_json::json!({"online":false,"checkedAt":unix_ms()}),
                                );
                            }
                            let account_status = match error.code.as_str() {
                                "DAV_AUTH_FAILED" => Some("AUTH_FAILED"),
                                "DAV_CONNECTION_FAILED" => Some("OFFLINE"),
                                _ => None,
                            };
                            if let Some(account_status) = account_status {
                                let _ = self
                                    .db
                                    .set_account_status(&root.account_id, account_status)
                                    .await;
                            }
                            if error.code.starts_with("BLOCKED_") {
                                summary.blocked += 1;
                            } else {
                                summary.failed += 1;
                            }
                            self.emit("sync://task-failed",serde_json::json!({"taskId":task,"rootId":root.id,"path":item.path,"error":{"code":error.code,"message":error.message}}));
                        }
                    }
                }
            }
        }
        if !root.initial_sync_completed && summary.failed == 0 && summary.blocked == 0 {
            self.db.mark_initial_completed(&root.id).await?;
        }
        Ok(())
    }

    async fn execute_item(
        &self,
        root: &RootRecord,
        client: &WebDavClient,
        capabilities: &WebDavCapabilities,
        item: &PlannedAction,
        task_id: &str,
    ) -> AppResult<u64> {
        let destination = remote_file_path(&root.remote_path, &item.path)?;
        match item.action {
            SyncAction::UploadNew | SyncAction::UploadUpdate => {
                let local = item
                    .local
                    .as_ref()
                    .ok_or_else(|| AppError::new("LOCAL_FILE_CHANGED", "上传源文件已不存在"))?;
                if hash_file(&local.absolute_path)? != local.hash {
                    return Err(AppError::retryable(
                        "LOCAL_FILE_CHANGED",
                        "上传期间本地文件发生变化",
                    ));
                }
                if item.action == SyncAction::UploadNew && !capabilities.safe_create_only {
                    return Err(AppError::new(
                        "BLOCKED_SERVER_CAPABILITY",
                        "服务端没有验证 create-only 写入能力",
                    ));
                }
                let condition = if item.action == SyncAction::UploadNew {
                    PutCondition::CreateOnly
                } else {
                    if !capabilities.safe_update_existing {
                        return Err(AppError::new(
                            "BLOCKED_SERVER_CAPABILITY",
                            "服务端没有验证 If-Match 更新保护",
                        ));
                    }
                    PutCondition::IfMatch(item.expected_remote_etag.clone().ok_or_else(|| {
                        AppError::new(
                            "BLOCKED_SERVER_CAPABILITY",
                            "远端文件缺少可用于条件更新的 ETag",
                        )
                    })?)
                };
                ensure_remote_parent(client, &destination).await?;
                client
                    .put_file(&local.absolute_path, &destination, condition)
                    .await?;
                let observed =
                    verify_remote_hash(client, &destination, &self.data_dir, &local.hash).await?;
                if hash_file(&local.absolute_path)? != local.hash {
                    return Err(AppError::retryable(
                        "LOCAL_FILE_CHANGED",
                        "上传完成后本地文件已再次变化；基准未更新",
                    ));
                }
                self.db
                    .update_base(
                        &root.id,
                        &item.path,
                        Some(&local.hash),
                        Some(local),
                        Some(&observed),
                    )
                    .await?;
                Ok(local.size)
            }
            SyncAction::DownloadNew | SyncAction::DownloadUpdate => {
                let remote = item
                    .remote
                    .as_ref()
                    .ok_or_else(|| AppError::new("DAV_NOT_FOUND", "远端文件已不存在"))?;
                let target = ensure_safe_parent(&root.local_path, &item.path)?;
                if item.action == SyncAction::DownloadNew && target.exists() {
                    return Err(AppError::new(
                        "LOCAL_FILE_CHANGED",
                        "下载目标已由本地新文件占用",
                    ));
                }
                let staging = target.with_file_name(format!(".projectsync-{}.stage", task_id));
                let _ = tokio::fs::remove_file(&staging).await;
                let size = client.get_to_file(&destination, &staging).await?;
                let hash = hash_file(&staging)?;
                if hash != remote.hash {
                    return Err(AppError::retryable(
                        "HASH_MISMATCH",
                        "下载内容与扫描到的远端版本不同；已保留临时文件",
                    ));
                }
                let current = client.propfind(&destination, 0).await?;
                let current = current.iter().find(|e| !e.is_collection).ok_or_else(|| {
                    AppError::retryable("DAV_NOT_FOUND", "下载期间远端文件已删除")
                })?;
                if current.etag != remote.etag {
                    return Err(AppError::retryable(
                        "DAV_PRECONDITION_FAILED",
                        "下载期间远端版本发生变化；已保留临时文件",
                    ));
                }
                if item.action == SyncAction::DownloadUpdate {
                    if let Some(local) = item.local.as_ref() {
                        if !target.exists() || hash_file(&target)? != local.hash {
                            return Err(AppError::retryable(
                                "LOCAL_FILE_CHANGED",
                                "下载期间本地文件发生变化；未替换",
                            ));
                        }
                    }
                } else if target.exists() {
                    return Err(AppError::new(
                        "LOCAL_FILE_CHANGED",
                        "下载目标已存在；未覆盖",
                    ));
                }
                atomic_replace(&staging, &target)?;
                let verified = hash_file(&target)?;
                if verified != remote.hash {
                    return Err(AppError::new(
                        "HASH_MISMATCH",
                        "原子替换后的本地文件摘要不匹配",
                    ));
                }
                let local = LocalEntry {
                    relative_path: item.path.clone(),
                    path_key: path_key(&item.path),
                    absolute_path: target,
                    hash: verified,
                    size,
                    mtime_ns: unix_ms() * 1_000_000,
                };
                self.db
                    .update_base(
                        &root.id,
                        &item.path,
                        Some(&remote.hash),
                        Some(&local),
                        Some(remote),
                    )
                    .await?;
                Ok(size)
            }
            SyncAction::MoveLocalToTrash => {
                let local = item
                    .local
                    .as_ref()
                    .ok_or_else(|| AppError::new("LOCAL_NOT_FOUND", "待回收本地文件不存在"))?;
                if hash_file(&local.absolute_path)? != local.hash {
                    return Err(AppError::retryable(
                        "LOCAL_FILE_CHANGED",
                        "本地文件在同步期间发生变化",
                    ));
                }
                move_to_trash(&self.data_dir, &root.id, &item.path, &local.absolute_path)?;
                self.db
                    .add_tombstone(
                        &root.id,
                        &item.path,
                        "LOCAL",
                        Some(&local.hash),
                        item.remote.as_ref().map(|v| v.hash.as_str()),
                        Some("LOCAL_TRASHED"),
                    )
                    .await?;
                self.db
                    .update_base(&root.id, &item.path, None, None, None)
                    .await?;
                Ok(local.size)
            }
            SyncAction::MoveRemoteToTrash => {
                if !capabilities.safe_move_no_overwrite || !capabilities.safe_update_existing {
                    return Err(AppError::new(
                        "BLOCKED_SERVER_CAPABILITY",
                        "服务端未验证受 ETag 保护的远端 MOVE；删除操作已阻止",
                    ));
                }
                let remote = item
                    .remote
                    .as_ref()
                    .ok_or_else(|| AppError::new("DAV_NOT_FOUND", "待回收远端文件不存在"))?;
                let etag = remote.etag.as_deref().ok_or_else(|| {
                    AppError::new("BLOCKED_SERVER_CAPABILITY", "远端文件没有可验证的 ETag")
                })?;
                let trash = format!(
                    "{}/.projectsync/trash/{}/{}-{}",
                    root.remote_path.trim_end_matches('/'),
                    root.id,
                    unix_ms(),
                    item.path.replace('/', "_")
                );
                ensure_remote_parent(client, &trash).await?;
                client
                    .move_resource(&destination, &trash, false, Some(etag))
                    .await?;
                self.db
                    .add_tombstone(
                        &root.id,
                        &item.path,
                        "REMOTE",
                        Some(&remote.hash),
                        None,
                        Some("REMOTE_MOVED_TO_TRASH"),
                    )
                    .await?;
                self.db
                    .update_base(&root.id, &item.path, None, None, None)
                    .await?;
                Ok(remote.size)
            }
            _ => Ok(0),
        }
    }

    pub async fn pause(&self, root_id: &str) -> AppResult<()> {
        if !self.db.root(root_id).await?.enabled {
            return Err(AppError::new("ROOT_DISABLED", "同步项目已停用"));
        }
        self.db.set_root_status(root_id, "PAUSED").await
    }
    pub async fn resume(&self, root_id: &str) -> AppResult<()> {
        if !self.db.root(root_id).await?.enabled {
            return Err(AppError::new("ROOT_DISABLED", "同步项目已停用"));
        }
        self.db.set_root_status(root_id, "IDLE").await?;
        let _ = self.sync_now(root_id).await?;
        Ok(())
    }

    pub async fn resolve_conflict(
        &self,
        conflict_id: &str,
        resolution: ConflictResolution,
    ) -> AppResult<String> {
        let (root_id, path, local_hash, remote_hash, _base_hash, expected_etag) =
            self.db.conflict_record(conflict_id).await?;
        let root = self.db.root(&root_id).await?;
        let (account, client) = self.client_for(&root.account_id).await?;
        let capabilities = account.capabilities.unwrap_or_else(unsafe_capabilities);
        let rules = self.db.rules(&root_id).await?;
        let target = ensure_safe_parent(&root.local_path, &path)?;
        let remote_path = remote_file_path(&root.remote_path, &path)?;
        let current_local = if target.exists() {
            Some(hash_file(&target)?)
        } else {
            None
        };
        if current_local != local_hash {
            return Err(AppError::retryable(
                "LOCAL_FILE_CHANGED",
                "冲突检测后本地版本发生变化；请重新扫描",
            ));
        }
        let current_remote = match client.propfind(&remote_path, 0).await {
            Ok(rows) => {
                if rows.iter().any(|e| !e.is_collection) {
                    Some(
                        read_remote_snapshot(&client, &root.remote_path, &path, &self.data_dir)
                            .await?,
                    )
                } else {
                    None
                }
            }
            Err(error) if error.code == "DAV_NOT_FOUND" => None,
            Err(error) => return Err(error),
        };
        if current_remote.as_ref().and_then(|r| r.etag.as_ref()) != expected_etag.as_ref()
            || current_remote.as_ref().map(|r| r.hash.as_str()) != remote_hash.as_deref()
        {
            return Err(AppError::retryable(
                "DAV_PRECONDITION_FAILED",
                "冲突检测后远端版本发生变化；请重新扫描",
            ));
        }
        let message = match resolution {
            ConflictResolution::KeepLocal => {
                let local_path = target.clone();
                if !local_path.exists() {
                    return Err(AppError::new("LOCAL_NOT_FOUND", "本地冲突版本不存在"));
                }
                if current_remote.is_some() {
                    if !capabilities.safe_update_existing {
                        return Err(AppError::new(
                            "BLOCKED_SERVER_CAPABILITY",
                            "服务端未验证条件更新，无法应用 KEEP_LOCAL",
                        ));
                    }
                    let etag = current_remote
                        .as_ref()
                        .and_then(|r| r.etag.clone())
                        .ok_or_else(|| {
                            AppError::new("BLOCKED_SERVER_CAPABILITY", "远端缺少 ETag")
                        })?;
                    client
                        .put_file(&local_path, &remote_path, PutCondition::IfMatch(etag))
                        .await?;
                } else {
                    if !capabilities.safe_create_only {
                        return Err(AppError::new(
                            "BLOCKED_SERVER_CAPABILITY",
                            "服务端未验证 create-only，无法恢复远端文件",
                        ));
                    }
                    ensure_remote_parent(&client, &remote_path).await?;
                    client
                        .put_file(&local_path, &remote_path, PutCondition::CreateOnly)
                        .await?;
                }
                let hash = hash_file(&local_path)?;
                let observed =
                    verify_remote_hash(&client, &remote_path, &self.data_dir, &hash).await?;
                let local = scan_local(&root.local_path, &rules)?
                    .into_iter()
                    .find(|e| e.relative_path == path);
                self.db
                    .update_base(
                        &root.id,
                        &path,
                        Some(&hash),
                        local.as_ref(),
                        Some(&observed),
                    )
                    .await?;
                "本地版本已通过远端条件写入并验证。".to_owned()
            }
            ConflictResolution::KeepRemote => {
                if let Some(remote) = current_remote.as_ref() {
                    let stage = target.with_file_name(format!(
                        ".projectsync-resolve-{}.stage",
                        uuid::Uuid::new_v4()
                    ));
                    client.get_to_file(&remote_path, &stage).await?;
                    let hash = hash_file(&stage)?;
                    if Some(hash.as_str()) != remote_hash.as_deref() {
                        return Err(AppError::retryable(
                            "HASH_MISMATCH",
                            "远端冲突版本读取后发生变化",
                        ));
                    }
                    if target.exists() {
                        move_to_trash(&self.data_dir, &root.id, &path, &target)?;
                    }
                    atomic_replace(&stage, &target)?;
                    let local = LocalEntry {
                        relative_path: path.clone(),
                        path_key: path_key(&path),
                        absolute_path: target.clone(),
                        hash: hash.clone(),
                        size: fs::metadata(&target)?.len(),
                        mtime_ns: unix_ms() * 1_000_000,
                    };
                    self.db
                        .update_base(&root.id, &path, Some(&hash), Some(&local), Some(remote))
                        .await?;
                } else {
                    if target.exists() {
                        move_to_trash(&self.data_dir, &root.id, &path, &target)?;
                    }
                    self.db
                        .update_base(&root.id, &path, None, None, None)
                        .await?;
                }
                "远端版本已保留，本地旧版本已移入 ProjectSync 回收站。".to_owned()
            }
            ConflictResolution::KeepBoth => {
                if let Some(local_hash) = current_local.as_deref() {
                    let conflict_path = crate::filesystem::unique_conflict_path(
                        &path,
                        &self.db.device_name().await?,
                    )?;
                    let conflict_target = ensure_safe_parent(&root.local_path, &conflict_path)?;
                    crate::filesystem::copy_create_new(&target, &conflict_target)?;
                    if capabilities.safe_create_only {
                        let conflict_remote = remote_file_path(&root.remote_path, &conflict_path)?;
                        ensure_remote_parent(&client, &conflict_remote).await?;
                        client
                            .put_file(&conflict_target, &conflict_remote, PutCondition::CreateOnly)
                            .await?;
                        let _ = verify_remote_hash(
                            &client,
                            &conflict_remote,
                            &self.data_dir,
                            local_hash,
                        )
                        .await?;
                    }
                    if let Some(remote) = current_remote.as_ref() {
                        let stage = target.with_file_name(format!(
                            ".projectsync-keepboth-{}.stage",
                            uuid::Uuid::new_v4()
                        ));
                        client.get_to_file(&remote_path, &stage).await?;
                        if hash_file(&stage)? != remote.hash {
                            return Err(AppError::retryable(
                                "HASH_MISMATCH",
                                "读取远端版本时内容发生变化；冲突副本已保留",
                            ));
                        }
                        if hash_file(&target)? != local_hash {
                            return Err(AppError::retryable(
                                "LOCAL_FILE_CHANGED",
                                "保存冲突副本后本地原文件发生变化",
                            ));
                        }
                        atomic_replace(&stage, &target)?;
                        let local = LocalEntry {
                            relative_path: path.clone(),
                            path_key: path_key(&path),
                            absolute_path: target.clone(),
                            hash: remote.hash.clone(),
                            size: remote.size,
                            mtime_ns: unix_ms() * 1_000_000,
                        };
                        self.db
                            .update_base(
                                &root.id,
                                &path,
                                Some(&remote.hash),
                                Some(&local),
                                Some(remote),
                            )
                            .await?;
                    } else {
                        if !capabilities.safe_create_only {
                            return Err(AppError::new(
                                "BLOCKED_SERVER_CAPABILITY",
                                "远端文件已删除且服务端未验证 create-only；本地冲突副本已保留",
                            ));
                        }
                        ensure_remote_parent(&client, &remote_path).await?;
                        client
                            .put_file(&target, &remote_path, PutCondition::CreateOnly)
                            .await?;
                        let observed =
                            verify_remote_hash(&client, &remote_path, &self.data_dir, local_hash)
                                .await?;
                        let local = scan_local(&root.local_path, &rules)?
                            .into_iter()
                            .find(|e| e.relative_path == path);
                        self.db
                            .update_base(
                                &root.id,
                                &path,
                                Some(local_hash),
                                local.as_ref(),
                                Some(&observed),
                            )
                            .await?;
                    }
                    format!("本地版本已另存为冲突副本：{conflict_path}。")
                } else if let Some(remote) = current_remote.as_ref() {
                    let stage = target.with_file_name(format!(
                        ".projectsync-keepboth-{}.stage",
                        uuid::Uuid::new_v4()
                    ));
                    client.get_to_file(&remote_path, &stage).await?;
                    if hash_file(&stage)? != remote.hash {
                        return Err(AppError::retryable(
                            "HASH_MISMATCH",
                            "远端版本读取后发生变化",
                        ));
                    }
                    atomic_replace(&stage, &target)?;
                    let local = LocalEntry {
                        relative_path: path.clone(),
                        path_key: path_key(&path),
                        absolute_path: target.clone(),
                        hash: remote.hash.clone(),
                        size: remote.size,
                        mtime_ns: unix_ms() * 1_000_000,
                    };
                    self.db
                        .update_base(
                            &root.id,
                            &path,
                            Some(&remote.hash),
                            Some(&local),
                            Some(remote),
                        )
                        .await?;
                    "本地无文件版本，远端版本已保留并恢复到本地路径。".to_owned()
                } else {
                    return Err(AppError::new(
                        "SYNC_CONFLICT",
                        "冲突双方当前均不存在文件；请重新扫描后再解决",
                    ));
                }
            }
        };
        self.db.resolve_conflict(conflict_id, resolution).await?;
        let action = SyncAction::CreateConflictCopy;
        self.db
            .add_history(HistoryEntry {
                root_id: &root.id,
                task_id: None,
                path: &path,
                action: &action,
                status: "SUCCESS",
                bytes: 0,
                duration_ms: 0,
                error: None,
            })
            .await?;
        Ok(message)
    }

    fn emit(&self, event: &str, payload: serde_json::Value) {
        if let Err(error) = self.app.emit(event, payload) {
            tracing::debug!(event,error=%error,"event delivery failed");
        }
    }
}

fn unsafe_capabilities() -> WebDavCapabilities {
    WebDavCapabilities {
        server_header: "unknown".to_owned(),
        etag_type: "None".to_owned(),
        supports_if_match: false,
        supports_if_none_match: false,
        supports_lock: false,
        propfind_depth1_supported: false,
        safe_create_only: false,
        safe_update_existing: false,
        safe_delete: false,
        safe_move_no_overwrite: false,
        probe_cleanup_warning: None,
        tested_at: 0,
    }
}

fn parse_manifest(bytes: &[u8]) -> AppResult<RootManifest> {
    let manifest: RootManifest = serde_json::from_slice(bytes).map_err(|_| {
        AppError::new(
            "REMOTE_PROJECT_INVALID",
            "远端 .projectsync/root.json 格式无效",
        )
    })?;
    if manifest.schema_version != 1 || manifest.remote_project_id.trim().is_empty() {
        return Err(AppError::new(
            "REMOTE_PROJECT_INVALID",
            "远端项目标识版本或内容无效",
        ));
    }
    Ok(manifest)
}

fn remote_file_path(root_path: &str, relative: &str) -> AppResult<String> {
    let root = normalize_remote_path(root_path)?;
    let relative = validate_relative_path(relative)?;
    Ok(format!("{}/{}", root.trim_end_matches('/'), relative))
}

async fn ensure_remote_parent(client: &WebDavClient, path: &str) -> AppResult<()> {
    let parent = path
        .rsplit_once('/')
        .map(|(p, _)| if p.is_empty() { "/" } else { p })
        .unwrap_or("/");
    client.ensure_collection(parent).await
}

async fn verify_remote_hash(
    client: &WebDavClient,
    path: &str,
    data_dir: &Path,
    expected: &str,
) -> AppResult<RemoteEntry> {
    let staging = data_dir
        .join("staging")
        .join(format!("verify-{}.bin", uuid::Uuid::new_v4()));
    if let Some(parent) = staging.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    let size = client.get_to_file(path, &staging).await?;
    let hash = hash_file(&staging)?;
    let _ = tokio::fs::remove_file(&staging).await;
    if hash != expected {
        return Err(AppError::retryable(
            "HASH_MISMATCH",
            "WebDAV 写入后的读取校验不一致",
        ));
    }
    let props = client.propfind(path, 0).await?;
    let prop = props
        .into_iter()
        .find(|e| !e.is_collection)
        .ok_or_else(|| AppError::retryable("DAV_NOT_FOUND", "写入后无法读取远端文件属性"))?;
    Ok(RemoteEntry {
        relative_path: String::new(),
        path_key: String::new(),
        hash,
        size,
        modified_at: prop.modified_at,
        etag: prop.etag,
        is_collection: false,
    })
}

async fn read_remote_snapshot(
    client: &WebDavClient,
    root_path: &str,
    relative: &str,
    data_dir: &Path,
) -> AppResult<RemoteEntry> {
    let remote_path = remote_file_path(root_path, relative)?;
    let staging = data_dir
        .join("staging")
        .join(format!("conflict-read-{}.bin", uuid::Uuid::new_v4()));
    if let Some(parent) = staging.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    let size = client.get_to_file(&remote_path, &staging).await?;
    let hash = hash_file(&staging)?;
    let _ = tokio::fs::remove_file(staging).await;
    let properties = client.propfind(&remote_path, 0).await?;
    let property = properties
        .into_iter()
        .find(|entry| !entry.is_collection)
        .ok_or_else(|| AppError::retryable("DAV_NOT_FOUND", "冲突远端版本已删除"))?;
    Ok(RemoteEntry {
        relative_path: relative.to_owned(),
        path_key: path_key(relative),
        hash,
        size,
        modified_at: property.modified_at,
        etag: property.etag,
        is_collection: false,
    })
}

async fn scan_remote(
    client: &WebDavClient,
    root_path: &str,
    rules: &[SyncRuleDto],
    data_dir: &Path,
    cache: &[crate::domain::BaselineEntry],
) -> AppResult<Vec<RemoteEntry>> {
    let root_path = normalize_remote_path(root_path)?;
    let rule_engine = RuleEngine::compile(rules)?;
    let mut directories = vec![root_path.clone()];
    let mut visited = BTreeSet::new();
    let mut entries = Vec::new();
    let mut case_names = HashMap::<String, String>::new();
    while let Some(directory) = directories.pop() {
        if !visited.insert(directory.clone()) {
            continue;
        }
        let props = client.propfind(&directory, 1).await?;
        for prop in props {
            let dav_path = href_to_dav_path(client, &prop.path, &directory)?;
            if dav_path == directory || dav_path == format!("{}/", directory.trim_end_matches('/'))
            {
                continue;
            }
            let prefix = format!("{}/", root_path.trim_end_matches('/'));
            let relative = dav_path.strip_prefix(&prefix).ok_or_else(|| {
                AppError::new(
                    "DAV_INVALID_RESPONSE",
                    "PROPFIND 返回了同步根目录之外的文件",
                )
            })?;
            let relative = validate_relative_path(relative.trim_end_matches('/'))?;
            if prop.is_collection {
                if !relative
                    .split('/')
                    .any(|part| part.eq_ignore_ascii_case(".projectsync"))
                {
                    directories.push(dav_path);
                }
                continue;
            }
            if !rule_engine.includes(&relative) {
                continue;
            }
            let key = path_key(&relative);
            if let Some(previous) = case_names.insert(key.clone(), relative.clone()) {
                return Err(AppError::new(
                    "CASE_COLLISION",
                    format!("远端路径在 Windows 上大小写冲突：{previous} / {relative}"),
                ));
            }
            let cached = cache.iter().find(|old| {
                old.path_key == key
                    && old.remote_etag.as_deref() == prop.etag.as_deref()
                    && old.remote_size == prop.size
                    && old.remote_hash.is_some()
                    && !prop
                        .etag
                        .as_deref()
                        .unwrap_or_default()
                        .trim_start()
                        .starts_with("W/")
            });
            let (hash, size) = if let Some(old) = cached {
                (old.remote_hash.clone().unwrap_or_default(), prop.size)
            } else {
                let staging = data_dir
                    .join("staging")
                    .join(format!("remote-scan-{}.bin", uuid::Uuid::new_v4()));
                if let Some(parent) = staging.parent() {
                    tokio::fs::create_dir_all(parent).await?;
                }
                let size = client.get_to_file(&dav_path, &staging).await?;
                let hash = hash_file(&staging)?;
                let _ = tokio::fs::remove_file(staging).await;
                (hash, size)
            };
            entries.push(RemoteEntry {
                relative_path: relative,
                path_key: key,
                hash,
                size,
                modified_at: prop.modified_at,
                etag: prop.etag,
                is_collection: false,
            });
        }
    }
    Ok(entries)
}

fn build_plan(
    local: &[LocalEntry],
    remote: &[RemoteEntry],
    baseline: &[crate::domain::BaselineEntry],
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
                if local.hash == remote.hash {
                    plan.push(plan_item(
                        &path,
                        SyncAction::MarkClean,
                        None,
                        Some((*local).clone()),
                        Some((*remote).clone()),
                        "两端内容一致",
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
                        if capabilities.safe_move_no_overwrite && capabilities.safe_update_existing
                        {
                            plan.push(with_etag(
                                plan_item(
                                    &path,
                                    SyncAction::MoveRemoteToTrash,
                                    None,
                                    None,
                                    Some((*remote).clone()),
                                    "本地已删除且远端仍为基线版本；移入远端回收站",
                                ),
                                remote.etag.clone(),
                            ));
                        } else {
                            plan.push(plan_item(
                                &path,
                                SyncAction::Blocked,
                                None,
                                None,
                                Some((*remote).clone()),
                                "服务端未验证受保护的 MOVE/删除能力",
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

fn preview_from_plan(root_id: &str, plan: Vec<PlannedAction>) -> InitialSyncPreviewDto {
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
