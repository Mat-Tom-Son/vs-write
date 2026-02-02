//! Credential management for the native agent.
//!
//! This module provides fallback API key management via environment variables.
//! The primary source of API keys is the frontend Settings UI (stored in localStorage).
//! Environment variables serve as a fallback when no UI-provided key is available.

use serde::{Deserialize, Serialize};
use std::sync::Arc;

use super::types::LlmProvider;

// ============================================================================
// Credential Manager
// ============================================================================

/// Manages API credentials for LLM providers.
/// Keys are loaded from environment variables and never exposed to frontend.
#[derive(Debug, Clone)]
pub struct CredentialManager {
    // Keys are read on-demand from environment
    // This allows hot-reloading if env vars change
}

impl CredentialManager {
    /// Create a new credential manager
    pub fn new() -> Self {
        CredentialManager {}
    }

    /// Get the API key for a provider (if configured)
    pub fn get_key(&self, provider: LlmProvider) -> Option<String> {
        let env_var = match provider {
            LlmProvider::OpenAI => "OPENAI_API_KEY",
            LlmProvider::Claude => "ANTHROPIC_API_KEY",
            LlmProvider::OpenRouter => "OPENROUTER_API_KEY",
            LlmProvider::Ollama => return Some(String::new()), // Ollama doesn't need a key
        };

        std::env::var(env_var).ok().filter(|k| !k.is_empty())
    }

    /// Check if a provider has credentials configured
    pub fn has_key(&self, provider: LlmProvider) -> bool {
        match provider {
            LlmProvider::Ollama => true, // Always available (no key needed)
            _ => self.get_key(provider).is_some(),
        }
    }

    /// Get status of all providers
    pub fn get_provider_status(&self) -> Vec<ProviderStatus> {
        vec![
            ProviderStatus {
                provider: LlmProvider::OpenAI,
                available: self.has_key(LlmProvider::OpenAI),
                default_model: "gpt-5-mini".to_string(),
                env_var: "OPENAI_API_KEY".to_string(),
            },
            ProviderStatus {
                provider: LlmProvider::Claude,
                available: self.has_key(LlmProvider::Claude),
                default_model: "claude-sonnet-4-20250514".to_string(),
                env_var: "ANTHROPIC_API_KEY".to_string(),
            },
            ProviderStatus {
                provider: LlmProvider::OpenRouter,
                available: self.has_key(LlmProvider::OpenRouter),
                default_model: "openai/gpt-4o-mini".to_string(),
                env_var: "OPENROUTER_API_KEY".to_string(),
            },
            ProviderStatus {
                provider: LlmProvider::Ollama,
                available: true, // Ollama is always "available" (may not be running though)
                default_model: "llama3.2".to_string(),
                env_var: String::new(),
            },
        ]
    }
}

impl Default for CredentialManager {
    fn default() -> Self {
        Self::new()
    }
}

/// Shared credential manager for Tauri state
pub type SharedCredentialManager = Arc<CredentialManager>;

// ============================================================================
// Provider Status
// ============================================================================

/// Status of a single LLM provider
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderStatus {
    /// The provider identifier
    pub provider: LlmProvider,
    /// Whether the provider has credentials configured
    pub available: bool,
    /// Default model for this provider
    pub default_model: String,
    /// Environment variable name for the API key (empty for Ollama)
    pub env_var: String,
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_credential_manager_creation() {
        let cm = CredentialManager::new();
        // Ollama should always be "available" (no key needed)
        assert!(cm.has_key(LlmProvider::Ollama));
    }

    #[test]
    fn test_provider_status() {
        let cm = CredentialManager::new();
        let status = cm.get_provider_status();
        assert_eq!(status.len(), 4);

        // Find Ollama status
        let ollama = status.iter().find(|s| s.provider == LlmProvider::Ollama);
        assert!(ollama.is_some());
        assert!(ollama.unwrap().available);
    }

    #[test]
    fn test_ollama_always_available() {
        let cm = CredentialManager::new();
        assert!(cm.has_key(LlmProvider::Ollama));
        assert_eq!(cm.get_key(LlmProvider::Ollama), Some(String::new()));
    }
}
