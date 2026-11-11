use super::*;
use crate::webdav::DavEntry;
use std::collections::VecDeque;

const MAX_DIRECTORIES: usize = 500;
const MAX_FILES: usize = 2000;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RemoteCleanupItem {
    path: String,
    kind: &'static str,
    size: u64,
    modified_at: i64,
    etag: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CleanupSelection {
    path: String,
    size: u64,
    modified_at: i64,
    etag: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RemoteCleanupInventory {
    files: Vec<RemoteCleanupItem>,
    truncated: bool,
    can_attempt_cleanup: bool,
}

#[derive(Serialize)]
pub(crate) struct RemoteCleanupResult {
    removed: Vec<String>,
    failures: Vec<(String, String)>,
}

impl SyncCoordinator {
    pub(crate) async fn list_remote_cleanup(
        &self,
        root_id: &str,
    ) -> AppResult<RemoteCleanupInventory> {
        let root = self.db.root(root_id).await?;
        let (account, client) = self.client_for(&root.account_id).await?;
        let base = normalize_remote_path(&root.remote_path)?;
        let nested = self.nested_cleanup_roots(&root, &base).await?;
        let prefix = format!("{}/", base.trim_end_matches('/'));
        let trash = format!("{prefix}.projectsync/trash");
        let mut directories = VecDeque::from([trash.clone(), base.clone()]);
        let mut visited = HashSet::new();
        let mut files = HashMap::new();
        let mut truncated = false;
        while let Some(directory) = directories.pop_front() {
            if !visited.insert(directory.clone()) {
                continue;
            }
            if visited.len() > MAX_DIRECTORIES {
                truncated = true;
                break;
            }
            let rows = match client.propfind(&directory, 1).await {
                Ok(rows) => rows,
                Err(error) if error.code == "DAV_NOT_FOUND" && directory.starts_with(&trash) => {
                    continue
                }
                Err(error) => return Err(error),
            };
            if directory != base && !directory.starts_with(&trash) {
                let internal = format!("{directory}/.projectsync");
                if rows.iter().filter(|row| row.is_collection).any(|row| {
                    href_to_dav_path(&client, &row.path, &directory)
                        .is_ok_and(|path| path.trim_end_matches('/') == internal)
                }) {
                    continue;
                }
            }
            for row in rows {
                let absolute = href_to_dav_path(&client, &row.path, &directory)?;
                let absolute = absolute.trim_end_matches('/');
                let parent = directory.trim_end_matches('/');
                let Some(name) = absolute
                    .strip_prefix(parent)
                    .and_then(|p| p.strip_prefix('/'))
                else {
                    continue;
                };
                if name.is_empty() || name.contains('/') {
                    continue;
                }
                let Some(relative) = absolute.strip_prefix(&prefix) else {
                    continue;
                };
                if row.is_collection {
                    if nested.contains(absolute) {
                        continue;
                    }
                    if directory == trash {
                        if uuid::Uuid::parse_str(name).is_ok() {
                            directories.push_front(absolute.to_owned());
                        }
                    } else if !directory.starts_with(&trash)
                        && validate_relative_path(relative).is_ok()
                    {
                        directories.push_back(absolute.to_owned());
                    }
                } else if let Some(kind) = cleanup_kind(relative) {
                    if files.len() >= MAX_FILES {
                        truncated = true;
                        break;
                    }
                    files
                        .entry(relative.to_owned())
                        .or_insert(RemoteCleanupItem {
                            path: relative.to_owned(),
                            kind,
                            size: row.size,
                            modified_at: row.modified_at,
                            etag: strong_etag(row.etag.as_deref()).map(str::to_owned),
                        });
                }
            }
            if truncated {
                break;
            }
        }
        let mut files = files.into_values().collect::<Vec<_>>();
        files.sort_by(|a, b| {
            a.modified_at
                .cmp(&b.modified_at)
                .then_with(|| a.path.cmp(&b.path))
        });
        let can_attempt_cleanup = account.capabilities.is_some_and(|caps| {
            caps.safe_delete || (caps.supports_lock && caps.supports_if_none_match)
        });
        Ok(RemoteCleanupInventory {
            files,
            truncated,
            can_attempt_cleanup,
        })
    }

    pub(crate) async fn clean_remote_backups(
        &self,
        root_id: &str,
        items: Vec<CleanupSelection>,
    ) -> AppResult<RemoteCleanupResult> {
        if items.is_empty() || items.len() > 200 {
            return Err(AppError::new(
                "CLEANUP_SELECTION_INVALID",
                "每次请选择 1 至 200 个备份文件",
            ));
        }
        if items.iter().any(|item| {
            cleanup_kind(&item.path).is_none() || strong_etag(Some(&item.etag)).is_none()
        }) {
            return Err(AppError::new(
                "CLEANUP_SELECTION_INVALID",
                "只能清理列表中具有强 ETag 的备份文件",
            ));
        }
        let lock = self.lock_for(root_id)?;
        let _guard = lock.lock().await;
        let root = self.db.root(root_id).await?;
        let base = normalize_remote_path(&root.remote_path)?;
        let nested = self.nested_cleanup_roots(&root, &base).await?;
        if items.iter().any(|item| {
            let path = format!("{}/{}", base.trim_end_matches('/'), item.path);
            nested.iter().any(|other| {
                path.strip_prefix(other.as_str())
                    .is_some_and(|suffix| suffix.starts_with('/'))
            })
        }) {
            return Err(AppError::new(
                "CLEANUP_SELECTION_INVALID",
                "选中的路径属于另一个已绑定的同步项目",
            ));
        }
        let (account, client) = self.client_for(&root.account_id).await?;
        let caps = account.capabilities.unwrap_or_else(unsafe_capabilities);
        let use_lock = !caps.safe_delete;
        if use_lock
            && (!(caps.supports_lock && caps.supports_if_none_match)
                || !client.probe_locked_delete(&base).await?)
        {
            return Err(AppError::new(
                "BLOCKED_SERVER_CAPABILITY",
                "节点未通过受保护删除验证，所选备份均已保留。",
            ));
        }

        let mut result = RemoteCleanupResult {
            removed: Vec::new(),
            failures: Vec::new(),
        };
        let mut seen = HashSet::new();
        for item in items {
            if !seen.insert(item.path.clone()) {
                continue;
            }
            let absolute = format!("{}/{}", base.trim_end_matches('/'), item.path);
            let attempt = if use_lock {
                delete_with_verified_lock(&client, &absolute, &item).await
            } else {
                async {
                    validate_snapshot(&client, &absolute, &item).await?;
                    client.delete(&absolute, Some(&item.etag)).await?;
                    verify_removed(&client, &absolute).await
                }
                .await
            };
            match attempt {
                Ok(()) => result.removed.push(item.path),
                Err(error) => result.failures.push((item.path, error.message)),
            }
        }
        Ok(result)
    }

    async fn nested_cleanup_roots(
        &self,
        root: &RootRecord,
        base: &str,
    ) -> AppResult<HashSet<String>> {
        let prefix = format!("{}/", base.trim_end_matches('/'));
        Ok(self
            .db
            .roots()
            .await?
            .into_iter()
            .filter(|other| other.id != root.id && other.account_id == root.account_id)
            .filter_map(|other| normalize_remote_path(&other.remote_path).ok())
            .filter(|path| path.starts_with(&prefix) && path != base)
            .collect())
    }
}

fn cleanup_kind(path: &str) -> Option<&'static str> {
    if let Some(rest) = path.strip_prefix(".projectsync/trash/") {
        let (binding, name) = rest.split_once('/')?;
        let (timestamp, original) = name.split_once('-')?;
        return (uuid::Uuid::parse_str(binding).is_ok()
            && !name.contains('/')
            && validate_relative_path(name).is_ok()
            && timestamp.len() == 13
            && timestamp.bytes().all(|b| b.is_ascii_digit())
            && !original.is_empty())
        .then_some("trash");
    }
    (validate_relative_path(path).is_ok() && is_generated_conflict_copy(path)).then_some("conflict")
}

fn strong_etag(value: Option<&str>) -> Option<&str> {
    value.map(str::trim).filter(|value| {
        value
            .strip_prefix('"')
            .and_then(|v| v.strip_suffix('"'))
            .is_some_and(|v| !v.contains('"'))
    })
}

async fn validate_snapshot(
    client: &WebDavClient,
    path: &str,
    item: &CleanupSelection,
) -> AppResult<()> {
    let rows = client.propfind(path, 0).await?;
    for row in rows {
        let absolute = href_to_dav_path(client, &row.path, path)?;
        if absolute.trim_end_matches('/') == path && matches_selection(&row, item) {
            return Ok(());
        }
    }
    Err(AppError::new(
        "DAV_PRECONDITION_FAILED",
        "远端文件已变化，请重新扫描后再清理",
    ))
}

fn matches_selection(row: &DavEntry, item: &CleanupSelection) -> bool {
    !row.is_collection
        && row.size == item.size
        && row.modified_at == item.modified_at
        && strong_etag(row.etag.as_deref()) == Some(item.etag.as_str())
}

async fn verify_removed(client: &WebDavClient, path: &str) -> AppResult<()> {
    match client.propfind(path, 0).await {
        Err(error) if error.code == "DAV_NOT_FOUND" => Ok(()),
        Err(error) => Err(error),
        Ok(_) => Err(AppError::new(
            "DAV_CLEANUP_UNVERIFIED",
            "无法确认文件已移除，请刷新列表",
        )),
    }
}

async fn delete_with_verified_lock(
    client: &WebDavClient,
    path: &str,
    item: &CleanupSelection,
) -> AppResult<()> {
    validate_snapshot(client, path, item).await?;
    let token = client.lock_exclusive(path, "0").await?;
    let result = async {
        validate_snapshot(client, path, item).await?;
        client.delete_with_lock_token(path, &token).await?;
        verify_removed(client, path).await
    }
    .await;
    let _ = client.unlock(path, &token).await;
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cleanup_is_limited_to_generated_backups_and_legacy_copies() {
        assert_eq!(
            cleanup_kind(
                ".projectsync/trash/aaaaaaaa-bbbb-4ccc-addd-eeeeeeeeeeee/1700000000000-notes.md"
            ),
            Some("trash")
        );
        assert_eq!(
            cleanup_kind("docs/notes.conflict-WORK-PC-20261111T070000Z-abcdef.md"),
            Some("conflict")
        );
        for path in [
            ".projectsync/root.json",
            "docs/notes.md",
            "../notes.conflict-PC-20261111T070000Z-abcdef.md",
            ".projectsync/trash/aaaaaaaa-bbbb-4ccc-addd-eeeeeeeeeeee/1700000000000-folder/notes.md",
        ] {
            assert_eq!(cleanup_kind(path), None, "{path}");
        }
    }

    #[test]
    fn cleanup_rechecks_the_selected_file_version_and_type() {
        let item = CleanupSelection {
            path: "ignored-here".into(),
            size: 10,
            modified_at: 42,
            etag: "\"v1\"".into(),
        };
        let mut row = DavEntry {
            path: String::new(),
            size: 10,
            modified_at: 42,
            etag: Some("\"v1\"".into()),
            is_collection: false,
        };
        assert!(matches_selection(&row, &item));
        row.is_collection = true;
        assert!(!matches_selection(&row, &item));
        row.is_collection = false;
        row.etag = Some("\"v2\"".into());
        assert!(!matches_selection(&row, &item));
    }
}
