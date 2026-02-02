//! Multi-provider LLM client for OpenAI, Claude, and Ollama APIs.
//!
//! This module handles communication with different LLM providers:
//! - OpenAI: Full tool support via function calling
//! - Claude: Full tool support via Anthropic's tool_use
//! - Ollama: Chat only (no tool support)

use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::types::{AgentConfig, AgentError, LlmProvider, Message, MessageRole, Tool, ToolCall, Usage};

// ============================================================================
// Common Response Type
// ============================================================================

/// Response from an LLM call (provider-agnostic)
#[derive(Debug)]
pub struct LlmResponse {
    /// Text content from the assistant (may be None if only tool calls)
    pub content: Option<String>,
    /// Tool calls requested by the assistant
    pub tool_calls: Vec<ToolCall>,
    /// Token usage information
    pub usage: Option<Usage>,
    /// The finish reason
    #[allow(dead_code)]
    pub finish_reason: Option<String>,
}

// ============================================================================
// OpenAI Types
// ============================================================================

#[derive(Debug, Serialize)]
struct OpenAiRequest {
    model: String,
    messages: Vec<OpenAiMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tools: Option<Vec<OpenAiTool>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tool_choice: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    temperature: Option<f32>,
    /// Used by most models (gpt-4o, gpt-4o-mini, gpt-4-turbo, etc.)
    #[serde(skip_serializing_if = "Option::is_none")]
    max_tokens: Option<u32>,
    /// Used by o-series models (o1, o1-mini, o3-mini, etc.)
    #[serde(skip_serializing_if = "Option::is_none")]
    max_completion_tokens: Option<u32>,
}

#[derive(Debug, Serialize)]
struct OpenAiMessage {
    role: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tool_calls: Option<Vec<OpenAiToolCall>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tool_call_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct OpenAiTool {
    #[serde(rename = "type")]
    tool_type: String,
    function: OpenAiFunction,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct OpenAiFunction {
    name: String,
    description: String,
    parameters: serde_json::Value,
}

#[derive(Debug, Serialize, Deserialize)]
struct OpenAiToolCall {
    id: String,
    #[serde(rename = "type")]
    call_type: String,
    function: OpenAiFunctionCall,
}

#[derive(Debug, Serialize, Deserialize)]
struct OpenAiFunctionCall {
    name: String,
    arguments: String,
}

#[derive(Debug, Deserialize)]
struct OpenAiResponse {
    #[allow(dead_code)]
    id: String,
    choices: Vec<OpenAiChoice>,
    #[serde(default)]
    usage: Option<OpenAiUsage>,
}

#[derive(Debug, Deserialize)]
struct OpenAiChoice {
    #[allow(dead_code)]
    index: u32,
    message: OpenAiResponseMessage,
    finish_reason: Option<String>,
}

#[derive(Debug, Deserialize)]
struct OpenAiResponseMessage {
    #[allow(dead_code)]
    role: String,
    #[serde(default)]
    content: Option<Value>,
    #[serde(default)]
    tool_calls: Option<Vec<OpenAiToolCall>>,
}

#[derive(Debug, Deserialize)]
struct OpenAiUsage {
    prompt_tokens: u32,
    completion_tokens: u32,
    total_tokens: u32,
}

#[derive(Debug, Deserialize)]
struct OpenAiError {
    error: OpenAiErrorDetail,
}

#[derive(Debug, Deserialize)]
struct OpenAiErrorDetail {
    message: String,
    #[serde(rename = "type")]
    #[allow(dead_code)]
    error_type: Option<String>,
    #[allow(dead_code)]
    code: Option<String>,
}

fn openai_content_to_text(content: Option<Value>) -> Option<String> {
    match content {
        Some(Value::String(text)) => Some(text),
        Some(Value::Array(parts)) => {
            let mut combined = String::new();
            for part in parts {
                if let Value::Object(map) = part {
                    if let Some(Value::String(text)) = map.get("text") {
                        combined.push_str(text);
                    }
                }
            }
            if combined.is_empty() { None } else { Some(combined) }
        }
        _ => None,
    }
}

/// Returns true if the model is an o-series reasoning model (o1, o3, o4, etc.)
fn is_o_series_model(model: &str) -> bool {
    let base = model.rsplit('/').next().unwrap_or(model);
    // o-series reasoning models: o1, o1-mini, o1-pro, o3, o3-mini, o4-mini, etc.
    // Match "o" followed by a digit at the start
    let chars: Vec<char> = base.chars().collect();
    chars.len() >= 2 && chars[0] == 'o' && chars[1].is_ascii_digit()
}

/// Returns true if the model is a GPT-5 series model.
/// GPT-5 models have different parameter requirements (no max_tokens, no temperature).
fn is_gpt5_model(model: &str) -> bool {
    let base = model.rsplit('/').next().unwrap_or(model);
    // GPT-5 series: gpt-5, gpt-5-mini, gpt-5-nano, gpt-5.1, gpt-5.2, gpt-5.2-pro, etc.
    base.starts_with("gpt-5")
}

/// Returns true if the model supports temperature parameter.
/// O-series and GPT-5 models do not support temperature.
fn supports_temperature(model: &str) -> bool {
    !is_o_series_model(model) && !is_gpt5_model(model)
}

/// Returns true if the model uses max_completion_tokens instead of max_tokens.
/// O-series and GPT-5 models require max_completion_tokens.
fn uses_max_completion_tokens(model: &str) -> bool {
    is_o_series_model(model) || is_gpt5_model(model)
}

// ============================================================================
// Claude (Anthropic) Types
// ============================================================================

#[derive(Debug, Serialize)]
struct ClaudeRequest {
    model: String,
    messages: Vec<ClaudeMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    system: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tools: Option<Vec<ClaudeTool>>,
    max_tokens: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    temperature: Option<f32>,
}

#[derive(Debug, Serialize)]
struct ClaudeMessage {
    role: String,
    content: ClaudeContent,
}

#[derive(Debug, Serialize)]
#[serde(untagged)]
enum ClaudeContent {
    Text(String),
    Blocks(Vec<ClaudeContentBlock>),
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type")]
enum ClaudeContentBlock {
    #[serde(rename = "text")]
    Text { text: String },
    #[serde(rename = "tool_use")]
    ToolUse {
        id: String,
        name: String,
        input: serde_json::Value,
    },
    #[serde(rename = "tool_result")]
    ToolResult {
        tool_use_id: String,
        content: String,
    },
}

#[derive(Debug, Serialize)]
struct ClaudeTool {
    name: String,
    description: String,
    input_schema: serde_json::Value,
}

#[derive(Debug, Deserialize)]
struct ClaudeResponse {
    #[allow(dead_code)]
    id: String,
    content: Vec<ClaudeResponseContent>,
    stop_reason: Option<String>,
    #[serde(default)]
    usage: Option<ClaudeUsage>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
enum ClaudeResponseContent {
    #[serde(rename = "text")]
    Text { text: String },
    #[serde(rename = "tool_use")]
    ToolUse {
        id: String,
        name: String,
        input: serde_json::Value,
    },
}

#[derive(Debug, Deserialize)]
struct ClaudeUsage {
    input_tokens: u32,
    output_tokens: u32,
}

#[derive(Debug, Deserialize)]
struct ClaudeError {
    error: ClaudeErrorDetail,
}

#[derive(Debug, Deserialize)]
struct ClaudeErrorDetail {
    message: String,
    #[serde(rename = "type")]
    #[allow(dead_code)]
    error_type: Option<String>,
}

// ============================================================================
// Ollama Types
// ============================================================================

#[derive(Debug, Serialize)]
struct OllamaRequest {
    model: String,
    messages: Vec<OllamaMessage>,
    stream: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    options: Option<OllamaOptions>,
}

#[derive(Debug, Serialize)]
struct OllamaMessage {
    role: String,
    content: String,
}

#[derive(Debug, Serialize)]
struct OllamaOptions {
    temperature: f32,
    num_predict: u32,
}

#[derive(Debug, Deserialize)]
struct OllamaResponse {
    message: OllamaResponseMessage,
    #[serde(default)]
    done: bool,
    #[serde(default)]
    eval_count: Option<u32>,
    #[serde(default)]
    prompt_eval_count: Option<u32>,
}

#[derive(Debug, Deserialize)]
struct OllamaResponseMessage {
    #[allow(dead_code)]
    role: String,
    content: String,
}

// ============================================================================
// LLM Client
// ============================================================================

/// Multi-provider LLM client
pub struct LlmClient {
    client: Client,
    config: AgentConfig,
}

impl LlmClient {
    /// Create a new LLM client
    pub fn new(config: AgentConfig) -> Self {
        LlmClient {
            client: Client::new(),
            config,
        }
    }

    /// Make a chat completion request to the configured provider
    pub async fn chat(
        &self,
        messages: &[Message],
        tools: Option<&[Tool]>,
    ) -> Result<LlmResponse, AgentError> {
        match self.config.provider {
            LlmProvider::OpenAI => self.chat_openai(messages, tools).await,
            LlmProvider::Claude => self.chat_claude(messages, tools).await,
            LlmProvider::Ollama => self.chat_ollama(messages).await,
            LlmProvider::OpenRouter => self.chat_openrouter(messages, tools).await,
        }
    }

    // ========================================================================
    // OpenAI Implementation
    // ========================================================================

    async fn chat_openai(
        &self,
        messages: &[Message],
        tools: Option<&[Tool]>,
    ) -> Result<LlmResponse, AgentError> {
        if self.config.api_key.is_empty() {
            return Err(AgentError::ConfigError(
                "OpenAI API key is not configured".to_string(),
            ));
        }

        let url = format!("{}/chat/completions", self.config.effective_base_url());

        // Convert messages to OpenAI format
        let openai_messages: Vec<OpenAiMessage> = messages
            .iter()
            .map(|m| OpenAiMessage {
                role: match m.role {
                    MessageRole::Developer => "developer".to_string(),
                    MessageRole::System => "system".to_string(),
                    MessageRole::User => "user".to_string(),
                    MessageRole::Assistant => "assistant".to_string(),
                    MessageRole::Tool => "tool".to_string(),
                },
                content: m.content.clone(),
                tool_calls: m.tool_calls.as_ref().map(|tcs| {
                    tcs.iter()
                        .map(|tc| OpenAiToolCall {
                            id: tc.id.clone(),
                            call_type: "function".to_string(),
                            function: OpenAiFunctionCall {
                                name: tc.function.name.clone(),
                                arguments: tc.function.arguments.clone(),
                            },
                        })
                        .collect()
                }),
                tool_call_id: m.tool_call_id.clone(),
            })
            .collect();

        // Convert tools to OpenAI format
        let openai_tools: Option<Vec<OpenAiTool>> = tools.map(|ts| {
            ts.iter()
                .map(|t| OpenAiTool {
                    tool_type: "function".to_string(),
                    function: OpenAiFunction {
                        name: t.function.name.clone(),
                        description: t.function.description.clone(),
                        parameters: serde_json::to_value(&t.function.parameters)
                            .unwrap_or(serde_json::json!({})),
                    },
                })
                .collect()
        });

        // Determine which max tokens parameter to use based on model
        let (max_tokens, max_completion_tokens) = if uses_max_completion_tokens(&self.config.model) {
            (None, Some(self.config.max_tokens))
        } else {
            (Some(self.config.max_tokens), None)
        };

        let request = OpenAiRequest {
            model: self.config.model.clone(),
            messages: openai_messages,
            tools: openai_tools.clone(),
            tool_choice: openai_tools.as_ref().map(|_| "auto".to_string()),
            temperature: if supports_temperature(&self.config.model) {
                Some(self.config.temperature)
            } else {
                None
            },
            max_tokens,
            max_completion_tokens,
        };

        log::debug!("OpenAI request to {}: model={}", url, request.model);

        let response = self
            .client
            .post(&url)
            .header("Authorization", format!("Bearer {}", self.config.api_key))
            .header("Content-Type", "application/json")
            .json(&request)
            .send()
            .await
            .map_err(|e| AgentError::LlmError(format!("OpenAI request failed: {}", e)))?;

        let status = response.status();

        if !status.is_success() {
            let error_text = response.text().await.unwrap_or_else(|_| "Unknown error".to_string());

            if let Ok(api_error) = serde_json::from_str::<OpenAiError>(&error_text) {
                return Err(AgentError::LlmError(format!(
                    "OpenAI API error ({}): {}",
                    status, api_error.error.message
                )));
            }

            return Err(AgentError::LlmError(format!(
                "OpenAI request failed ({}): {}",
                status, error_text
            )));
        }

        let openai_response: OpenAiResponse = response
            .json()
            .await
            .map_err(|e| AgentError::LlmError(format!("Failed to parse OpenAI response: {}", e)))?;

        let choice = openai_response
            .choices
            .into_iter()
            .next()
            .ok_or_else(|| AgentError::LlmError("No choices in OpenAI response".to_string()))?;

        // Convert tool calls
        let tool_calls = choice
            .message
            .tool_calls
            .unwrap_or_default()
            .into_iter()
            .map(|tc| ToolCall {
                id: tc.id,
                call_type: tc.call_type,
                function: super::types::FunctionCall {
                    name: tc.function.name,
                    arguments: tc.function.arguments,
                },
            })
            .collect();

        let usage = openai_response.usage.map(|u| Usage {
            prompt_tokens: u.prompt_tokens,
            completion_tokens: u.completion_tokens,
            total_tokens: u.total_tokens,
        });

        Ok(LlmResponse {
            content: openai_content_to_text(choice.message.content),
            tool_calls,
            usage,
            finish_reason: choice.finish_reason,
        })
    }

    // ========================================================================
    // OpenRouter Implementation (OpenAI-compatible with extra headers)
    // ========================================================================

    async fn chat_openrouter(
        &self,
        messages: &[Message],
        tools: Option<&[Tool]>,
    ) -> Result<LlmResponse, AgentError> {
        if self.config.api_key.is_empty() {
            return Err(AgentError::ConfigError(
                "OpenRouter API key is not configured".to_string(),
            ));
        }

        let url = format!("{}/chat/completions", self.config.effective_base_url());

        // Convert messages to OpenAI format (OpenRouter is OpenAI-compatible)
        let openai_messages: Vec<OpenAiMessage> = messages
            .iter()
            .map(|m| OpenAiMessage {
                role: match m.role {
                    MessageRole::Developer => "system".to_string(),
                    MessageRole::System => "system".to_string(),
                    MessageRole::User => "user".to_string(),
                    MessageRole::Assistant => "assistant".to_string(),
                    MessageRole::Tool => "tool".to_string(),
                },
                content: m.content.clone(),
                tool_calls: m.tool_calls.as_ref().map(|tcs| {
                    tcs.iter()
                        .map(|tc| OpenAiToolCall {
                            id: tc.id.clone(),
                            call_type: "function".to_string(),
                            function: OpenAiFunctionCall {
                                name: tc.function.name.clone(),
                                arguments: tc.function.arguments.clone(),
                            },
                        })
                        .collect()
                }),
                tool_call_id: m.tool_call_id.clone(),
            })
            .collect();

        // Convert tools to OpenAI format
        let openai_tools: Option<Vec<OpenAiTool>> = tools.map(|ts| {
            ts.iter()
                .map(|t| OpenAiTool {
                    tool_type: "function".to_string(),
                    function: OpenAiFunction {
                        name: t.function.name.clone(),
                        description: t.function.description.clone(),
                        parameters: serde_json::to_value(&t.function.parameters)
                            .unwrap_or(serde_json::json!({})),
                    },
                })
                .collect()
        });

        // Determine which max tokens parameter to use based on model
        let (max_tokens, max_completion_tokens) = if uses_max_completion_tokens(&self.config.model) {
            (None, Some(self.config.max_tokens))
        } else {
            (Some(self.config.max_tokens), None)
        };

        let request = OpenAiRequest {
            model: self.config.model.clone(),
            messages: openai_messages,
            tools: openai_tools.clone(),
            tool_choice: openai_tools.as_ref().map(|_| "auto".to_string()),
            temperature: if supports_temperature(&self.config.model) {
                Some(self.config.temperature)
            } else {
                None
            },
            max_tokens,
            max_completion_tokens,
        };

        log::debug!("OpenRouter request to {}: model={}", url, request.model);

        let response = self
            .client
            .post(&url)
            .header("Authorization", format!("Bearer {}", self.config.api_key))
            .header("Content-Type", "application/json")
            .header("HTTP-Referer", "https://vswrite.app")
            .header("X-Title", "VS Write")
            .json(&request)
            .send()
            .await
            .map_err(|e| AgentError::LlmError(format!("OpenRouter request failed: {}", e)))?;

        let status = response.status();

        if !status.is_success() {
            let error_text = response.text().await.unwrap_or_else(|_| "Unknown error".to_string());

            if let Ok(api_error) = serde_json::from_str::<OpenAiError>(&error_text) {
                return Err(AgentError::LlmError(format!(
                    "OpenRouter API error ({}): {}",
                    status, api_error.error.message
                )));
            }

            return Err(AgentError::LlmError(format!(
                "OpenRouter request failed ({}): {}",
                status, error_text
            )));
        }

        let openai_response: OpenAiResponse = response
            .json()
            .await
            .map_err(|e| AgentError::LlmError(format!("Failed to parse OpenRouter response: {}", e)))?;

        let choice = openai_response
            .choices
            .into_iter()
            .next()
            .ok_or_else(|| AgentError::LlmError("No choices in OpenRouter response".to_string()))?;

        // Convert tool calls
        let tool_calls = choice
            .message
            .tool_calls
            .unwrap_or_default()
            .into_iter()
            .map(|tc| ToolCall {
                id: tc.id,
                call_type: tc.call_type,
                function: super::types::FunctionCall {
                    name: tc.function.name,
                    arguments: tc.function.arguments,
                },
            })
            .collect();

        let usage = openai_response.usage.map(|u| Usage {
            prompt_tokens: u.prompt_tokens,
            completion_tokens: u.completion_tokens,
            total_tokens: u.total_tokens,
        });

        Ok(LlmResponse {
            content: openai_content_to_text(choice.message.content),
            tool_calls,
            usage,
            finish_reason: choice.finish_reason,
        })
    }

    // ========================================================================
    // Claude Implementation
    // ========================================================================

    async fn chat_claude(
        &self,
        messages: &[Message],
        tools: Option<&[Tool]>,
    ) -> Result<LlmResponse, AgentError> {
        if self.config.api_key.is_empty() {
            return Err(AgentError::ConfigError(
                "Claude API key is not configured".to_string(),
            ));
        }

        let url = format!("{}/messages", self.config.effective_base_url());

        // Extract system message and convert others
        let mut system_prompt: Option<String> = None;
        let mut claude_messages: Vec<ClaudeMessage> = Vec::new();

        for msg in messages {
            match msg.role {
                MessageRole::System | MessageRole::Developer => {
                    if let Some(content) = msg.content.clone() {
                        system_prompt = Some(match system_prompt.take() {
                            Some(existing) => format!("{}\n\n{}", existing, content),
                            None => content,
                        });
                    }
                }
                MessageRole::User => {
                    claude_messages.push(ClaudeMessage {
                        role: "user".to_string(),
                        content: ClaudeContent::Text(msg.content.clone().unwrap_or_default()),
                    });
                }
                MessageRole::Assistant => {
                    if let Some(tool_calls) = &msg.tool_calls {
                        // Assistant message with tool calls
                        let mut blocks: Vec<ClaudeContentBlock> = Vec::new();
                        if let Some(text) = &msg.content {
                            if !text.is_empty() {
                                blocks.push(ClaudeContentBlock::Text { text: text.clone() });
                            }
                        }
                        for tc in tool_calls {
                            let input: serde_json::Value =
                                serde_json::from_str(&tc.function.arguments)
                                    .unwrap_or(serde_json::json!({}));
                            blocks.push(ClaudeContentBlock::ToolUse {
                                id: tc.id.clone(),
                                name: tc.function.name.clone(),
                                input,
                            });
                        }
                        claude_messages.push(ClaudeMessage {
                            role: "assistant".to_string(),
                            content: ClaudeContent::Blocks(blocks),
                        });
                    } else {
                        claude_messages.push(ClaudeMessage {
                            role: "assistant".to_string(),
                            content: ClaudeContent::Text(msg.content.clone().unwrap_or_default()),
                        });
                    }
                }
                MessageRole::Tool => {
                    // Tool results go as user messages with tool_result block
                    if let Some(tool_call_id) = &msg.tool_call_id {
                        claude_messages.push(ClaudeMessage {
                            role: "user".to_string(),
                            content: ClaudeContent::Blocks(vec![ClaudeContentBlock::ToolResult {
                                tool_use_id: tool_call_id.clone(),
                                content: msg.content.clone().unwrap_or_default(),
                            }]),
                        });
                    }
                }
            }
        }

        // Convert tools to Claude format
        let claude_tools: Option<Vec<ClaudeTool>> = tools.map(|ts| {
            ts.iter()
                .map(|t| ClaudeTool {
                    name: t.function.name.clone(),
                    description: t.function.description.clone(),
                    input_schema: serde_json::to_value(&t.function.parameters)
                        .unwrap_or(serde_json::json!({"type": "object"})),
                })
                .collect()
        });

        let request = ClaudeRequest {
            model: self.config.model.clone(),
            messages: claude_messages,
            system: system_prompt,
            tools: claude_tools,
            max_tokens: self.config.max_tokens,
            temperature: Some(self.config.temperature),
        };

        log::debug!("Claude request to {}: model={}", url, request.model);

        let response = self
            .client
            .post(&url)
            .header("x-api-key", &self.config.api_key)
            .header("anthropic-version", "2023-06-01")
            .header("Content-Type", "application/json")
            .json(&request)
            .send()
            .await
            .map_err(|e| AgentError::LlmError(format!("Claude request failed: {}", e)))?;

        let status = response.status();

        if !status.is_success() {
            let error_text = response.text().await.unwrap_or_else(|_| "Unknown error".to_string());

            if let Ok(api_error) = serde_json::from_str::<ClaudeError>(&error_text) {
                return Err(AgentError::LlmError(format!(
                    "Claude API error ({}): {}",
                    status, api_error.error.message
                )));
            }

            return Err(AgentError::LlmError(format!(
                "Claude request failed ({}): {}",
                status, error_text
            )));
        }

        let claude_response: ClaudeResponse = response
            .json()
            .await
            .map_err(|e| AgentError::LlmError(format!("Failed to parse Claude response: {}", e)))?;

        // Extract text content and tool calls
        let mut content: Option<String> = None;
        let mut tool_calls: Vec<ToolCall> = Vec::new();

        for block in claude_response.content {
            match block {
                ClaudeResponseContent::Text { text } => {
                    content = Some(text);
                }
                ClaudeResponseContent::ToolUse { id, name, input } => {
                    tool_calls.push(ToolCall {
                        id,
                        call_type: "function".to_string(),
                        function: super::types::FunctionCall {
                            name,
                            arguments: serde_json::to_string(&input).unwrap_or_default(),
                        },
                    });
                }
            }
        }

        let usage = claude_response.usage.map(|u| Usage {
            prompt_tokens: u.input_tokens,
            completion_tokens: u.output_tokens,
            total_tokens: u.input_tokens + u.output_tokens,
        });

        Ok(LlmResponse {
            content,
            tool_calls,
            usage,
            finish_reason: claude_response.stop_reason,
        })
    }

    // ========================================================================
    // Ollama Implementation
    // ========================================================================

    async fn chat_ollama(&self, messages: &[Message]) -> Result<LlmResponse, AgentError> {
        let url = format!("{}/api/chat", self.config.effective_base_url());

        // Ollama doesn't support tools, so we warn if tools were requested
        log::warn!("Ollama does not support tool calling. Running in chat-only mode.");

        // Convert messages to Ollama format (flatten to simple role/content)
        let ollama_messages: Vec<OllamaMessage> = messages
            .iter()
            .filter_map(|m| {
                let role = match m.role {
                    MessageRole::Developer => "system",
                    MessageRole::System => "system",
                    MessageRole::User => "user",
                    MessageRole::Assistant => "assistant",
                    MessageRole::Tool => return None, // Skip tool messages
                };
                Some(OllamaMessage {
                    role: role.to_string(),
                    content: m.content.clone().unwrap_or_default(),
                })
            })
            .collect();

        let request = OllamaRequest {
            model: self.config.model.clone(),
            messages: ollama_messages,
            stream: false,
            options: Some(OllamaOptions {
                temperature: self.config.temperature,
                num_predict: self.config.max_tokens,
            }),
        };

        log::debug!("Ollama request to {}: model={}", url, request.model);

        let response = self
            .client
            .post(&url)
            .header("Content-Type", "application/json")
            .json(&request)
            .send()
            .await
            .map_err(|e| AgentError::LlmError(format!("Ollama request failed: {}", e)))?;

        let status = response.status();

        if !status.is_success() {
            let error_text = response.text().await.unwrap_or_else(|_| "Unknown error".to_string());
            return Err(AgentError::LlmError(format!(
                "Ollama request failed ({}): {}",
                status, error_text
            )));
        }

        let ollama_response: OllamaResponse = response
            .json()
            .await
            .map_err(|e| AgentError::LlmError(format!("Failed to parse Ollama response: {}", e)))?;

        // Ollama doesn't return tool calls
        let usage = match (ollama_response.prompt_eval_count, ollama_response.eval_count) {
            (Some(prompt), Some(completion)) => Some(Usage {
                prompt_tokens: prompt,
                completion_tokens: completion,
                total_tokens: prompt + completion,
            }),
            _ => None,
        };

        Ok(LlmResponse {
            content: Some(ollama_response.message.content),
            tool_calls: Vec::new(), // Ollama doesn't support tools
            usage,
            finish_reason: if ollama_response.done {
                Some("stop".to_string())
            } else {
                None
            },
        })
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_openai_request_serialization() {
        let request = OpenAiRequest {
            model: "gpt-4o-mini".to_string(),
            messages: vec![OpenAiMessage {
                role: "user".to_string(),
                content: Some("Hello".to_string()),
                tool_calls: None,
                tool_call_id: None,
            }],
            tools: None,
            tool_choice: None,
            temperature: Some(0.7),
            max_tokens: Some(1000),
            max_completion_tokens: None,
        };

        let json = serde_json::to_string(&request).unwrap();
        assert!(json.contains("gpt-4o-mini"));
        assert!(json.contains("Hello"));
        assert!(!json.contains("tools")); // tools should be omitted when None
        assert!(json.contains("max_tokens"));
        assert!(!json.contains("max_completion_tokens")); // should be omitted when None
    }

    #[test]
    fn test_openai_request_o_series_serialization() {
        let request = OpenAiRequest {
            model: "o1-mini".to_string(),
            messages: vec![OpenAiMessage {
                role: "user".to_string(),
                content: Some("Hello".to_string()),
                tool_calls: None,
                tool_call_id: None,
            }],
            tools: None,
            tool_choice: None,
            temperature: None, // o-series doesn't support temperature
            max_tokens: None,
            max_completion_tokens: Some(1000),
        };

        let json = serde_json::to_string(&request).unwrap();
        assert!(json.contains("o1-mini"));
        assert!(!json.contains("\"max_tokens\"")); // should be omitted when None
        assert!(json.contains("max_completion_tokens"));
    }

    #[test]
    fn test_is_o_series_model() {
        // o-series reasoning models
        assert!(is_o_series_model("o1"));
        assert!(is_o_series_model("o1-mini"));
        assert!(is_o_series_model("o1-preview"));
        assert!(is_o_series_model("o1-pro"));
        assert!(is_o_series_model("o3"));
        assert!(is_o_series_model("o3-mini"));
        assert!(is_o_series_model("o4-mini"));
        assert!(is_o_series_model("openai/o1-mini")); // with provider prefix
        assert!(is_o_series_model("openai/o3-mini"));
        assert!(is_o_series_model("openai/o4-mini"));

        // GPT models are NOT o-series
        assert!(!is_o_series_model("gpt-4o"));
        assert!(!is_o_series_model("gpt-4o-mini"));
        assert!(!is_o_series_model("gpt-5"));
        assert!(!is_o_series_model("gpt-5-mini"));
    }

    #[test]
    fn test_is_gpt5_model() {
        // GPT-5 series models
        assert!(is_gpt5_model("gpt-5"));
        assert!(is_gpt5_model("gpt-5-mini"));
        assert!(is_gpt5_model("gpt-5-nano"));
        assert!(is_gpt5_model("gpt-5.1"));
        assert!(is_gpt5_model("gpt-5.2"));
        assert!(is_gpt5_model("gpt-5.2-pro"));
        assert!(is_gpt5_model("gpt-5.2-chat-latest"));
        assert!(is_gpt5_model("gpt-5.2-codex"));
        assert!(is_gpt5_model("openai/gpt-5-mini")); // with provider prefix

        // NOT GPT-5 models
        assert!(!is_gpt5_model("gpt-4o"));
        assert!(!is_gpt5_model("gpt-4o-mini"));
        assert!(!is_gpt5_model("gpt-4.1-mini"));
        assert!(!is_gpt5_model("o1-mini"));
        assert!(!is_gpt5_model("o3-mini"));
    }

    #[test]
    fn test_uses_max_completion_tokens() {
        // O-series models use max_completion_tokens
        assert!(uses_max_completion_tokens("o1"));
        assert!(uses_max_completion_tokens("o1-mini"));
        assert!(uses_max_completion_tokens("o3-mini"));
        assert!(uses_max_completion_tokens("o4-mini"));
        assert!(uses_max_completion_tokens("openai/o1-mini"));

        // GPT-5 models also use max_completion_tokens
        assert!(uses_max_completion_tokens("gpt-5"));
        assert!(uses_max_completion_tokens("gpt-5-mini"));
        assert!(uses_max_completion_tokens("gpt-5.2"));
        assert!(uses_max_completion_tokens("gpt-5.2-pro"));

        // GPT-4 models use max_tokens (NOT max_completion_tokens)
        assert!(!uses_max_completion_tokens("gpt-4o"));
        assert!(!uses_max_completion_tokens("gpt-4o-mini"));
        assert!(!uses_max_completion_tokens("gpt-4.1-mini"));
    }

    #[test]
    fn test_supports_temperature() {
        // GPT-4 models support temperature
        assert!(supports_temperature("gpt-4o"));
        assert!(supports_temperature("gpt-4o-mini"));
        assert!(supports_temperature("gpt-4.1-mini"));
        assert!(supports_temperature("gpt-3.5-turbo"));

        // O-series models do NOT support temperature
        assert!(!supports_temperature("o1"));
        assert!(!supports_temperature("o1-mini"));
        assert!(!supports_temperature("o3-mini"));
        assert!(!supports_temperature("o4-mini"));

        // GPT-5 models do NOT support temperature
        assert!(!supports_temperature("gpt-5"));
        assert!(!supports_temperature("gpt-5-mini"));
        assert!(!supports_temperature("gpt-5.2"));
        assert!(!supports_temperature("gpt-5.2-pro"));
    }

    #[test]
    fn test_openai_response_parsing() {
        let json = r#"{
            "id": "chatcmpl-123",
            "choices": [{
                "index": 0,
                "message": {
                    "role": "assistant",
                    "content": "Hello!"
                },
                "finish_reason": "stop"
            }],
            "usage": {
                "prompt_tokens": 10,
                "completion_tokens": 5,
                "total_tokens": 15
            }
        }"#;

        let response: OpenAiResponse = serde_json::from_str(json).unwrap();
        assert_eq!(response.choices.len(), 1);
        assert_eq!(
            openai_content_to_text(response.choices[0].message.content.clone()),
            Some("Hello!".to_string())
        );
        assert!(response.usage.is_some());
    }

    #[test]
    fn test_openai_response_parsing_content_parts() {
        let json = r#"{
            "id": "chatcmpl-123",
            "choices": [{
                "index": 0,
                "message": {
                    "role": "assistant",
                    "content": [
                        {"type": "text", "text": "Hello"},
                        {"type": "text", "text": " world!"}
                    ]
                },
                "finish_reason": "stop"
            }]
        }"#;

        let response: OpenAiResponse = serde_json::from_str(json).unwrap();
        assert_eq!(
            openai_content_to_text(response.choices[0].message.content.clone()),
            Some("Hello world!".to_string())
        );
    }

    #[test]
    fn test_openai_tool_call_parsing() {
        let json = r#"{
            "id": "chatcmpl-123",
            "choices": [{
                "index": 0,
                "message": {
                    "role": "assistant",
                    "content": null,
                    "tool_calls": [{
                        "id": "call_abc123",
                        "type": "function",
                        "function": {
                            "name": "read_file",
                            "arguments": "{\"path\": \"test.txt\"}"
                        }
                    }]
                },
                "finish_reason": "tool_calls"
            }]
        }"#;

        let response: OpenAiResponse = serde_json::from_str(json).unwrap();
        let tool_calls = response.choices[0].message.tool_calls.as_ref().unwrap();
        assert_eq!(tool_calls.len(), 1);
        assert_eq!(tool_calls[0].function.name, "read_file");
    }

    #[test]
    fn test_claude_request_serialization() {
        let request = ClaudeRequest {
            model: "claude-sonnet-4-20250514".to_string(),
            messages: vec![ClaudeMessage {
                role: "user".to_string(),
                content: ClaudeContent::Text("Hello".to_string()),
            }],
            system: Some("You are helpful".to_string()),
            tools: None,
            max_tokens: 1000,
            temperature: Some(0.7),
        };

        let json = serde_json::to_string(&request).unwrap();
        assert!(json.contains("claude-sonnet-4-20250514"));
        assert!(json.contains("Hello"));
        assert!(json.contains("You are helpful"));
    }

    #[test]
    fn test_claude_response_parsing() {
        let json = r#"{
            "id": "msg_123",
            "content": [
                {"type": "text", "text": "Hello!"}
            ],
            "stop_reason": "end_turn",
            "usage": {
                "input_tokens": 10,
                "output_tokens": 5
            }
        }"#;

        let response: ClaudeResponse = serde_json::from_str(json).unwrap();
        assert_eq!(response.content.len(), 1);
        match &response.content[0] {
            ClaudeResponseContent::Text { text } => assert_eq!(text, "Hello!"),
            _ => panic!("Expected text content"),
        }
    }

    #[test]
    fn test_claude_tool_use_parsing() {
        let json = r#"{
            "id": "msg_123",
            "content": [
                {"type": "tool_use", "id": "tool_1", "name": "read_file", "input": {"path": "test.txt"}}
            ],
            "stop_reason": "tool_use"
        }"#;

        let response: ClaudeResponse = serde_json::from_str(json).unwrap();
        assert_eq!(response.content.len(), 1);
        match &response.content[0] {
            ClaudeResponseContent::ToolUse { id, name, input } => {
                assert_eq!(id, "tool_1");
                assert_eq!(name, "read_file");
                assert_eq!(input["path"], "test.txt");
            }
            _ => panic!("Expected tool_use content"),
        }
    }

    #[test]
    fn test_ollama_request_serialization() {
        let request = OllamaRequest {
            model: "llama3.2".to_string(),
            messages: vec![OllamaMessage {
                role: "user".to_string(),
                content: "Hello".to_string(),
            }],
            stream: false,
            options: Some(OllamaOptions {
                temperature: 0.7,
                num_predict: 1000,
            }),
        };

        let json = serde_json::to_string(&request).unwrap();
        assert!(json.contains("llama3.2"));
        assert!(json.contains("Hello"));
        assert!(json.contains("\"stream\":false"));
    }

    #[test]
    fn test_ollama_response_parsing() {
        let json = r#"{
            "message": {
                "role": "assistant",
                "content": "Hello!"
            },
            "done": true,
            "eval_count": 5,
            "prompt_eval_count": 10
        }"#;

        let response: OllamaResponse = serde_json::from_str(json).unwrap();
        assert_eq!(response.message.content, "Hello!");
        assert!(response.done);
    }

    #[test]
    fn test_openai_error_parsing() {
        let json = r#"{
            "error": {
                "message": "Invalid API key",
                "type": "invalid_request_error",
                "code": "invalid_api_key"
            }
        }"#;

        let error: OpenAiError = serde_json::from_str(json).unwrap();
        assert_eq!(error.error.message, "Invalid API key");
    }

    #[test]
    fn test_claude_error_parsing() {
        let json = r#"{
            "error": {
                "message": "Invalid API key",
                "type": "authentication_error"
            }
        }"#;

        let error: ClaudeError = serde_json::from_str(json).unwrap();
        assert_eq!(error.error.message, "Invalid API key");
    }
}
