use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::PathBuf;
use thiserror::Error;

#[derive(Debug, Error)]
#[error("{message}")]
pub struct AppError {
    pub code: String,
    pub message: String,
    pub retryable: bool,
    pub details: Option<Value>,
}

pub type AppResult<T> = Result<T, AppError>;

impl AppError {
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            retryable: false,
            details: None,
        }
    }

    pub fn retryable(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            retryable: true,
            details: None,
        }
    }

    pub fn with_details(mut self, details: Value) -> Self {
        self.details = Some(details);
        self
    }
}

impl From<sqlx::Error> for AppError {
    fn from(error: sqlx::Error) -> Self {
        tracing::error!(error = %error, "database operation failed");
        Self::new("DATABASE_ERROR", "本地数据库操作失败")
    }
}

impl From<std::io::Error> for AppError {
    fn from(error: std::io::Error) -> Self {
        let code = if error.kind() == std::io::ErrorKind::PermissionDenied {
            "LOCAL_PERMISSION_DENIED"
        } else if error.kind() == std::io::ErrorKind::NotFound {
            "LOCAL_NOT_FOUND"
        } else {
            "LOCAL_IO_ERROR"
        };
        Self::new(code, "本地文件操作失败")
            .with_details(serde_json::json!({"kind": format!("{:?}", error.kind())}))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiError {
    pub code: String,
    pub message: String,
    pub retryable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<Value>,
}

impl From<AppError> for ApiError {
    fn from(error: AppError) -> Self {
        Self {
            code: error.code,
            message: error.message,
            retryable: error.retryable,
            details: error.details,
        }
    }
}

pub type ApiResult<T> = Result<T, ApiError>;

pub fn api<T>(result: AppResult<T>) -> ApiResult<T> {
    result.map_err(Into::into)
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RuleType {
    Include,
    Exclude,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncRuleDto {
    pub id: Option<i64>,
    pub rule_type: RuleType,
    pub pattern: String,
    pub enabled: bool,
    pub priority: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebDavCapabilities {
    pub server_header: String,
    pub etag_type: String,
    pub supports_if_match: bool,
    pub supports_if_none_match: bool,
    pub supports_lock: bool,
    pub propfind_depth1_supported: bool,
    pub safe_create_only: bool,
    pub safe_update_existing: bool,
    pub safe_delete: bool,
    pub safe_move_no_overwrite: bool,
    #[serde(default)]
    pub safe_move_if_match: bool,
    pub probe_cleanup_warning: Option<String>,
    pub tested_at: i64,
}

impl WebDavCapabilities {
    pub fn supports_remote_trash(&self) -> bool {
        self.safe_move_no_overwrite && self.safe_move_if_match && self.safe_update_existing
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebDavAccountDto {
    pub id: String,
    pub name: String,
    pub url: String,
    pub username: String,
    pub credential_ref: String,
    pub tls_verify: bool,
    pub capabilities: Option<WebDavCapabilities>,
    pub last_connected_at: Option<i64>,
    pub status: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebDavAccountInput {
    pub name: String,
    pub url: String,
    pub username: String,
    pub password: String,
    pub tls_verify: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncRootDto {
    pub id: String,
    pub remote_project_id: String,
    pub name: String,
    pub account_id: String,
    pub local_path: String,
    pub remote_path: String,
    pub enabled: bool,
    pub exclude_git_tracked: bool,
    pub status: String,
    pub poll_interval_seconds: u32,
    pub debounce_ms: u32,
    pub last_sync_at: Option<i64>,
    pub file_count: Option<u64>,
    pub pending_changes: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncSummaryDto {
    pub root_id: String,
    pub uploaded: u64,
    pub downloaded: u64,
    pub skipped: u64,
    pub conflicts: u64,
    pub blocked: u64,
    pub failed: u64,
    pub started_at: i64,
    pub finished_at: Option<i64>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum SyncAction {
    UploadNew,
    UploadUpdate,
    DownloadNew,
    DownloadUpdate,
    MoveRemoteToTrash,
    MoveLocalToTrash,
    CreateConflictCopy,
    AiMerge,
    MarkClean,
    Skip,
    Blocked,
}

impl SyncAction {
    pub fn as_db(&self) -> &'static str {
        match self {
            Self::UploadNew => "UPLOAD_NEW",
            Self::UploadUpdate => "UPLOAD_UPDATE",
            Self::DownloadNew => "DOWNLOAD_NEW",
            Self::DownloadUpdate => "DOWNLOAD_UPDATE",
            Self::MoveRemoteToTrash => "MOVE_REMOTE_TO_TRASH",
            Self::MoveLocalToTrash => "MOVE_LOCAL_TO_TRASH",
            Self::CreateConflictCopy => "CREATE_CONFLICT_COPY",
            Self::AiMerge => "AI_MERGE",
            Self::MarkClean => "MARK_CLEAN",
            Self::Skip => "SKIP",
            Self::Blocked => "BLOCKED",
        }
    }

    pub fn from_db(value: &str) -> Self {
        match value {
            "UPLOAD_NEW" => Self::UploadNew,
            "UPLOAD_UPDATE" => Self::UploadUpdate,
            "DOWNLOAD_NEW" => Self::DownloadNew,
            "DOWNLOAD_UPDATE" => Self::DownloadUpdate,
            "MOVE_REMOTE_TO_TRASH" => Self::MoveRemoteToTrash,
            "MOVE_LOCAL_TO_TRASH" => Self::MoveLocalToTrash,
            "CREATE_CONFLICT_COPY" => Self::CreateConflictCopy,
            "AI_MERGE" => Self::AiMerge,
            "MARK_CLEAN" => Self::MarkClean,
            "BLOCKED" => Self::Blocked,
            _ => Self::Skip,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum ConflictType {
    ConcurrentModification,
    InitialSyncDifferent,
    LocalDeleteRemoteModified,
    RemoteDeleteLocalModified,
    CaseCollision,
}

impl ConflictType {
    pub fn as_db(&self) -> &'static str {
        match self {
            Self::ConcurrentModification => "CONCURRENT_MODIFICATION",
            Self::InitialSyncDifferent => "INITIAL_SYNC_DIFFERENT",
            Self::LocalDeleteRemoteModified => "LOCAL_DELETE_REMOTE_MODIFIED",
            Self::RemoteDeleteLocalModified => "REMOTE_DELETE_LOCAL_MODIFIED",
            Self::CaseCollision => "CASE_COLLISION",
        }
    }
    pub fn from_db(value: &str) -> Self {
        match value {
            "INITIAL_SYNC_DIFFERENT" => Self::InitialSyncDifferent,
            "LOCAL_DELETE_REMOTE_MODIFIED" => Self::LocalDeleteRemoteModified,
            "REMOTE_DELETE_LOCAL_MODIFIED" => Self::RemoteDeleteLocalModified,
            "CASE_COLLISION" => Self::CaseCollision,
            _ => Self::ConcurrentModification,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[allow(clippy::enum_variant_names)]
pub enum ConflictResolution {
    KeepLocal,
    KeepRemote,
    KeepBoth,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum TaskStatus {
    Pending,
    Running,
    RetryWait,
    Succeeded,
    Failed,
    Blocked,
    Cancelled,
}

impl TaskStatus {
    pub fn as_db(&self) -> &'static str {
        match self {
            Self::Pending => "PENDING",
            Self::Running => "RUNNING",
            Self::RetryWait => "RETRY_WAIT",
            Self::Succeeded => "SUCCEEDED",
            Self::Failed => "FAILED",
            Self::Blocked => "BLOCKED",
            Self::Cancelled => "CANCELLED",
        }
    }
    pub fn from_db(value: &str) -> Self {
        match value {
            "RUNNING" => Self::Running,
            "RETRY_WAIT" => Self::RetryWait,
            "SUCCEEDED" => Self::Succeeded,
            "FAILED" => Self::Failed,
            "BLOCKED" => Self::Blocked,
            "CANCELLED" => Self::Cancelled,
            _ => Self::Pending,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskDto {
    pub id: String,
    pub root_id: String,
    pub path: String,
    pub action: SyncAction,
    pub status: TaskStatus,
    pub bytes_transferred: u64,
    pub total_bytes: u64,
    pub error: Option<String>,
    pub error_code: Option<String>,
    pub retries: u32,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncFileItemDto {
    pub relative_path: String,
    pub status: String,
    pub size_bytes: u64,
    pub local_modified_at: i64,
    pub remote_modified_at: Option<i64>,
    pub blake3_hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InitialSyncPreviewDto {
    pub root_id: String,
    pub uploads_count: u64,
    pub downloads_count: u64,
    pub identical_count: u64,
    pub conflicts_count: u64,
    pub blocked_count: u64,
    pub total_upload_bytes: u64,
    pub total_download_bytes: u64,
    pub items: Vec<PreviewItemDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewItemDto {
    pub relative_path: String,
    pub action: SyncAction,
    pub size_bytes: u64,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConflictItemDto {
    pub has_local_version: bool,
    pub has_remote_version: bool,
    pub id: String,
    pub root_id: String,
    pub relative_path: String,
    pub conflict_type: ConflictType,
    pub status: String,
    pub detected_at: i64,
    pub base_version: Option<FileVersionDto>,
    pub local_version: FileVersionDto,
    pub remote_version: RemoteVersionDto,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileVersionDto {
    pub blake3_hash: String,
    pub size_bytes: u64,
    pub modified_at: i64,
    pub device_id: String,
    pub author_device: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteVersionDto {
    pub etag: String,
    pub size_bytes: u64,
    pub modified_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiMergePreviewDto {
    pub preview_id: String,
    pub conflict_id: String,
    pub relative_path: String,
    pub merged_content: String,
    #[serde(default)]
    pub local_content: Option<String>,
    #[serde(default)]
    pub remote_content: Option<String>,
    #[serde(default)]
    pub suggestions: Option<String>,
    pub local_size: u64,
    pub remote_size: u64,
    pub model: String,
    pub created_at: i64,
    pub expires_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryItemDto {
    pub id: String,
    pub root_id: String,
    pub project_name: String,
    pub relative_path: String,
    pub action: SyncAction,
    pub status: String,
    pub bytes: u64,
    pub timestamp: i64,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
}

pub struct HistoryEntry<'a> {
    pub root_id: &'a str,
    pub task_id: Option<&'a str>,
    pub path: &'a str,
    pub action: &'a SyncAction,
    pub status: &'a str,
    pub bytes: u64,
    pub duration_ms: u64,
    pub error: Option<(&'a str, &'a str)>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncStatusDto {
    pub root_id: String,
    pub status: String,
    pub pending_tasks: u64,
    pub unresolved_conflicts: u64,
    pub last_sync_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuleImpactDto {
    pub newly_included: Vec<String>,
    pub newly_excluded: Vec<String>,
    pub unchanged: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettingsDto {
    pub ignore_remote_delete_warnings: bool,
    pub device_id: String,
    pub device_name: String,
    pub poll_interval_seconds: u32,
    pub debounce_ms: u32,
    pub auto_start: bool,
    pub start_minimized: bool,
    pub retry_limit: u32,
}

#[derive(Debug, Clone)]
pub struct AccountRecord {
    pub id: String,
    pub name: String,
    pub url: String,
    pub username: String,
    pub credential_ref: String,
    pub tls_verify: bool,
    pub capabilities: Option<WebDavCapabilities>,
    pub last_connected_at: Option<i64>,
    pub status: String,
}

impl From<AccountRecord> for WebDavAccountDto {
    fn from(value: AccountRecord) -> Self {
        Self {
            id: value.id,
            name: value.name,
            url: value.url,
            username: value.username,
            credential_ref: value.credential_ref,
            tls_verify: value.tls_verify,
            capabilities: value.capabilities,
            last_connected_at: value.last_connected_at,
            status: value.status,
        }
    }
}

#[derive(Debug, Clone)]
pub struct RootRecord {
    pub id: String,
    pub remote_project_id: String,
    pub name: String,
    pub account_id: String,
    pub local_path: PathBuf,
    pub remote_path: String,
    pub enabled: bool,
    pub exclude_git_tracked: bool,
    pub status: String,
    pub poll_interval_seconds: u32,
    pub debounce_ms: u32,
    pub max_parallel_transfers: u32,
    pub last_sync_at: Option<i64>,
    pub initial_sync_completed: bool,
    pub initial_sync_confirmed: bool,
}

#[derive(Debug, Clone)]
pub struct LocalEntry {
    pub relative_path: String,
    pub path_key: String,
    pub absolute_path: PathBuf,
    pub hash: String,
    pub size: u64,
    pub mtime_ns: i64,
}

#[derive(Debug, Clone)]
pub struct RemoteEntry {
    pub relative_path: String,
    pub path_key: String,
    pub hash: String,
    pub size: u64,
    pub modified_at: i64,
    pub etag: Option<String>,
    pub is_collection: bool,
}

#[derive(Debug, Clone)]
pub struct BaselineEntry {
    pub relative_path: String,
    pub path_key: String,
    pub baseline_state: String,
    pub sync_state: String,
    pub base_hash: Option<String>,
    pub base_size: u64,
    pub base_mtime_ms: i64,
    pub local_exists: bool,
    pub local_hash: Option<String>,
    pub remote_exists: bool,
    pub remote_hash: Option<String>,
    pub remote_etag: Option<String>,
    pub local_size: u64,
    pub remote_size: u64,
    pub local_mtime_ns: i64,
    pub remote_mtime_ms: i64,
}

#[derive(Debug, Clone)]
pub struct PlannedAction {
    pub path: String,
    pub action: SyncAction,
    pub conflict: Option<ConflictType>,
    pub local: Option<LocalEntry>,
    pub remote: Option<RemoteEntry>,
    pub expected_remote_etag: Option<String>,
    pub reason: String,
}
