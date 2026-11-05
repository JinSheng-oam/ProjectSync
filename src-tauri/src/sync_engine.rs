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
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeSet, HashMap},
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
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
    root_cancellations: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct RootManifest {
    schema_version: u32,
    remote_project_id: String,
}

type TransferProgress = Arc<dyn Fn(u64) + Send + Sync>;

impl SyncCoordinator {
    pub fn new(db: Database, data_dir: PathBuf, app: AppHandle) -> Self {
        Self {
            db,
            data_dir,
            app,
            root_locks: Arc::new(Mutex::new(HashMap::new())),
            root_cancellations: Arc::new(Mutex::new(HashMap::new())),
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

    fn cancellation_for(&self, root_id: &str) -> AppResult<Arc<AtomicBool>> {
        let mut cancellations = self
            .root_cancellations
            .lock()
            .map_err(|_| AppError::new("ENGINE_LOCK_FAILED", "同步控制状态不可用"))?;
        Ok(cancellations
            .entry(root_id.to_owned())
            .or_insert_with(|| Arc::new(AtomicBool::new(false)))
            .clone())
    }

    pub fn cancel_root(&self, root_id: &str) {
        if let Ok(cancellation) = self.cancellation_for(root_id) {
            cancellation.store(true, Ordering::Release);
        }
    }

    fn transfer_progress(
        &self,
        root_id: &str,
        task_id: &str,
        path: &str,
        action: SyncAction,
        total: u64,
    ) -> TransferProgress {
        let app = self.app.clone();
        let root_id = root_id.to_owned();
        let task_id = task_id.to_owned();
        let path = path.to_owned();
        let operation = serde_json::to_value(action).unwrap_or_default();
        let last_emit = Arc::new(Mutex::new((Instant::now(), 0_u64)));
        Arc::new(move |transferred| {
            if let Ok(mut last) = last_emit.lock() {
                let now = Instant::now();
                if transferred >= total
                    || transferred.saturating_sub(last.1) >= 256 * 1024
                    || now.duration_since(last.0) >= std::time::Duration::from_millis(250)
                {
                    *last = (now, transferred);
                    let _ = app.emit(
                        "sync://progress",
                        serde_json::json!({"rootId":root_id,"taskId":task_id,"path":path,"operation":operation,"bytesTransferred":transferred,"totalBytes":total}),
                    );
                }
            }
        })
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
        let mut capabilities = account.capabilities.unwrap_or_else(unsafe_capabilities);
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
        if capabilities.supports_lock && !capabilities.supports_if_none_match {
            let metadata_path = format!("{}/.projectsync", remote_path.trim_end_matches('/'));
            if !client.probe_lock_exclusion_in(&metadata_path).await? {
                return Err(AppError::new(
                    "BLOCKED_SERVER_CAPABILITY",
                    "目标 WebDAV 目录未通过独占锁写保护验证；请检查该目录的 LOCK/写入权限",
                ));
            }
            capabilities.safe_create_only = true;
            capabilities.safe_update_existing = true;
            capabilities.tested_at = unix_ms();
            self.db
                .save_capabilities(&account_id, &capabilities, "ONLINE")
                .await?;
        }
        let remote_project_id = match client.get_bytes(&manifest_path).await {
            Ok(bytes) => parse_manifest(&bytes)?.remote_project_id,
            Err(error) if error.code == "DAV_NOT_FOUND" => {
                if !capabilities.safe_create_only {
                    let metadata_path =
                        format!("{}/.projectsync", remote_path.trim_end_matches('/'));
                    let native_create_only = client.probe_create_only_in(&metadata_path).await?;
                    let lock_protected_writes = if native_create_only {
                        false
                    } else {
                        client.probe_lock_exclusion_in(&metadata_path).await?
                    };
                    if !native_create_only && !lock_protected_writes {
                        return Err(AppError::new(
                            "BLOCKED_SERVER_CAPABILITY",
                            "目标 WebDAV 目录未通过安全新建验证；服务器需支持 If-None-Match: *，或支持并强制执行 WebDAV 独占锁",
                        ));
                    }
                    capabilities.safe_create_only = true;
                    if native_create_only {
                        capabilities.supports_if_none_match = true;
                    } else {
                        capabilities.supports_lock = true;
                        capabilities.safe_update_existing = true;
                    }
                    capabilities.tested_at = unix_ms();
                    self.db
                        .save_capabilities(&account_id, &capabilities, "ONLINE")
                        .await?;
                }
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
                let bytes = serde_json::to_vec_pretty(&manifest)
                    .map_err(|e| AppError::new("SERIALIZATION_ERROR", e.to_string()))?;
                tokio::fs::write(&path, bytes).await?;
                let create_result = if capabilities.supports_if_none_match {
                    match client
                        .put_file(&path, &manifest_path, PutCondition::CreateOnly)
                        .await
                    {
                        Ok(()) => Ok(()),
                        Err(write_error) if write_error.code == "DAV_PRECONDITION_FAILED" => Ok(()),
                        Err(write_error) => Err(write_error),
                    }
                } else if capabilities.supports_lock {
                    let metadata_path =
                        format!("{}/.projectsync", remote_path.trim_end_matches('/'));
                    match client.lock_exclusive(&metadata_path, "infinity").await {
                        Ok(lock_token) => {
                            let result = async {
                                match client.get_bytes(&manifest_path).await {
                                    Ok(_) => Ok(()),
                                    Err(error) if error.code == "DAV_NOT_FOUND" => {
                                        client
                                            .put_file_with_lock_token(
                                                &path,
                                                &manifest_path,
                                                PutCondition::CreateOnly,
                                                &lock_token,
                                            )
                                            .await
                                    }
                                    Err(error) => Err(error),
                                }
                            }
                            .await;
                            let unlock_result = client.unlock(&metadata_path, &lock_token).await;
                            result.and(unlock_result)
                        }
                        Err(error) => Err(error),
                    }
                } else {
                    Err(AppError::new(
                        "BLOCKED_SERVER_CAPABILITY",
                        "服务端没有安全新建能力",
                    ))
                };
                let _ = tokio::fs::remove_file(&path).await;
                create_result?;
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
            max_parallel_transfers: 2,
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
        self.sync_with_lock_policy(root_id, false)
            .await?
            .ok_or_else(|| AppError::new("ENGINE_LOCK_FAILED", "同步未能获取执行锁"))
    }

    pub async fn sync_now_if_idle(&self, root_id: &str) -> AppResult<Option<SyncSummaryDto>> {
        self.sync_with_lock_policy(root_id, true).await
    }

    async fn sync_with_lock_policy(
        &self,
        root_id: &str,
        skip_if_busy: bool,
    ) -> AppResult<Option<SyncSummaryDto>> {
        let lock = self.lock_for(root_id)?;
        let cancellation = self.cancellation_for(root_id)?;
        let _guard = if skip_if_busy {
            match lock.try_lock_owned() {
                Ok(guard) => guard,
                Err(_) => return Ok(None),
            }
        } else {
            lock.lock_owned().await
        };
        cancellation.store(false, Ordering::Release);
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
        let interrupted = matches!(
            result.as_ref().err().map(|error| error.code.as_str()),
            Some("SYNC_INTERRUPTED" | "ROOT_DISABLED" | "ROOT_NOT_FOUND")
        );
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
        let current_root = self.db.root(root_id).await.ok();
        let has_conflicts = self
            .db
            .root_has_unresolved_conflicts(root_id)
            .await
            .unwrap_or(false);
        let status = if current_root.as_ref().is_none_or(|root| !root.enabled) {
            "DISABLED"
        } else if current_root.as_ref().is_some_and(|root| {
            root.status == "PAUSED"
                || (interrupted
                    && matches!(
                        root.status.as_str(),
                        "SCANNING_LOCAL" | "SCANNING_REMOTE" | "PLANNING" | "SYNCING"
                    ))
        }) {
            "PAUSED"
        } else if has_conflicts {
            "CONFLICT"
        } else if result.is_err() || summary.failed > 0 || summary.blocked > 0 {
            "ERROR"
        } else {
            "IDLE"
        };
        if current_root.is_some() {
            let _ = self.db.finish_sync(root_id, status).await;
        }
        summary.finished_at = Some(unix_ms());
        self.emit(
            "sync://root-status",
            serde_json::json!({"rootId":root_id,"status":status,"timestamp":summary.finished_at}),
        );
        drop(_guard);
        if interrupted {
            Ok(Some(summary))
        } else {
            result.map(|_| Some(summary))
        }
    }

    async fn sync_locked(&self, root: &RootRecord, summary: &mut SyncSummaryDto) -> AppResult<()> {
        self.ensure_sync_active(&root.id).await?;
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
        self.ensure_sync_active(&root.id).await?;
        self.db.set_root_status(&root.id, "SCANNING_REMOTE").await?;
        let remote = scan_remote(
            &client,
            &root.remote_path,
            &rules,
            &self.data_dir,
            &old_baseline,
        )
        .await?;
        self.ensure_sync_active(&root.id).await?;
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
        let mut transfer_jobs = Vec::new();
        for item in plan {
            self.ensure_sync_active(&root.id).await?;
            if matches!(
                item.action,
                SyncAction::UploadNew
                    | SyncAction::UploadUpdate
                    | SyncAction::DownloadNew
                    | SyncAction::DownloadUpdate
            ) {
                let total = item
                    .local
                    .as_ref()
                    .map(|entry| entry.size)
                    .or_else(|| item.remote.as_ref().map(|entry| entry.size))
                    .unwrap_or_default();
                let (task, ready) = self
                    .db
                    .prepare_task(
                        &root.id,
                        &item.path,
                        &item.action,
                        total,
                        item.local.as_ref().map(|entry| entry.hash.as_str()),
                        item.expected_remote_etag.as_deref(),
                    )
                    .await?;
                if ready {
                    transfer_jobs.push((item, task, total));
                } else {
                    summary.skipped += 1;
                }
                continue;
            }
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
                                        && put_remote_create_only(
                                            &client,
                                            &source,
                                            &remote_copy,
                                            &capabilities,
                                            &self.data_dir,
                                            None,
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
                    let total = item
                        .local
                        .as_ref()
                        .map(|entry| entry.size)
                        .or_else(|| item.remote.as_ref().map(|entry| entry.size))
                        .unwrap_or_default();
                    let (task, ready) = self
                        .db
                        .prepare_task(
                            &root.id,
                            &item.path,
                            &action,
                            total,
                            item.local.as_ref().map(|entry| entry.hash.as_str()),
                            item.expected_remote_etag.as_deref(),
                        )
                        .await?;
                    if ready {
                        let (uploaded, downloaded, failed, blocked) = self
                            .execute_planned_task(
                                &root,
                                &client,
                                &capabilities,
                                &item,
                                &task,
                                total,
                            )
                            .await?;
                        summary.uploaded += uploaded;
                        summary.downloaded += downloaded;
                        summary.failed += failed;
                        summary.blocked += blocked;
                    } else {
                        summary.skipped += 1;
                    }
                }
            }
        }
        let transfer_results = futures_util::stream::iter(transfer_jobs)
            .map(|(item, task, total)| {
                let client = client.clone();
                let capabilities = capabilities.clone();
                async move {
                    self.execute_planned_task(root, &client, &capabilities, &item, &task, total)
                        .await
                }
            })
            .buffer_unordered(root.max_parallel_transfers.clamp(1, 8) as usize)
            .collect::<Vec<_>>()
            .await;
        for result in transfer_results {
            let (uploaded, downloaded, failed, blocked) = result?;
            summary.uploaded += uploaded;
            summary.downloaded += downloaded;
            summary.failed += failed;
            summary.blocked += blocked;
        }
        if !root.initial_sync_completed && summary.failed == 0 && summary.blocked == 0 {
            self.db.mark_initial_completed(&root.id).await?;
        }
        Ok(())
    }

    async fn ensure_sync_active(&self, root_id: &str) -> AppResult<()> {
        if self.cancellation_for(root_id)?.load(Ordering::Acquire) {
            return Err(AppError::new("SYNC_INTERRUPTED", "同步已按要求停止"));
        }
        let root = self.db.root(root_id).await?;
        if !root.enabled {
            return Err(AppError::new("ROOT_DISABLED", "同步项目已停用"));
        }
        if root.status == "PAUSED" {
            return Err(AppError::new("SYNC_INTERRUPTED", "同步已按要求停止"));
        }
        Ok(())
    }

    async fn execute_planned_task(
        &self,
        root: &RootRecord,
        client: &WebDavClient,
        capabilities: &WebDavCapabilities,
        item: &PlannedAction,
        task_id: &str,
        total: u64,
    ) -> AppResult<(u64, u64, u64, u64)> {
        self.ensure_sync_active(&root.id).await?;
        self.db
            .set_task(task_id, crate::domain::TaskStatus::Running, 0, None)
            .await?;
        self.emit(
            "sync://progress",
            serde_json::json!({"rootId":root.id,"taskId":task_id,"path":item.path,"operation":item.action,"bytesTransferred":0,"totalBytes":total}),
        );
        let started = Instant::now();
        match self
            .execute_item(root, client, capabilities, item, task_id)
            .await
        {
            Ok(transferred) => {
                self.db
                    .set_task(
                        task_id,
                        crate::domain::TaskStatus::Succeeded,
                        transferred,
                        None,
                    )
                    .await?;
                let history_id = self
                    .db
                    .add_history(HistoryEntry {
                        root_id: &root.id,
                        task_id: Some(task_id),
                        path: &item.path,
                        action: &item.action,
                        status: "SUCCESS",
                        bytes: transferred,
                        duration_ms: started.elapsed().as_millis() as u64,
                        error: None,
                    })
                    .await?;
                self.emit(
                    "sync://progress",
                    serde_json::json!({"rootId":root.id,"taskId":task_id,"path":item.path,"operation":item.action,"bytesTransferred":transferred,"totalBytes":total}),
                );
                self.emit(
                    "sync://history-updated",
                    serde_json::json!({"rootId":root.id,"historyId":history_id}),
                );
                self.emit(
                    "sync://task-completed",
                    serde_json::json!({"taskId":task_id,"rootId":root.id,"path":item.path,"result":"SUCCESS"}),
                );
                let (uploaded, downloaded) = match item.action {
                    SyncAction::UploadNew | SyncAction::UploadUpdate => (1, 0),
                    SyncAction::DownloadNew | SyncAction::DownloadUpdate => (0, 1),
                    _ => (0, 0),
                };
                Ok((uploaded, downloaded, 0, 0))
            }
            Err(error) => {
                let attempts = self.db.task_attempts(task_id).await?;
                let retry_limit = self
                    .db
                    .setting("retryLimit")
                    .await?
                    .and_then(|value| value.parse().ok())
                    .unwrap_or(5_u32);
                let task_status = if error.code.starts_with("BLOCKED_") {
                    crate::domain::TaskStatus::Blocked
                } else if error.retryable && attempts < retry_limit {
                    crate::domain::TaskStatus::RetryWait
                } else {
                    crate::domain::TaskStatus::Failed
                };
                self.db
                    .set_task(task_id, task_status, 0, Some((&error.code, &error.message)))
                    .await?;
                let history_id = self
                    .db
                    .add_history(HistoryEntry {
                        root_id: &root.id,
                        task_id: Some(task_id),
                        path: &item.path,
                        action: &item.action,
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
                let blocked = u64::from(error.code.starts_with("BLOCKED_"));
                let failed = u64::from(blocked == 0);
                self.emit(
                    "sync://task-failed",
                    serde_json::json!({"taskId":task_id,"rootId":root.id,"path":item.path,"error":{"code":error.code,"message":error.message}}),
                );
                Ok((0, 0, failed, blocked))
            }
        }
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
                ensure_remote_parent(client, &destination).await?;
                let progress =
                    self.transfer_progress(&root.id, task_id, &item.path, item.action, local.size);
                if item.action == SyncAction::UploadNew {
                    put_remote_create_only(
                        client,
                        &local.absolute_path,
                        &destination,
                        capabilities,
                        &self.data_dir,
                        Some(progress),
                    )
                    .await?;
                } else {
                    let remote = item
                        .remote
                        .as_ref()
                        .ok_or_else(|| AppError::new("DAV_NOT_FOUND", "待更新的远端文件不存在"))?;
                    put_remote_update(
                        client,
                        &local.absolute_path,
                        &destination,
                        item.expected_remote_etag
                            .as_deref()
                            .or(remote.etag.as_deref()),
                        &remote.hash,
                        capabilities,
                        &self.data_dir,
                        Some(progress),
                    )
                    .await?;
                }
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
                let progress =
                    self.transfer_progress(&root.id, task_id, &item.path, item.action, remote.size);
                let size = client
                    .get_to_file_with_progress(&destination, &staging, Some(progress))
                    .await?;
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
        self.db.set_root_status(root_id, "PAUSED").await?;
        self.cancel_root(root_id);
        Ok(())
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
                    let remote = current_remote.as_ref().ok_or_else(|| {
                        AppError::new("DAV_NOT_FOUND", "冲突中的远端文件已不存在")
                    })?;
                    put_remote_update(
                        &client,
                        &local_path,
                        &remote_path,
                        remote.etag.as_deref(),
                        &remote.hash,
                        &capabilities,
                        &self.data_dir,
                        None,
                    )
                    .await?;
                } else {
                    ensure_remote_parent(&client, &remote_path).await?;
                    put_remote_create_only(
                        &client,
                        &local_path,
                        &remote_path,
                        &capabilities,
                        &self.data_dir,
                        None,
                    )
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
                        put_remote_create_only(
                            &client,
                            &conflict_target,
                            &conflict_remote,
                            &capabilities,
                            &self.data_dir,
                            None,
                        )
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
                        ensure_remote_parent(&client, &remote_path).await?;
                        put_remote_create_only(
                            &client,
                            &target,
                            &remote_path,
                            &capabilities,
                            &self.data_dir,
                            None,
                        )
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

async fn put_remote_create_only(
    client: &WebDavClient,
    source: &Path,
    destination: &str,
    capabilities: &WebDavCapabilities,
    data_dir: &Path,
    progress: Option<TransferProgress>,
) -> AppResult<()> {
    if !capabilities.safe_create_only {
        return Err(AppError::new(
            "BLOCKED_SERVER_CAPABILITY",
            "服务端没有经过验证的安全新建能力",
        ));
    }
    if capabilities.supports_if_none_match {
        if let Some(progress) = progress.clone() {
            return client
                .put_file_with_progress(source, destination, PutCondition::CreateOnly, progress)
                .await;
        }
        return client
            .put_file(source, destination, PutCondition::CreateOnly)
            .await;
    }
    if capabilities.supports_lock {
        let parent = remote_parent_path(destination);
        return put_remote_with_lock(
            client,
            source,
            destination,
            &parent,
            PutCondition::CreateOnly,
            None,
            data_dir,
            progress,
        )
        .await;
    }
    Err(AppError::new(
        "BLOCKED_SERVER_CAPABILITY",
        "服务端没有可用于安全新建的 If-None-Match 或 WebDAV 独占锁",
    ))
}

async fn put_remote_update(
    client: &WebDavClient,
    source: &Path,
    destination: &str,
    expected_etag: Option<&str>,
    expected_hash: &str,
    capabilities: &WebDavCapabilities,
    data_dir: &Path,
    progress: Option<TransferProgress>,
) -> AppResult<()> {
    if !capabilities.safe_update_existing {
        return Err(AppError::new(
            "BLOCKED_SERVER_CAPABILITY",
            "服务端没有经过验证的安全更新能力",
        ));
    }
    if capabilities.supports_if_match {
        let etag = expected_etag.ok_or_else(|| {
            AppError::new(
                "BLOCKED_SERVER_CAPABILITY",
                "远端文件缺少可用于条件更新的 ETag",
            )
        })?;
        if let Some(progress) = progress.clone() {
            return client
                .put_file_with_progress(
                    source,
                    destination,
                    PutCondition::IfMatch(etag.to_owned()),
                    progress,
                )
                .await;
        }
        return client
            .put_file(source, destination, PutCondition::IfMatch(etag.to_owned()))
            .await;
    }
    if capabilities.supports_lock {
        let parent = remote_parent_path(destination);
        return put_remote_with_lock(
            client,
            source,
            destination,
            &parent,
            PutCondition::Unconditional,
            Some(expected_hash),
            data_dir,
            progress,
        )
        .await;
    }
    Err(AppError::new(
        "BLOCKED_SERVER_CAPABILITY",
        "服务端没有可用于安全更新的 If-Match 或 WebDAV 独占锁",
    ))
}

async fn put_remote_with_lock(
    client: &WebDavClient,
    source: &Path,
    destination: &str,
    lock_parent: &str,
    condition: PutCondition,
    expected_hash: Option<&str>,
    data_dir: &Path,
    progress: Option<TransferProgress>,
) -> AppResult<()> {
    let token = client.lock_exclusive(lock_parent, "infinity").await?;
    let result = async {
        let current_hash = remote_file_hash(client, destination, data_dir).await?;
        match (expected_hash, current_hash.as_deref()) {
            (None, None) => {}
            (Some(expected), Some(current)) if expected == current => {}
            (None, Some(_)) => {
                return Err(AppError::retryable(
                    "DAV_PRECONDITION_FAILED",
                    "取得远端写锁后发现目标文件已存在，未覆盖远端内容",
                ));
            }
            (Some(_), None) => {
                return Err(AppError::retryable(
                    "DAV_PRECONDITION_FAILED",
                    "取得远端写锁后发现目标文件已删除，未写入远端",
                ));
            }
            (Some(_), Some(_)) => {
                return Err(AppError::retryable(
                    "DAV_PRECONDITION_FAILED",
                    "取得远端写锁后发现文件内容已变化，未覆盖远端内容",
                ));
            }
        }
        if let Some(progress) = progress {
            client
                .put_file_with_lock_token_and_progress(
                    source,
                    destination,
                    condition,
                    &token,
                    progress,
                )
                .await
        } else {
            client
                .put_file_with_lock_token(source, destination, condition, &token)
                .await
        }
    }
    .await;
    let unlock_result = client.unlock(lock_parent, &token).await;
    result?;
    unlock_result
}

fn remote_parent_path(path: &str) -> String {
    path.rsplit_once('/')
        .map(|(parent, _)| if parent.is_empty() { "/" } else { parent })
        .unwrap_or("/")
        .to_owned()
}

async fn remote_file_hash(
    client: &WebDavClient,
    path: &str,
    data_dir: &Path,
) -> AppResult<Option<String>> {
    let entries = match client.propfind(path, 0).await {
        Ok(entries) => entries,
        Err(error) if error.code == "DAV_NOT_FOUND" => return Ok(None),
        Err(error) => return Err(error),
    };
    let Some(entry) = entries.iter().find(|entry| !entry.is_collection) else {
        if entries.iter().any(|entry| entry.is_collection) {
            return Err(AppError::new("DAV_CONFLICT", "远端目标路径已被目录占用"));
        }
        return Ok(None);
    };
    let _ = entry;
    let staging = data_dir
        .join("staging")
        .join(format!("lock-check-{}.bin", uuid::Uuid::new_v4()));
    if let Some(parent) = staging.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    let result = async {
        client.get_to_file(path, &staging).await?;
        hash_file(&staging)
    }
    .await;
    let _ = tokio::fs::remove_file(&staging).await;
    result.map(Some)
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
    let cache_by_path = cache
        .iter()
        .map(|entry| (entry.path_key.clone(), entry))
        .collect::<HashMap<_, _>>();
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
            let cached = cache_by_path
                .get(&key)
                .copied()
                .filter(|old| can_reuse_remote_hash(old, prop.etag.as_deref(), prop.size));
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

fn can_reuse_remote_hash(
    old: &crate::domain::BaselineEntry,
    current_etag: Option<&str>,
    current_size: u64,
) -> bool {
    let Some(current_etag) = current_etag else {
        return false;
    };
    old.remote_hash.is_some()
        && old.remote_size == current_size
        && old.remote_etag.as_deref() == Some(current_etag)
        && !current_etag.trim_start().starts_with("W/")
}

#[cfg(test)]
mod remote_hash_cache_tests {
    use super::can_reuse_remote_hash;
    use crate::domain::BaselineEntry;

    fn baseline(etag: Option<&str>) -> BaselineEntry {
        BaselineEntry {
            relative_path: "file.txt".to_owned(),
            path_key: "file.txt".to_owned(),
            baseline_state: "PRESENT".to_owned(),
            sync_state: "CLEAN".to_owned(),
            base_hash: Some("base".to_owned()),
            base_size: 4,
            base_mtime_ms: 0,
            local_exists: true,
            local_hash: Some("hash".to_owned()),
            remote_exists: true,
            remote_hash: Some("hash".to_owned()),
            remote_etag: etag.map(str::to_owned),
            local_size: 4,
            remote_size: 4,
            local_mtime_ns: 0,
            remote_mtime_ms: 0,
        }
    }

    #[test]
    fn requires_a_matching_strong_etag_and_size_to_reuse_remote_hash() {
        let cached = baseline(Some("\"v1\""));
        assert!(can_reuse_remote_hash(&cached, Some("\"v1\""), 4));
        assert!(!can_reuse_remote_hash(&baseline(None), None, 4));
        assert!(!can_reuse_remote_hash(&cached, Some("W/\"v1\""), 4));
        assert!(!can_reuse_remote_hash(&cached, Some("\"v2\""), 4));
        assert!(!can_reuse_remote_hash(&cached, Some("\"v1\""), 5));
    }
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
