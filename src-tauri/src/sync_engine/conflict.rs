use super::*;

impl SyncCoordinator {
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
                    if capabilities.safe_create_only {
                        let conflict_remote = remote_file_path(&root.remote_path, &conflict_path)?;
                        ensure_remote_parent(&client, &conflict_remote).await?;
                        put_remote_create_only(
                            &client,
                            &target,
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
                    } else {
                        copy_to_trash(&self.data_dir, &root.id, &path, "keep-both", &target)?;
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
                                "保存本地冲突版本后原文件发生变化",
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
                    if capabilities.safe_create_only {
                        format!("本地版本已保存在远端冲突副本 {conflict_path}；同步目录不会保留该副本。")
                    } else {
                        "远端不支持安全创建冲突副本；本地版本已保存在 ProjectSync 回收站，同步目录不会保留副本。".to_owned()
                    }
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
}
