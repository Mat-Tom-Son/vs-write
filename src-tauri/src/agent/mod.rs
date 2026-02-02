//! Native Rust agent module for VS Write.
//!
//! This module implements a tool-calling LLM agent with multi-provider support.
//! It provides file operations, shell execution, and LLM integration for the writing assistant.

pub mod core;
pub mod credentials;
pub mod doctor;
pub mod entity_api;
pub mod llm;
pub mod lua_extensions;
pub mod lua_runtime;
pub mod session;
pub mod tools;
pub mod types;

// Re-export main types and functions for convenience
pub use core::run_agent;
pub use types::{AgentConfig, AgentEvent, LlmProvider, Message, MessageRole};
