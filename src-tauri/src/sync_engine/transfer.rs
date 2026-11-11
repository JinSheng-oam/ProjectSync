use super::*;

impl SyncCoordinator {
    pub async fn handle_retained_remote_file(&self, task_id: &str, restore: bool) -> AppResult<()> {
        let (root_id, _) = self.db.remote_trash_task(task_id).await?;
        let lock = self.lock_for(&root_id)?;
        let _guard = lock.lock().await;
        let (_, path) = self.db.remote_trash_task(task_id).await?;
        if !restore {
            return self.db.acknowledge_remote_trash(&root_id, &path).await;
        }

        let root = self.db.root(&root_id).await?;
        let target = ensure_safe_parent(&root.local_path, &path)?;
        if target.symlink_metadata().is_ok() {
            return Err(AppError::new("LOCAL_FILE_CHANGED", "本地原位置已有文件，未覆盖"));
        }
        let (account, client) = self.client_for(&root.account_id).await?;
        let remote = read_remote_snapshot(&client, &root.remote_path, &path, &self.data_dir).await?;
        let item = PlannedAction {
            path,
            action: SyncAction::DownloadNew,
            conflict: None,
            local: None,
            remote: Some(remote),
            expected_remote_etag: None,
            reason: "撤销本地删除".into(),
        };
        let id = uuid::Uuid::new_v4().to_string();
        let caps = account.capabilities.unwrap_or_else(unsafe_capabilities);
        let bytes = match self.execute_item(&root, &client, &caps, &item, &id).await {
            Ok(bytes) => bytes,
            Err(error) => {
                let _ = tokio::fs::remove_file(target.with_file_name(format!(".projectsync-{id}.stage"))).await;
                return Err(error);
            }
        };
        self.db.reconcile_tasks_for_path(&root.id, &item.path, true).await?;
        let history_id = self.db.add_history(HistoryEntry {
            root_id: &root.id, task_id: None, path: &item.path, action: &item.action,
            status: "SUCCESS", bytes, duration_ms: 0, error: None,
        }).await?;
        self.emit("sync://history-updated", serde_json::json!({"rootId":root.id,"historyId":history_id}));
        Ok(())
    }

    pub(super) async fn execute_planned_task(
        &self,
        root: &RootRecord,
        client: &WebDavClient,
        capabilities: &WebDavCapabilities,
        item: &PlannedAction,
        task_id: &str,
        total: u64,
    ) -> AppResult<(u64, u64, u64, u64)> {
        self.ensure_sync_active(&root.id).await?;
        let cancellation = Arc::new(ActiveTaskCancellation {
            token: CancellationToken::new(),
            finished: Arc::new(tokio::sync::Notify::new()),
        });
        let _completion = TaskCompletionGuard(cancellation.finished.clone());
        self.task_cancellations
            .lock()
            .map_err(|_| AppError::new("ENGINE_LOCK_FAILED", "文件传输控制状态不可用"))?
            .insert(task_id.to_owned(), cancellation.clone());
        if let Err(error) = self
            .db
            .set_task(task_id, crate::domain::TaskStatus::Running, 0, None)
            .await
        {
            if let Ok(mut tasks) = self.task_cancellations.lock() {
                tasks.remove(task_id);
            }
            return Err(error);
        }
        self.emit(
            "sync://progress",
            serde_json::json!({"rootId":root.id,"taskId":task_id,"path":item.path,"operation":item.action,"bytesTransferred":0,"totalBytes":total}),
        );
        let started = Instant::now();
        let result = tokio::select! {
            result = self.execute_item(root, client, capabilities, item, task_id) => result,
            _ = cancellation.token.cancelled() => Err(AppError::new("TASK_CANCELLED", "用户已取消当前文件传输")),
        };
        if let Ok(mut tasks) = self.task_cancellations.lock() {
            tasks.remove(task_id);
        }
        if result.as_ref().is_err_and(|error| error.code == "TASK_CANCELLED")
            && matches!(item.action, SyncAction::DownloadNew | SyncAction::DownloadUpdate)
        {
            if let Ok(target) = crate::security::resolve_local_path(&root.local_path, &item.path) {
                let staging = target.with_file_name(format!(".projectsync-{}.stage", task_id));
                let _ = tokio::fs::remove_file(staging).await;
            }
        }
        match result {
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
            Err(error) if error.code == "TASK_CANCELLED" => {
                self.db
                    .set_task(task_id, crate::domain::TaskStatus::Cancelled, 0, None)
                    .await?;
                self.emit(
                    "sync://task-cancelled",
                    serde_json::json!({"taskId":task_id,"rootId":root.id,"path":item.path}),
                );
                Ok((0, 0, 0, 0))
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
                if item.action == SyncAction::DownloadNew {
                    crate::filesystem::atomic_install_new(&staging, &target)?;
                } else {
                    atomic_replace(&staging, &target)?;
                }
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
                match client.propfind(&destination, 0).await {
                    Err(error) if error.code == "DAV_NOT_FOUND" => {}
                    Err(error) => return Err(error),
                    Ok(_) => {
                        return Err(AppError::retryable(
                            "DAV_PRECONDITION_FAILED",
                            "远端旧路径已恢复；本地文件已保留",
                        ));
                    }
                }
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
                self.db
                    .resolve_conflicts_for_path(&root.id, &item.path)
                    .await?;
                Ok(local.size)
            }
            SyncAction::MoveRemoteToTrash => {
                let remote = item
                    .remote
                    .as_ref()
                    .ok_or_else(|| AppError::new("DAV_NOT_FOUND", "待回收远端文件不存在"))?;
                let etag = plan::remote_trash_etag(capabilities, remote).ok_or_else(|| {
                    AppError::new("BLOCKED_SERVER_CAPABILITY", if capabilities.supports_remote_trash() {
                        "远端文件没有可用的强 ETag；远端文件已保留。"
                    } else {
                        plan::REMOTE_TRASH_CAPABILITY_MESSAGE
                    })
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
                self.db
                    .reconcile_tasks_for_path(&root.id, &item.path, true)
                    .await?;
                Ok(remote.size)
            }
            _ => Ok(0),
        }
    }
}
