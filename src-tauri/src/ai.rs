use crate::{
    app::AppState,
    credentials::CredentialStore,
    domain::{api, ApiResult, AppError, AppResult},
    storage::Database,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::State;
use zeroize::Zeroize;

mod codex;

const AI_KEY_REFERENCE: &str = "ProjectSync/AI/Default";
const DEFAULT_MERGE_PROMPT: &str =
    include_str!("../../src/features/ai/default-merge-prompt.txt");

#[derive(Debug, Clone)]
pub struct AiConfig {
    pub endpoint: String,
    pub model: String,
    pub api_key: Option<String>,
    pub merge_prompt: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiSettingsDto {
    pub use_codex_for_merge: bool,
    pub endpoint: String,
    pub model: String,
    pub has_api_key: bool,
    pub configured: bool,
    pub merge_prompt: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveAiSettingsInput {
    #[serde(default)]
    pub use_codex_for_merge: bool,
    pub endpoint: String,
    pub model: String,
    pub api_key: Option<String>,
    pub clear_api_key: bool,
    pub merge_prompt: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiConnectionTestDto {
    pub message: String,
    pub model: String,
    pub latency_ms: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiModelListInput {
    pub endpoint: String,
    pub api_key: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiTestInput {
    #[serde(default)]
    pub use_codex_for_merge: bool,
    pub endpoint: String,
    pub model: String,
    pub api_key: Option<String>,
}

#[tauri::command]
pub async fn get_ai_settings(state: State<'_, AppState>) -> ApiResult<AiSettingsDto> {
    api(read_settings(&state.db).await)
}

#[tauri::command]
pub async fn save_ai_settings(
    state: State<'_, AppState>,
    mut settings: SaveAiSettingsInput,
) -> ApiResult<AiSettingsDto> {
    let result = async {
        let endpoint = if settings.use_codex_for_merge && settings.endpoint.trim().is_empty() {
            String::new()
        } else {
            validate_base_endpoint(settings.endpoint.trim())?
        };
        let model = settings.model.trim();
        if (!settings.use_codex_for_merge && model.is_empty()) || model.len() > 200 {
            return Err(AppError::new(
                "AI_SETTINGS_INVALID",
                "模型名称必须为 1 至 200 个字符",
            ));
        }
        let merge_prompt = settings.merge_prompt.trim();
        if merge_prompt.len() > 4_000 {
            return Err(AppError::new(
                "AI_SETTINGS_INVALID",
                "冲突合并要求不能超过 4000 个字符",
            ));
        }
        state.db.set_setting("aiEndpoint", &endpoint).await?;
        state.db.set_setting("aiModel", model).await?;
        state
            .db
            .set_setting(
                "aiMergePrompt",
                if merge_prompt.is_empty() {
                    DEFAULT_MERGE_PROMPT
                } else {
                    merge_prompt
                },
            )
            .await?;
        if settings.clear_api_key {
            CredentialStore::delete(AI_KEY_REFERENCE)?;
        } else if let Some(api_key) = settings.api_key.as_deref().filter(|v| !v.trim().is_empty()) {
            if api_key.len() > 8_192 {
                return Err(AppError::new("AI_SETTINGS_INVALID", "API 密钥过长"));
            }
            CredentialStore::set(AI_KEY_REFERENCE, api_key.trim())?;
        }
        state.db.set_setting("aiMergeProvider", if settings.use_codex_for_merge { "codex" } else { "api" }).await?;
        read_settings(&state.db).await
    }
    .await;
    if let Some(key) = settings.api_key.as_mut() {
        key.zeroize();
    }
    api(result)
}

#[tauri::command]
pub async fn test_ai_settings(
    state: State<'_, AppState>,
    mut input: Option<AiTestInput>,
) -> ApiResult<AiConnectionTestDto> {
    let result = async {
        if input.as_ref().is_some_and(|value| value.use_codex_for_merge) {
            let started = std::time::Instant::now();
            let reply = codex::request("You are a connectivity check. Reply with OK only.", "Connection test.", 45).await?;
            return Ok(AiConnectionTestDto {
                message: format!("Codex CLI 连接成功：{}", truncate(&reply, 80)),
                model: "Codex CLI".to_owned(),
                latency_ms: started.elapsed().as_millis() as u64,
            });
        }
        let saved = load_config(&state.db).await?;
        let endpoint = input
            .as_ref()
            .map(|value| value.endpoint.trim())
            .filter(|value| !value.is_empty())
            .map(str::to_owned)
            .or_else(|| saved.as_ref().map(|value| value.endpoint.clone()))
            .ok_or_else(|| AppError::new("AI_NOT_CONFIGURED", "请先填写 AI 接口地址"))?;
        let model = input
            .as_ref()
            .map(|value| value.model.trim())
            .filter(|value| !value.is_empty())
            .map(str::to_owned)
            .or_else(|| saved.as_ref().map(|value| value.model.clone()))
            .ok_or_else(|| AppError::new("AI_NOT_CONFIGURED", "请先填写模型名称"))?;
        validate_base_endpoint(&endpoint)?;
        let api_key = input
            .as_ref()
            .and_then(|value| value.api_key.as_deref())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_owned)
            .or_else(|| saved.as_ref().and_then(|value| value.api_key.clone()));
        let config = AiConfig {
            endpoint,
            model,
            api_key,
            merge_prompt: saved
                .map(|value| value.merge_prompt)
                .unwrap_or_else(|| DEFAULT_MERGE_PROMPT.to_owned()),
        };
        let started = std::time::Instant::now();
        let reply = request_chat_with_timeout(
            &config,
            "You are a connectivity check. Reply with OK only.",
            "Connection test.",
            Some(32),
            std::time::Duration::from_secs(25),
        )
        .await?;
        Ok(AiConnectionTestDto {
            message: format!("连接成功，模型返回：{}", truncate(&reply, 80)),
            model: config.model,
            latency_ms: started.elapsed().as_millis().min(u64::MAX as u128) as u64,
        })
    }
    .await;
    if let Some(key) = input.as_mut().and_then(|value| value.api_key.as_mut()) {
        key.zeroize();
    }
    api(result)
}

#[tauri::command]
pub async fn list_ai_models(
    state: State<'_, AppState>,
    mut input: Option<AiModelListInput>,
) -> ApiResult<Vec<String>> {
    let result = list_models(&state.db, input.as_ref()).await;
    if let Some(key) = input.as_mut().and_then(|value| value.api_key.as_mut()) {
        key.zeroize();
    }
    api(result)
}

pub async fn load_config(db: &Database) -> AppResult<Option<AiConfig>> {
    let endpoint = db.setting("aiEndpoint").await?.unwrap_or_default();
    let model = db.setting("aiModel").await?.unwrap_or_default();
    if endpoint.trim().is_empty() || model.trim().is_empty() {
        return Ok(None);
    }
    let endpoint = validate_base_endpoint(endpoint.trim())?;
    let api_key = match CredentialStore::get(AI_KEY_REFERENCE) {
        Ok(value) if !value.is_empty() => Some(value),
        Ok(_) => None,
        Err(error) if error.code == "CREDENTIAL_NOT_FOUND" => None,
        Err(error) => return Err(error),
    };
    let merge_prompt = db
        .setting("aiMergePrompt")
        .await?
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_MERGE_PROMPT.to_owned());
    Ok(Some(AiConfig {
        endpoint,
        model: model.trim().to_owned(),
        api_key,
        merge_prompt,
    }))
}

pub struct MergeConfig {
    pub model: String,
    pub merge_prompt: String,
    api: Option<AiConfig>,
}

pub async fn load_merge_config(db: &Database) -> AppResult<Option<MergeConfig>> {
    if db.setting("aiMergeProvider").await?.as_deref() == Some("codex") {
        return Ok(Some(MergeConfig {
            model: "Codex CLI".to_owned(),
            merge_prompt: db.setting("aiMergePrompt").await?
                .filter(|value| !value.trim().is_empty())
                .unwrap_or_else(|| DEFAULT_MERGE_PROMPT.to_owned()),
            api: None,
        }));
    }
    Ok(load_config(db).await?.map(|api| MergeConfig {
        model: api.model.clone(),
        merge_prompt: api.merge_prompt.clone(),
        api: Some(api),
    }))
}

pub async fn request_merge(
    config: &MergeConfig, system: &str, user: &str, max_output_tokens: Option<u32>,
) -> AppResult<String> {
    match &config.api {
        Some(api) => request_chat(api, system, user, max_output_tokens).await,
        None => codex::request(system, user, 180).await,
    }
}

pub async fn request_chat(
    config: &AiConfig,
    system: &str,
    user: &str,
    max_output_tokens: Option<u32>,
) -> AppResult<String> {
    request_chat_with_timeout(
        config,
        system,
        user,
        max_output_tokens,
        std::time::Duration::from_secs(120),
    )
    .await
}

async fn request_chat_with_timeout(
    config: &AiConfig,
    system: &str,
    user: &str,
    max_output_tokens: Option<u32>,
    timeout: std::time::Duration,
) -> AppResult<String> {
    let url = resolve_chat_endpoint(&config.endpoint)?;
    let mut payload = json!({
        "model": config.model,
        "stream": false,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user}
        ]
    });
    if let Some(limit) = max_output_tokens {
        payload["max_tokens"] = json!(limit);
    }
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(std::time::Duration::from_secs(5))
        .timeout(timeout)
        .build()
        .map_err(|_| AppError::new("AI_REQUEST_FAILED", "无法创建 AI 请求"))?;
    let mut request = client.post(url).json(&payload);
    if let Some(api_key) = config.api_key.as_deref() {
        request = request.bearer_auth(api_key);
    }
    let response = request
        .send()
        .await
        .map_err(|error| ai_request_error(error, timeout, "AI 接口"))?;
    let status = response.status();
    let bytes = response
        .bytes()
        .await
        .map_err(|error| ai_request_error(error, timeout, "AI 接口"))?;
    if bytes.len() > 2_000_000 {
        return Err(AppError::new("AI_RESPONSE_INVALID", "AI 响应过大"));
    }
    if !status.is_success() {
        let detail = serde_json::from_slice::<Value>(&bytes)
            .ok()
            .and_then(|value| {
                value
                    .pointer("/error/message")
                    .and_then(Value::as_str)
                    .map(str::to_owned)
            })
            .unwrap_or_else(|| "服务未提供错误详情".to_owned());
        return Err(AppError::new(
            "AI_REQUEST_FAILED",
            format!(
                "AI 接口返回 HTTP {}：{}",
                status.as_u16(),
                truncate(&detail, 240)
            ),
        ));
    }
    let value: Value = serde_json::from_slice(&bytes)
        .map_err(|_| AppError::new("AI_RESPONSE_INVALID", "AI 返回格式不兼容"))?;
    let content = value
        .pointer("/choices/0/message/content")
        .and_then(content_text)
        .or_else(|| {
            value
                .pointer("/choices/0/text")
                .and_then(Value::as_str)
                .map(str::to_owned)
        })
        .ok_or_else(|| AppError::new("AI_RESPONSE_INVALID", "AI 没有返回文本内容"))?;
    if content.trim().is_empty() {
        return Err(AppError::new("AI_RESPONSE_INVALID", "AI 返回了空内容"));
    }
    Ok(content)
}

async fn list_models(db: &Database, input: Option<&AiModelListInput>) -> AppResult<Vec<String>> {
    let saved = load_config(db).await?;
    let endpoint = input
        .map(|value| value.endpoint.trim())
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
        .or_else(|| saved.as_ref().map(|value| value.endpoint.clone()))
        .ok_or_else(|| AppError::new("AI_NOT_CONFIGURED", "请先填写 AI 接口地址"))?;
    validate_base_endpoint(&endpoint)?;
    let api_key = input
        .and_then(|value| value.api_key.as_deref())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
        .or_else(|| saved.and_then(|value| value.api_key));
    let url = resolve_models_endpoint(&endpoint)?;
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(std::time::Duration::from_secs(5))
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|_| AppError::new("AI_REQUEST_FAILED", "无法创建模型列表请求"))?;
    let mut request = client.get(url);
    if let Some(api_key) = api_key.as_deref() {
        request = request.bearer_auth(api_key);
    }
    let response = request.send().await.map_err(|error| {
        ai_request_error(error, std::time::Duration::from_secs(20), "AI 模型列表接口")
    })?;
    let status = response.status();
    let bytes = response.bytes().await.map_err(|error| {
        ai_request_error(error, std::time::Duration::from_secs(20), "AI 模型列表接口")
    })?;
    if bytes.len() > 2_000_000 {
        return Err(AppError::new("AI_RESPONSE_INVALID", "模型列表响应过大"));
    }
    if !status.is_success() {
        let detail = serde_json::from_slice::<Value>(&bytes)
            .ok()
            .and_then(|value| {
                value
                    .pointer("/error/message")
                    .and_then(Value::as_str)
                    .map(str::to_owned)
            })
            .unwrap_or_else(|| "服务未提供错误详情".to_owned());
        return Err(AppError::new(
            "AI_REQUEST_FAILED",
            format!(
                "模型列表接口返回 HTTP {}：{}",
                status.as_u16(),
                truncate(&detail, 240)
            ),
        ));
    }
    parse_model_ids(&bytes)
}

async fn read_settings(db: &Database) -> AppResult<AiSettingsDto> {
    let endpoint = db.setting("aiEndpoint").await?.unwrap_or_default();
    let model = db.setting("aiModel").await?.unwrap_or_default();
    let merge_prompt = db
        .setting("aiMergePrompt")
        .await?
        .unwrap_or_else(|| DEFAULT_MERGE_PROMPT.to_owned());
    let has_api_key = match CredentialStore::get(AI_KEY_REFERENCE) {
        Ok(value) => !value.is_empty(),
        Err(error) if error.code == "CREDENTIAL_NOT_FOUND" => false,
        Err(error) => return Err(error),
    };
    Ok(AiSettingsDto {
        use_codex_for_merge: db.setting("aiMergeProvider").await?.as_deref() == Some("codex"),
        configured: !endpoint.trim().is_empty() && !model.trim().is_empty(),
        endpoint,
        model,
        has_api_key,
        merge_prompt,
    })
}

fn validate_base_endpoint(value: &str) -> AppResult<String> {
    validate_http_url(value)?;
    if value.len() > 2_048 {
        return Err(AppError::new("AI_URL_INVALID", "AI 接口地址过长"));
    }
    Ok(value.to_owned())
}

fn resolve_chat_endpoint(value: &str) -> AppResult<url::Url> {
    let mut url = validate_http_url(value)?;
    let path = url.path().trim_end_matches('/');
    let resolved_path = if path.is_empty() {
        "/v1/chat/completions".to_owned()
    } else if path.ends_with("/chat/completions") {
        path.to_owned()
    } else {
        format!("{path}/chat/completions")
    };
    if resolved_path.len() > 2_048 {
        return Err(AppError::new("AI_URL_INVALID", "AI 接口地址过长"));
    }
    url.set_path(&resolved_path);
    Ok(url)
}

fn resolve_models_endpoint(value: &str) -> AppResult<url::Url> {
    let mut url = validate_http_url(value)?;
    let path = url.path().trim_end_matches('/');
    let resolved_path = if path.is_empty() {
        "/v1/models".to_owned()
    } else if path.ends_with("/chat/completions") {
        format!("{}/models", path.trim_end_matches("/chat/completions"))
    } else if path.ends_with("/models") {
        path.to_owned()
    } else {
        format!("{path}/models")
    };
    if resolved_path.len() > 2_048 {
        return Err(AppError::new("AI_URL_INVALID", "AI 接口地址过长"));
    }
    url.set_path(&resolved_path);
    Ok(url)
}

fn validate_http_url(value: &str) -> AppResult<url::Url> {
    let url =
        url::Url::parse(value).map_err(|_| AppError::new("AI_URL_INVALID", "AI 接口地址无效"))?;
    if !(url.scheme() == "https"
        || url.scheme() == "http"
            && matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "::1")))
        || url.username() != ""
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(AppError::new(
            "AI_URL_INVALID",
            "接口地址需使用 HTTPS（本机可用 HTTP），且不能包含凭据或查询参数",
        ));
    }
    Ok(url)
}

fn content_text(value: &Value) -> Option<String> {
    if let Some(text) = value.as_str() {
        return Some(text.to_owned());
    }
    let parts = value.as_array()?;
    let text = parts
        .iter()
        .filter_map(|part| part.get("text").and_then(Value::as_str))
        .collect::<Vec<_>>()
        .join("");
    (!text.is_empty()).then_some(text)
}

fn parse_model_ids(bytes: &[u8]) -> AppResult<Vec<String>> {
    let value: Value = serde_json::from_slice(bytes)
        .map_err(|_| AppError::new("AI_RESPONSE_INVALID", "模型列表格式不兼容"))?;
    let rows = value
        .get("data")
        .and_then(Value::as_array)
        .or_else(|| value.get("models").and_then(Value::as_array))
        .ok_or_else(|| AppError::new("AI_RESPONSE_INVALID", "AI 响应中没有模型列表"))?;
    let mut models = rows
        .iter()
        .filter_map(|row| {
            row.as_str()
                .or_else(|| row.get("id").and_then(Value::as_str))
                .or_else(|| row.get("name").and_then(Value::as_str))
        })
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
        .collect::<Vec<_>>();
    models.sort_by_key(|value| value.to_lowercase());
    models.dedup_by(|left, right| left.eq_ignore_ascii_case(right));
    if models.len() > 1_000 {
        return Err(AppError::new("AI_RESPONSE_INVALID", "模型列表超过 1000 项"));
    }
    Ok(models)
}

fn truncate(value: &str, max_chars: usize) -> String {
    if value.chars().count() <= max_chars {
        value.to_owned()
    } else {
        format!("{}…", value.chars().take(max_chars).collect::<String>())
    }
}

fn ai_request_error(
    error: reqwest::Error,
    timeout: std::time::Duration,
    operation: &str,
) -> AppError {
    if error.is_timeout() {
        AppError::new(
            "AI_REQUEST_TIMEOUT",
            format!(
                "{}在 {} 秒内未返回完整响应；请检查地址、模型名称或服务端流式设置",
                operation,
                timeout.as_secs()
            ),
        )
    } else if error.is_connect() {
        AppError::new(
            "AI_CONNECT_FAILED",
            format!("无法连接{}，请检查地址和网络", operation),
        )
    } else {
        AppError::new("AI_REQUEST_FAILED", format!("请求{}失败", operation))
    }
}

#[cfg(test)]
mod endpoint_tests {
    use super::{parse_model_ids, resolve_chat_endpoint, resolve_models_endpoint};

    #[test]
    fn accepts_base_urls_and_complete_chat_endpoints() {
        let cases = [
            (
                "https://api.openai.com",
                "https://api.openai.com/v1/chat/completions",
            ),
            (
                "https://api.openai.com/",
                "https://api.openai.com/v1/chat/completions",
            ),
            (
                "https://api.openai.com/v1",
                "https://api.openai.com/v1/chat/completions",
            ),
            (
                "https://gateway.example.com/openai/v1/",
                "https://gateway.example.com/openai/v1/chat/completions",
            ),
            (
                "https://api.openai.com/v1/chat/completions",
                "https://api.openai.com/v1/chat/completions",
            ),
            (
                "http://127.0.0.1:11434/v1",
                "http://127.0.0.1:11434/v1/chat/completions",
            ),
        ];
        for (input, expected) in cases {
            assert_eq!(resolve_chat_endpoint(input).unwrap().as_str(), expected);
        }
    }

    #[test]
    fn derives_models_endpoint_from_base_or_chat_url() {
        let cases = [
            ("https://api.openai.com", "https://api.openai.com/v1/models"),
            (
                "https://api.openai.com/v1",
                "https://api.openai.com/v1/models",
            ),
            (
                "https://api.openai.com/v1/chat/completions",
                "https://api.openai.com/v1/models",
            ),
            (
                "https://gateway.example.com/openai/v1",
                "https://gateway.example.com/openai/v1/models",
            ),
        ];
        for (input, expected) in cases {
            assert_eq!(resolve_models_endpoint(input).unwrap().as_str(), expected);
        }
    }

    #[test]
    fn parses_common_model_list_shapes() {
        let models = parse_model_ids(
            br#"{"data":[{"id":"gpt-4.1"},{"id":"gpt-4o-mini"},{"id":"gpt-4.1"}]}"#,
        )
        .unwrap();
        assert_eq!(models, ["gpt-4.1", "gpt-4o-mini"]);
        let models = parse_model_ids(br#"{"models":[{"name":"qwen3:8b"},"llama3.2"]}"#).unwrap();
        assert_eq!(models, ["llama3.2", "qwen3:8b"]);
    }
}
