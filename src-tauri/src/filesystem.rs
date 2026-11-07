use crate::{
    domain::{AppError, AppResult, LocalEntry, SyncRuleDto},
    security::{path_key, resolve_local_path, validate_relative_path},
};
use globset::{GlobBuilder, GlobSet, GlobSetBuilder};
use std::{
    collections::HashSet,
    fs::{self, File, OpenOptions},
    io::{Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};
use walkdir::WalkDir;

pub struct RuleEngine {
    includes: GlobSet,
    excludes: GlobSet,
    has_include: bool,
}

impl RuleEngine {
    pub fn compile(rules: &[SyncRuleDto]) -> AppResult<Self> {
        let mut include_builder = GlobSetBuilder::new();
        let mut exclude_builder = GlobSetBuilder::new();
        let mut has_include = false;
        for rule in rules.iter().filter(|r| r.enabled) {
            let pattern = rule.pattern.trim();
            if pattern.is_empty() {
                return Err(AppError::new("RULE_INVALID", "同步规则不能为空"));
            }
            let glob = GlobBuilder::new(pattern)
                .literal_separator(true)
                .backslash_escape(true)
                .case_insensitive(true)
                .build()
                .map_err(|e| AppError::new("RULE_INVALID", format!("Glob 规则无效：{e}")))?;
            match rule.rule_type {
                crate::domain::RuleType::Include => {
                    include_builder.add(glob);
                    has_include = true;
                }
                crate::domain::RuleType::Exclude => {
                    exclude_builder.add(glob);
                }
            }
        }
        Ok(Self {
            includes: include_builder
                .build()
                .map_err(|e| AppError::new("RULE_INVALID", e.to_string()))?,
            excludes: exclude_builder
                .build()
                .map_err(|e| AppError::new("RULE_INVALID", e.to_string()))?,
            has_include,
        })
    }

    pub fn includes(&self, path: &str) -> bool {
        !self.is_excluded(path, false)
            && !path
                .match_indices('/')
                .any(|(index, _)| self.is_excluded(&path[..index], true))
            && (!self.has_include || self.includes.is_match(path))
    }

    fn is_excluded(&self, path: &str, is_directory: bool) -> bool {
        if path
            .split('/')
            .any(|part| part.eq_ignore_ascii_case(".projectsync"))
        {
            return true;
        }
        let path = path.trim_matches('/');
        self.excludes.is_match(path)
            || (is_directory && self.excludes.is_match(&format!("{path}/")))
    }
}

pub fn scan_local(root: &Path, rules: &[SyncRuleDto]) -> AppResult<Vec<LocalEntry>> {
    scan_local_cached(root, rules, &[])
}

pub fn scan_local_cached(
    root: &Path,
    rules: &[SyncRuleDto],
    cache: &[crate::domain::BaselineEntry],
) -> AppResult<Vec<LocalEntry>> {
    scan_local_cached_excluding(root, rules, cache, &HashSet::new())
}

pub fn scan_local_cached_excluding(
    root: &Path,
    rules: &[SyncRuleDto],
    cache: &[crate::domain::BaselineEntry],
    excluded_paths: &HashSet<String>,
) -> AppResult<Vec<LocalEntry>> {
    let root = fs::canonicalize(root)
        .map_err(|e| AppError::new("LOCAL_ROOT_INVALID", format!("无法访问本地同步目录：{e}")))?;
    if !root.is_dir() {
        return Err(AppError::new("LOCAL_ROOT_INVALID", "本地同步路径不是目录"));
    }
    let rule_engine = RuleEngine::compile(rules)?;
    let scan_incomplete = std::cell::Cell::new(false);
    let cache = cache
        .iter()
        .filter_map(|entry| {
            entry
                .local_hash
                .as_deref()
                .map(|hash| (entry.path_key.as_str(), (entry, hash)))
        })
        .collect::<std::collections::HashMap<_, _>>();
    let mut entries = Vec::new();
    let mut case_names = std::collections::HashMap::<String, String>::new();
    let walker = WalkDir::new(&root)
        .follow_links(false)
        .sort_by_file_name()
        .into_iter()
        .filter_entry(|entry| {
            if entry.depth() == 0 {
                return true;
            }
            let file_type = entry.file_type();
            let relative = match entry.path().strip_prefix(&root) {
                Ok(relative) => relative
                    .components()
                    .map(|part| part.as_os_str().to_string_lossy())
                    .collect::<Vec<_>>()
                    .join("/"),
                Err(_) => {
                    scan_incomplete.set(true);
                    return false;
                }
            };
            if relative
                .split('/')
                .any(|part| part.eq_ignore_ascii_case(".projectsync"))
            {
                return false;
            }
            if excluded_paths.contains(&path_key(&relative)) {
                return false;
            }
            if file_type.is_file() && is_generated_conflict_copy(&relative) {
                return false;
            }
            if rule_engine.is_excluded(&relative, file_type.is_dir() || file_type.is_symlink()) {
                return false;
            }
            if file_type.is_symlink() {
                scan_incomplete.set(true);
                return false;
            }
            match fs::symlink_metadata(entry.path()) {
                Ok(metadata) if is_reparse_point(&metadata) => {
                    scan_incomplete.set(true);
                    false
                }
                Ok(_) => true,
                Err(_) => {
                    scan_incomplete.set(true);
                    false
                }
            }
        });
    for walk in walker.skip(1) {
        let item = walk.map_err(|error| {
            AppError::new("SCAN_INCOMPLETE", format!("本地目录扫描失败：{error}"))
        })?;
        let meta = item.metadata().map_err(|error| {
            AppError::new("SCAN_INCOMPLETE", format!("读取本地文件属性失败：{error}"))
        })?;
        if item.file_type().is_symlink() || is_reparse_point(&meta) || !meta.is_file() {
            continue;
        }
        let relative = item
            .path()
            .strip_prefix(&root)
            .map_err(|_| AppError::new("LOCAL_PATH_INVALID", "扫描结果越过了根目录"))?
            .components()
            .map(|c| c.as_os_str().to_string_lossy())
            .collect::<Vec<_>>()
            .join("/");
        let relative = validate_relative_path(&relative)?;
        if !rule_engine.includes(&relative) {
            continue;
        }
        let key = path_key(&relative);
        if let Some(existing) = case_names.insert(key.clone(), relative.clone()) {
            return Err(AppError::new(
                "CASE_COLLISION",
                format!("本地文件名不区分大小写时发生冲突：{existing} / {relative}"),
            ));
        }
        let modified = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_nanos().min(i64::MAX as u128) as i64)
            .unwrap_or_default();
        let hash = match cache.get(key.as_str()) {
            Some((old, hash)) if old.local_size == meta.len() && old.local_mtime_ns == modified => {
                (*hash).to_owned()
            }
            _ => hash_file(item.path())?,
        };
        entries.push(LocalEntry {
            relative_path: relative,
            path_key: key,
            absolute_path: item.path().to_path_buf(),
            hash,
            size: meta.len(),
            mtime_ns: modified,
        });
    }
    if scan_incomplete.get() {
        return Err(AppError::new(
            "SCAN_INCOMPLETE",
            "本地目录包含符号链接、重解析点或无法检查的目录；为避免误判删除，本轮同步已停止",
        ));
    }
    Ok(entries)
}

pub fn is_generated_conflict_copy(relative_path: &str) -> bool {
    let candidate = Path::new(relative_path);
    let Some(candidate_stem) = candidate.file_stem().and_then(|value| value.to_str()) else {
        return false;
    };
    let Some((source_stem, suffix)) = candidate_stem.rsplit_once(".conflict-") else {
        return false;
    };
    if source_stem.is_empty() {
        return false;
    }

    let parts = suffix.split('-').collect::<Vec<_>>();
    if parts.len() < 3 {
        return false;
    }
    let device = parts[..parts.len() - 2].join("-");
    let timestamp = parts[parts.len() - 2].as_bytes();
    let token = parts[parts.len() - 1];
    !device.is_empty()
        && device.len() <= 24
        && device
            .chars()
            .all(|value| value.is_ascii_alphanumeric() || value == '-' || value == '_')
        && timestamp.len() == 16
        && timestamp[8] == b'T'
        && timestamp[15] == b'Z'
        && timestamp
            .iter()
            .enumerate()
            .all(|(index, value)| index == 8 || index == 15 || value.is_ascii_digit())
        && matches!(token.len(), 6 | 32)
        && token.chars().all(|value| value.is_ascii_hexdigit())
}

pub fn move_generated_conflict_copies_to_trash(
    root: &Path,
    data_dir: &Path,
    root_id: &str,
) -> AppResult<usize> {
    let root = fs::canonicalize(root).map_err(|error| {
        AppError::new(
            "LOCAL_ROOT_INVALID",
            format!("无法访问本地同步目录：{error}"),
        )
    })?;
    let mut moved = 0;
    for walk in WalkDir::new(&root)
        .follow_links(false)
        .sort_by_file_name()
        .into_iter()
        .skip(1)
    {
        let entry = walk.map_err(|error| {
            AppError::new(
                "SCAN_INCOMPLETE",
                format!("清理冲突副本时扫描目录失败：{error}"),
            )
        })?;
        if !entry.file_type().is_file() || entry.file_type().is_symlink() {
            continue;
        }
        let relative = entry
            .path()
            .strip_prefix(&root)
            .map_err(|_| AppError::new("LOCAL_PATH_INVALID", "冲突副本路径越过同步根目录"))?
            .components()
            .map(|component| component.as_os_str().to_string_lossy())
            .collect::<Vec<_>>()
            .join("/");
        if relative
            .split('/')
            .any(|part| part.eq_ignore_ascii_case(".projectsync"))
            || !is_generated_conflict_copy(&relative)
        {
            continue;
        }
        let target = ensure_safe_parent(&root, &relative)?;
        move_to_trash(data_dir, root_id, &relative, &target)?;
        moved += 1;
    }
    Ok(moved)
}

pub fn hash_file(path: &Path) -> AppResult<String> {
    let mut file = File::open(path)
        .map_err(|e| AppError::new("LOCAL_FILE_READ", format!("无法读取文件：{e}")))?;
    hash_reader(&mut file)
}

fn hash_reader(reader: &mut impl Read) -> AppResult<String> {
    let mut hasher = blake3::Hasher::new();
    let mut buf = [0_u8; 128 * 1024];
    loop {
        let read = reader
            .read(&mut buf)
            .map_err(|e| AppError::new("LOCAL_FILE_READ", format!("计算文件摘要失败：{e}")))?;
        if read == 0 {
            break;
        }
        hasher.update(&buf[..read]);
    }
    Ok(hasher.finalize().to_hex().to_string())
}

pub fn ensure_safe_parent(root: &Path, relative_path: &str) -> AppResult<PathBuf> {
    let root =
        fs::canonicalize(root).map_err(|e| AppError::new("LOCAL_ROOT_INVALID", e.to_string()))?;
    let target = resolve_local_path(&root, relative_path)?;
    let parent = target
        .parent()
        .ok_or_else(|| AppError::new("LOCAL_PATH_INVALID", "目标路径没有父目录"))?;
    let parent_rel = parent
        .strip_prefix(&root)
        .map_err(|_| AppError::new("LOCAL_PATH_INVALID", "目标父目录越过同步根目录"))?;
    let mut current = root.clone();
    for component in parent_rel.components() {
        let part = component.as_os_str();
        current.push(part);
        match fs::symlink_metadata(&current) {
            Ok(meta) if meta.file_type().is_symlink() || is_reparse_point(&meta) => {
                return Err(AppError::new(
                    "LOCAL_PATH_INVALID",
                    "同步目标路径中包含符号链接",
                ))
            }
            Ok(meta) if !meta.is_dir() => {
                return Err(AppError::new(
                    "LOCAL_PATH_INVALID",
                    "同步目标父路径不是目录",
                ))
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => fs::create_dir(&current)?,
            Err(error) => return Err(AppError::new("LOCAL_PERMISSION_DENIED", error.to_string())),
        }
    }
    Ok(target)
}

pub fn atomic_replace(staging: &Path, target: &Path) -> AppResult<()> {
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::Storage::FileSystem::{
            MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
        };
        let from = staging
            .as_os_str()
            .encode_wide()
            .chain(Some(0))
            .collect::<Vec<_>>();
        let to = target
            .as_os_str()
            .encode_wide()
            .chain(Some(0))
            .collect::<Vec<_>>();
        let moved = unsafe {
            MoveFileExW(
                from.as_ptr(),
                to.as_ptr(),
                MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
            )
        };
        if moved == 0 {
            return Err(AppError::new(
                "LOCAL_REPLACE_FAILED",
                "原子替换本地文件失败；临时文件已保留",
            ));
        }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        fs::rename(staging, target)?;
        Ok(())
    }
}

fn is_reparse_point(metadata: &fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
        metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
    }
    #[cfg(not(windows))]
    {
        let _ = metadata;
        false
    }
}

pub fn move_to_trash(
    data_dir: &Path,
    root_id: &str,
    relative_path: &str,
    source: &Path,
) -> AppResult<PathBuf> {
    let source_meta = fs::symlink_metadata(source)
        .map_err(|e| AppError::new("LOCAL_TRASH_FAILED", e.to_string()))?;
    if source_meta.file_type().is_symlink()
        || is_reparse_point(&source_meta)
        || !source_meta.is_file()
    {
        return Err(AppError::new(
            "LOCAL_PATH_INVALID",
            "回收站目标不是普通文件",
        ));
    }
    let safe = validate_relative_path(relative_path)?;
    let destination = data_dir
        .join("trash")
        .join(root_id)
        .join(format!(
            "{}-{}",
            crate::security::unix_ms(),
            uuid::Uuid::new_v4().simple()
        ))
        .join(safe);
    let parent = destination
        .parent()
        .ok_or_else(|| AppError::new("LOCAL_PATH_INVALID", "回收站路径无效"))?;
    fs::create_dir_all(parent)?;
    let mut source_options = OpenOptions::new();
    source_options.read(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        use windows_sys::Win32::Storage::FileSystem::{FILE_SHARE_DELETE, FILE_SHARE_READ};
        source_options.share_mode(FILE_SHARE_READ | FILE_SHARE_DELETE);
    }
    let mut input = source_options
        .open(source)
        .map_err(|e| AppError::new("LOCAL_TRASH_FAILED", format!("无法读取待回收文件：{e}")))?;
    let source_hash = hash_reader(&mut input)?;
    input
        .seek(SeekFrom::Start(0))
        .map_err(|e| AppError::new("LOCAL_TRASH_FAILED", e.to_string()))?;
    let mut output = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&destination)
        .map_err(|e| AppError::new("LOCAL_TRASH_FAILED", format!("无法创建回收站副本：{e}")))?;
    if let Err(error) = std::io::copy(&mut input, &mut output).and_then(|_| output.sync_all()) {
        let _ = fs::remove_file(&destination);
        return Err(AppError::new(
            "LOCAL_TRASH_FAILED",
            format!("复制文件到回收站失败：{error}"),
        ));
    }
    if hash_file(&destination)? != source_hash {
        let _ = fs::remove_file(&destination);
        return Err(AppError::retryable(
            "LOCAL_FILE_CHANGED",
            "文件在移入回收站期间发生变化",
        ));
    }
    fs::remove_file(source).map_err(|e| {
        AppError::new(
            "LOCAL_TRASH_FAILED",
            format!("回收站副本已创建，但无法移除原文件：{e}"),
        )
    })?;
    Ok(destination)
}

pub fn unique_conflict_path(original: &str, device_name: &str) -> AppResult<String> {
    let normalized = validate_relative_path(original)?;
    let source = Path::new(&normalized);
    let parent = source.parent().unwrap_or_else(|| Path::new(""));
    let stem = source
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("file");
    let extension = source
        .extension()
        .and_then(|s| s.to_str())
        .map(|e| format!(".{e}"))
        .unwrap_or_default();
    let safe_device = device_name
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .take(24)
        .collect::<String>();
    let name = format!(
        "{stem}.conflict-{}-{}-{:.6}{extension}",
        if safe_device.is_empty() {
            "device"
        } else {
            &safe_device
        },
        chrono::Utc::now().format("%Y%m%dT%H%M%SZ"),
        uuid::Uuid::new_v4().simple()
    );
    let path = parent.join(name).to_string_lossy().replace('\\', "/");
    validate_relative_path(&path)
}

pub fn copy_create_new(source: &Path, destination: &Path) -> AppResult<()> {
    let mut input = File::open(source)?;
    let mut output = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(destination)
        .map_err(|e| AppError::new("CONFLICT_COPY_FAILED", format!("无法创建唯一冲突副本：{e}")))?;
    if let Err(error) = std::io::copy(&mut input, &mut output)
        .and_then(|_| output.flush())
        .and_then(|_| output.sync_all())
    {
        drop(output);
        let _ = fs::remove_file(destination);
        return Err(AppError::new(
            "CONFLICT_COPY_FAILED",
            format!("冲突副本写入失败：{error}"),
        ));
    }
    Ok(())
}

pub fn copy_to_trash(
    data_dir: &Path,
    root_id: &str,
    relative_path: &str,
    label: &str,
    source: &Path,
) -> AppResult<PathBuf> {
    let safe_relative = validate_relative_path(relative_path)?;
    let safe_label = label
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .take(48)
        .collect::<String>();
    let destination = data_dir
        .join("trash")
        .join(root_id)
        .join(format!(
            "{}-{}",
            crate::security::unix_ms(),
            uuid::Uuid::new_v4().simple()
        ))
        .join(if safe_label.is_empty() {
            "backup"
        } else {
            &safe_label
        })
        .join(safe_relative);
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent)?;
    }
    let source_hash = hash_file(source)?;
    copy_create_new(source, &destination)?;
    if hash_file(&destination)? != source_hash {
        let _ = fs::remove_file(&destination);
        return Err(AppError::retryable(
            "LOCAL_FILE_CHANGED",
            "文件在备份到回收站期间发生变化",
        ));
    }
    Ok(destination)
}

#[cfg(test)]
mod rule_tests {
    use super::*;
    use crate::domain::RuleType;

    fn rule(kind: RuleType, pattern: &str) -> SyncRuleDto {
        SyncRuleDto {
            id: None,
            rule_type: kind,
            pattern: pattern.into(),
            enabled: true,
            priority: 0,
        }
    }

    #[test]
    fn exclusion_of_directories_applies_to_files_at_any_depth() {
        for pattern in ["**/node_modules/**", "node_modules"] {
            let engine = RuleEngine::compile(&[rule(RuleType::Exclude, pattern)]).unwrap();
            assert!(!engine.includes("node_modules/package/index.js"));
        }
        let engine = RuleEngine::compile(&[rule(RuleType::Exclude, "**/node_modules/**")]).unwrap();
        assert!(!engine.includes("apps/web/node_modules/package/index.js"));
        assert!(engine.includes("apps/web/src/index.js"));
    }

    #[test]
    fn selective_rules_include_root_and_nested_documents_but_exclude_dependencies() {
        let engine = RuleEngine::compile(&[
            rule(RuleType::Include, "**/*.md"),
            rule(RuleType::Exclude, "**/node_modules/**"),
        ])
        .unwrap();
        assert!(engine.includes("README.md"));
        assert!(engine.includes("docs/guide.md"));
        assert!(!engine.includes("src/main.rs"));
        assert!(!engine.includes("node_modules/pkg/README.md"));
        assert!(!engine.includes(".projectsync/state.md"));
    }
}
