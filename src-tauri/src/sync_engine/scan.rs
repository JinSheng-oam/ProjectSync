use super::*;

fn line_ending_insensitive_hash(path: &Path) -> AppResult<Option<String>> {
    let mut file = fs::File::open(path)?;
    let mut buffer = [0_u8; 128 * 1024];
    let mut utf8_tail = Vec::with_capacity(4);
    let mut normalized = Vec::with_capacity(buffer.len() + 1);
    let mut pending_cr = false;
    let mut hasher = blake3::Hasher::new();

    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        let bytes = &buffer[..read];
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
    Ok(Some(hasher.finalize().to_hex().to_string()))
}

pub(super) async fn line_ending_equivalent_paths(
    client: &WebDavClient,
    root_path: &str,
    local: &[LocalEntry],
    remote: &[RemoteEntry],
    baseline: &[crate::domain::BaselineEntry],
    data_dir: &Path,
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

    for local_entry in local {
        let Some(remote_entry) = remote_by_path.get(local_entry.path_key.as_str()) else {
            continue;
        };
        if local_entry.relative_path != remote_entry.relative_path
            || local_entry.hash == remote_entry.hash
        {
            continue;
        }
        if let Some(base) = baseline_by_path.get(local_entry.path_key.as_str()) {
            if base.baseline_state == "PRESENT"
                && (Some(local_entry.hash.as_str()) == base.base_hash.as_deref()
                    || Some(remote_entry.hash.as_str()) == base.base_hash.as_deref())
            {
                continue;
            }
        }
        let Some(local_normalized_hash) =
            line_ending_insensitive_hash(&local_entry.absolute_path)?
        else {
            continue;
        };
        if hash_file(&local_entry.absolute_path)? != local_entry.hash {
            continue;
        }

        let remote_path = remote_file_path(root_path, &remote_entry.relative_path)?;
        let staging = data_dir
            .join("staging")
            .join(format!("line-ending-check-{}.bin", uuid::Uuid::new_v4()));
        if let Some(parent) = staging.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }
        let remote_normalized_hash = async {
            client.get_to_file(&remote_path, &staging).await?;
            if hash_file(&staging)? != remote_entry.hash {
                return Ok::<_, AppError>(None);
            }
            line_ending_insensitive_hash(&staging)
        }
        .await;
        let _ = tokio::fs::remove_file(&staging).await;
        let Some(remote_normalized_hash) = remote_normalized_hash? else {
            continue;
        };
        if local_normalized_hash == remote_normalized_hash
            && hash_file(&local_entry.absolute_path)? == local_entry.hash
        {
            equivalent.insert(local_entry.path_key.clone());
        }
    }

    Ok(equivalent)
}

pub(super) async fn scan_remote(
    client: &WebDavClient,
    root_path: &str,
    rules: &[SyncRuleDto],
    data_dir: &Path,
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
    let staging_dir = data_dir.join("staging");
    while let Some(directory) = directories.pop() {
        if !visited.insert(directory.clone()) {
            continue;
        }
        let props = client.propfind(&directory, 1).await?;
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
            tokio::fs::create_dir_all(&staging_dir).await?;
            let mut jobs = futures_util::stream::iter(downloads)
                .map(|(dav_path, mut entry)| {
                    let staging = staging_dir.join(format!("remote-scan-{}.bin", uuid::Uuid::new_v4()));
                    async move {
                        let result = async {
                            entry.size = client.get_to_file(&dav_path, &staging).await?;
                            let hash_path = staging.clone();
                            entry.hash = tokio::task::spawn_blocking(move || hash_file(&hash_path))
                                .await
                                .map_err(|error| AppError::new("LOCAL_FILE_READ", error.to_string()))??;
                            Ok::<_, AppError>(entry)
                        }
                        .await;
                        let _ = tokio::fs::remove_file(staging).await;
                        result
                    }
                })
                .buffer_unordered(4);
            // Drain in-flight downloads so each job can remove its staging file.
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
