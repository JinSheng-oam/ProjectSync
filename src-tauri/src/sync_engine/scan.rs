use super::*;

const LINE_ENDING_COMPARE_LIMIT: u64 = 8 * 1024 * 1024;
const LINE_ENDING_COMPARE_CONCURRENCY: usize = 4;

fn line_ending_hashes(mut file: impl Read) -> AppResult<Option<(String, String)>> {
    let mut buffer = [0_u8; 128 * 1024];
    let mut utf8_tail = Vec::with_capacity(4);
    let mut normalized = Vec::with_capacity(buffer.len() + 1);
    let mut pending_cr = false;
    let mut hasher = blake3::Hasher::new();
    let mut original = blake3::Hasher::new();

    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        let bytes = &buffer[..read];
        original.update(bytes);
        if bytes.contains(&0) {
            return Ok(None);
        }

        let mut validation = Vec::with_capacity(utf8_tail.len() + read);
        validation.extend_from_slice(&utf8_tail);
        validation.extend_from_slice(bytes);
        match std::str::from_utf8(&validation) {
            Ok(_) => utf8_tail.clear(),
            Err(error) if error.error_len().is_some() => return Ok(None),
            Err(error) => {
                utf8_tail.clear();
                utf8_tail.extend_from_slice(&validation[error.valid_up_to()..]);
            }
        }

        normalized.clear();
        for byte in bytes {
            if pending_cr {
                normalized.push(b'\n');
                pending_cr = false;
                if *byte == b'\n' {
                    continue;
                }
            }
            if *byte == b'\r' {
                pending_cr = true;
            } else {
                normalized.push(*byte);
            }
        }
        hasher.update(&normalized);
    }

    if !utf8_tail.is_empty() {
        return Ok(None);
    }
    if pending_cr {
        hasher.update(b"\n");
    }
    Ok(Some((original.finalize().to_hex().to_string(), hasher.finalize().to_hex().to_string())))
}

fn bounded_line_ending_file(path: &Path) -> AppResult<Option<(String, String)>> {
    let mut reader = fs::File::open(path)?.take(LINE_ENDING_COMPARE_LIMIT + 1);
    let hashes = line_ending_hashes(&mut reader)?;
    if reader.limit() == 0 { return Ok(None); }
    Ok(hashes)
}

pub(super) async fn line_ending_equivalent_paths(
    client: &WebDavClient,
    root_path: &str,
    local: &[LocalEntry],
    remote: &[RemoteEntry],
    baseline: &[crate::domain::BaselineEntry],
    cancellation: Option<Arc<AtomicBool>>,
) -> AppResult<HashSet<String>> {
    let remote_by_path = remote
        .iter()
        .map(|entry| (entry.path_key.as_str(), entry))
        .collect::<HashMap<_, _>>();
    let baseline_by_path = baseline
        .iter()
        .map(|entry| (entry.path_key.as_str(), entry))
        .collect::<HashMap<_, _>>();
    let mut equivalent = HashSet::new();
    let mut candidates = Vec::new();

    for local_entry in local {
        ensure_line_ending_scan_active(&cancellation)?;
        let Some(remote_entry) = remote_by_path.get(local_entry.path_key.as_str()) else {
            continue;
        };
        if local_entry.relative_path != remote_entry.relative_path
            || local_entry.hash == remote_entry.hash
        {
            continue;
        }
        if let Some(base) = baseline_by_path.get(local_entry.path_key.as_str()) {
            if base.baseline_state == "PRESENT" {
                let local_unchanged = Some(local_entry.hash.as_str()) == base.base_hash.as_deref();
                let remote_unchanged = Some(remote_entry.hash.as_str())
                    == base.base_remote_hash.as_deref().or(base.base_hash.as_deref());
                if local_unchanged && remote_unchanged {
                    equivalent.insert(local_entry.path_key.clone());
                    continue;
                }
                if local_unchanged || remote_unchanged {
                    continue;
                }
            }
        }
        if local_entry.size > LINE_ENDING_COMPARE_LIMIT || remote_entry.size > LINE_ENDING_COMPARE_LIMIT {
            continue;
        }
        candidates.push((local_entry.clone(), (*remote_entry).clone()));
    }

    let mut jobs = futures_util::stream::iter(candidates)
        .map(|(local, remote)| {
            let cancellation = cancellation.clone();
            async move {
                ensure_line_ending_scan_active(&cancellation)?;
                let local_path = local.absolute_path.clone();
                let expected = local.hash.clone();
                let local_normalized = tokio::task::spawn_blocking(move || {
                    let metadata = fs::metadata(&local_path)?;
                    if metadata.len() > LINE_ENDING_COMPARE_LIMIT { return Ok(None); }
                    Ok::<_, AppError>(bounded_line_ending_file(&local_path)?
                        .and_then(|(raw, normalized)| (raw == expected).then_some(normalized)))
                }).await.map_err(|error| AppError::new("LOCAL_FILE_READ", format!("换行比较任务失败：{error}")))??;
                let Some(local_normalized) = local_normalized else { return Ok(None); };
                ensure_line_ending_scan_active(&cancellation)?;
                let remote_path = remote_file_path(root_path, &remote.relative_path)?;
                let download = tokio::select! {
                    result = client.get_bytes_limited(&remote_path, LINE_ENDING_COMPARE_LIMIT as usize) => result,
                    _ = wait_for_line_ending_cancel(cancellation.clone()) =>
                        return Err(AppError::new("SYNC_INTERRUPTED", "同步已按要求停止")),
                };
                let (contents, etag) = match download {
                    Ok(value) => value,
                    Err(error) if error.code == "DAV_FILE_TOO_LARGE" => return Ok(None),
                    Err(error) => return Err(error),
                };
                if remote.etag.as_deref().zip(etag.as_deref()).is_some_and(|(listed, received)| listed != received) {
                    return Err(AppError::retryable("DAV_PRECONDITION_FAILED", "读取内容时 WebDAV 文件版本已变化，请重新扫描。"));
                }
                let expected = remote.hash.clone();
                let remote_normalized = tokio::task::spawn_blocking(move || {
                    Ok::<_, AppError>(line_ending_hashes(std::io::Cursor::new(contents))?
                        .and_then(|(raw, normalized)| (raw == expected).then_some(normalized)))
                }).await.map_err(|error| AppError::new("LOCAL_FILE_READ", format!("换行比较任务失败：{error}")))??;
                ensure_line_ending_scan_active(&cancellation)?;
                let local_path = local.absolute_path.clone();
                let current_hash = tokio::task::spawn_blocking(move || bounded_line_ending_file(&local_path))
                    .await.map_err(|error| AppError::new("LOCAL_FILE_READ", format!("换行比较任务失败：{error}")))??;
                if remote_normalized.as_deref() == Some(local_normalized.as_str())
                    && current_hash.is_some_and(|(raw, _)| raw == local.hash)
                {
                    Ok(Some(local.path_key))
                } else {
                    Ok(None)
                }
            }
        })
        .buffer_unordered(LINE_ENDING_COMPARE_CONCURRENCY);
    loop {
        tokio::select! {
            result = jobs.next() => match result {
                Some(result) => if let Some(key) = result? { equivalent.insert(key); },
                None => break,
            },
            _ = wait_for_line_ending_cancel(cancellation.clone()) =>
                return Err(AppError::new("SYNC_INTERRUPTED", "同步已按要求停止")),
        }
    }
    Ok(equivalent)
}

fn ensure_line_ending_scan_active(cancellation: &Option<Arc<AtomicBool>>) -> AppResult<()> {
    if cancellation.as_ref().is_some_and(|flag| flag.load(Ordering::Acquire)) {
        return Err(AppError::new("SYNC_INTERRUPTED", "同步已按要求停止"));
    }
    Ok(())
}

async fn wait_for_line_ending_cancel(cancellation: Option<Arc<AtomicBool>>) {
    if let Some(flag) = cancellation {
        while !flag.load(Ordering::Acquire) {
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        }
    } else {
        std::future::pending::<()>().await;
    }
}

pub(super) async fn scan_remote(
    client: &WebDavClient,
    root_path: &str,
    rules: &[SyncRuleDto],
    cache: &[crate::domain::BaselineEntry],
    excluded_paths: &HashSet<String>,
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
    let prefix = format!("{}/", root_path.trim_end_matches('/'));
    while let Some(directory) = directories.pop() {
        if !visited.insert(directory.clone()) {
            continue;
        }
        let props = client.propfind(&directory, 1).await.map_err(|error| {
            if directory != root_path && error.code == "DAV_NOT_FOUND" {
                AppError::retryable("SCAN_INCOMPLETE", "扫描期间远端子目录已变化，请重新扫描。")
            } else {
                error
            }
        })?;
        let mut downloads = Vec::new();
        for prop in props {
            let dav_path = href_to_dav_path(client, &prop.path, &directory)?;
            if dav_path == directory || dav_path == format!("{}/", directory.trim_end_matches('/'))
            {
                continue;
            }
            let relative = dav_path.strip_prefix(prefix.as_str()).ok_or_else(|| {
                AppError::new(
                    "DAV_INVALID_RESPONSE",
                    "PROPFIND 返回了同步根目录之外的文件",
                )
            })?;
            let relative = relative.trim_end_matches('/');
            if relative
                .split('/')
                .any(|part| part.eq_ignore_ascii_case(".projectsync"))
            {
                continue;
            }
            let relative = validate_relative_path(relative)?;
            if prop.is_collection {
                if !rule_engine.is_excluded(&relative, true) {
                    directories.push(dav_path);
                }
                continue;
            }
            if is_generated_conflict_copy(&relative) {
                continue;
            }
            let key = path_key(&relative);
            if excluded_paths.contains(&key) {
                continue;
            }
            if !rule_engine.includes(&relative) {
                continue;
            }
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
            let entry = RemoteEntry {
                relative_path: relative,
                path_key: key,
                hash: cached.and_then(|old| old.remote_hash.clone()).unwrap_or_default(),
                size: prop.size,
                modified_at: prop.modified_at,
                etag: prop.etag,
                is_collection: false,
            };
            if cached.is_some() {
                entries.push(entry);
            } else {
                downloads.push((dav_path, entry));
            }
        }
        if !downloads.is_empty() {
            let mut jobs = futures_util::stream::iter(downloads)
                .map(|(dav_path, mut entry)| async move {
                    let (size, hash, etag) = client.hash_resource(&dav_path).await.map_err(|error| {
                        if error.code == "DAV_NOT_FOUND" {
                            AppError::retryable("SCAN_INCOMPLETE", "扫描期间远端文件已变化，请重新扫描。")
                        } else {
                            error
                        }
                    })?;
                    super::remote_files::verify_snapshot_etag(entry.etag.as_deref(), etag.as_deref())?;
                    entry.size = size;
                    entry.hash = hash;
                    Ok::<_, AppError>(entry)
                })
                .buffer_unordered(4);
            let mut failure = None;
            while let Some(result) = jobs.next().await {
                match result {
                    Ok(entry) => entries.push(entry),
                    Err(error) => {
                        failure.get_or_insert(error);
                    }
                }
            }
            if let Some(error) = failure {
                return Err(error);
            }
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
    use super::*;
    use crate::domain::BaselineEntry;

    fn baseline(etag: Option<&str>) -> BaselineEntry {
        BaselineEntry {
            relative_path: "file.txt".to_owned(),
            path_key: "file.txt".to_owned(),
            baseline_state: "PRESENT".to_owned(),
            sync_state: "CLEAN".to_owned(),
            base_hash: Some("base".to_owned()),
            base_remote_hash: None,
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
    fn line_ending_comparison_handles_unicode_and_rejects_binary() {
        let crlf = line_ending_hashes(std::io::Cursor::new("中文\r\nnext\r".as_bytes())).unwrap().unwrap().1;
        let lf = line_ending_hashes(std::io::Cursor::new("中文\nnext\n".as_bytes())).unwrap().unwrap().1;
        assert_eq!(crlf, lf);
        assert!(line_ending_hashes(std::io::Cursor::new(b"binary\0data")).unwrap().is_none());
    }

    #[tokio::test]
    async fn large_or_cancelled_line_ending_checks_do_not_read_files() {
        let client = WebDavClient::new("https://example.test/", "user", String::new(), true).unwrap();
        let local = LocalEntry { relative_path: "large.txt".into(), path_key: "large.txt".into(),
            absolute_path: PathBuf::from("not-an-existing-file"), hash: "a".into(),
            size: LINE_ENDING_COMPARE_LIMIT + 1, mtime_ns: 0 };
        let remote = RemoteEntry { relative_path: "large.txt".into(), path_key: "large.txt".into(),
            hash: "b".into(), size: 1, modified_at: 0, etag: None, is_collection: false };
        assert!(line_ending_equivalent_paths(&client, "/", &[local.clone()], &[remote.clone()], &[], None)
            .await.unwrap().is_empty());
        let cancelled = Arc::new(AtomicBool::new(true));
        assert_eq!(line_ending_equivalent_paths(&client, "/", &[local], &[remote], &[], Some(cancelled))
            .await.unwrap_err().code, "SYNC_INTERRUPTED");
    }

    #[tokio::test]
    async fn unchanged_line_endings_stay_equivalent_without_another_get() {
        let client = WebDavClient::new("https://example.test/", "user", String::new(), true).unwrap();
        let mut baseline = baseline(None);
        baseline.base_hash = Some("crlf".into());
        baseline.base_remote_hash = Some("lf".into());
        let local = LocalEntry {
            relative_path: "file.txt".into(), path_key: "file.txt".into(),
            absolute_path: PathBuf::new(), hash: "crlf".into(), size: 4, mtime_ns: 0,
        };
        let mut remote = RemoteEntry {
            relative_path: "file.txt".into(), path_key: "file.txt".into(),
            hash: "lf".into(), size: 3, modified_at: 0, etag: None, is_collection: false,
        };
        let equivalents = line_ending_equivalent_paths(
            &client, "/", std::slice::from_ref(&local), std::slice::from_ref(&remote),
            std::slice::from_ref(&baseline), None,
        ).await.unwrap();
        assert!(equivalents.contains("file.txt"));
        let clean = build_plan(
            std::slice::from_ref(&local), std::slice::from_ref(&remote),
            std::slice::from_ref(&baseline), &equivalents, &[], true, true, &unsafe_capabilities(),
        );
        assert_eq!(clean[0].action, SyncAction::MarkClean);

        remote.hash = "edited".into();
        remote.size = 10;
        let plan = build_plan(
            &[local], &[remote], &[baseline], &HashSet::new(), &[], true, true, &unsafe_capabilities(),
        );
        assert_eq!(plan[0].action, SyncAction::DownloadUpdate);
        assert_eq!(plan[0].transfer_size(), 10);
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
