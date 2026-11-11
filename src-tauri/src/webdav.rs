mod capabilities;
mod multistatus;

use multistatus::{parse_multistatus, percent_decode};

use crate::{
    domain::{AppError, AppResult, WebDavCapabilities},
    security::{normalize_remote_path, unix_ms, validate_webdav_url},
};
use futures_util::StreamExt;
use quick_xml::{events::Event, Reader};
use reqwest::{
    header::{HeaderMap, HeaderName, HeaderValue, ACCEPT, CONTENT_LENGTH, CONTENT_TYPE},
    Method, Response, StatusCode,
};
use serde::Serialize;
use std::{path::Path, str::FromStr, sync::Arc};
use tokio::{fs::File, io::AsyncWriteExt};
use tokio_util::io::ReaderStream;
use url::Url;
use zeroize::Zeroizing;

const PROPFIND_BODY: &str = r#"<?xml version="1.0" encoding="utf-8" ?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getcontentlength/><d:getlastmodified/><d:getetag/></d:prop></d:propfind>"#;
const EXCLUSIVE_LOCK_BODY: &str = r#"<?xml version="1.0" encoding="utf-8"?><d:lockinfo xmlns:d="DAV:"><d:lockscope><d:exclusive/></d:lockscope><d:locktype><d:write/></d:locktype><d:owner>ProjectSync</d:owner></d:lockinfo>"#;

#[derive(Debug, Clone, Serialize)]
pub struct DavEntry {
    pub path: String,
    pub size: u64,
    pub modified_at: i64,
    pub etag: Option<String>,
    pub is_collection: bool,
}

#[derive(Clone)]
pub struct WebDavClient {
    base_url: Url,
    username: String,
    password: Zeroizing<String>,
    client: reqwest::Client,
}

impl WebDavClient {
    pub fn new(
        base_url: &str,
        username: &str,
        password: String,
        tls_verify: bool,
    ) -> AppResult<Self> {
        let password = Zeroizing::new(password);
        let base_url = validate_webdav_url(base_url)?;
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .danger_accept_invalid_certs(!tls_verify)
            .connect_timeout(std::time::Duration::from_secs(15))
            .timeout(std::time::Duration::from_secs(120))
            .build()
            .map_err(|e| AppError::new("DAV_CLIENT_INIT_FAILED", e.to_string()))?;
        Ok(Self {
            base_url,
            username: username.to_owned(),
            password,
            client,
        })
    }

    pub fn url_for(&self, remote_path: &str) -> AppResult<Url> {
        let normalized = normalize_remote_path(remote_path)?;
        let mut url = self.base_url.clone();
        {
            let mut segments = url
                .path_segments_mut()
                .map_err(|_| AppError::new("DAV_URL_INVALID", "WebDAV URL 不支持路径拼接"))?;
            segments.pop_if_empty();
            for segment in normalized.split('/').filter(|s| !s.is_empty()) {
                segments.push(segment);
            }
        }
        Ok(url)
    }

    fn dav_path_for_href(&self, href: &str, request_url: &Url) -> AppResult<String> {
        let resolved = request_url
            .join(href)
            .map_err(|_| AppError::new("DAV_INVALID_RESPONSE", "PROPFIND 返回了无效 href"))?;
        if resolved.scheme() != self.base_url.scheme()
            || resolved.host_str() != self.base_url.host_str()
            || resolved.port_or_known_default() != self.base_url.port_or_known_default()
        {
            return Err(AppError::new(
                "DAV_INVALID_RESPONSE",
                "PROPFIND href 指向了 WebDAV 服务之外",
            ));
        }
        let href_decoded = percent_decode(resolved.path());
        let base_decoded = percent_decode(self.base_url.path());
        let base_prefix = format!("{}/", base_decoded.trim_end_matches('/'));
        let dav = if href_decoded == base_decoded.trim_end_matches('/') {
            "/".to_owned()
        } else if let Some(rest) = href_decoded.strip_prefix(&base_prefix) {
            format!("/{rest}")
        } else {
            return Err(AppError::new(
                "DAV_INVALID_RESPONSE",
                "PROPFIND href 越过了 WebDAV URL 根路径",
            ));
        };
        normalize_remote_path(&dav)
    }

    async fn send(
        &self,
        method: Method,
        url: Url,
        headers: HeaderMap,
        body: Option<reqwest::Body>,
    ) -> AppResult<Response> {
        let mut request = self
            .client
            .request(method, url)
            .basic_auth(&self.username, Some(self.password.as_str()))
            .headers(headers);
        if let Some(body) = body {
            request = request.body(body);
        }
        let response = request.send().await.map_err(|e| {
            tracing::warn!(error=%e, "WebDAV request failed");
            AppError::retryable("DAV_CONNECTION_FAILED", "无法连接 WebDAV 服务")
        })?;
        if response.status().is_redirection() {
            return Err(AppError::new(
                "DAV_REDIRECT_BLOCKED",
                "WebDAV 服务返回重定向；请检查配置的服务 URL",
            ));
        }
        Ok(response)
    }

    fn check_status(status: StatusCode, operation: &str) -> AppResult<()> {
        if status.is_success() {
            return Ok(());
        }
        let (code, retryable) = match status {
            StatusCode::UNAUTHORIZED => ("DAV_AUTH_FAILED", false),
            StatusCode::FORBIDDEN => ("DAV_PERMISSION_DENIED", false),
            StatusCode::NOT_FOUND => ("DAV_NOT_FOUND", false),
            StatusCode::CONFLICT => ("DAV_CONFLICT", false),
            StatusCode::PRECONDITION_FAILED => ("DAV_PRECONDITION_FAILED", true),
            StatusCode::LOCKED => ("DAV_LOCKED", true),
            StatusCode::METHOD_NOT_ALLOWED | StatusCode::NOT_IMPLEMENTED => {
                ("DAV_UNSUPPORTED", false)
            }
            s if s.is_server_error() => ("DAV_CONNECTION_FAILED", true),
            _ => ("DAV_REQUEST_FAILED", false),
        };
        Err(AppError {
            code: code.to_owned(),
            message: format!("WebDAV {operation} 失败（HTTP {}）", status.as_u16()),
            retryable,
            details: Some(serde_json::json!({"httpStatus":status.as_u16()})),
        })
    }

    async fn response_bytes(response: Response, operation: &str) -> AppResult<Vec<u8>> {
        let status = response.status();
        Self::check_status(status, operation)?;
        response
            .bytes()
            .await
            .map(|b| b.to_vec())
            .map_err(|_| AppError::retryable("DAV_CONNECTION_FAILED", "读取 WebDAV 响应失败"))
    }

    pub async fn options_header(&self) -> AppResult<(String, bool)> {
        let response = self
            .send(Method::OPTIONS, self.url_for("/")?, HeaderMap::new(), None)
            .await?;
        if !response.status().is_success() && response.status() != StatusCode::METHOD_NOT_ALLOWED {
            Self::check_status(response.status(), "OPTIONS")?;
        }
        let server = response
            .headers()
            .get("server")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("unknown")
            .to_owned();
        let allow = response
            .headers()
            .get("allow")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_ascii_uppercase();
        Ok((server, allow.contains("PROPFIND")))
    }

    pub async fn propfind(&self, path: &str, depth: u8) -> AppResult<Vec<DavEntry>> {
        let url = self.url_for(path)?;
        let mut headers = HeaderMap::new();
        headers.insert(
            HeaderName::from_static("depth"),
            HeaderValue::from_str(&depth.min(1).to_string())
                .map_err(|e| AppError::new("DAV_REQUEST_FAILED", e.to_string()))?,
        );
        headers.insert(
            CONTENT_TYPE,
            HeaderValue::from_static("application/xml; charset=utf-8"),
        );
        headers.insert(
            ACCEPT,
            HeaderValue::from_static("application/xml, text/xml"),
        );
        let response = self
            .send(
                Method::from_bytes(b"PROPFIND")
                    .map_err(|e| AppError::new("DAV_CLIENT_INIT_FAILED", e.to_string()))?,
                url.clone(),
                headers,
                Some(PROPFIND_BODY.into()),
            )
            .await?;
        let status = response.status();
        let body = Self::response_bytes(response, "PROPFIND").await?;
        if status != StatusCode::MULTI_STATUS && !status.is_success() {
            Self::check_status(status, "PROPFIND")?;
        }
        parse_multistatus(&body, &self.base_url, &url)
    }

    pub async fn get_to_file(&self, path: &str, destination: &Path) -> AppResult<u64> {
        self.get_to_file_with_progress(path, destination, None)
            .await
    }

    pub async fn get_to_file_with_progress(
        &self,
        path: &str,
        destination: &Path,
        progress: Option<Arc<dyn Fn(u64) + Send + Sync>>,
    ) -> AppResult<u64> {
        let response = self
            .send(Method::GET, self.url_for(path)?, HeaderMap::new(), None)
            .await?;
        let status = response.status();
        Self::check_status(status, "GET")?;
        let mut stream = response.bytes_stream();
        let mut file = File::create(destination)
            .await
            .map_err(|e| AppError::new("LOCAL_STAGING_FAILED", e.to_string()))?;
        let mut total = 0_u64;
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|_| {
                AppError::retryable("DAV_CONNECTION_FAILED", "读取 WebDAV 文件流失败")
            })?;
            file.write_all(&chunk)
                .await
                .map_err(|e| AppError::new("LOCAL_STAGING_FAILED", e.to_string()))?;
            total = total.saturating_add(chunk.len() as u64);
            if let Some(progress) = &progress {
                progress(total);
            }
        }
        file.flush()
            .await
            .map_err(|e| AppError::new("LOCAL_STAGING_FAILED", e.to_string()))?;
        file.sync_all()
            .await
            .map_err(|e| AppError::new("LOCAL_STAGING_FAILED", e.to_string()))?;
        Ok(total)
    }

    pub async fn get_bytes(&self, path: &str) -> AppResult<Vec<u8>> {
        let response = self
            .send(Method::GET, self.url_for(path)?, HeaderMap::new(), None)
            .await?;
        Self::response_bytes(response, "GET").await
    }

    pub async fn put_file(
        &self,
        source: &Path,
        destination: &str,
        condition: PutCondition,
    ) -> AppResult<()> {
        self.put_file_inner(source, destination, condition, None, None)
            .await
    }

    pub async fn put_file_with_progress(
        &self,
        source: &Path,
        destination: &str,
        condition: PutCondition,
        progress: Arc<dyn Fn(u64) + Send + Sync>,
    ) -> AppResult<()> {
        self.put_file_inner(source, destination, condition, None, Some(progress))
            .await
    }

    pub async fn put_file_with_lock_token(
        &self,
        source: &Path,
        destination: &str,
        condition: PutCondition,
        lock_token: &str,
    ) -> AppResult<()> {
        self.put_file_inner(source, destination, condition, Some(lock_token), None)
            .await
    }

    pub async fn put_file_with_lock_token_and_progress(
        &self,
        source: &Path,
        destination: &str,
        condition: PutCondition,
        lock_token: &str,
        progress: Arc<dyn Fn(u64) + Send + Sync>,
    ) -> AppResult<()> {
        self.put_file_inner(
            source,
            destination,
            condition,
            Some(lock_token),
            Some(progress),
        )
        .await
    }

    async fn put_file_inner(
        &self,
        source: &Path,
        destination: &str,
        condition: PutCondition,
        lock_token: Option<&str>,
        progress: Option<Arc<dyn Fn(u64) + Send + Sync>>,
    ) -> AppResult<()> {
        let meta = tokio::fs::metadata(source)
            .await
            .map_err(|e| AppError::new("LOCAL_FILE_READ", e.to_string()))?;
        let file = tokio::fs::File::open(source)
            .await
            .map_err(|e| AppError::new("LOCAL_FILE_READ", e.to_string()))?;
        let mut transferred = 0_u64;
        let stream = ReaderStream::new(file).map(move |chunk| {
            if let Ok(bytes) = &chunk {
                transferred = transferred.saturating_add(bytes.len() as u64);
                if let Some(progress) = &progress {
                    progress(transferred);
                }
            }
            chunk
        });
        let body = reqwest::Body::wrap_stream(stream);
        let mut headers = HeaderMap::new();
        headers.insert(
            CONTENT_LENGTH,
            HeaderValue::from_str(&meta.len().to_string())
                .map_err(|e| AppError::new("DAV_REQUEST_FAILED", e.to_string()))?,
        );
        match condition {
            PutCondition::CreateOnly => {
                headers.insert(
                    HeaderName::from_static("if-none-match"),
                    HeaderValue::from_static("*"),
                );
            }
            PutCondition::IfMatch(etag) => {
                headers.insert(
                    HeaderName::from_static("if-match"),
                    HeaderValue::from_str(&etag)
                        .map_err(|_| AppError::new("DAV_ETAG_INVALID", "远端 ETag 格式无效"))?,
                );
            }
            PutCondition::Unconditional => {}
        }
        if let Some(token) = lock_token {
            headers.insert(
                HeaderName::from_static("if"),
                HeaderValue::from_str(&format!("(<{token}>)")).map_err(|_| {
                    AppError::new("DAV_LOCK_TOKEN_INVALID", "WebDAV 锁令牌格式无效")
                })?,
            );
        }
        let response = self
            .send(Method::PUT, self.url_for(destination)?, headers, Some(body))
            .await?;
        Self::check_status(response.status(), "PUT")
    }

    pub async fn mkcol(&self, path: &str) -> AppResult<()> {
        let response = self
            .send(
                Method::from_bytes(b"MKCOL")
                    .map_err(|e| AppError::new("DAV_CLIENT_INIT_FAILED", e.to_string()))?,
                self.url_for(path)?,
                HeaderMap::new(),
                None,
            )
            .await?;
        if response.status() == StatusCode::METHOD_NOT_ALLOWED
            || response.status() == StatusCode::CONFLICT
        {
            return Ok(());
        }
        Self::check_status(response.status(), "MKCOL")
    }

    pub async fn ensure_collection(&self, path: &str) -> AppResult<()> {
        let normalized = normalize_remote_path(path)?;
        let mut current = String::new();
        for segment in normalized.split('/').filter(|s| !s.is_empty()) {
            current.push('/');
            current.push_str(segment);
            self.mkcol(&current).await?;
        }
        Ok(())
    }

    pub async fn move_resource(
        &self,
        source: &str,
        destination: &str,
        overwrite: bool,
        if_match: Option<&str>,
    ) -> AppResult<()> {
        let mut headers = HeaderMap::new();
        headers.insert(
            HeaderName::from_static("destination"),
            HeaderValue::from_str(self.url_for(destination)?.as_str())
                .map_err(|e| AppError::new("DAV_REQUEST_FAILED", e.to_string()))?,
        );
        headers.insert(
            HeaderName::from_static("overwrite"),
            HeaderValue::from_static(if overwrite { "T" } else { "F" }),
        );
        if let Some(etag) = if_match {
            headers.insert(
                HeaderName::from_static("if-match"),
                HeaderValue::from_str(etag)
                    .map_err(|_| AppError::new("DAV_ETAG_INVALID", "远端 ETag 格式无效"))?,
            );
        }
        let response = self
            .send(
                Method::from_bytes(b"MOVE")
                    .map_err(|e| AppError::new("DAV_CLIENT_INIT_FAILED", e.to_string()))?,
                self.url_for(source)?,
                headers,
                None,
            )
            .await?;
        Self::check_status(response.status(), "MOVE")
    }

    pub async fn delete(&self, path: &str, if_match: Option<&str>) -> AppResult<()> {
        self.delete_inner(path, if_match, None).await
    }

    pub(crate) async fn delete_with_lock_token(&self, path: &str, lock_token: &str) -> AppResult<()> {
        self.delete_inner(path, None, Some(lock_token)).await
    }

    async fn delete_inner(
        &self,
        path: &str,
        if_match: Option<&str>,
        lock_token: Option<&str>,
    ) -> AppResult<()> {
        let mut headers = HeaderMap::new();
        if let Some(etag) = if_match {
            headers.insert(
                HeaderName::from_static("if-match"),
                HeaderValue::from_str(etag)
                    .map_err(|_| AppError::new("DAV_ETAG_INVALID", "远端 ETag 格式无效"))?,
            );
        }
        if let Some(token) = lock_token {
            headers.insert(
                HeaderName::from_static("if"),
                HeaderValue::from_str(&format!("(<{token}>)")).map_err(|_| {
                    AppError::new("DAV_LOCK_TOKEN_INVALID", "WebDAV 锁令牌格式无效")
                })?,
            );
        }
        let response = self
            .send(Method::DELETE, self.url_for(path)?, headers, None)
            .await?;
        Self::check_status(response.status(), "DELETE")
    }

    pub async fn lock_exclusive(&self, path: &str, depth: &str) -> AppResult<String> {
        if depth != "0" && depth != "infinity" {
            return Err(AppError::new("DAV_LOCK_DEPTH_INVALID", "WebDAV 锁深度无效"));
        }
        let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(30);
        loop {
            let mut headers = HeaderMap::new();
            headers.insert(
                HeaderName::from_static("depth"),
                HeaderValue::from_static(if depth == "0" { "0" } else { "infinity" }),
            );
            headers.insert(
                HeaderName::from_static("timeout"),
                HeaderValue::from_static("Second-600"),
            );
            headers.insert(
                CONTENT_TYPE,
                HeaderValue::from_static("application/xml; charset=utf-8"),
            );
            let response = self
                .send(
                    Method::from_bytes(b"LOCK")
                        .map_err(|e| AppError::new("DAV_CLIENT_INIT_FAILED", e.to_string()))?,
                    self.url_for(path)?,
                    headers,
                    Some(EXCLUSIVE_LOCK_BODY.into()),
                )
                .await?;
            if response.status() == StatusCode::LOCKED && tokio::time::Instant::now() < deadline {
                tokio::time::sleep(std::time::Duration::from_millis(200)).await;
                continue;
            }
            Self::check_status(response.status(), "LOCK")?;
            let token = response
                .headers()
                .get("lock-token")
                .and_then(|value| value.to_str().ok())
                .map(|value| value.trim().trim_start_matches('<').trim_end_matches('>'))
                .filter(|value| !value.is_empty())
                .ok_or_else(|| AppError::new("DAV_LOCK_TOKEN_MISSING", "WebDAV 未返回锁令牌"))?;
            return Ok(token.to_owned());
        }
    }

    pub async fn unlock(&self, path: &str, lock_token: &str) -> AppResult<()> {
        let mut headers = HeaderMap::new();
        headers.insert(
            HeaderName::from_static("lock-token"),
            HeaderValue::from_str(&format!("<{lock_token}>"))
                .map_err(|_| AppError::new("DAV_LOCK_TOKEN_INVALID", "WebDAV 锁令牌格式无效"))?,
        );
        let response = self
            .send(
                Method::from_bytes(b"UNLOCK")
                    .map_err(|e| AppError::new("DAV_CLIENT_INIT_FAILED", e.to_string()))?,
                self.url_for(path)?,
                headers,
                None,
            )
            .await?;
        Self::check_status(response.status(), "UNLOCK")
    }


}

pub fn redact_url(value: &str) -> String {
    match Url::parse(value) {
        Ok(mut url) => {
            url.set_query(None);
            url.set_fragment(None);
            url.set_username("").ok();
            url.set_password(None).ok();
            url.set_path("/");
            url.to_string()
        }
        Err(_) => "[INVALID URL]".to_owned(),
    }
}

#[derive(Debug, Clone)]
pub enum PutCondition {
    CreateOnly,
    IfMatch(String),
    Unconditional,
}

pub fn href_to_dav_path(
    client: &WebDavClient,
    href: &str,
    request_path: &str,
) -> AppResult<String> {
    let request_url = client.url_for(request_path)?;
    client.dav_path_for_href(href, &request_url)
}

impl FromStr for PutCondition {
    type Err = AppError;
    fn from_str(value: &str) -> Result<Self, Self::Err> {
        if value == "create" {
            Ok(Self::CreateOnly)
        } else if let Some(etag) = value.strip_prefix("etag:") {
            Ok(Self::IfMatch(etag.to_owned()))
        } else {
            Err(AppError::new("DAV_REQUEST_FAILED", "未知的写入条件"))
        }
    }
}
