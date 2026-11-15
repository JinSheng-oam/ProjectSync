use super::*;
use sha2::{Digest, Sha256};

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
            None,
            false,
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
            expected_etag,
            capabilities.strong_etag_verified,
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
    expected_etag: Option<&str>,
    strong_etag_verified: bool,
    progress: Option<TransferProgress>,
) -> AppResult<()> {
    let token = client.lock_exclusive(lock_parent, "infinity").await?;
    let result = async {
        let current_hash = remote_file_hash(client, destination, expected_hash, expected_etag, strong_etag_verified).await?;
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
    expected_hash: Option<&str>,
    expected_etag: Option<&str>,
    strong_etag_verified: bool,
) -> AppResult<Option<String>> {
    let entries = match client.propfind(path, 0).await {
        Ok(entries) => entries,
        Err(error) if error.code == "DAV_NOT_FOUND" => return Ok(None),
        Err(error) => return Err(error),
    };
    let normalized = normalize_remote_path(path)?;
    let entry = entries.into_iter().find(|entry|
        href_to_dav_path(client, &entry.path, path).ok().as_deref() == Some(normalized.as_str()))
        .ok_or_else(|| AppError::new("DAV_INVALID_RESPONSE", "无法确认远端目标路径状态"))?;
    if entry.is_collection {
        return Err(AppError::new("DAV_CONFLICT", "远端目标路径已被目录占用"));
    }
    let Some(expected_hash) = expected_hash else {
        // Create-only needs existence, not the contents of an occupied file.
        return Ok(Some(String::new()));
    };
    if can_reuse_locked_hash(strong_etag_verified, expected_etag, entry.etag.as_deref()) {
        return Ok(Some(expected_hash.to_owned()));
    }
    let (size, hash, received_etag) = client.hash_resource(path).await?;
    if size != entry.size || entry.etag.as_deref().zip(received_etag.as_deref()).is_some_and(|(listed, received)| listed != received) {
        return Err(AppError::retryable("DAV_PRECONDITION_FAILED", "读取远端文件期间版本发生变化，请重新同步"));
    }
    Ok(Some(hash))
}

fn can_reuse_locked_hash(verified: bool, expected: Option<&str>, actual: Option<&str>) -> bool {
    verified && expected == actual && expected.is_some_and(crate::webdav::is_strong_etag)
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
    assert!(can_reuse_locked_hash(true, Some("\"v1\""), Some("\"v1\"")));
    assert!(!can_reuse_locked_hash(false, Some("\"v1\""), Some("\"v1\"")));
    assert!(!can_reuse_locked_hash(true, Some("W/\"v1\""), Some("W/\"v1\"")));
    assert!(!can_reuse_locked_hash(true, Some("\"v1\""), Some("\"v2\"")));
    assert!(!can_reuse_locked_hash(true, None, None));
    assert!(!can_reuse_locked_hash(true, Some("unquoted"), Some("unquoted")));
    assert!(!can_reuse_locked_hash(true, Some("\"bad tag\""), Some("\"bad tag\"")));
}

pub(super) async fn verify_remote_hash(
    client: &WebDavClient,
    path: &str,
    expected: &str,
    source: &Path,
    capabilities: &WebDavCapabilities,
) -> AppResult<RemoteEntry> {
    const DIGEST_FAST_PATH_MIN_BYTES: u64 = 1024 * 1024;
    if capabilities.strong_etag_verified && capabilities.repr_digest_sha256_verified
        && tokio::fs::metadata(source).await.is_ok_and(|metadata| metadata.len() >= DIGEST_FAST_PATH_MIN_BYTES)
    {
        if let Some(entry) = verify_remote_digest(client, path, expected, source).await? {
            return Ok(entry);
        }
    }
    let observed = read_remote_entry(client, path).await?;
    if observed.hash != expected {
        return Err(AppError::retryable(
            "HASH_MISMATCH",
            "WebDAV 写入后的读取校验不一致",
        ));
    }
    Ok(observed)
}

async fn verify_remote_digest(
    client: &WebDavClient,
    path: &str,
    expected: &str,
    source: &Path,
) -> AppResult<Option<RemoteEntry>> {
    let Some(head) = client.head_repr_digest(path).await.ok().flatten() else { return Ok(None); };
    let normalized = normalize_remote_path(path)?;
    let property = match client.propfind(path, 0).await {
        Ok(entries) => entries.into_iter().find(|entry| !entry.is_collection
            && href_to_dav_path(client, &entry.path, path).ok().as_deref() == Some(normalized.as_str())),
        Err(_) => None,
    };
    let Some(property) = property else { return Ok(None); };
    if !digest_matches_properties(&head, &property) {
        return Ok(None);
    }
    let source = source.to_owned();
    let (size, blake, sha) = tokio::task::spawn_blocking(move || -> AppResult<(u64, String, [u8; 32])> {
        let mut file = fs::File::open(source)?;
        let mut buffer = [0u8; 128 * 1024];
        let mut size = 0u64;
        let mut blake = blake3::Hasher::new();
        let mut sha = Sha256::new();
        loop {
            let count = file.read(&mut buffer)?;
            if count == 0 { break; }
            size = size.saturating_add(count as u64);
            blake.update(&buffer[..count]);
            sha.update(&buffer[..count]);
        }
        Ok((size, blake.finalize().to_hex().to_string(), sha.finalize().into()))
    }).await.map_err(|error| AppError::new("LOCAL_FILE_READ", format!("计算文件摘要失败：{error}")))??;
    if blake != expected {
        return Err(AppError::retryable("LOCAL_FILE_CHANGED", "上传校验期间本地文件发生变化"));
    }
    if !digest_matches_local(&head, property.size, size, &sha) {
        return Ok(None);
    }
    let confirmed = client.head_repr_digest(path).await.ok().flatten();
    if !confirmed.is_some_and(|value| value.etag == head.etag
        && digest_matches_local(&value, property.size, size, &sha))
    {
        return Ok(None);
    }
    Ok(Some(RemoteEntry {
        relative_path: String::new(), path_key: String::new(), hash: blake, size,
        modified_at: property.modified_at, etag: property.etag, is_collection: false,
    }))
}

fn digest_matches_properties(head: &crate::webdav::ReprDigest, property: &crate::webdav::DavEntry) -> bool {
    property.etag.as_deref() == Some(head.etag.as_str())
        && head.size.is_none_or(|size| size == property.size)
}

fn digest_matches_local(head: &crate::webdav::ReprDigest, remote_size: u64, local_size: u64, sha: &[u8; 32]) -> bool {
    remote_size == local_size && head.sha256 == *sha
        && head.size.is_none_or(|size| size == local_size)
}

#[test]
fn digest_fast_path_requires_matching_versions_sizes_and_content() {
    use crate::webdav::{DavEntry, ReprDigest};
    let head = ReprDigest { etag: "\"v1\"".into(), sha256: [1; 32], size: Some(10) };
    let mut property = DavEntry { path: String::new(), size: 10, modified_at: 0,
        etag: Some("\"v1\"".into()), is_collection: false };
    assert!(digest_matches_properties(&head, &property));
    assert!(digest_matches_local(&head, property.size, 10, &[1; 32]));
    assert!(!digest_matches_local(&head, property.size, 10, &[2; 32]));
    assert!(!digest_matches_local(&head, property.size, 11, &[1; 32]));
    property.etag = Some("\"v2\"".into());
    assert!(!digest_matches_properties(&head, &property));
    property.etag = Some("\"v1\"".into());
    property.size = 11;
    assert!(!digest_matches_properties(&head, &property));
}

#[cfg(test)]
#[tokio::test]
#[ignore = "uses a local Node.js WebDAV fixture"]
async fn digest_verification_avoids_get_only_for_a_matching_server_digest() {
    use std::io::{BufRead, BufReader};
    use std::process::{Child, Command, Stdio};

    struct Server(Child);
    impl Drop for Server {
        fn drop(&mut self) {
            let _ = self.0.kill();
            let _ = self.0.wait();
        }
    }
    struct TempFile(PathBuf);
    impl Drop for TempFile {
        fn drop(&mut self) { let _ = std::fs::remove_file(&self.0); }
    }

    let fixture = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/digest-dav.cjs");
    let mut command = Command::new("node");
    command.arg(fixture).stdout(Stdio::piped()).stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    let mut server = Server(command.spawn().expect("start local WebDAV fixture"));
    let stdout = server.0.stdout.take().unwrap();
    let port = tokio::time::timeout(std::time::Duration::from_secs(10), tokio::task::spawn_blocking(move || {
        let mut line = String::new();
        BufReader::new(stdout).read_line(&mut line).unwrap();
        line.trim().parse::<u16>().unwrap()
    })).await.unwrap().unwrap();
    let mut client = WebDavClient::new(&format!("http://127.0.0.1:{port}/"), "test", String::new(), true).unwrap();
    client.disable_proxy_for_test();
    let source = TempFile(std::env::temp_dir().join(format!("projectsync-digest-test-{}", uuid::Uuid::new_v4())));
    let contents = vec![b'a'; 1024 * 1024 + 7];
    tokio::fs::write(&source.0, &contents).await.unwrap();
    let expected = blake3::hash(&contents).to_hex().to_string();
    let mut capabilities = unsafe_capabilities();
    capabilities.strong_etag_verified = true;
    capabilities.repr_digest_sha256_verified = true;
    assert_eq!(verify_remote_hash(&client, "/good", &expected, &source.0, &capabilities).await.unwrap().hash, expected);
    assert_eq!(verify_remote_hash(&client, "/bad", &expected, &source.0, &capabilities).await.unwrap().hash, expected);
    assert_eq!(verify_remote_hash(&client, "/corrupt", &expected, &source.0, &capabilities).await.unwrap_err().code, "HASH_MISMATCH");
    assert_eq!(verify_remote_hash(&client, "/mismatch", &expected, &source.0, &capabilities).await.unwrap_err().code, "DAV_PRECONDITION_FAILED");
    let counts: serde_json::Value = serde_json::from_slice(&client.get_bytes("/_counts").await.unwrap()).unwrap();
    assert_eq!(counts["good"], 0);
    assert_eq!(counts["bad"], 1);
    assert_eq!(counts["corrupt"], 1);
    assert_eq!(counts["mismatch"], 1);
    assert_eq!(verify_remote_hash(&client, "/good", "different", &source.0, &capabilities).await.unwrap_err().code, "LOCAL_FILE_CHANGED");
    assert_eq!(client.get_bytes_limited("/good", 1024).await.unwrap_err().code, "DAV_FILE_TOO_LARGE");
    assert_eq!(client.get_bytes_limited("/chunked", 1024).await.unwrap_err().code, "DAV_FILE_TOO_LARGE");
    capabilities.repr_digest_sha256_verified = false;
    assert_eq!(verify_remote_hash(&client, "/good", &expected, &source.0, &capabilities).await.unwrap().hash, expected);
    let counts: serde_json::Value = serde_json::from_slice(&client.get_bytes("/_counts").await.unwrap()).unwrap();
    // One attempted limited GET and one fallback full GET; the fast path above used none.
    assert_eq!(counts["good"], 2);
    let probed = client.test_connection().await.unwrap();
    assert!(probed.strong_etag_verified);
    assert!(probed.repr_digest_sha256_verified);
    assert!(probed.supports_if_match);
    assert!(probed.supports_if_none_match);
    assert!(!probed.supports_lock);
    assert!(probed.probe_cleanup_warning.is_none());
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
