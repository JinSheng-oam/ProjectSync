use super::*;

impl WebDavClient {
    pub(crate) async fn probe_locked_delete(&self, project_root: &str) -> AppResult<bool> {
        let path = format!("{}/.projectsync/.projectsync-cleanup-probe-{}", project_root.trim_end_matches('/'), uuid::Uuid::new_v4().simple());
        let contents = b"ProjectSync isolated DELETE lock probe";
        let file = temp_file(contents)?;
        let created = self.put_file(&file, &path, PutCondition::CreateOnly).await;
        let _ = tokio::fs::remove_file(file).await;
        created?;
        let result = async {
            let token = self.lock_exclusive(&path, "0").await?;
            let rejected = self.delete(&path, None).await.is_err_and(|error| {
                matches!(error.code.as_str(), "DAV_LOCKED" | "DAV_PRECONDITION_FAILED")
            });
            let wrong_token = format!("opaquelocktoken:{}", uuid::Uuid::new_v4());
            let protected = rejected
                && self.delete_with_lock_token(&path, &wrong_token).await.is_err_and(|error| {
                    matches!(error.code.as_str(), "DAV_LOCKED" | "DAV_PRECONDITION_FAILED")
                })
                && self.get_bytes(&path).await.as_deref().ok() == Some(contents.as_slice())
                && self.delete_with_lock_token(&path, &token).await.is_ok()
                && self.get_bytes(&path).await.is_err_and(|error| error.code == "DAV_NOT_FOUND");
            let _ = self.unlock(&path, &token).await;
            Ok(protected)
        }.await;
        if self.get_bytes(&path).await.as_deref().ok() == Some(contents.as_slice()) {
            let _ = self.delete(&path, None).await;
        }
        result
    }

    pub async fn probe_lock_exclusion_in(&self, parent: &str) -> AppResult<bool> {
        let parent = normalize_remote_path(parent)?;
        let token = match self.lock_exclusive(&parent, "infinity").await {
            Ok(token) => token,
            Err(error)
                if matches!(
                    error.code.as_str(),
                    "DAV_UNSUPPORTED" | "DAV_PERMISSION_DENIED" | "DAV_LOCKED"
                ) =>
            {
                return Ok(false)
            }
            Err(error) => return Err(error),
        };

        let suffix = uuid::Uuid::new_v4().simple().to_string();
        let probe_path = format!(
            "{}/.projectsync-lock-probe-{suffix}",
            parent.trim_end_matches('/')
        );
        let probe_file = temp_file(b"projectsync exclusive lock probe")?;

        let unprotected_error = self
            .put_file(&probe_file, &probe_path, PutCondition::Unconditional)
            .await
            .err();
        let unprotected_rejected = unprotected_error.as_ref().is_some_and(|error| {
            matches!(
                error.code.as_str(),
                "DAV_LOCKED" | "DAV_PRECONDITION_FAILED"
            )
        });
        let protected_write = self
            .put_file_with_lock_token(
                &probe_file,
                &probe_path,
                PutCondition::Unconditional,
                &token,
            )
            .await
            .is_ok();
        let protected_contents = if protected_write {
            self.get_bytes(&probe_path).await.ok()
        } else {
            None
        };
        let protection_verified = unprotected_rejected
            && protected_contents.as_deref() == Some(b"projectsync exclusive lock probe");

        let _ = self.delete_with_lock_token(&probe_path, &token).await;
        let unlock_result = self.unlock(&parent, &token).await;
        let _ = self.delete(&probe_path, None).await;
        let _ = tokio::fs::remove_file(probe_file).await;
        unlock_result?;

        Ok(protection_verified)
    }

    pub async fn probe_create_only_in(&self, parent: &str) -> AppResult<bool> {
        let parent = normalize_remote_path(parent)?;
        let probe_path = format!(
            "{}/.projectsync-probe-{}",
            parent.trim_end_matches('/'),
            uuid::Uuid::new_v4().simple()
        );
        let probe_file = format!("{probe_path}/a.bin");
        let new_probe_file = format!("{probe_path}/new.bin");
        let a = temp_file(b"projectsync target create-only probe A")?;
        let b = temp_file(b"projectsync target create-only probe B")?;
        let mut created_directory = false;

        let result = async {
            let response = self
                .send(
                    Method::from_bytes(b"MKCOL")
                        .map_err(|e| AppError::new("DAV_CLIENT_INIT_FAILED", e.to_string()))?,
                    self.url_for(&probe_path)?,
                    HeaderMap::new(),
                    None,
                )
                .await?;
            let status = response.status();
            if status == StatusCode::METHOD_NOT_ALLOWED || status == StatusCode::CONFLICT {
                return Ok(false);
            }
            Self::check_status(status, "MKCOL")?;
            created_directory = true;

            self.put_file(&a, &probe_file, PutCondition::Unconditional)
                .await?;
            let before = self.get_bytes(&probe_file).await?;
            if before.as_slice() != b"projectsync target create-only probe A" {
                return Ok(false);
            }

            let rejected = self
                .put_file(&b, &probe_file, PutCondition::CreateOnly)
                .await
                .err()
                .is_some_and(|error| error.code == "DAV_PRECONDITION_FAILED");
            let after = self.get_bytes(&probe_file).await?;
            if !rejected || after.as_slice() != b"projectsync target create-only probe A" {
                return Ok(false);
            }

            if self
                .put_file(&b, &new_probe_file, PutCondition::CreateOnly)
                .await
                .is_err()
            {
                return Ok(false);
            }
            let new_contents = self.get_bytes(&new_probe_file).await?;
            Ok(new_contents.as_slice() == b"projectsync target create-only probe B")
        }
        .await;

        let cleanup = if created_directory {
            self.delete(&probe_path, None).await
        } else {
            Ok(())
        };
        let _ = tokio::fs::remove_file(a).await;
        let _ = tokio::fs::remove_file(b).await;
        if let Err(error) = cleanup {
            if error.code != "DAV_NOT_FOUND" {
                tracing::warn!(path=%probe_path,error=%error,"unable to clean target create-only probe");
                return Err(AppError::new(
                    "DAV_PROBE_CLEANUP_FAILED",
                    format!("无法清理远端安全能力探测目录：{}", error.message),
                ));
            }
        }

        result
    }

    pub async fn test_connection(&self) -> AppResult<WebDavCapabilities> {
        let (server_header, _allow_propfind) = self.options_header().await?;
        let _ = self.propfind("/", 0).await?;
        let propfind_depth1_supported = self.propfind("/", 1).await.is_ok();
        let probe_path = format!("/.projectsync-probe-{}", uuid::Uuid::new_v4().simple());
        let mut safe_create_only = false;
        let mut safe_update_existing = false;
        let mut safe_delete = false;
        let mut safe_move_no_overwrite = false;
        let mut safe_move_if_match = false;
        let mut etag_type = "None".to_owned();
        let mut created = false;

        if self.mkcol(&probe_path).await.is_ok() {
            created = true;
            let first = format!("{probe_path}/a.bin");
            let a = temp_file(b"projectsync capability probe A")?;
            let b = temp_file(b"projectsync capability probe B")?;
            if self
                .put_file(&a, &first, PutCondition::Unconditional)
                .await
                .is_ok()
            {
                let props = self.propfind(&probe_path, 1).await.unwrap_or_default();
                let etag = props
                    .iter()
                    .find(|entry| entry.path.ends_with("/a.bin"))
                    .and_then(|entry| entry.etag.clone());
                if let Some(value) = etag.as_deref() {
                    etag_type = if value.trim_start().starts_with("W/") {
                        "Weak"
                    } else {
                        "Strong"
                    }
                    .to_owned();
                }

                // Validate create-only against an existing resource; only the isolated probe file can be affected.
                let before = self.get_bytes(&first).await.ok();
                safe_create_only = self
                    .put_file(&b, &first, PutCondition::CreateOnly)
                    .await
                    .err()
                    .is_some_and(|e| e.code == "DAV_PRECONDITION_FAILED")
                    && before.as_deref() == Some(b"projectsync capability probe A")
                    && self.get_bytes(&first).await.as_deref().ok()
                        == Some(b"projectsync capability probe A".as_slice());
                let _ = self.put_file(&a, &first, PutCondition::Unconditional).await;

                // A stale If-Match must be rejected without changing the isolated file.
                let stale_if_match = self
                    .put_file(
                        &b,
                        &first,
                        PutCondition::IfMatch("\"projectsync-invalid-etag\"".to_owned()),
                    )
                    .await
                    .err()
                    .is_some_and(|e| e.code == "DAV_PRECONDITION_FAILED")
                    && self.get_bytes(&first).await.as_deref().ok()
                        == Some(b"projectsync capability probe A".as_slice());

                // A stale If-Match on DELETE must leave the test resource intact.
                safe_delete = self
                    .delete(&first, Some("\"projectsync-invalid-etag\""))
                    .await
                    .err()
                    .is_some_and(|e| e.code == "DAV_PRECONDITION_FAILED")
                    && self.get_bytes(&first).await.as_deref().ok()
                        == Some(b"projectsync capability probe A".as_slice());

                if stale_if_match
                    && etag
                        .as_deref()
                        .is_some_and(|v| !v.trim_start().starts_with("W/"))
                {
                    safe_update_existing = self
                        .put_file(
                            &b,
                            &first,
                            PutCondition::IfMatch(etag.clone().unwrap_or_default()),
                        )
                        .await
                        .is_ok()
                        && self.get_bytes(&first).await.as_deref().ok()
                            == Some(b"projectsync capability probe B".as_slice());
                    if safe_update_existing {
                        let after = self.propfind(&probe_path, 1).await.ok().and_then(|rows| {
                            rows.into_iter()
                                .find(|entry| entry.path.ends_with("/a.bin"))
                                .and_then(|entry| entry.etag)
                        });
                        if after.as_deref() == etag.as_deref() || after.is_none() {
                            safe_update_existing = false;
                            etag_type = "Weak".to_owned();
                        }
                    }
                }

                let move_source = format!("{probe_path}/move-source.bin");
                let move_dest = format!("{probe_path}/move-dest.bin");
                if self
                    .put_file(&a, &move_source, PutCondition::Unconditional)
                    .await
                    .is_ok()
                    && self
                        .put_file(&b, &move_dest, PutCondition::Unconditional)
                        .await
                        .is_ok()
                {
                    // MOVE with Overwrite:F must reject an occupied destination and preserve both files.
                    safe_move_no_overwrite = self
                        .move_resource(&move_source, &move_dest, false, None)
                        .await
                        .err()
                        .is_some_and(|e| e.code == "DAV_PRECONDITION_FAILED")
                        && self.get_bytes(&move_dest).await.as_deref().ok()
                            == Some(b"projectsync capability probe B".as_slice())
                        && self.get_bytes(&move_source).await.as_deref().ok()
                            == Some(b"projectsync capability probe A".as_slice());
                    if safe_move_no_overwrite {
                        safe_move_if_match = self
                            .probe_move_if_match(&move_source, &format!("{probe_path}/move-new.bin"))
                            .await;
                    }
                }
            }
            let _ = tokio::fs::remove_file(a).await;
            let _ = tokio::fs::remove_file(b).await;
        }
        let lock_exclusion_safe = self
            .probe_lock_exclusion_in(&probe_path)
            .await
            .unwrap_or(false);
        let native_if_none_match = safe_create_only;
        let native_if_match = safe_update_existing || safe_delete;
        if lock_exclusion_safe {
            safe_create_only = true;
            safe_update_existing = true;
        }
        safe_move_no_overwrite &= native_if_match;
        let probe_cleanup_warning = if created {
            self.delete(&probe_path, None)
                .await
                .err()
                .map(|error| format!("能力探测目录 {probe_path} 未能自动清理：{}", error.message))
        } else {
            None
        };
        let supports_if_match = native_if_match;
        let supports_if_none_match = native_if_none_match;
        Ok(WebDavCapabilities {
            server_header,
            etag_type,
            supports_if_match,
            supports_if_none_match,
            supports_lock: lock_exclusion_safe,
            propfind_depth1_supported,
            safe_create_only,
            safe_update_existing,
            safe_delete,
            safe_move_no_overwrite,
            safe_move_if_match,
            probe_cleanup_warning,
            tested_at: unix_ms(),
        })
    }

    async fn probe_move_if_match(&self, source: &str, destination: &str) -> bool {
        let Ok(entries) = self.propfind(source, 0).await else {
            return false;
        };
        let Some(etag) = entries
            .iter()
            .find(|entry| !entry.is_collection)
            .and_then(|entry| entry.etag.as_deref())
            .map(str::trim)
            .filter(|etag| etag.len() >= 2 && etag.starts_with('"') && etag.ends_with('"'))
        else {
            return false;
        };
        let stale = if etag == "\"projectsync-invalid-etag\"" {
            "\"projectsync-other-invalid-etag\""
        } else {
            "\"projectsync-invalid-etag\""
        };
        let expected = b"projectsync capability probe A".as_slice();
        self.move_resource(source, destination, false, Some(stale))
            .await
            .is_err_and(|error| error.code == "DAV_PRECONDITION_FAILED")
            && self.get_bytes(source).await.as_deref().ok() == Some(expected)
            && self.get_bytes(destination).await.is_err_and(|error| error.code == "DAV_NOT_FOUND")
            && self.move_resource(source, destination, false, Some(etag)).await.is_ok()
            && self.get_bytes(destination).await.as_deref().ok() == Some(expected)
            && self.get_bytes(source).await.is_err_and(|error| error.code == "DAV_NOT_FOUND")
    }
}

fn temp_file(content: &[u8]) -> AppResult<std::path::PathBuf> {
    let path = std::env::temp_dir().join(format!(
        "projectsync-probe-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::write(&path, content)
        .map_err(|e| AppError::new("LOCAL_STAGING_FAILED", e.to_string()))?;
    Ok(path)
}
