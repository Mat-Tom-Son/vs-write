# Agent Backend Security & Architecture Plan

This document outlines gaps between the current implementation and the `agent-builder-guide.md` specification, with a prioritized implementation plan.

---

## Executive Summary

The current agent backend is **functional for local single-user use** but has **significant gaps** for production readiness:

| Category | Status | Risk Level |
|----------|--------|------------|
| Path Security | Good | Low |
| Extension Signing | Good | Low |
| Lua Sandbox | Adequate | Medium |
| API Key Management | **Poor** | **High** |
| Tool Approval Model | **Missing** | **High** |
| Session/Audit | **Missing** | Medium |
| Input Validation | **Weak** | Medium |
| Concurrency | Adequate | Low |

---

## Phase 1: Critical Security Fixes (Do First)

### 1.1 Remove API Key Exposure Command

**Files:** `src-tauri/src/agent_commands.rs`

**Problem:** `get_env_api_key()` (line 278) exposes secrets to frontend JavaScript.

**Fix:**
```rust
// DELETE these commands entirely:
// - get_env_api_key()
// - check_api_key_configured()

// REPLACE with backend-only key management:
// Keys should be read from:
// 1. Environment variables (for all providers, not just OpenAI)
// 2. A secure config file in app data directory
// 3. System keychain via tauri-plugin-stronghold or OS keyring
```

**Action Items:**
- [ ] Remove `get_env_api_key` command from lib.rs invoke_handler
- [ ] Remove `check_api_key_configured` command
- [ ] Add `AgentKeyManager` struct that reads keys from env vars for all providers
- [ ] Keys never cross the IPC boundary - backend reads them directly
- [ ] Frontend only sends provider selection, not the key itself

### 1.2 Backend-Only Credential Management

**New File:** `src-tauri/src/agent/credentials.rs`

```rust
pub struct CredentialManager {
    // Keys loaded at startup, never exposed
}

impl CredentialManager {
    pub fn new() -> Self { /* load from env/config */ }

    pub fn get_key(&self, provider: LlmProvider) -> Option<String> {
        match provider {
            LlmProvider::OpenAI => std::env::var("OPENAI_API_KEY").ok(),
            LlmProvider::Claude => std::env::var("ANTHROPIC_API_KEY").ok(),
            LlmProvider::OpenRouter => std::env::var("OPENROUTER_API_KEY").ok(),
            LlmProvider::Ollama => None, // No key needed
        }
    }

    pub fn has_key(&self, provider: LlmProvider) -> bool {
        self.get_key(provider).is_some()
    }
}
```

**Frontend Change:**
```typescript
// Before (INSECURE):
config: { api_key: appSettings.llm.openai.apiKey, ... }

// After (SECURE):
config: { provider: 'openai', model: 'gpt-4o-mini', ... }
// Backend reads key from its own secure storage
```

**Action Items:**
- [ ] Create `credentials.rs` module
- [ ] Add `CredentialManager` to Tauri app state
- [ ] Modify `InputConfig` to remove `api_key` field
- [ ] Update `run_native_agent` to get key from CredentialManager
- [ ] Add command `get_available_providers() -> Vec<ProviderStatus>` (returns which have keys configured)
- [ ] Update `NativeAgentPanel.tsx` to use provider selection UI

### 1.3 Add Tool Risk Classification

**File:** `src-tauri/src/agent/tools.rs`

**Problem:** All tools execute without confirmation, including destructive ones.

**Add:**
```rust
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum ToolRisk {
    Low,      // read_file, list_dir, glob, grep
    Medium,   // write_file, append_file
    High,     // delete_file, run_shell
}

impl Tool {
    pub fn risk_level(&self) -> ToolRisk {
        match self.function.name.as_str() {
            "read_file" | "list_dir" | "glob" | "grep" => ToolRisk::Low,
            "write_file" | "append_file" => ToolRisk::Medium,
            "delete_file" | "run_shell" => ToolRisk::High,
            _ => ToolRisk::Medium, // Extension tools default to medium
        }
    }
}
```

**Action Items:**
- [ ] Add `ToolRisk` enum to types.rs
- [ ] Add `risk_level()` method to Tool
- [ ] Extension manifest should declare risk level for each tool
- [ ] Default extension tools to Medium if not specified

### 1.4 Add Tool Approval Model

**File:** `src-tauri/src/agent/types.rs`

```rust
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub enum ApprovalMode {
    AutoApprove,      // All tools run automatically
    ApproveWrites,    // Pause for Medium/High risk tools
    ApproveAll,       // Pause for every tool
    DryRun,           // Never execute, just show what would happen
}

// Add to AgentConfig:
pub struct AgentConfig {
    // ... existing fields ...
    pub approval_mode: ApprovalMode,
}
```

**File:** `src-tauri/src/agent/core.rs`

```rust
// In the tool execution loop, add:
if config.approval_mode != ApprovalMode::AutoApprove {
    let risk = tool_schema.risk_level();
    let needs_approval = match config.approval_mode {
        ApprovalMode::ApproveWrites => risk >= ToolRisk::Medium,
        ApprovalMode::ApproveAll => true,
        ApprovalMode::DryRun => true,
        ApprovalMode::AutoApprove => false,
    };

    if needs_approval {
        // Emit event requesting approval
        if let Some(ref tx) = event_tx {
            tx.send(AgentEvent::ToolApprovalRequest {
                name: tool_name.clone(),
                args: args.clone(),
                risk_level: risk,
                run_id: Some(run_id.clone()),
            }).await;
        }

        // Wait for approval response (with timeout)
        // This requires a response channel or similar mechanism
    }
}
```

**Action Items:**
- [ ] Add `ApprovalMode` enum
- [ ] Add `ToolApprovalRequest` and `ToolApprovalResponse` events
- [ ] Implement approval wait loop with timeout
- [ ] Add dry-run mode that returns "would execute: {tool}({args})"
- [ ] Frontend UI for approval prompts

---

## Phase 2: Input Validation & Protocol

### 2.1 Add IPC Schema Validation

**Problem:** Frontend passes unvalidated input to Tauri commands.

**File:** `src-tauri/src/agent_commands.rs`

```rust
use validator::{Validate, ValidationError};

#[derive(Debug, Validate, Deserialize)]
pub struct ValidatedInputConfig {
    pub provider: LlmProvider,

    #[validate(length(min = 1, max = 100))]
    pub model: String,

    #[validate(range(min = 0.0, max = 2.0))]
    pub temperature: f32,

    #[validate(range(min = 1, max = 100000))]
    pub max_tokens: u32,

    #[validate(range(min = 1, max = 100))]
    pub max_iterations: u32,
}

// In run_native_agent:
config.validate().map_err(|e| format!("Invalid config: {}", e))?;
```

**Action Items:**
- [ ] Add `validator` crate to Cargo.toml
- [ ] Add validation to all input structs
- [ ] Validate workspace path is within allowed directories
- [ ] Validate task/prompt length limits
- [ ] Add protocol version field to all commands

### 2.2 Add Protocol Versioning

**File:** `src-tauri/src/agent_commands.rs`

```rust
pub const PROTOCOL_VERSION: &str = "1.0.0";

#[derive(Serialize)]
pub struct NativeAgentStatus {
    pub available: bool,
    pub version: String,
    pub protocol_version: String,  // ADD THIS
    pub supported_providers: Vec<ProviderInfo>,
}

#[tauri::command]
pub fn get_native_agent_status(
    credentials: State<'_, CredentialManager>,
) -> NativeAgentStatus {
    NativeAgentStatus {
        available: true,
        version: env!("CARGO_PKG_VERSION").to_string(),
        protocol_version: PROTOCOL_VERSION.to_string(),
        supported_providers: vec![
            ProviderInfo {
                id: "openai",
                available: credentials.has_key(LlmProvider::OpenAI),
            },
            // ... etc
        ],
    }
}
```

**Action Items:**
- [ ] Add `PROTOCOL_VERSION` constant
- [ ] Include in status response
- [ ] Frontend checks version compatibility on connect
- [ ] Document breaking changes in CHANGELOG

---

## Phase 3: Session & Audit System

### 3.1 Add Session Store

**New File:** `src-tauri/src/agent/session.rs`

```rust
use std::collections::HashMap;
use chrono::{DateTime, Utc};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Session {
    pub id: String,
    pub created_at: DateTime<Utc>,
    pub last_active: DateTime<Utc>,
    pub workspace: PathBuf,
    pub provider: LlmProvider,
    pub model: String,
    pub approval_mode: ApprovalMode,
    pub tool_call_count: u32,
    pub total_tokens: u32,
    pub status: SessionStatus,
}

#[derive(Debug, Clone, Copy)]
pub enum SessionStatus {
    Active,
    Paused,
    Completed,
    Failed,
}

pub struct SessionStore {
    sessions: RwLock<HashMap<String, Session>>,
}

impl SessionStore {
    pub fn create_session(&self, config: &AgentConfig, workspace: &Path) -> String {
        let session = Session {
            id: uuid::Uuid::new_v4().to_string(),
            created_at: Utc::now(),
            last_active: Utc::now(),
            workspace: workspace.to_path_buf(),
            provider: config.provider,
            model: config.model.clone(),
            approval_mode: config.approval_mode,
            tool_call_count: 0,
            total_tokens: 0,
            status: SessionStatus::Active,
        };

        let id = session.id.clone();
        self.sessions.write().unwrap().insert(id.clone(), session);
        id
    }

    pub fn update_session(&self, id: &str, f: impl FnOnce(&mut Session)) { ... }
    pub fn get_session(&self, id: &str) -> Option<Session> { ... }
}
```

**Action Items:**
- [ ] Create session.rs module
- [ ] Add SessionStore to Tauri app state
- [ ] Create session on agent run start
- [ ] Update session on each tool call
- [ ] Add commands: `get_session`, `list_sessions`, `pause_session`, `resume_session`

### 3.2 Add Audit Log

**New File:** `src-tauri/src/agent/audit.rs`

```rust
use rusqlite::{Connection, params};

#[derive(Debug, Serialize)]
pub struct AuditEntry {
    pub id: i64,
    pub timestamp: DateTime<Utc>,
    pub session_id: String,
    pub event_type: String,      // tool_call, llm_call, error, etc.
    pub tool_name: Option<String>,
    pub args_hash: String,       // SHA256 of args (don't store raw for privacy)
    pub result_summary: String,  // First 200 chars, redacted
    pub success: bool,
    pub duration_ms: u64,
}

pub struct AuditLog {
    conn: Connection,
}

impl AuditLog {
    pub fn new(db_path: &Path) -> Result<Self, String> {
        let conn = Connection::open(db_path)?;
        conn.execute(
            "CREATE TABLE IF NOT EXISTS audit_log (
                id INTEGER PRIMARY KEY,
                timestamp TEXT NOT NULL,
                session_id TEXT NOT NULL,
                event_type TEXT NOT NULL,
                tool_name TEXT,
                args_hash TEXT NOT NULL,
                result_summary TEXT,
                success INTEGER NOT NULL,
                duration_ms INTEGER NOT NULL
            )",
            [],
        )?;
        Ok(Self { conn })
    }

    pub fn log_tool_call(&self, entry: &AuditEntry) -> Result<(), String> { ... }

    pub fn query_by_session(&self, session_id: &str) -> Vec<AuditEntry> { ... }
}
```

**Action Items:**
- [ ] Create audit.rs module
- [ ] Add AuditLog to Tauri app state (or use existing SQLite plugin)
- [ ] Log every tool call with timing
- [ ] Add args hashing for privacy
- [ ] Redact sensitive patterns (API keys, passwords) from result summaries
- [ ] Add command: `get_audit_log(session_id, limit)`

---

## Phase 4: Lua Sandbox Hardening

### 4.1 Additional Sandbox Restrictions

**File:** `src-tauri/src/agent/lua_runtime.rs`

```rust
fn sandbox_lua(lua: &Lua) -> LuaResult<()> {
    let globals = lua.globals();

    // Existing removals
    globals.set("os", Value::Nil)?;
    globals.set("io", Value::Nil)?;
    globals.set("debug", Value::Nil)?;
    globals.set("loadfile", Value::Nil)?;
    globals.set("dofile", Value::Nil)?;
    globals.set("load", Value::Nil)?;
    globals.set("package", Value::Nil)?;

    // ADD: Additional dangerous functions
    globals.set("rawget", Value::Nil)?;
    globals.set("rawset", Value::Nil)?;
    globals.set("rawequal", Value::Nil)?;
    globals.set("rawlen", Value::Nil)?;
    globals.set("collectgarbage", Value::Nil)?;
    globals.set("newproxy", Value::Nil)?;  // Lua 5.1

    // ADD: Restrict string library
    let string_table: Table = globals.get("string")?;
    string_table.set("dump", Value::Nil)?;  // Prevent bytecode extraction

    // ADD: Restrict metatable access
    globals.set("setmetatable", create_restricted_setmetatable(lua)?)?;
    globals.set("getmetatable", create_restricted_getmetatable(lua)?)?;

    Ok(())
}

// Restricted setmetatable - only allow on new tables, not builtins
fn create_restricted_setmetatable(lua: &Lua) -> LuaResult<Function> {
    lua.create_function(|_, (table, meta): (Table, Value)| {
        // Allow setting metatable on user-created tables
        // Block attempts to modify string/table/etc metatables
        table.set_metatable(Some(meta.as_table().ok_or_else(||
            mlua::Error::runtime("metatable must be a table")
        )?));
        Ok(table)
    })
}
```

**Action Items:**
- [ ] Add raw* function removal
- [ ] Remove `string.dump`
- [ ] Add restricted metatable functions
- [ ] Add execution timeout to Lua scripts
- [ ] Add memory limit to Lua environment
- [ ] Create adversarial test suite for sandbox escapes

### 4.2 Lua Execution Limits

**File:** `src-tauri/src/agent/lua_runtime.rs`

```rust
impl LuaContext {
    pub fn new(workspace: &Path, shell_timeout: u64) -> Self {
        LuaContext {
            workspace: Arc::from(workspace),
            shell_timeout,
            max_execution_time: Duration::from_secs(30),
            max_memory_bytes: 50 * 1024 * 1024, // 50MB
        }
    }
}

pub fn create_lua_runtime(ctx: &LuaContext) -> LuaResult<Lua> {
    let lua = Lua::new();

    // Set memory limit
    lua.set_memory_limit(ctx.max_memory_bytes)?;

    // Set instruction limit (proxy for time limit)
    lua.set_hook(
        mlua::HookTriggers::every_nth_instruction(10000),
        move |lua, _| {
            // Check if we've exceeded time limit
            // This requires tracking start time externally
            Ok(())
        },
    )?;

    sandbox_lua(&lua)?;
    // ... rest of setup
}
```

**Action Items:**
- [ ] Add `set_memory_limit` call
- [ ] Add instruction hook for timeout
- [ ] Track execution start time
- [ ] Kill script if it exceeds limits
- [ ] Return clear error message on limit exceeded

---

## Phase 5: Path Security Hardening

### 5.1 Fix Symlink TOCTOU

**File:** `src-tauri/src/agent/tools.rs`

```rust
pub fn safe_path(workspace: &Path, requested: &str) -> Result<PathBuf, String> {
    // ... existing validation ...

    // ADD: Check for symlinks in the resolved path
    let final_path = if canonical_requested.exists() {
        canonical_requested
    } else {
        // For non-existent paths, verify no symlinks in parent chain
        let mut current = canonical_workspace.clone();
        for component in relative.components() {
            match component {
                std::path::Component::Normal(c) => {
                    current.push(c);
                    // Check if this intermediate path is a symlink
                    if current.exists() && current.is_symlink() {
                        let target = current.read_link()
                            .map_err(|e| format!("Failed to read symlink: {}", e))?;
                        // Verify symlink target is within workspace
                        let resolved = if target.is_absolute() {
                            target
                        } else {
                            current.parent().unwrap().join(target)
                        };
                        let canonical = resolved.canonicalize()
                            .map_err(|e| format!("Failed to resolve symlink: {}", e))?;
                        if !canonical.starts_with(&canonical_workspace) {
                            return Err(format!(
                                "Symlink at '{}' points outside workspace",
                                current.display()
                            ));
                        }
                    }
                }
                // ... existing cases ...
            }
        }
        current
    };

    Ok(final_path)
}
```

**Action Items:**
- [ ] Add symlink detection in path construction loop
- [ ] Verify symlink targets stay within workspace
- [ ] Add tests for symlink attack vectors
- [ ] Consider O_NOFOLLOW flag for file operations

### 5.2 Add Path Denylist

**File:** `src-tauri/src/agent/tools.rs`

```rust
const DENIED_PATHS: &[&str] = &[
    ".git",
    ".env",
    "credentials.json",
    "secrets.yaml",
    ".ssh",
    ".gnupg",
];

fn is_sensitive_path(path: &Path) -> bool {
    path.components().any(|c| {
        if let std::path::Component::Normal(name) = c {
            DENIED_PATHS.iter().any(|denied|
                name.to_string_lossy().eq_ignore_ascii_case(denied)
            )
        } else {
            false
        }
    })
}

pub fn safe_path(workspace: &Path, requested: &str) -> Result<PathBuf, String> {
    // ... existing validation ...

    // ADD: Check against denylist
    if is_sensitive_path(&final_path) {
        return Err(format!(
            "Access to sensitive path denied: {}",
            final_path.display()
        ));
    }

    Ok(final_path)
}
```

**Action Items:**
- [ ] Add `DENIED_PATHS` constant
- [ ] Add `is_sensitive_path()` function
- [ ] Make denylist configurable per-session
- [ ] Log denied path access attempts

---

## Phase 6: Observability & Debugging

### 6.1 Add Structured Logging

**File:** `src-tauri/src/agent/core.rs`

```rust
use tracing::{info, warn, error, instrument, Span};

#[instrument(
    skip(system_prompt, messages, config, event_tx, extensions),
    fields(
        run_id = %uuid::Uuid::new_v4(),
        workspace = %workspace.display(),
        provider = ?config.provider,
        model = %config.model,
    )
)]
pub async fn run_agent(...) -> Result<AgentRunResult, AgentError> {
    info!("Agent run starting");

    // ... existing code ...

    // For each tool call:
    let span = tracing::info_span!(
        "tool_call",
        tool = %tool_name,
        success = tracing::field::Empty,
        duration_ms = tracing::field::Empty,
    );
    let _guard = span.enter();

    let start = std::time::Instant::now();
    let result = dispatch_tool(...);
    let duration = start.elapsed();

    Span::current().record("success", result.is_ok());
    Span::current().record("duration_ms", duration.as_millis() as u64);

    // ... rest of loop
}
```

**Action Items:**
- [ ] Add `tracing` crate to Cargo.toml
- [ ] Add `#[instrument]` to key functions
- [ ] Add structured fields to spans
- [ ] Configure JSON log output for production
- [ ] Add log redaction for sensitive patterns
- [ ] Add log rotation

### 6.2 Add Metrics Collection

**New File:** `src-tauri/src/agent/metrics.rs`

```rust
use std::sync::atomic::{AtomicU64, Ordering};

pub struct AgentMetrics {
    pub total_runs: AtomicU64,
    pub total_tool_calls: AtomicU64,
    pub total_tokens: AtomicU64,
    pub total_errors: AtomicU64,
    pub tool_call_durations_ms: RwLock<Vec<u64>>,
}

impl AgentMetrics {
    pub fn record_run(&self) {
        self.total_runs.fetch_add(1, Ordering::Relaxed);
    }

    pub fn record_tool_call(&self, duration_ms: u64) {
        self.total_tool_calls.fetch_add(1, Ordering::Relaxed);
        self.tool_call_durations_ms.write().unwrap().push(duration_ms);
    }

    pub fn get_stats(&self) -> MetricsSnapshot { ... }
}
```

**Action Items:**
- [ ] Create metrics.rs module
- [ ] Add AgentMetrics to Tauri app state
- [ ] Record metrics in agent loop
- [ ] Add command: `get_agent_metrics()`
- [ ] Add P50/P99 latency calculations

---

## Phase 7: Cancellation & Concurrency

### 7.1 Wire Cancellation Token into Agent Loop

**File:** `src-tauri/src/agent/core.rs`

**Problem:** Cancellation token is created but never checked.

```rust
pub async fn run_agent(
    // ... existing params ...
    cancel_token: Option<CancellationToken>,  // ADD THIS
) -> Result<AgentRunResult, AgentError> {
    // In the loop:
    for iteration in 0..config.max_iterations {
        // ADD: Check for cancellation
        if let Some(ref token) = cancel_token {
            if token.is_cancelled() {
                log::info!("Agent run cancelled by user");
                if let Some(ref tx) = event_tx {
                    let _ = tx.send(AgentEvent::Cancelled {
                        run_id: Some(run_id.clone())
                    }).await;
                }
                return Err(AgentError::Cancelled);
            }
        }

        // ... rest of loop
    }
}
```

**Action Items:**
- [ ] Add `cancel_token` parameter to `run_agent`
- [ ] Pass token from `run_native_agent` command
- [ ] Check token at start of each iteration
- [ ] Check token before each tool call
- [ ] Add `AgentEvent::Cancelled` variant
- [ ] Clean up running task on cancellation

### 7.2 Add Rate Limiting

**New File:** `src-tauri/src/agent/rate_limit.rs`

```rust
use std::time::{Duration, Instant};
use tokio::sync::Semaphore;

pub struct RateLimiter {
    // Limit concurrent agent runs
    concurrent_runs: Semaphore,

    // Limit tool calls per minute
    tool_calls_per_minute: u32,
    recent_tool_calls: RwLock<Vec<Instant>>,
}

impl RateLimiter {
    pub fn new(max_concurrent: usize, tools_per_min: u32) -> Self {
        Self {
            concurrent_runs: Semaphore::new(max_concurrent),
            tool_calls_per_minute: tools_per_min,
            recent_tool_calls: RwLock::new(Vec::new()),
        }
    }

    pub async fn acquire_run_permit(&self) -> Result<SemaphorePermit, String> {
        self.concurrent_runs
            .acquire()
            .await
            .map_err(|_| "Rate limit: too many concurrent runs".to_string())
    }

    pub fn check_tool_rate(&self) -> Result<(), String> {
        let mut calls = self.recent_tool_calls.write().unwrap();
        let cutoff = Instant::now() - Duration::from_secs(60);
        calls.retain(|t| *t > cutoff);

        if calls.len() >= self.tool_calls_per_minute as usize {
            return Err("Rate limit: too many tool calls per minute".to_string());
        }

        calls.push(Instant::now());
        Ok(())
    }
}
```

**Action Items:**
- [ ] Create rate_limit.rs module
- [ ] Add RateLimiter to Tauri app state
- [ ] Acquire permit before agent run
- [ ] Check tool rate before each tool call
- [ ] Make limits configurable
- [ ] Add rate limit exceeded event

---

## Phase 8: "Doctor" Health Checks

### 8.1 Add Health Check Command

**New File:** `src-tauri/src/agent/doctor.rs`

```rust
#[derive(Debug, Serialize)]
pub struct HealthIssue {
    pub severity: String,  // warning, error
    pub category: String,  // credentials, permissions, config
    pub message: String,
    pub remediation: String,
}

#[derive(Debug, Serialize)]
pub struct HealthReport {
    pub healthy: bool,
    pub issues: Vec<HealthIssue>,
    pub checked_at: String,
}

pub fn run_health_check(
    credentials: &CredentialManager,
    extensions: &ExtensionRegistry,
) -> HealthReport {
    let mut issues = Vec::new();

    // Check: No API keys configured
    let has_any_key = [LlmProvider::OpenAI, LlmProvider::Claude, LlmProvider::OpenRouter]
        .iter()
        .any(|p| credentials.has_key(*p));

    if !has_any_key {
        issues.push(HealthIssue {
            severity: "error".to_string(),
            category: "credentials".to_string(),
            message: "No LLM API keys configured".to_string(),
            remediation: "Set OPENAI_API_KEY, ANTHROPIC_API_KEY, or OPENROUTER_API_KEY environment variable".to_string(),
        });
    }

    // Check: Unsigned extensions loaded
    for ext_id in extensions.list_extensions() {
        // Check signature status
        // ...
    }

    // Check: High-risk tools enabled without approval mode
    // ...

    HealthReport {
        healthy: issues.is_empty(),
        issues,
        checked_at: chrono::Utc::now().to_rfc3339(),
    }
}
```

**Action Items:**
- [ ] Create doctor.rs module
- [ ] Add credential presence checks
- [ ] Add unsigned extension warnings
- [ ] Add risky configuration warnings
- [ ] Add command: `run_health_check()`
- [ ] Run health check on app startup
- [ ] Show health warnings in UI

---

## Implementation Priority

### Immediate (This Week)
1. **Remove `get_env_api_key`** - Security critical
2. **Add backend credential management** - Required for #1
3. **Add input validation** - Prevent injection

### Short-term (2 Weeks)
4. **Add tool risk levels** - Foundation for approval
5. **Add approval mode** - User control over tool execution
6. **Wire cancellation token** - User can stop runaway agents

### Medium-term (1 Month)
7. **Add session store** - Track agent runs
8. **Add audit logging** - Compliance and debugging
9. **Harden Lua sandbox** - Reduce attack surface
10. **Add health checks** - Proactive issue detection

### Long-term (Ongoing)
11. **Add structured logging** - Operational visibility
12. **Add metrics** - Performance monitoring
13. **Add rate limiting** - Abuse prevention
14. **Fix symlink TOCTOU** - Edge case security

---

## Testing Requirements

Each phase should include:

1. **Unit Tests**
   - Credential manager isolation
   - Validation schema edge cases
   - Risk level classification
   - Audit log serialization

2. **Integration Tests**
   - End-to-end agent run with approval
   - Cancellation mid-run
   - Session persistence across restarts

3. **Security Tests**
   - API key leakage attempts
   - Lua sandbox escape attempts
   - Path traversal with symlinks
   - Input injection attacks

4. **Load Tests**
   - Concurrent agent runs
   - Rate limiter behavior
   - Large audit log queries

---

## Migration Notes

### Breaking Changes for Frontend

1. **Config no longer accepts `api_key`**
   - Frontend must use provider selection
   - Backend reads keys from environment

2. **New events for approval flow**
   - `ToolApprovalRequest` must be handled
   - Timeout if no response

3. **New status fields**
   - `protocol_version` in status
   - `supported_providers` array

### Environment Variables

After migration, the following env vars are recognized:
```
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
OPENROUTER_API_KEY=sk-or-...
```

---

*Document Version: 1.0*
*Last Updated: 2026-01-26*
