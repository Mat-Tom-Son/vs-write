//! Core types for the Rust agent module.
//!
//! This module defines all the data structures used throughout the agent:
//! - Tool definitions and results
//! - Agent configuration
//! - Message types for LLM communication
//! - Event types for streaming to the frontend

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ============================================================================
// Tool Risk & Approval Types
// ============================================================================

/// Risk level for a tool operation
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ToolRisk {
    /// Read-only operations: read_file, list_dir, glob, grep
    Low,
    /// Write operations: write_file, append_file
    Medium,
    /// Destructive or arbitrary execution: delete_file, run_shell
    High,
}

impl ToolRisk {
    /// Get the risk level for a built-in tool by name
    pub fn for_tool(tool_name: &str) -> Self {
        // Extract the base tool name (strip extension prefix if present)
        let base_name = if tool_name.contains(':') {
            // Extension tool - default to Medium unless we have metadata
            return ToolRisk::Medium;
        } else {
            tool_name
        };

        match base_name {
            "read_file" | "list_dir" | "glob" | "grep" => ToolRisk::Low,
            "write_file" | "append_file" => ToolRisk::Medium,
            "delete_file" | "run_shell" => ToolRisk::High,
            _ => ToolRisk::Medium, // Unknown tools default to Medium
        }
    }
}

/// Approval mode for tool execution
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum ApprovalMode {
    /// All tools run automatically without approval
    #[default]
    AutoApprove,
    /// Pause for approval on High risk tools only
    ApproveDangerous,
    /// Pause for approval on Medium and High risk tools
    ApproveWrites,
    /// Pause for approval on all tools
    ApproveAll,
    /// Never execute - just show what would happen (for testing)
    DryRun,
}

impl ApprovalMode {
    /// Check if a tool needs approval under this mode
    pub fn needs_approval(&self, risk: ToolRisk) -> bool {
        match self {
            ApprovalMode::AutoApprove => false,
            ApprovalMode::ApproveDangerous => risk >= ToolRisk::High,
            ApprovalMode::ApproveWrites => risk >= ToolRisk::Medium,
            ApprovalMode::ApproveAll => true,
            ApprovalMode::DryRun => true,
        }
    }
}

// ============================================================================
// Tool Types
// ============================================================================

/// JSON Schema for tool parameters
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JsonSchema {
    #[serde(rename = "type")]
    pub schema_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub properties: Option<HashMap<String, PropertySchema>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub required: Option<Vec<String>>,
}

/// Schema for individual properties
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PropertySchema {
    #[serde(rename = "type")]
    pub prop_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default: Option<serde_json::Value>,
}

/// Function definition within a tool
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FunctionDef {
    pub name: String,
    pub description: String,
    pub parameters: JsonSchema,
}

/// Tool definition for the LLM
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tool {
    #[serde(rename = "type")]
    pub tool_type: String,
    pub function: FunctionDef,
}

impl Tool {
    /// Create a new tool definition
    pub fn new(name: &str, description: &str, parameters: JsonSchema) -> Self {
        Tool {
            tool_type: "function".to_string(),
            function: FunctionDef {
                name: name.to_string(),
                description: description.to_string(),
                parameters,
            },
        }
    }
}

/// A tool call requested by the LLM
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCall {
    pub id: String,
    #[serde(rename = "type")]
    pub call_type: String,
    pub function: FunctionCall,
}

/// Function call details
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FunctionCall {
    pub name: String,
    pub arguments: String,
}

/// Result of executing a tool
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolResult {
    pub tool_call_id: String,
    pub output: String,
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub truncated: Option<bool>,
}

impl ToolResult {
    /// Create a successful result
    pub fn success(tool_call_id: &str, output: String) -> Self {
        ToolResult {
            tool_call_id: tool_call_id.to_string(),
            output,
            success: true,
            truncated: None,
        }
    }

    /// Create an error result
    pub fn error(tool_call_id: &str, error: String) -> Self {
        ToolResult {
            tool_call_id: tool_call_id.to_string(),
            output: format!("ERROR: {}", error),
            success: false,
            truncated: None,
        }
    }
}

// ============================================================================
// Agent Configuration
// ============================================================================

/// LLM provider selection
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum LlmProvider {
    #[default]
    OpenAI,
    Claude,
    Ollama,
    OpenRouter,
}

impl LlmProvider {
    /// Get the default base URL for this provider
    pub fn default_base_url(&self) -> &'static str {
        match self {
            LlmProvider::OpenAI => "https://api.openai.com/v1",
            LlmProvider::Claude => "https://api.anthropic.com/v1",
            LlmProvider::Ollama => "http://localhost:11434",
            LlmProvider::OpenRouter => "https://openrouter.ai/api/v1",
        }
    }

    /// Get the default model for this provider
    #[allow(dead_code)]
    pub fn default_model(&self) -> &'static str {
        match self {
            LlmProvider::OpenAI => "gpt-5-mini",
            LlmProvider::Claude => "claude-sonnet-4-20250514",
            LlmProvider::Ollama => "llama3.2",
            LlmProvider::OpenRouter => "openai/gpt-4o-mini",
        }
    }

    /// Check if this provider supports tool calling
    #[allow(dead_code)]
    pub fn supports_tools(&self) -> bool {
        match self {
            LlmProvider::OpenAI => true,
            LlmProvider::Claude => true,
            LlmProvider::Ollama => false, // Ollama doesn't support tools reliably
            LlmProvider::OpenRouter => true,
        }
    }
}

/// Configuration for the agent
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentConfig {
    /// LLM provider to use
    #[serde(default)]
    pub provider: LlmProvider,

    /// API key for the provider
    pub api_key: String,

    /// Model to use (e.g., "gpt-5-mini", "gpt-4.1", "claude-sonnet-4-20250514")
    #[serde(default = "default_model")]
    pub model: String,

    /// Temperature for sampling (0.0 - 2.0)
    #[serde(default = "default_temperature")]
    pub temperature: f32,

    /// Maximum tokens in the response
    #[serde(default = "default_max_tokens")]
    pub max_tokens: u32,

    /// Maximum number of agent iterations
    #[serde(default = "default_max_iterations")]
    pub max_iterations: u32,

    /// Timeout for shell commands in seconds
    #[serde(default = "default_shell_timeout")]
    pub shell_timeout: u64,

    /// Base URL for the API (optional, uses provider default if not set)
    #[serde(default)]
    pub base_url: Option<String>,

    /// Tool approval mode
    #[serde(default)]
    pub approval_mode: ApprovalMode,
}

fn default_model() -> String {
    "gpt-5-mini".to_string()
}

fn default_temperature() -> f32 {
    0.7
}

fn default_max_tokens() -> u32 {
    4096
}

fn default_max_iterations() -> u32 {
    8
}

fn default_shell_timeout() -> u64 {
    30
}

impl Default for AgentConfig {
    fn default() -> Self {
        AgentConfig {
            provider: LlmProvider::default(),
            api_key: String::new(),
            model: default_model(),
            temperature: default_temperature(),
            max_tokens: default_max_tokens(),
            max_iterations: default_max_iterations(),
            shell_timeout: default_shell_timeout(),
            base_url: None,
            approval_mode: ApprovalMode::default(),
        }
    }
}

#[allow(dead_code)]
impl AgentConfig {
    /// Create a new config with just an API key (defaults to OpenAI)
    pub fn new(api_key: &str) -> Self {
        AgentConfig {
            api_key: api_key.to_string(),
            ..Default::default()
        }
    }

    /// Create a config for a specific provider
    pub fn for_provider(provider: LlmProvider, api_key: &str) -> Self {
        AgentConfig {
            provider,
            api_key: api_key.to_string(),
            model: provider.default_model().to_string(),
            base_url: None,
            ..Default::default()
        }
    }

    /// Set the provider
    pub fn with_provider(mut self, provider: LlmProvider) -> Self {
        self.provider = provider;
        self
    }

    /// Set the model
    pub fn with_model(mut self, model: &str) -> Self {
        self.model = model.to_string();
        self
    }

    /// Set the temperature
    pub fn with_temperature(mut self, temperature: f32) -> Self {
        self.temperature = temperature.clamp(0.0, 2.0);
        self
    }

    /// Set max tokens
    pub fn with_max_tokens(mut self, max_tokens: u32) -> Self {
        self.max_tokens = max_tokens;
        self
    }

    /// Set base URL for API (overrides provider default)
    pub fn with_base_url(mut self, base_url: &str) -> Self {
        self.base_url = Some(base_url.to_string());
        self
    }

    /// Get the effective base URL (custom or provider default)
    pub fn effective_base_url(&self) -> String {
        self.base_url
            .clone()
            .unwrap_or_else(|| self.provider.default_base_url().to_string())
    }
}

// ============================================================================
// Message Types
// ============================================================================

/// Role of a message in the conversation
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MessageRole {
    Developer,
    System,
    User,
    Assistant,
    Tool,
}

/// A message in the conversation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Message {
    pub role: MessageRole,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<Vec<ToolCall>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
}

impl Message {
    /// Create a system message
    pub fn system(content: &str) -> Self {
        Message {
            role: MessageRole::System,
            content: Some(content.to_string()),
            tool_calls: None,
            tool_call_id: None,
        }
    }

    /// Create a developer message (preferred for OpenAI GPT-5+)
    pub fn developer(content: &str) -> Self {
        Message {
            role: MessageRole::Developer,
            content: Some(content.to_string()),
            tool_calls: None,
            tool_call_id: None,
        }
    }

    /// Create a user message
    pub fn user(content: &str) -> Self {
        Message {
            role: MessageRole::User,
            content: Some(content.to_string()),
            tool_calls: None,
            tool_call_id: None,
        }
    }

    /// Create an assistant message
    #[allow(dead_code)]
    pub fn assistant(content: &str) -> Self {
        Message {
            role: MessageRole::Assistant,
            content: Some(content.to_string()),
            tool_calls: None,
            tool_call_id: None,
        }
    }

    /// Create an assistant message with tool calls
    pub fn assistant_with_tools(content: Option<String>, tool_calls: Vec<ToolCall>) -> Self {
        Message {
            role: MessageRole::Assistant,
            content,
            tool_calls: Some(tool_calls),
            tool_call_id: None,
        }
    }

    /// Create a tool result message
    pub fn tool_result(tool_call_id: &str, content: &str) -> Self {
        Message {
            role: MessageRole::Tool,
            content: Some(content.to_string()),
            tool_calls: None,
            tool_call_id: Some(tool_call_id.to_string()),
        }
    }
}

// ============================================================================
// Event Types (for streaming to frontend)
// ============================================================================

/// Events emitted during agent execution for UI streaming
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AgentEvent {
    /// Agent has started processing
    Start {
        task: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        run_id: Option<String>,
    },

    /// A tool call is about to be executed
    ToolCallStart {
        name: String,
        args: serde_json::Value,
        #[serde(skip_serializing_if = "Option::is_none")]
        run_id: Option<String>,
    },

    /// A tool call has completed
    ToolCallComplete {
        name: String,
        args: serde_json::Value,
        result: String,
        success: bool,
        truncated: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        run_id: Option<String>,
    },

    /// Streaming text chunk from the assistant
    TextChunk {
        content: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        run_id: Option<String>,
    },

    /// Agent has completed with a final response
    Complete {
        response: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        usage: Option<Usage>,
        #[serde(skip_serializing_if = "Option::is_none")]
        run_id: Option<String>,
    },

    /// An error occurred
    Error {
        error: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        run_id: Option<String>,
    },

    /// Agent run was cancelled
    Cancelled {
        #[serde(skip_serializing_if = "Option::is_none")]
        run_id: Option<String>,
    },

    /// Tool requires user approval before execution
    ToolApprovalRequired {
        /// Unique ID for this approval request
        approval_id: String,
        /// Tool name
        name: String,
        /// Tool arguments
        args: serde_json::Value,
        /// Risk level of this tool
        risk: ToolRisk,
        #[serde(skip_serializing_if = "Option::is_none")]
        run_id: Option<String>,
    },

    /// Tool was skipped in dry-run mode
    ToolSkipped {
        name: String,
        args: serde_json::Value,
        reason: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        run_id: Option<String>,
    },
}

/// Token usage information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Usage {
    pub prompt_tokens: u32,
    pub completion_tokens: u32,
    pub total_tokens: u32,
}

// ============================================================================
// Error Types
// ============================================================================

/// Errors that can occur during agent execution
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum AgentError {
    /// Error calling the LLM API
    LlmError(String),

    /// Error executing a tool
    ToolError(String),

    /// Path security violation
    PathViolation(String),

    /// Configuration error
    ConfigError(String),

    /// Maximum iterations reached
    MaxIterationsReached,

    /// Request cancelled
    Cancelled,
}

impl std::fmt::Display for AgentError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AgentError::LlmError(msg) => write!(f, "LLM error: {}", msg),
            AgentError::ToolError(msg) => write!(f, "Tool error: {}", msg),
            AgentError::PathViolation(msg) => write!(f, "Path violation: {}", msg),
            AgentError::ConfigError(msg) => write!(f, "Config error: {}", msg),
            AgentError::MaxIterationsReached => write!(f, "Max iterations reached"),
            AgentError::Cancelled => write!(f, "Request cancelled"),
        }
    }
}

impl std::error::Error for AgentError {}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_llm_provider_defaults() {
        assert_eq!(LlmProvider::default(), LlmProvider::OpenAI);
        assert_eq!(LlmProvider::OpenAI.default_model(), "gpt-5-mini");
        assert_eq!(LlmProvider::Claude.default_model(), "claude-sonnet-4-20250514");
        assert_eq!(LlmProvider::Ollama.default_model(), "llama3.2");
    }

    #[test]
    fn test_llm_provider_base_urls() {
        assert_eq!(LlmProvider::OpenAI.default_base_url(), "https://api.openai.com/v1");
        assert_eq!(LlmProvider::Claude.default_base_url(), "https://api.anthropic.com/v1");
        assert_eq!(LlmProvider::Ollama.default_base_url(), "http://localhost:11434");
    }

    #[test]
    fn test_llm_provider_tool_support() {
        assert!(LlmProvider::OpenAI.supports_tools());
        assert!(LlmProvider::Claude.supports_tools());
        assert!(!LlmProvider::Ollama.supports_tools());
    }

    #[test]
    fn test_agent_config_defaults() {
        let config = AgentConfig::default();
        assert_eq!(config.provider, LlmProvider::OpenAI);
        assert_eq!(config.model, "gpt-5-mini");
        assert_eq!(config.temperature, 0.7);
        assert_eq!(config.max_tokens, 4096);
        assert_eq!(config.max_iterations, 8);
        assert!(config.base_url.is_none());
    }

    #[test]
    fn test_agent_config_builder() {
        let config = AgentConfig::new("test-key")
            .with_model("gpt-4o")
            .with_temperature(0.5)
            .with_max_tokens(2048);

        assert_eq!(config.api_key, "test-key");
        assert_eq!(config.model, "gpt-4o");
        assert_eq!(config.temperature, 0.5);
        assert_eq!(config.max_tokens, 2048);
    }

    #[test]
    fn test_agent_config_for_provider() {
        let config = AgentConfig::for_provider(LlmProvider::Claude, "sk-ant-key");
        assert_eq!(config.provider, LlmProvider::Claude);
        assert_eq!(config.model, "claude-sonnet-4-20250514");
        assert_eq!(config.api_key, "sk-ant-key");
    }

    #[test]
    fn test_effective_base_url() {
        let config = AgentConfig::default();
        assert_eq!(config.effective_base_url(), "https://api.openai.com/v1");

        let config = AgentConfig::default().with_base_url("https://custom.api.com");
        assert_eq!(config.effective_base_url(), "https://custom.api.com");

        let config = AgentConfig::for_provider(LlmProvider::Claude, "key");
        assert_eq!(config.effective_base_url(), "https://api.anthropic.com/v1");
    }

    #[test]
    fn test_temperature_clamping() {
        let config = AgentConfig::default().with_temperature(5.0);
        assert_eq!(config.temperature, 2.0);

        let config = AgentConfig::default().with_temperature(-1.0);
        assert_eq!(config.temperature, 0.0);
    }

    #[test]
    fn test_message_creation() {
        let developer = Message::developer("You are a helper");
        assert_eq!(developer.role, MessageRole::Developer);
        assert_eq!(developer.content, Some("You are a helper".to_string()));

        let system = Message::system("You are a helper");
        assert_eq!(system.role, MessageRole::System);
        assert_eq!(system.content, Some("You are a helper".to_string()));

        let user = Message::user("Hello");
        assert_eq!(user.role, MessageRole::User);

        let assistant = Message::assistant("Hi there");
        assert_eq!(assistant.role, MessageRole::Assistant);
    }

    #[test]
    fn test_tool_result() {
        let success = ToolResult::success("call-1", "file contents".to_string());
        assert!(success.success);
        assert_eq!(success.tool_call_id, "call-1");

        let error = ToolResult::error("call-2", "file not found".to_string());
        assert!(!error.success);
        assert!(error.output.starts_with("ERROR:"));
    }

    #[test]
    fn test_agent_event_serialization() {
        let event = AgentEvent::ToolCallComplete {
            name: "read_file".to_string(),
            args: serde_json::json!({"path": "test.txt"}),
            result: "contents".to_string(),
            success: true,
            truncated: false,
            run_id: None,
        };

        let json = serde_json::to_string(&event).unwrap();
        assert!(json.contains("tool_call_complete"));
        assert!(json.contains("read_file"));
    }
}
