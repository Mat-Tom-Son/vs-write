//! Session management for agent runs.
//!
//! This module tracks agent sessions and provides audit logging for tool calls.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::RwLock;

use super::types::{ApprovalMode, LlmProvider};

// ============================================================================
// Session Types
// ============================================================================

/// Status of an agent session
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SessionStatus {
    /// Session is actively running
    Active,
    /// Session is paused (waiting for approval)
    Paused,
    /// Session completed successfully
    Completed,
    /// Session failed with an error
    Failed,
    /// Session was cancelled by user
    Cancelled,
}

/// An agent session tracking a single run
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Session {
    /// Unique session identifier (same as run_id)
    pub id: String,
    /// When the session was created
    pub created_at: DateTime<Utc>,
    /// When the session was last active
    pub last_active: DateTime<Utc>,
    /// The workspace directory for this session
    pub workspace: PathBuf,
    /// LLM provider used
    pub provider: LlmProvider,
    /// Model used
    pub model: String,
    /// Approval mode for tool execution
    pub approval_mode: ApprovalMode,
    /// Number of tool calls made
    pub tool_call_count: u32,
    /// Total tokens used (prompt + completion)
    pub total_tokens: u32,
    /// Current status
    pub status: SessionStatus,
    /// Error message if failed
    pub error: Option<String>,
    /// The task that started this session
    pub task: String,
}

impl Session {
    /// Create a new session
    pub fn new(
        id: String,
        workspace: PathBuf,
        provider: LlmProvider,
        model: String,
        approval_mode: ApprovalMode,
        task: String,
    ) -> Self {
        let now = Utc::now();
        Session {
            id,
            created_at: now,
            last_active: now,
            workspace,
            provider,
            model,
            approval_mode,
            tool_call_count: 0,
            total_tokens: 0,
            status: SessionStatus::Active,
            error: None,
            task,
        }
    }

    /// Update the session after a tool call
    #[allow(dead_code)]
    pub fn record_tool_call(&mut self) {
        self.tool_call_count += 1;
        self.last_active = Utc::now();
    }

    /// Update token usage
    pub fn record_tokens(&mut self, tokens: u32) {
        self.total_tokens += tokens;
        self.last_active = Utc::now();
    }

    /// Mark session as completed
    pub fn complete(&mut self) {
        self.status = SessionStatus::Completed;
        self.last_active = Utc::now();
    }

    /// Mark session as failed
    pub fn fail(&mut self, error: String) {
        self.status = SessionStatus::Failed;
        self.error = Some(error);
        self.last_active = Utc::now();
    }

    /// Mark session as cancelled
    pub fn cancel(&mut self) {
        self.status = SessionStatus::Cancelled;
        self.last_active = Utc::now();
    }
}

// ============================================================================
// Audit Log Types
// ============================================================================

/// A single audit log entry for a tool call
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditEntry {
    /// Unique entry identifier
    pub id: String,
    /// Session this entry belongs to
    pub session_id: String,
    /// When this entry was created
    pub timestamp: DateTime<Utc>,
    /// Type of event
    pub event_type: AuditEventType,
    /// Tool name (for tool calls)
    pub tool_name: Option<String>,
    /// Hash of arguments (for privacy)
    pub args_hash: Option<String>,
    /// Summary of result (truncated and redacted)
    pub result_summary: Option<String>,
    /// Whether the operation succeeded
    pub success: bool,
    /// Duration in milliseconds
    pub duration_ms: u64,
}

/// Types of audit events
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AuditEventType {
    /// Session started
    SessionStart,
    /// Session ended
    SessionEnd,
    /// LLM API call
    LlmCall,
    /// Tool execution
    ToolCall,
    /// Tool was skipped (dry-run or denied)
    ToolSkipped,
    /// Error occurred
    Error,
}

impl AuditEntry {
    /// Create a new audit entry for a tool call
    #[allow(dead_code)]
    pub fn tool_call(
        session_id: &str,
        tool_name: &str,
        args: &serde_json::Value,
        result: &str,
        success: bool,
        duration_ms: u64,
    ) -> Self {
        // Hash arguments for privacy (don't store raw values)
        let args_str = serde_json::to_string(args).unwrap_or_default();
        let args_hash = format!("{:x}", md5_hash(&args_str));

        // Truncate and redact result summary
        let result_summary = redact_sensitive(truncate_string(result, 200));

        AuditEntry {
            id: uuid::Uuid::new_v4().to_string(),
            session_id: session_id.to_string(),
            timestamp: Utc::now(),
            event_type: AuditEventType::ToolCall,
            tool_name: Some(tool_name.to_string()),
            args_hash: Some(args_hash),
            result_summary: Some(result_summary),
            success,
            duration_ms,
        }
    }

    /// Create an audit entry for session start
    pub fn session_start(session_id: &str) -> Self {
        AuditEntry {
            id: uuid::Uuid::new_v4().to_string(),
            session_id: session_id.to_string(),
            timestamp: Utc::now(),
            event_type: AuditEventType::SessionStart,
            tool_name: None,
            args_hash: None,
            result_summary: None,
            success: true,
            duration_ms: 0,
        }
    }

    /// Create an audit entry for session end
    #[allow(dead_code)]
    pub fn session_end(session_id: &str, success: bool) -> Self {
        AuditEntry {
            id: uuid::Uuid::new_v4().to_string(),
            session_id: session_id.to_string(),
            timestamp: Utc::now(),
            event_type: AuditEventType::SessionEnd,
            tool_name: None,
            args_hash: None,
            result_summary: None,
            success,
            duration_ms: 0,
        }
    }
}

// ============================================================================
// Session Store
// ============================================================================

/// In-memory session store
pub struct SessionStore {
    sessions: RwLock<HashMap<String, Session>>,
    audit_log: RwLock<Vec<AuditEntry>>,
    max_sessions: usize,
    max_audit_entries: usize,
}

impl SessionStore {
    /// Create a new session store
    pub fn new() -> Self {
        SessionStore {
            sessions: RwLock::new(HashMap::new()),
            audit_log: RwLock::new(Vec::new()),
            max_sessions: 100,       // Keep last 100 sessions
            max_audit_entries: 1000, // Keep last 1000 audit entries
        }
    }

    /// Create a new session
    pub fn create_session(
        &self,
        workspace: PathBuf,
        provider: LlmProvider,
        model: String,
        approval_mode: ApprovalMode,
        task: String,
    ) -> String {
        let id = uuid::Uuid::new_v4().to_string();
        let session = Session::new(id.clone(), workspace, provider, model, approval_mode, task);

        // Add session
        {
            let mut sessions = self.sessions.write().unwrap();
            sessions.insert(id.clone(), session);

            // Cleanup old sessions if over limit
            if sessions.len() > self.max_sessions {
                // Find oldest completed sessions to remove
                let mut completed: Vec<_> = sessions
                    .iter()
                    .filter(|(_, s)| s.status != SessionStatus::Active)
                    .map(|(id, s)| (id.clone(), s.created_at))
                    .collect();
                completed.sort_by_key(|(_, created)| *created);

                for (old_id, _) in completed.iter().take(sessions.len() - self.max_sessions) {
                    sessions.remove(old_id);
                }
            }
        }

        // Log session start
        self.log_entry(AuditEntry::session_start(&id));

        id
    }

    /// Get a session by ID
    pub fn get_session(&self, id: &str) -> Option<Session> {
        self.sessions.read().ok()?.get(id).cloned()
    }

    /// Update a session
    pub fn update_session<F>(&self, id: &str, f: F)
    where
        F: FnOnce(&mut Session),
    {
        if let Ok(mut sessions) = self.sessions.write() {
            if let Some(session) = sessions.get_mut(id) {
                f(session);
            }
        }
    }

    /// List all sessions (most recent first)
    pub fn list_sessions(&self, limit: usize) -> Vec<Session> {
        let sessions = match self.sessions.read() {
            Ok(s) => s,
            Err(_) => return Vec::new(),
        };

        let mut list: Vec<_> = sessions.values().cloned().collect();
        list.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        list.truncate(limit);
        list
    }

    /// Add an audit entry
    pub fn log_entry(&self, entry: AuditEntry) {
        if let Ok(mut log) = self.audit_log.write() {
            log.push(entry);

            // Cleanup old entries if over limit
            let len = log.len();
            if len > self.max_audit_entries {
                log.drain(0..(len - self.max_audit_entries));
            }
        }
    }

    /// Log a tool call
    #[allow(dead_code)]
    pub fn log_tool_call(
        &self,
        session_id: &str,
        tool_name: &str,
        args: &serde_json::Value,
        result: &str,
        success: bool,
        duration_ms: u64,
    ) {
        let entry =
            AuditEntry::tool_call(session_id, tool_name, args, result, success, duration_ms);
        self.log_entry(entry);

        // Update session tool count
        self.update_session(session_id, |s| s.record_tool_call());
    }

    /// Get audit entries for a session
    pub fn get_session_audit(&self, session_id: &str, limit: usize) -> Vec<AuditEntry> {
        let log = match self.audit_log.read() {
            Ok(l) => l,
            Err(_) => return Vec::new(),
        };

        log.iter()
            .filter(|e| e.session_id == session_id)
            .cloned()
            .rev()
            .take(limit)
            .collect()
    }

    /// Get recent audit entries
    pub fn get_recent_audit(&self, limit: usize) -> Vec<AuditEntry> {
        let log = match self.audit_log.read() {
            Ok(l) => l,
            Err(_) => return Vec::new(),
        };

        log.iter().rev().take(limit).cloned().collect()
    }
}

impl Default for SessionStore {
    fn default() -> Self {
        Self::new()
    }
}

/// Shared session store type for Tauri state
pub type SharedSessionStore = std::sync::Arc<SessionStore>;

// ============================================================================
// Helper Functions
// ============================================================================

/// Simple hash function for argument hashing (not cryptographic)
#[allow(dead_code)]
fn md5_hash(input: &str) -> u64 {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};

    let mut hasher = DefaultHasher::new();
    input.hash(&mut hasher);
    hasher.finish()
}

/// Truncate a string to max length
#[allow(dead_code)]
fn truncate_string(s: &str, max_len: usize) -> String {
    if s.len() <= max_len {
        s.to_string()
    } else {
        format!("{}...", &s[..max_len])
    }
}

/// Redact sensitive patterns from a string
#[allow(dead_code)]
fn redact_sensitive(s: String) -> String {
    // Patterns to redact (API keys, passwords, etc.)
    let patterns: &[(&str, &str)] = &[
        (r"sk-[a-zA-Z0-9]{20,}", "[REDACTED_API_KEY]"),
        (r"sk-ant-[a-zA-Z0-9\-]{20,}", "[REDACTED_API_KEY]"),
        (
            r#"password["']?\s*[:=]\s*["'][^"']+["']"#,
            "password: [REDACTED]",
        ),
        (
            r#"secret["']?\s*[:=]\s*["'][^"']+["']"#,
            "secret: [REDACTED]",
        ),
    ];

    let mut result = s;
    for (pattern, replacement) in patterns {
        if let Ok(re) = regex::Regex::new(pattern) {
            result = re.replace_all(&result, *replacement).to_string();
        }
    }
    result
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_session_creation() {
        let store = SessionStore::new();
        let id = store.create_session(
            PathBuf::from("/tmp/workspace"),
            LlmProvider::OpenAI,
            "gpt-5-mini".to_string(),
            ApprovalMode::AutoApprove,
            "Test task".to_string(),
        );

        let session = store.get_session(&id).unwrap();
        assert_eq!(session.status, SessionStatus::Active);
        assert_eq!(session.tool_call_count, 0);
    }

    #[test]
    fn test_session_update() {
        let store = SessionStore::new();
        let id = store.create_session(
            PathBuf::from("/tmp"),
            LlmProvider::OpenAI,
            "gpt-5-mini".to_string(),
            ApprovalMode::AutoApprove,
            "Test".to_string(),
        );

        store.update_session(&id, |s| {
            s.record_tool_call();
            s.record_tokens(100);
        });

        let session = store.get_session(&id).unwrap();
        assert_eq!(session.tool_call_count, 1);
        assert_eq!(session.total_tokens, 100);
    }

    #[test]
    fn test_audit_logging() {
        let store = SessionStore::new();
        let session_id = "test-session";

        store.log_tool_call(
            session_id,
            "read_file",
            &serde_json::json!({"path": "test.txt"}),
            "file contents",
            true,
            50,
        );

        let entries = store.get_session_audit(session_id, 10);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].tool_name, Some("read_file".to_string()));
        assert!(entries[0].success);
    }

    #[test]
    fn test_redact_sensitive() {
        let input = "API key: sk-abc123456789012345678901234567890".to_string();
        let redacted = redact_sensitive(input);
        assert!(redacted.contains("[REDACTED_API_KEY]"));
        assert!(!redacted.contains("sk-abc"));
    }

    #[test]
    fn test_truncate_string() {
        let short = "hello";
        assert_eq!(truncate_string(short, 10), "hello");

        let long = "hello world this is a long string";
        let truncated = truncate_string(long, 10);
        assert_eq!(truncated.len(), 13); // 10 + "..."
        assert!(truncated.ends_with("..."));
    }
}
