use super::*;

impl SyncCoordinator {
    pub async fn create_root(
        &self,
        name: String,
        account_id: String,
        local_path: String,
        remote_path: String,
        rules: Vec<SyncRuleDto>,
        exclude_git_tracked: bool,
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
            exclude_git_tracked,
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
        exclude_git_tracked: bool,
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
        let git_tracked_paths = if exclude_git_tracked {
            crate::git::tracked_paths(&local_root)?
        } else {
            HashSet::new()
        };
        let local = scan_local_cached_excluding(&local_root, rules, &[], &git_tracked_paths)?;
        let remote =
            match scan_remote(
                &client,
                &normalized_remote,
                rules,
                &[],
                &git_tracked_paths,
            )
            .await
            {
                Ok(entries) => entries,
                Err(error) if error.code == "DAV_NOT_FOUND" => Vec::new(),
                Err(error) => return Err(error),
            };
        let line_ending_equivalent = line_ending_equivalent_paths(
            &client,
            &normalized_remote,
            &local,
            &remote,
            &[],
            &self.data_dir,
        )
        .await?;
        let root_id = format!("preview-{}", uuid::Uuid::new_v4().simple());
        let plan = build_plan(
            &local,
            &remote,
            &[],
            &line_ending_equivalent,
            rules,
            true,
            true,
            &capabilities,
        );
        Ok(preview_from_plan(&root_id, plan))
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
