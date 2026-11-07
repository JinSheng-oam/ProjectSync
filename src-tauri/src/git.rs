use crate::{
    domain::{AppError, AppResult},
    security::path_key,
};
use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
    process::{Command, Output},
};

pub fn tracked_paths(sync_root: &Path) -> AppResult<HashSet<String>> {
    let sync_root = fs::canonicalize(sync_root)
        .map_err(|error| AppError::new("LOCAL_ROOT_INVALID", error.to_string()))?;
    let top_level = run_git(&sync_root, &["rev-parse", "--show-toplevel"])?;
    if !top_level.status.success() {
        let message = String::from_utf8_lossy(&top_level.stderr).to_lowercase();
        if message.contains("not a git repository") {
            return Ok(HashSet::new());
        }
        return Err(git_error("无法定位本地 Git 仓库", &top_level));
    }

    let top_level_path = String::from_utf8_lossy(&top_level.stdout);
    let repository_root = fs::canonicalize(top_level_path.trim())
        .map_err(|error| AppError::new("GIT_SCAN_FAILED", error.to_string()))?;
    let root_prefix = sync_root
        .strip_prefix(&repository_root)
        .map_err(|_| AppError::new("GIT_SCAN_FAILED", "同步目录不在 Git 仓库目录内"))?;
    let prefix = root_prefix
        .components()
        .map(|component| component.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/");
    let prefix = if prefix.is_empty() {
        String::new()
    } else {
        format!("{prefix}/")
    };

    let output = run_git(&sync_root, &["ls-files", "--cached", "--full-name", "-z"])?;
    if !output.status.success() {
        return Err(git_error("无法读取 Git 已跟踪文件列表", &output));
    }

    let mut tracked = HashSet::new();
    for path in output.stdout.split(|byte| *byte == 0).filter(|path| !path.is_empty()) {
        let path = String::from_utf8_lossy(path);
        let Some(relative) = path.strip_prefix(&prefix) else {
            continue;
        };
        if !relative.is_empty() {
            tracked.insert(path_key(relative));
        }
    }
    Ok(tracked)
}

fn run_git(root: &Path, args: &[&str]) -> AppResult<Output> {
    Command::new("git")
        .arg("-C")
        .arg(git_compatible_path(root))
        .args(args)
        .output()
        .map_err(|error| {
            AppError::new(
                "GIT_UNAVAILABLE",
                format!("无法启动 Git；请安装 Git 或关闭 Git 跟踪文件排除选项：{error}"),
            )
        })
}

#[cfg(windows)]
fn git_compatible_path(path: &Path) -> PathBuf {
    let path = path.to_string_lossy();
    if let Some(rest) = path.strip_prefix("\\\\?\\UNC\\") {
        PathBuf::from(format!("\\\\{rest}"))
    } else if let Some(rest) = path.strip_prefix("\\\\?\\") {
        PathBuf::from(rest)
    } else {
        PathBuf::from(path.as_ref())
    }
}

#[cfg(not(windows))]
fn git_compatible_path(path: &Path) -> PathBuf {
    path.to_path_buf()
}

fn git_error(context: &str, output: &Output) -> AppError {
    let detail = String::from_utf8_lossy(&output.stderr);
    AppError::new("GIT_SCAN_FAILED", format!("{context}：{}", detail.trim()))
}
