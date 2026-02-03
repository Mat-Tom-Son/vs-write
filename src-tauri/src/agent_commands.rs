//! Tauri commands for the native Rust agent.
//!
//! These commands expose the agent functionality to the frontend via Tauri's IPC.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, RwLock};
use tauri::{AppHandle, Emitter, State};
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

use crate::agent::credentials::{CredentialManager, ProviderStatus, SharedCredentialManager};
use crate::agent::lua_extensions::{ExtensionRegistry, HookResult, LifecycleHook};
use crate::agent::session::{Session, SharedSessionStore, AuditEntry};
use crate::agent::{self, AgentConfig, AgentEvent, LlmProvider, Message, MessageRole, ToolApprovalStore};

/// Protocol version for the native agent API
pub const PROTOCOL_VERSION: &str = "1.1.0";

/// Maximum concurrent agent runs allowed
/// This prevents resource exhaustion from too many simultaneous LLM calls
pub const MAX_CONCURRENT_RUNS: usize = 3;

/// Shared extension registry state (RwLock allows concurrent reads)
pub type SharedExtensionRegistry = Arc<RwLock<ExtensionRegistry>>;

/// Running agent tasks that can be cancelled
pub type RunningTasks = Arc<RwLock<HashMap<String, CancellationToken>>>;

// ============================================================================
// Command Types
// ============================================================================

/// Input message from the frontend
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InputMessage {
    pub role: String,
    pub content: String,
}

impl From<InputMessage> for Message {
    fn from(msg: InputMessage) -> Self {
        let role = match msg.role.as_str() {
            "developer" => MessageRole::Developer,
            "system" => MessageRole::System,
            "assistant" => MessageRole::Assistant,
            "tool" => MessageRole::Tool,
            _ => MessageRole::User,
        };
        Message {
            role,
            content: Some(msg.content),
            tool_calls: None,
            tool_call_id: None,
        }
    }
}

/// Configuration input from frontend
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InputConfig {
    /// LLM provider to use (openai, claude, ollama)
    #[serde(default)]
    pub provider: LlmProvider,
    /// API key for the provider (from frontend Settings UI)
    /// Falls back to environment variables via CredentialManager if not provided
    #[serde(default)]
    pub api_key: Option<String>,
    /// Model to use
    #[serde(default = "default_model")]
    pub model: String,
    /// Temperature for sampling
    #[serde(default = "default_temperature")]
    pub temperature: f32,
    /// Max tokens in response
    #[serde(default = "default_max_tokens")]
    pub max_tokens: u32,
    /// Max agent iterations
    #[serde(default = "default_max_iterations")]
    pub max_iterations: u32,
    /// Optional custom base URL
    #[serde(default)]
    pub base_url: Option<String>,
    /// Tool approval mode
    #[serde(default)]
    pub approval_mode: crate::agent::types::ApprovalMode,
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

impl InputConfig {
    /// Validate the input configuration
    pub fn validate(&self) -> Result<(), String> {
        // Validate model name length
        if self.model.is_empty() {
            return Err("Model name cannot be empty".to_string());
        }
        if self.model.len() > 100 {
            return Err("Model name too long (max 100 characters)".to_string());
        }

        // Validate temperature range
        if self.temperature < 0.0 || self.temperature > 2.0 {
            return Err(format!(
                "Temperature must be between 0.0 and 2.0 (got {})",
                self.temperature
            ));
        }

        // Validate max_tokens
        if self.max_tokens == 0 {
            return Err("max_tokens must be at least 1".to_string());
        }
        if self.max_tokens > 200000 {
            return Err("max_tokens cannot exceed 200000".to_string());
        }

        // Validate max_iterations
        if self.max_iterations == 0 {
            return Err("max_iterations must be at least 1".to_string());
        }
        if self.max_iterations > 100 {
            return Err("max_iterations cannot exceed 100".to_string());
        }

        // Validate base_url if provided
        if let Some(ref url) = self.base_url {
            if url.is_empty() {
                return Err("base_url cannot be empty if provided".to_string());
            }
            if !url.starts_with("http://") && !url.starts_with("https://") {
                return Err("base_url must start with http:// or https://".to_string());
            }
        }

        Ok(())
    }

    /// Convert to AgentConfig, using CredentialManager as fallback if no frontend key provided
    pub fn into_agent_config(self, credentials: &CredentialManager) -> Result<AgentConfig, String> {
        // Validate first
        self.validate()?;
        // Use frontend-provided key (primary), fall back to environment variables
        let api_key = if let Some(key) = self.api_key.filter(|k| !k.is_empty()) {
            // Frontend provided a key via Settings UI (normal path)
            key
        } else {
            // Fall back to environment variable via CredentialManager
            credentials
                .get_key(self.provider)
                .ok_or_else(|| format!(
                    "No API key configured for provider {:?}. Please set your API key in Settings.",
                    self.provider
                ))?
        };

        Ok(AgentConfig {
            provider: self.provider,
            api_key,
            model: self.model,
            temperature: self.temperature,
            max_tokens: self.max_tokens,
            max_iterations: self.max_iterations,
            shell_timeout: 30,
            base_url: self.base_url,
            approval_mode: self.approval_mode,
        })
    }
}

/// Result returned to the frontend
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentResult {
    pub success: bool,
    pub response: Option<String>,
    pub error: Option<String>,
    pub tool_call_count: usize,
}

/// Status of the native agent
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NativeAgentStatus {
    pub available: bool,
    pub version: String,
    pub protocol_version: String,
    pub supported_providers: Vec<ProviderStatus>,
}

// ============================================================================
// Tauri Commands
// ============================================================================

/// Run the native agent with a task
#[tauri::command]
pub async fn run_native_agent(
    app: AppHandle,
    credentials: State<'_, SharedCredentialManager>,
    extensions: State<'_, SharedExtensionRegistry>,
    running_tasks: State<'_, RunningTasks>,
    session_store: State<'_, SharedSessionStore>,
    tool_approvals: State<'_, ToolApprovalStore>,
    task: String,
    system_prompt: String,
    workspace: String,
    messages: Vec<InputMessage>,
    config: InputConfig,
) -> Result<AgentResult, String> {
    log::info!("Running native agent with task: {}", task);

    // Input validation
    if task.is_empty() {
        return Err("Task cannot be empty".to_string());
    }
    if task.len() > 100000 {
        return Err("Task too long (max 100000 characters)".to_string());
    }
    if system_prompt.len() > 50000 {
        return Err("System prompt too long (max 50000 characters)".to_string());
    }
    if messages.len() > 100 {
        return Err("Too many messages in history (max 100)".to_string());
    }

    // Validate workspace path
    let workspace_path = PathBuf::from(&workspace);
    if !workspace_path.exists() {
        return Err(format!("Workspace path does not exist: {}", workspace));
    }
    if !workspace_path.is_dir() {
        return Err(format!("Workspace path is not a directory: {}", workspace));
    }
    // Ensure workspace path is absolute to prevent traversal tricks
    let workspace_path = workspace_path.canonicalize().map_err(|e| {
        format!("Failed to resolve workspace path: {}", e)
    })?;

    // Rate limiting: check concurrent run count before allowing new runs
    {
        let tasks = running_tasks
            .read()
            .map_err(|e| format!("Failed to read running tasks: {}", e))?;
        if tasks.len() >= MAX_CONCURRENT_RUNS {
            return Err(format!(
                "Too many concurrent agent runs ({}/{}). Please wait for an existing run to complete or cancel one.",
                tasks.len(),
                MAX_CONCURRENT_RUNS
            ));
        }
    }

    // Create cancellation token for this task
    let cancel_token = CancellationToken::new();
    let run_id = uuid::Uuid::new_v4().to_string();

    // Register the task (double-check limit in case of race condition)
    {
        let mut tasks = running_tasks
            .write()
            .map_err(|e| format!("Failed to write running tasks: {}", e))?;

        // Double-check limit inside write lock to prevent race conditions
        if tasks.len() >= MAX_CONCURRENT_RUNS {
            return Err(format!(
                "Too many concurrent agent runs ({}/{}). Please wait for an existing run to complete or cancel one.",
                tasks.len(),
                MAX_CONCURRENT_RUNS
            ));
        }

        tasks.insert(run_id.clone(), cancel_token.clone());
    }

    // Convert inputs - use CredentialManager for API key
    let agent_config: AgentConfig = config.into_agent_config(&credentials)?;

    // Create session for tracking this agent run
    let session_id = session_store.create_session(
        workspace_path.clone(),
        agent_config.provider,
        agent_config.model.clone(),
        agent_config.approval_mode,
        task.clone(),
    );
    log::info!("Created session {} for run {}", session_id, run_id);
    let conversation: Vec<Message> = messages.into_iter().map(|m| m.into()).collect();

    // Get extension registry for the agent (read access is sufficient)
    let ext_registry = {
        let registry = extensions.read().map_err(|e| format!("Failed to read extension registry: {}", e))?;
        // Clone the registry data into an Arc for the agent
        Arc::new(registry.clone())
    };

    // Create event channel
    let (tx, mut rx) = mpsc::channel::<AgentEvent>(32);

    // Spawn task to forward events to frontend
    let app_handle = app.clone();
    tokio::spawn(async move {
        while let Some(event) = rx.recv().await {
            if let Err(e) = app_handle.emit("native-agent-event", &event) {
                log::warn!("Failed to emit agent event: {}", e);
            }
        }
    });

    // Run the agent with extensions
    // Clone run_id and running_tasks for cleanup
    let run_id_cleanup = run_id.clone();
    let running_tasks_inner = running_tasks.inner().clone();

    // Run the agent with extensions and cancellation support
    let result = agent::run_agent(
        &task,
        &system_prompt,
        conversation,
        &workspace_path,
        agent_config,
        Some(tx),
        Some(ext_registry),
        Some(tool_approvals.inner().clone()),
        Some(cancel_token),
    )
    .await;

    // Clean up the task from running tasks
    {
        if let Ok(mut tasks) = running_tasks_inner.write() {
            tasks.remove(&run_id_cleanup);
        }
    }

    // Clone session store and session_id for result handling
    let session_store_inner = session_store.inner().clone();

    match result {
        Ok(result) => {
            // Update session as completed
            session_store_inner.update_session(&session_id, |s| {
                if let Some(ref usage) = result.usage {
                    s.record_tokens(usage.total_tokens);
                }
                s.complete();
            });

            Ok(AgentResult {
                success: true,
                response: Some(result.response),
                error: None,
                tool_call_count: result.tool_results.len(),
            })
        }
        Err(e) => {
            let error_msg = e.to_string();

            // Update session as failed (or cancelled)
            session_store_inner.update_session(&session_id, |s| {
                if error_msg.contains("cancelled") || error_msg.contains("Cancelled") {
                    s.cancel();
                } else {
                    s.fail(error_msg.clone());
                }
            });

            // Also emit error event
            let _ = app.emit(
                "native-agent-event",
                AgentEvent::Error {
                    error: error_msg.clone(),
                    run_id: Some(run_id),
                },
            );
            Ok(AgentResult {
                success: false,
                response: None,
                error: Some(error_msg),
                tool_call_count: 0,
            })
        }
    }
}

/// Respond to a pending tool approval request.
#[tauri::command]
pub async fn respond_tool_approval(
    tool_approvals: State<'_, ToolApprovalStore>,
    approval_id: String,
    approved: bool,
) -> Result<(), String> {
    let tx = {
        let mut pending = tool_approvals.lock().await;
        pending.remove(&approval_id)
    };

    match tx {
        Some(sender) => sender
            .send(approved)
            .map_err(|_| "Approval request already resolved".to_string()),
        None => Err("Unknown or expired approval_id".to_string()),
    }
}

/// Cancel a running agent task
#[tauri::command]
pub fn cancel_agent_task(
    running_tasks: State<'_, RunningTasks>,
    task_id: String,
) -> Result<bool, String> {
    let tasks = running_tasks
        .read()
        .map_err(|e| format!("Failed to read running tasks: {}", e))?;

    if let Some(token) = tasks.get(&task_id) {
        token.cancel();
        log::info!("Cancelled agent task: {}", task_id);
        Ok(true)
    } else {
        Ok(false)
    }
}

/// List running agent tasks
#[tauri::command]
pub fn list_running_tasks(
    running_tasks: State<'_, RunningTasks>,
) -> Result<Vec<String>, String> {
    let tasks = running_tasks
        .read()
        .map_err(|e| format!("Failed to read running tasks: {}", e))?;

    Ok(tasks.keys().cloned().collect())
}

/// Agent run capacity status
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunCapacityStatus {
    pub current_runs: usize,
    pub max_runs: usize,
    pub can_start_new: bool,
}

/// Get the current agent run capacity status
#[tauri::command]
pub fn get_agent_run_capacity(
    running_tasks: State<'_, RunningTasks>,
) -> Result<RunCapacityStatus, String> {
    let tasks = running_tasks
        .read()
        .map_err(|e| format!("Failed to read running tasks: {}", e))?;

    let current = tasks.len();
    Ok(RunCapacityStatus {
        current_runs: current,
        max_runs: MAX_CONCURRENT_RUNS,
        can_start_new: current < MAX_CONCURRENT_RUNS,
    })
}

/// Get the status of the native agent
#[tauri::command]
pub fn get_native_agent_status(
    credentials: State<'_, SharedCredentialManager>,
) -> NativeAgentStatus {
    NativeAgentStatus {
        available: true,
        version: env!("CARGO_PKG_VERSION").to_string(),
        protocol_version: PROTOCOL_VERSION.to_string(),
        supported_providers: credentials.get_provider_status(),
    }
}

/// Get available LLM providers and their configuration status
/// This replaces the old check_api_key_configured and get_env_api_key commands
/// with a secure alternative that doesn't expose the actual keys
#[tauri::command]
pub fn get_available_providers(
    credentials: State<'_, SharedCredentialManager>,
) -> Vec<ProviderStatus> {
    credentials.get_provider_status()
}

// ============================================================================
// Extension Management Commands
// ============================================================================

/// Extension info returned to frontend
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtensionInfo {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: Option<String>,
    pub tool_count: usize,
}

/// Load a Lua extension from a directory
#[tauri::command]
pub fn load_lua_extension(
    extensions: State<'_, SharedExtensionRegistry>,
    extension_path: String,
) -> Result<ExtensionInfo, String> {
    let path = PathBuf::from(&extension_path);
    if !path.exists() {
        return Err(format!("Extension path does not exist: {}", extension_path));
    }

    let mut registry = extensions
        .write()
        .map_err(|e| format!("Failed to write extension registry: {}", e))?;

    registry.load_extension(&path)?;

    // Get the loaded extension info
    // We need to read the manifest to get the info
    let manifest_path = path.join("manifest.json");
    let manifest_content = std::fs::read_to_string(&manifest_path)
        .map_err(|e| format!("Failed to read manifest: {}", e))?;
    let manifest: crate::agent::lua_extensions::ExtensionManifest =
        serde_json::from_str(&manifest_content)
            .map_err(|e| format!("Failed to parse manifest: {}", e))?;

    let lua_tool_count = manifest.tools.iter().filter(|t| t.lua_script.is_some()).count();

    Ok(ExtensionInfo {
        id: manifest.id,
        name: manifest.name,
        version: manifest.version,
        description: manifest.description,
        tool_count: lua_tool_count,
    })
}

/// Unload a Lua extension
#[tauri::command]
pub fn unload_lua_extension(
    extensions: State<'_, SharedExtensionRegistry>,
    extension_id: String,
) -> Result<(), String> {
    let mut registry = extensions
        .write()
        .map_err(|e| format!("Failed to write extension registry: {}", e))?;

    registry.unload_extension(&extension_id)
}

/// List all loaded Lua extensions
#[tauri::command]
pub fn list_lua_extensions(
    extensions: State<'_, SharedExtensionRegistry>,
) -> Result<Vec<String>, String> {
    let registry = extensions
        .read()
        .map_err(|e| format!("Failed to read extension registry: {}", e))?;

    Ok(registry.list_extensions().into_iter().map(|s| s.to_string()).collect())
}

/// Get tools from all loaded extensions
#[tauri::command]
pub fn get_extension_tools(
    extensions: State<'_, SharedExtensionRegistry>,
) -> Result<Vec<serde_json::Value>, String> {
    let registry = extensions
        .read()
        .map_err(|e| format!("Failed to read extension registry: {}", e))?;

    let tools = registry.get_extension_tool_schemas();
    let tool_infos: Vec<serde_json::Value> = tools
        .iter()
        .map(|t| {
            serde_json::json!({
                "name": t.function.name,
                "description": t.function.description,
            })
        })
        .collect();

    Ok(tool_infos)
}

// ============================================================================
// Lifecycle Hook Commands
// ============================================================================

/// Execute a lifecycle hook for a specific extension
#[tauri::command]
pub fn execute_extension_hook(
    extensions: State<'_, SharedExtensionRegistry>,
    extension_id: String,
    hook_name: String,
    args: serde_json::Value,
    workspace: String,
) -> Result<HookResult, String> {
    let hook = match hook_name.as_str() {
        "on_activate" => LifecycleHook::OnActivate,
        "on_deactivate" => LifecycleHook::OnDeactivate,
        "on_project_open" => LifecycleHook::OnProjectOpen,
        "on_project_close" => LifecycleHook::OnProjectClose,
        "on_section_save" => LifecycleHook::OnSectionSave,
        "on_entity_change" => LifecycleHook::OnEntityChange,
        _ => return Err(format!("Unknown hook: {}", hook_name)),
    };

    let workspace_path = std::path::PathBuf::from(&workspace);
    if !workspace_path.exists() {
        return Err(format!("Workspace path does not exist: {}", workspace));
    }

    let registry = extensions
        .read()
        .map_err(|e| format!("Failed to read extension registry: {}", e))?;

    registry.execute_hook(&extension_id, hook, args, &workspace_path, 30)
}

/// Execute a lifecycle hook for all extensions that have it enabled
#[tauri::command]
pub fn execute_hook_all(
    extensions: State<'_, SharedExtensionRegistry>,
    hook_name: String,
    args: serde_json::Value,
    workspace: String,
) -> Result<Vec<(String, HookResult)>, String> {
    let hook = match hook_name.as_str() {
        "on_activate" => LifecycleHook::OnActivate,
        "on_deactivate" => LifecycleHook::OnDeactivate,
        "on_project_open" => LifecycleHook::OnProjectOpen,
        "on_project_close" => LifecycleHook::OnProjectClose,
        "on_section_save" => LifecycleHook::OnSectionSave,
        "on_entity_change" => LifecycleHook::OnEntityChange,
        _ => return Err(format!("Unknown hook: {}", hook_name)),
    };

    let workspace_path = std::path::PathBuf::from(&workspace);
    if !workspace_path.exists() {
        return Err(format!("Workspace path does not exist: {}", workspace));
    }

    let registry = extensions
        .read()
        .map_err(|e| format!("Failed to read extension registry: {}", e))?;

    Ok(registry.execute_hook_all(hook, args, &workspace_path, 30))
}

/// Get list of enabled hooks for an extension
#[tauri::command]
pub fn get_extension_hooks(
    extensions: State<'_, SharedExtensionRegistry>,
    extension_id: String,
) -> Result<Vec<String>, String> {
    let registry = extensions
        .read()
        .map_err(|e| format!("Failed to read extension registry: {}", e))?;

    let hooks = registry.get_enabled_hooks(&extension_id);
    Ok(hooks.iter().map(|h| h.function_name().to_string()).collect())
}

// ============================================================================
// Health Check Commands
// ============================================================================

/// Run a health check on the agent backend
#[tauri::command]
pub fn run_agent_health_check(
    credentials: State<'_, SharedCredentialManager>,
    extensions: State<'_, SharedExtensionRegistry>,
) -> Result<crate::agent::doctor::HealthReport, String> {
    let registry = extensions
        .read()
        .map_err(|e| format!("Failed to read extension registry: {}", e))?;

    Ok(crate::agent::doctor::run_health_check(&credentials, &registry))
}

// ============================================================================
// Session Management Commands
// ============================================================================

/// List recent agent sessions
#[tauri::command]
pub fn list_agent_sessions(
    session_store: State<'_, SharedSessionStore>,
    limit: Option<usize>,
) -> Vec<Session> {
    let limit = limit.unwrap_or(20).min(100);
    session_store.list_sessions(limit)
}

/// Get a specific session by ID
#[tauri::command]
pub fn get_agent_session(
    session_store: State<'_, SharedSessionStore>,
    session_id: String,
) -> Option<Session> {
    session_store.get_session(&session_id)
}

/// Get audit log entries for a session
#[tauri::command]
pub fn get_session_audit_log(
    session_store: State<'_, SharedSessionStore>,
    session_id: String,
    limit: Option<usize>,
) -> Vec<AuditEntry> {
    let limit = limit.unwrap_or(50).min(500);
    session_store.get_session_audit(&session_id, limit)
}

/// Get recent audit log entries across all sessions
#[tauri::command]
pub fn get_recent_audit_log(
    session_store: State<'_, SharedSessionStore>,
    limit: Option<usize>,
) -> Vec<AuditEntry> {
    let limit = limit.unwrap_or(50).min(500);
    session_store.get_recent_audit(limit)
}
