//! Health check "doctor" for the agent backend.
//!
//! This module provides diagnostics to identify configuration issues,
//! security risks, and other problems before they cause runtime errors.

use serde::{Deserialize, Serialize};

use super::credentials::CredentialManager;
use super::lua_extensions::ExtensionRegistry;
use super::types::LlmProvider;

// ============================================================================
// Health Check Types
// ============================================================================

/// Severity of a health issue
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum IssueSeverity {
    /// Informational - not a problem, just FYI
    Info,
    /// Warning - should be addressed but not blocking
    Warning,
    /// Error - will likely cause failures
    Error,
}

/// Category of a health issue
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum IssueCategory {
    /// Credential-related issues
    Credentials,
    /// Extension-related issues
    Extensions,
    /// Configuration issues
    Configuration,
    /// Security concerns
    Security,
    /// Runtime environment issues
    Environment,
}

/// A single health issue
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthIssue {
    /// Severity of this issue
    pub severity: IssueSeverity,
    /// Category of this issue
    pub category: IssueCategory,
    /// Short description of the issue
    pub message: String,
    /// Suggested remediation
    pub remediation: String,
}

impl HealthIssue {
    /// Create a new health issue
    pub fn new(
        severity: IssueSeverity,
        category: IssueCategory,
        message: impl Into<String>,
        remediation: impl Into<String>,
    ) -> Self {
        HealthIssue {
            severity,
            category,
            message: message.into(),
            remediation: remediation.into(),
        }
    }
}

/// Complete health report
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthReport {
    /// Whether the agent is healthy (no errors)
    pub healthy: bool,
    /// List of issues found
    pub issues: Vec<HealthIssue>,
    /// When the check was performed
    pub checked_at: String,
    /// Summary counts
    pub summary: HealthSummary,
}

/// Summary of health check results
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthSummary {
    pub total_issues: usize,
    pub errors: usize,
    pub warnings: usize,
    pub info: usize,
}

// ============================================================================
// Health Check Implementation
// ============================================================================

/// Run a comprehensive health check
pub fn run_health_check(
    credentials: &CredentialManager,
    extensions: &ExtensionRegistry,
) -> HealthReport {
    let mut issues = Vec::new();

    // Check credentials
    check_credentials(credentials, &mut issues);

    // Check extensions
    check_extensions(extensions, &mut issues);

    // Check environment
    check_environment(&mut issues);

    // Calculate summary
    let errors = issues.iter().filter(|i| i.severity == IssueSeverity::Error).count();
    let warnings = issues.iter().filter(|i| i.severity == IssueSeverity::Warning).count();
    let info = issues.iter().filter(|i| i.severity == IssueSeverity::Info).count();

    HealthReport {
        healthy: errors == 0,
        issues,
        checked_at: chrono::Utc::now().to_rfc3339(),
        summary: HealthSummary {
            total_issues: errors + warnings + info,
            errors,
            warnings,
            info,
        },
    }
}

/// Check credential configuration
fn check_credentials(credentials: &CredentialManager, issues: &mut Vec<HealthIssue>) {
    let providers = [
        (LlmProvider::OpenAI, "OPENAI_API_KEY"),
        (LlmProvider::Claude, "ANTHROPIC_API_KEY"),
        (LlmProvider::OpenRouter, "OPENROUTER_API_KEY"),
    ];

    let mut any_configured = false;

    for (provider, _env_var) in providers {
        if credentials.has_key(provider) {
            any_configured = true;
        }
    }

    // No API keys configured via environment (fallback)
    // Note: Primary source is frontend Settings UI, this only checks env var fallback
    if !any_configured {
        issues.push(HealthIssue::new(
            IssueSeverity::Info,
            IssueCategory::Credentials,
            "No fallback API keys in environment variables",
            "API keys are primarily configured in Settings. Environment variables serve as fallback.",
        ));
    }

    // Check if Ollama is available (common local option)
    if !any_configured {
        issues.push(HealthIssue::new(
            IssueSeverity::Info,
            IssueCategory::Credentials,
            "Ollama is available as a local alternative",
            "Install Ollama from https://ollama.ai for local LLM without API keys",
        ));
    }
}

/// Check extension configuration
fn check_extensions(extensions: &ExtensionRegistry, issues: &mut Vec<HealthIssue>) {
    let loaded = extensions.list_extensions();

    if loaded.is_empty() {
        // No extensions loaded - this is fine, just informational
        issues.push(HealthIssue::new(
            IssueSeverity::Info,
            IssueCategory::Extensions,
            "No extensions loaded",
            "Extensions can be loaded from the Settings panel to add custom tools",
        ));
        return;
    }

    // Report loaded extensions
    issues.push(HealthIssue::new(
        IssueSeverity::Info,
        IssueCategory::Extensions,
        format!("{} extension(s) loaded: {}", loaded.len(), loaded.join(", ")),
        "Review extensions in Settings to ensure they're from trusted sources",
    ));

    // Check extension signatures
    let manifest_paths = extensions.get_extension_manifest_paths();
    let mut unsigned_count = 0;
    let mut untrusted_count = 0;
    let mut invalid_count = 0;

    for (ext_id, manifest_path) in manifest_paths {
        match crate::extensions::verify_extension_signature(
            manifest_path.to_string_lossy().to_string()
        ) {
            Ok(verification) => {
                if !verification.is_signed {
                    unsigned_count += 1;
                    issues.push(HealthIssue::new(
                        IssueSeverity::Warning,
                        IssueCategory::Security,
                        format!("Extension '{}' is not signed", ext_id),
                        "Consider using signed extensions from trusted publishers",
                    ));
                } else if !verification.is_valid {
                    invalid_count += 1;
                    issues.push(HealthIssue::new(
                        IssueSeverity::Error,
                        IssueCategory::Security,
                        format!("Extension '{}' has an invalid signature", ext_id),
                        "This extension may have been tampered with. Consider removing it.",
                    ));
                } else if !verification.is_trusted {
                    untrusted_count += 1;
                    issues.push(HealthIssue::new(
                        IssueSeverity::Warning,
                        IssueCategory::Security,
                        format!(
                            "Extension '{}' is signed by untrusted publisher: {}",
                            ext_id,
                            verification.publisher_id.unwrap_or_else(|| "unknown".to_string())
                        ),
                        "Verify you trust this publisher before using the extension",
                    ));
                } else {
                    // Signed, valid, and trusted - this is good
                    issues.push(HealthIssue::new(
                        IssueSeverity::Info,
                        IssueCategory::Extensions,
                        format!(
                            "Extension '{}' verified (publisher: {})",
                            ext_id,
                            verification.publisher_id.unwrap_or_else(|| "unknown".to_string())
                        ),
                        "This extension is signed by a trusted publisher",
                    ));
                }
            }
            Err(e) => {
                issues.push(HealthIssue::new(
                    IssueSeverity::Warning,
                    IssueCategory::Extensions,
                    format!("Could not verify extension '{}': {}", ext_id, e),
                    "Extension signature could not be checked",
                ));
            }
        }
    }

    // Summary of signature status
    if unsigned_count > 0 || untrusted_count > 0 || invalid_count > 0 {
        issues.push(HealthIssue::new(
            IssueSeverity::Info,
            IssueCategory::Security,
            format!(
                "Extension signature summary: {} unsigned, {} untrusted, {} invalid",
                unsigned_count, untrusted_count, invalid_count
            ),
            "Consider removing unsigned or untrusted extensions for better security",
        ));
    }
}

/// Check environment configuration
fn check_environment(issues: &mut Vec<HealthIssue>) {
    // Check if debug mode is enabled
    if cfg!(debug_assertions) {
        issues.push(HealthIssue::new(
            IssueSeverity::Warning,
            IssueCategory::Environment,
            "Running in debug mode",
            "Use release builds for production: cargo build --release",
        ));
    }

    // Check for common issues on Windows
    #[cfg(windows)]
    {
        // Check if running with full path access
        if std::env::var("USERPROFILE").is_err() {
            issues.push(HealthIssue::new(
                IssueSeverity::Warning,
                IssueCategory::Environment,
                "USERPROFILE environment variable not set",
                "This may cause issues with workspace path resolution",
            ));
        }
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_health_issue_creation() {
        let issue = HealthIssue::new(
            IssueSeverity::Warning,
            IssueCategory::Credentials,
            "Test message",
            "Test remediation",
        );

        assert_eq!(issue.severity, IssueSeverity::Warning);
        assert_eq!(issue.category, IssueCategory::Credentials);
        assert_eq!(issue.message, "Test message");
    }

    #[test]
    fn test_health_check_runs() {
        let credentials = CredentialManager::new();
        let extensions = ExtensionRegistry::new();

        let report = run_health_check(&credentials, &extensions);

        // Should always have some issues (at least info messages)
        assert!(!report.issues.is_empty());
        assert!(!report.checked_at.is_empty());
    }

    #[test]
    fn test_health_summary() {
        let credentials = CredentialManager::new();
        let extensions = ExtensionRegistry::new();

        let report = run_health_check(&credentials, &extensions);

        // Summary should match issue counts
        assert_eq!(
            report.summary.total_issues,
            report.summary.errors + report.summary.warnings + report.summary.info
        );
    }
}
