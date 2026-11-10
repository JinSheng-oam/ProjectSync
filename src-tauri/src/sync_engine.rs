mod plan;
mod ai_merge;
mod scan;
mod transfer;
mod remote_files;
mod conflict;
mod binding;

use plan::{build_plan, preview_from_plan};
use remote_files::{
    ensure_remote_parent, put_remote_create_only, put_remote_update, read_remote_snapshot,
    verify_remote_hash,
};
use scan::{line_ending_equivalent_paths, scan_remote};

use crate::{
    ai::{load_merge_config, request_merge},
    credentials::CredentialStore,
    domain::{
        AiMergePreviewDto, AppError, AppResult, ConflictResolution, HistoryEntry,
        InitialSyncPreviewDto, LocalEntry, PlannedAction, RemoteEntry, RootRecord,
        SyncAction, SyncRuleDto, SyncSummaryDto, WebDavCapabilities,
    },
    filesystem::{
        atomic_replace, copy_to_trash, ensure_safe_parent, hash_file, move_to_trash, scan_local,
        scan_local_cached_excluding, is_generated_conflict_copy,
        move_generated_conflict_copies_to_trash, RuleEngine,
    },
    security::{normalize_remote_path, path_key, unix_ms, validate_relative_path},
    storage::Database,
    webdav::{href_to_dav_path, PutCondition, WebDavClient},
};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeSet, HashMap, HashSet},
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::Instant,
};
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex as AsyncMutex;
use tokio_util::sync::CancellationToken;

struct ActiveTaskCancellation {
    token: CancellationToken,
    finished: Arc<tokio::sync::Notify>,
}

struct TaskCompletionGuard(Arc<tokio::sync::Notify>);

impl Drop for TaskCompletionGuard {
    fn drop(&mut self) {
        self.0.notify_one();
    }
}

#[derive(Clone)]
pub struct SyncCoordinator {
    db: Database,
    data_dir: PathBuf,
    app: AppHandle,
    root_locks: Arc<Mutex<HashMap<String, Arc<AsyncMutex<()>>>>>,
    root_cancellations: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
    task_cancellations: Arc<Mutex<HashMap<String, Arc<ActiveTaskCancellation>>>>,
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
            task_cancellations: Arc::new(Mutex::new(HashMap::new())),
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

    pub async fn cancel_task(&self, task_id: &str) -> AppResult<()> {
        let cancellation = self
            .task_cancellations
            .lock()
            .map_err(|_| AppError::new("ENGINE_LOCK_FAILED", "文件传输控制状态不可用"))?
            .get(task_id)
            .cloned()
            .ok_or_else(|| AppError::new("TASK_NOT_RUNNING", "该文件当前没有可取消的传输"))?;
        let completed = cancellation.finished.notified();
        cancellation.token.cancel();
        tokio::time::timeout(std::time::Duration::from_secs(10), completed)
            .await
            .map_err(|_| {
                AppError::retryable(
                    "TASK_CANCEL_TIMEOUT",
                    "已发送取消请求，但当前文件传输尚未停止",
                )
            })?;
        Ok(())
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
        let git_tracked_paths = if root.exclude_git_tracked {
            crate::git::tracked_paths(&root.local_path)?
        } else {
            HashSet::new()
        };
        if !git_tracked_paths.is_empty() {
            let cancelled_git_tasks = self
                .db
                .cancel_tasks_for_paths(
                    &root.id,
                    &git_tracked_paths,
                    "GIT_TRACKED_FILE_EXCLUDED",
                    "此文件已由 Git 跟踪，当前项目设置为跳过 Git 已跟踪文件。",
                )
                .await?;
            if cancelled_git_tasks > 0 {
                tracing::info!(
                    root_id = %root.id,
                    count = cancelled_git_tasks,
                    "cancelled tasks for Git-tracked files excluded from sync"
                );
            }
        }
        let cancelled_conflict_copy_tasks =
            self.db.cancel_generated_conflict_copy_tasks(&root.id).await?;
        if cancelled_conflict_copy_tasks > 0 {
            tracing::info!(
                root_id = %root.id,
                count = cancelled_conflict_copy_tasks,
                "cancelled stale tasks for generated conflict copies"
            );
        }
        let cleaned_conflict_copies =
            move_generated_conflict_copies_to_trash(&root.local_path, &self.data_dir, &root.id)?;
        if cleaned_conflict_copies > 0 {
            tracing::info!(
                root_id = %root.id,
                count = cleaned_conflict_copies,
                "moved generated conflict copies out of the synchronized folder"
            );
        }
        let (_, client) = self.client_for(&root.account_id).await?;
        let account = self.db.account(&root.account_id).await?;
        let capabilities = account.capabilities.unwrap_or_else(unsafe_capabilities);
        let rules = self.db.rules(&root.id).await?;
        let old_baseline = self.db.baselines(&root.id).await?;
        let rule_engine = RuleEngine::compile(&rules)?;
        let ignored = old_baseline
            .iter()
            .filter(|entry| {
                !rule_engine.includes(&entry.relative_path)
                    || git_tracked_paths.contains(&entry.path_key)
            })
            .map(|entry| entry.relative_path.clone())
            .collect::<Vec<_>>();
        let reenabled = old_baseline
            .iter()
            .filter(|entry| {
                entry.sync_state == "IGNORED"
                    && rule_engine.includes(&entry.relative_path)
                    && !git_tracked_paths.contains(&entry.path_key)
            })
            .map(|entry| entry.relative_path.clone())
            .collect::<Vec<_>>();
        self.db
            .apply_rule_state(&root.id, &ignored, &reenabled)
            .await?;
        self.db.set_root_status(&root.id, "SCANNING_LOCAL").await?;
        let local = scan_local_cached_excluding(
            &root.local_path,
            &rules,
            &old_baseline,
            &git_tracked_paths,
        )?;
        self.ensure_sync_active(&root.id).await?;
        self.db.set_root_status(&root.id, "SCANNING_REMOTE").await?;
        let remote = scan_remote(
            &client,
            &root.remote_path,
            &rules,
            &self.data_dir,
            &old_baseline,
            &git_tracked_paths,
        )
        .await?;
        let line_ending_equivalent = line_ending_equivalent_paths(
            &client,
            &root.remote_path,
            &local,
            &remote,
            &old_baseline,
            &self.data_dir,
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
            &line_ending_equivalent,
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
                        let previous_hash = baseline
                            .iter()
                            .find(|entry| entry.path_key == path_key(&item.path))
                            .and_then(|entry| entry.base_hash.as_deref());
                        self.db
                            .add_tombstone(
                                &root.id,
                                &item.path,
                                "LOCAL",
                                previous_hash,
                                None,
                                Some("CONFIRMED_DELETED"),
                            )
                            .await?;
                        self.db
                            .add_tombstone(
                                &root.id,
                                &item.path,
                                "REMOTE",
                                previous_hash,
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
                    if item.local.is_some()
                        && item.remote.is_some()
                        && line_ending_equivalent.contains(&path_key(&item.path))
                    {
                        self.db
                            .mark_line_endings_equivalent(&root.id, &item.path)
                            .await?;
                    }
                    if item.local.is_some() && item.remote.is_some() {
                        self.db
                            .resolve_conflicts_for_path(&root.id, &item.path)
                            .await?;
                    }
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

fn local_file_operation_error(context: &str, path: &Path, error: std::io::Error) -> AppError {
    let code = match error.kind() {
        std::io::ErrorKind::PermissionDenied => "LOCAL_PERMISSION_DENIED",
        std::io::ErrorKind::NotFound => "LOCAL_NOT_FOUND",
        _ => "LOCAL_IO_ERROR",
    };
    AppError::new(
        code,
        format!("{context}：{}（路径：{}）", error, path.display()),
    )
    .with_details(serde_json::json!({
        "path": path.to_string_lossy(),
        "kind": format!("{:?}", error.kind()),
        "osCode": error.raw_os_error(),
    }))
}

fn remote_file_path(root_path: &str, relative: &str) -> AppResult<String> {
    let root = normalize_remote_path(root_path)?;
    let relative = validate_relative_path(relative)?;
    Ok(format!("{}/{}", root.trim_end_matches('/'), relative))
}
