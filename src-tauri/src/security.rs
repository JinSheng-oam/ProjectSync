use crate::domain::{AppError, AppResult};
use std::{
    path::{Component, Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
use url::Url;

pub fn validate_webdav_url(value: &str) -> AppResult<Url> {
    let parsed = Url::parse(value.trim())
        .map_err(|_| AppError::new("DAV_URL_INVALID", "WebDAV URL 格式无效"))?;
    if !matches!(parsed.scheme(), "http" | "https")
        || parsed.host_str().is_none()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.query().is_some()
        || parsed.fragment().is_some()
    {
        return Err(AppError::new(
            "DAV_URL_INVALID",
            "WebDAV URL 必须是无凭据、无查询参数的 HTTP(S) 地址",
        ));
    }
    Ok(parsed)
}

pub fn normalize_remote_path(value: &str) -> AppResult<String> {
    let trimmed = value.trim();
    if trimmed.is_empty()
        || trimmed.contains('\\')
        || trimmed.chars().any(|c| c == '\0' || c.is_control())
    {
        return Err(AppError::new(
            "REMOTE_PATH_INVALID",
            "远端路径为空或包含控制字符",
        ));
    }
    let mut parts = Vec::new();
    for part in trimmed.split('/').filter(|p| !p.is_empty()) {
        validate_path_segment(part, true)?;
        parts.push(part.to_owned());
    }
    if parts.is_empty() {
        return Ok("/".to_owned());
    }
    Ok(format!("/{}", parts.join("/")))
}

pub fn validate_relative_path(value: &str) -> AppResult<String> {
    if value.is_empty()
        || value.starts_with('/')
        || value.starts_with('\\')
        || value.contains(':')
        || value.contains('\\')
        || value.chars().any(|c| c == '\0' || c.is_control())
    {
        return Err(AppError::new("LOCAL_PATH_INVALID", "相对路径格式无效"));
    }
    let mut parts = Vec::new();
    for part in value.split('/') {
        if part.is_empty() || part == "." || part == ".." {
            return Err(AppError::new(
                "LOCAL_PATH_INVALID",
                "相对路径包含非法目录段",
            ));
        }
        validate_path_segment(part, false)?;
        if part.eq_ignore_ascii_case(".projectsync") {
            return Err(AppError::new(
                "LOCAL_PATH_INVALID",
                "同步元数据目录不能作为普通同步文件",
            ));
        }
        parts.push(part);
    }
    Ok(parts.join("/"))
}

fn validate_path_segment(part: &str, remote: bool) -> AppResult<()> {
    if part.is_empty()
        || part == "."
        || part == ".."
        || part.ends_with('.')
        || part.ends_with(' ')
        || part
            .chars()
            .any(|c| c.is_control() || "<>:\"|?*".contains(c))
        || (remote && part.contains('\\'))
    {
        return Err(AppError::new(
            "LOCAL_PATH_INVALID",
            "路径包含 Windows 不支持或不安全的名称",
        ));
    }
    let stem = part.split('.').next().unwrap_or(part).to_ascii_uppercase();
    if matches!(
        stem.as_str(),
        "CON"
            | "PRN"
            | "AUX"
            | "NUL"
            | "COM1"
            | "COM2"
            | "COM3"
            | "COM4"
            | "COM5"
            | "COM6"
            | "COM7"
            | "COM8"
            | "COM9"
            | "LPT1"
            | "LPT2"
            | "LPT3"
            | "LPT4"
            | "LPT5"
            | "LPT6"
            | "LPT7"
            | "LPT8"
            | "LPT9"
    ) {
        return Err(AppError::new(
            "LOCAL_PATH_INVALID",
            "路径使用了 Windows 保留设备名",
        ));
    }
    Ok(())
}

pub fn path_key(relative_path: &str) -> String {
    relative_path.chars().flat_map(char::to_lowercase).collect()
}

pub fn resolve_local_path(root: &Path, relative_path: &str) -> AppResult<PathBuf> {
    let normalized = validate_relative_path(relative_path)?;
    let mut out = root.to_path_buf();
    for component in Path::new(&normalized).components() {
        match component {
            Component::Normal(part) => out.push(part),
            _ => return Err(AppError::new("LOCAL_PATH_INVALID", "路径越过了同步根目录")),
        }
    }
    Ok(out)
}

pub fn unix_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis().min(i64::MAX as u128) as i64)
        .unwrap_or_default()
}
