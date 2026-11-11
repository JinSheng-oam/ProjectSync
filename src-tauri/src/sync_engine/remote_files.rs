use super::*;

pub(super) async fn ensure_remote_parent(client: &WebDavClient, path: &str) -> AppResult<()> {
    let parent = path
        .rsplit_once('/')
        .map(|(p, _)| if p.is_empty() { "/" } else { p })
        .unwrap_or("/");
    client.ensure_collection(parent).await
}

pub(super) async fn put_remote_create_only(
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

pub(super) async fn put_remote_update(
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

pub(super) fn verify_snapshot_etag(listed: Option<&str>, received: Option<&str>) -> AppResult<()> {
    if listed.is_some_and(|tag| Some(tag) != received) {
        return Err(AppError::retryable(
            "DAV_PRECONDITION_FAILED",
            "读取内容时 WebDAV 文件版本与属性不一致，请重新扫描。",
        ));
    }
    Ok(())
}

#[test]
fn snapshot_rejects_content_from_a_different_version() {
    assert!(verify_snapshot_etag(Some("\"v1\""), Some("\"v2\"")).is_err());
    assert!(verify_snapshot_etag(Some("\"v1\""), None).is_err());
    assert!(verify_snapshot_etag(Some("\"v1\""), Some("\"v1\"")).is_ok());
    assert!(verify_snapshot_etag(None, None).is_ok());
}

pub(super) async fn verify_remote_hash(
    client: &WebDavClient,
    path: &str,
    expected: &str,
) -> AppResult<RemoteEntry> {
    let observed = read_remote_entry(client, path).await?;
    if observed.hash != expected {
        return Err(AppError::retryable(
            "HASH_MISMATCH",
            "WebDAV 写入后的读取校验不一致",
        ));
    }
    Ok(observed)
}

pub(super) async fn read_remote_snapshot(
    client: &WebDavClient,
    root_path: &str,
    relative: &str,
) -> AppResult<RemoteEntry> {
    let remote_path = remote_file_path(root_path, relative)?;
    let mut entry = read_remote_entry(client, &remote_path).await?;
    entry.relative_path = relative.to_owned();
    entry.path_key = path_key(relative);
    Ok(entry)
}

async fn read_remote_entry(client: &WebDavClient, path: &str) -> AppResult<RemoteEntry> {
    let (size, hash, etag) = client.hash_resource(path).await?;
    let property = client.propfind(path, 0).await?.into_iter()
        .find(|entry| !entry.is_collection)
        .ok_or_else(|| AppError::retryable("DAV_NOT_FOUND", "无法读取远端文件属性"))?;
    verify_snapshot_etag(property.etag.as_deref(), etag.as_deref())?;
    Ok(RemoteEntry {
        relative_path: String::new(),
        path_key: String::new(),
        hash,
        size,
        modified_at: property.modified_at,
        etag: property.etag,
        is_collection: false,
    })
}
