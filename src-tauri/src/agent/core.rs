//! Core agent loop implementation.
//!
//! This module contains the main agent execution logic:
//! - Orchestrates LLM calls and tool execution
//! - Manages conversation state
//! - Emits events for UI streaming
//! - Supports Lua extensions
//! - Handles tool approval workflow

use std::path::Path;
use std::sync::Arc;
use std::{collections::HashMap, time::Duration};
use tokio::sync::mpsc;
use tokio::sync::{oneshot, Mutex};
use tokio_util::sync::CancellationToken;

use super::llm::{LlmClient, LlmResponse};
use super::lua_extensions::ExtensionRegistry;
use super::tools::{dispatch_tool, get_tool_schemas};
use super::types::{
    AgentConfig, AgentError, AgentEvent, ApprovalMode, LlmProvider, Message, ToolResult, ToolRisk,
};

/// Pending tool approval requests (approval_id -> response channel).
///
/// This is managed at the app level so the frontend can approve/deny tool calls via IPC.
pub type ToolApprovalStore = Arc<Mutex<HashMap<String, oneshot::Sender<bool>>>>;

const TOOL_APPROVAL_TIMEOUT: Duration = Duration::from_secs(5 * 60);

// ============================================================================
// Agent Execution
// ============================================================================

/// Result of running the agent
#[derive(Debug)]
pub struct AgentRunResult {
    /// The final response from the agent
    pub response: String,
    /// All tool calls made during execution
    pub tool_results: Vec<ToolResult>,
    /// Total token usage
    #[allow(dead_code)]
    pub usage: Option<super::types::Usage>,
}

/// Run the agent with a task
///
/// # Arguments
/// * `task` - The user's task/question
/// * `system_prompt` - System prompt for the agent
/// * `messages` - Previous conversation messages
/// * `workspace` - Path to the workspace directory
/// * `config` - Agent configuration
/// * `event_tx` - Channel to send events for UI streaming (optional)
/// * `extensions` - Optional extension registry for Lua tools
/// * `tool_approvals` - Optional shared approval store for gated tool execution
/// * `cancel_token` - Optional cancellation token to abort the run
///
/// # Returns
/// The final response and all tool results
pub async fn run_agent(
    task: &str,
    system_prompt: &str,
    messages: Vec<Message>,
    workspace: &Path,
    config: AgentConfig,
    event_tx: Option<mpsc::Sender<AgentEvent>>,
    extensions: Option<Arc<ExtensionRegistry>>,
    tool_approvals: Option<ToolApprovalStore>,
    cancel_token: Option<CancellationToken>,
) -> Result<AgentRunResult, AgentError> {
    let run_id = uuid::Uuid::new_v4().to_string();

    // Send start event
    if let Some(ref tx) = event_tx {
        let _ = tx
            .send(AgentEvent::Start {
                task: task.to_string(),
                run_id: Some(run_id.clone()),
            })
            .await;
    }

    // Build initial messages
    let mut conversation: Vec<Message> = Vec::new();

    // Add system prompt (OpenAI prefers developer role for GPT-5+)
    let system_message = if config.provider == LlmProvider::OpenAI {
        Message::developer(system_prompt)
    } else {
        Message::system(system_prompt)
    };
    conversation.push(system_message);

    // Add previous messages
    for msg in messages {
        conversation.push(msg);
    }

    // Add the current task as a user message
    conversation.push(Message::user(task));

    // Get tool schemas - combine built-in and extension tools
    let mut tools = get_tool_schemas();
    if let Some(ref ext_registry) = extensions {
        tools.extend(ext_registry.get_extension_tool_schemas());
    }

    // Create LLM client
    let client = LlmClient::new(config.clone());

    // Track all tool results
    let mut all_tool_results: Vec<ToolResult> = Vec::new();
    let mut total_usage: Option<super::types::Usage> = None;

    // Agent loop
    for iteration in 0..config.max_iterations {
        // Check for cancellation at the start of each iteration
        if let Some(ref token) = cancel_token {
            if token.is_cancelled() {
                log::info!("Agent run cancelled by user");
                if let Some(ref tx) = event_tx {
                    let _ = tx
                        .send(AgentEvent::Cancelled {
                            run_id: Some(run_id.clone()),
                        })
                        .await;
                }
                return Err(AgentError::Cancelled);
            }
        }

        log::info!("Agent iteration {}/{}", iteration + 1, config.max_iterations);

        // Call LLM
        let response: LlmResponse = client.chat(&conversation, Some(&tools)).await?;

        // Accumulate usage
        if let Some(usage) = response.usage {
            total_usage = Some(match total_usage {
                Some(mut existing) => {
                    existing.prompt_tokens += usage.prompt_tokens;
                    existing.completion_tokens += usage.completion_tokens;
                    existing.total_tokens += usage.total_tokens;
                    existing
                }
                None => usage,
            });
        }

        // Check if we have tool calls
        if !response.tool_calls.is_empty() {
            log::info!("Processing {} tool calls", response.tool_calls.len());

            // Add assistant message with tool calls
            conversation.push(Message::assistant_with_tools(
                response.content.clone(),
                response.tool_calls.clone(),
            ));

            // Execute each tool call
            for tool_call in &response.tool_calls {
                let tool_name = &tool_call.function.name;
                let tool_args_str = &tool_call.function.arguments;

                // Parse arguments
                let args: serde_json::Value = serde_json::from_str(tool_args_str).unwrap_or_else(|e| {
                    log::warn!("Failed to parse tool arguments: {}", e);
                    serde_json::json!({})
                });

                // Check for cancellation before each tool call
                if let Some(ref token) = cancel_token {
                    if token.is_cancelled() {
                        log::info!("Agent run cancelled before tool execution");
                        if let Some(ref tx) = event_tx {
                            let _ = tx
                                .send(AgentEvent::Cancelled {
                                    run_id: Some(run_id.clone()),
                                })
                                .await;
                        }
                        return Err(AgentError::Cancelled);
                    }
                }

                // Determine tool risk level
                let risk = ToolRisk::for_tool(tool_name);
                let needs_approval = config.approval_mode.needs_approval(risk);

                // Handle dry-run mode - skip execution entirely
                if config.approval_mode == ApprovalMode::DryRun {
                    log::info!("Dry-run mode: skipping tool {}", tool_name);
                    if let Some(ref tx) = event_tx {
                        let _ = tx
                            .send(AgentEvent::ToolSkipped {
                                name: tool_name.clone(),
                                args: args.clone(),
                                reason: format!("Dry-run mode (risk: {:?})", risk),
                                run_id: Some(run_id.clone()),
                            })
                            .await;
                    }

                    // Add a synthetic tool result for dry-run
                    let dry_run_output = format!(
                        "[DRY-RUN] Would execute tool '{}' with args: {}",
                        tool_name,
                        serde_json::to_string_pretty(&args).unwrap_or_default()
                    );
                    conversation.push(Message::tool_result(&tool_call.id, &dry_run_output));
                    all_tool_results.push(ToolResult::success(&tool_call.id, dry_run_output));
                    continue;
                }

                // Handle approval-required modes
                if needs_approval && config.approval_mode != ApprovalMode::AutoApprove {
                    let approval_id = uuid::Uuid::new_v4().to_string();
                    log::info!(
                        "Tool {} requires approval (risk: {:?}, mode: {:?})",
                        tool_name,
                        risk,
                        config.approval_mode
                    );

                    // If we have an approval store, register the pending approval BEFORE emitting the event.
                    let approval_rx = if let Some(store) = tool_approvals.as_ref() {
                        let (tx, rx) = oneshot::channel::<bool>();
                        {
                            let mut pending = store.lock().await;
                            pending.insert(approval_id.clone(), tx);
                        }
                        Some(rx)
                    } else {
                        None
                    };

                    // Emit approval required event
                    if let Some(ref tx) = event_tx {
                        let _ = tx
                            .send(AgentEvent::ToolApprovalRequired {
                                approval_id: approval_id.clone(),
                                name: tool_name.clone(),
                                args: args.clone(),
                                risk,
                                run_id: Some(run_id.clone()),
                            })
                            .await;
                    }

                    // If we have an approval receiver, block until the UI responds (or timeouts/cancelled).
                    let approved = if let Some(rx) = approval_rx {
                        let wait_for_approval = async { rx.await.unwrap_or(false) };

                        let store = tool_approvals
                            .as_ref()
                            .expect("approval_rx implies tool_approvals is Some");

                        let approved = if let Some(ref token) = cancel_token {
                            tokio::select! {
                                _ = token.cancelled() => {
                                    // Best-effort cleanup.
                                    let mut pending = store.lock().await;
                                    pending.remove(&approval_id);
                                    return Err(AgentError::Cancelled);
                                }
                                res = tokio::time::timeout(TOOL_APPROVAL_TIMEOUT, wait_for_approval) => {
                                    res.unwrap_or(false)
                                }
                            }
                        } else {
                            tokio::time::timeout(TOOL_APPROVAL_TIMEOUT, wait_for_approval)
                                .await
                                .unwrap_or(false)
                        };

                        // Best-effort cleanup in case the responder never removed it.
                        let mut pending = store.lock().await;
                        pending.remove(&approval_id);

                        approved
                    } else {
                        // No approval channel available (e.g. tests). Log and proceed.
                        log::warn!(
                            "Approval required for tool '{}' but no approval store was provided; auto-approving",
                            tool_name
                        );
                        true
                    };

                    if !approved {
                        let denial = "DENIED: Tool execution was blocked by user approval.".to_string();

                        // Emit a completion event so the UI can display the outcome.
                        if let Some(ref tx) = event_tx {
                            let _ = tx
                                .send(AgentEvent::ToolCallComplete {
                                    name: tool_name.clone(),
                                    args: args.clone(),
                                    result: denial.clone(),
                                    success: false,
                                    truncated: false,
                                    run_id: Some(run_id.clone()),
                                })
                                .await;
                        }

                        // Provide a tool result to the model so it can continue.
                        conversation.push(Message::tool_result(&tool_call.id, &denial));
                        all_tool_results.push(ToolResult::error(&tool_call.id, denial));
                        continue;
                    }
                }

                // Send tool call start event
                if let Some(ref tx) = event_tx {
                    let _ = tx
                        .send(AgentEvent::ToolCallStart {
                            name: tool_name.clone(),
                            args: args.clone(),
                            run_id: Some(run_id.clone()),
                        })
                        .await;
                }

                // Execute the tool - route to extension or built-in
                let result = if let Some(ref ext_registry) = extensions {
                    if ext_registry.is_extension_tool(tool_name) {
                        ext_registry.execute_tool(tool_name, &args, workspace, config.shell_timeout)
                    } else {
                        dispatch_tool(workspace, tool_name, &args, config.shell_timeout)
                    }
                } else {
                    dispatch_tool(workspace, tool_name, &args, config.shell_timeout)
                };

                let (output, success, truncated) = match result {
                    Ok(output) => {
                        let truncated = output.len() > 8000;
                        let output = if truncated {
                            format!(
                                "{}...\n\n[Output truncated: {} bytes total]",
                                &output[..8000],
                                output.len()
                            )
                        } else {
                            output
                        };
                        (output, true, truncated)
                    }
                    Err(e) => (format!("ERROR: {}", e), false, false),
                };

                // Create tool result
                let tool_result = if success {
                    ToolResult::success(&tool_call.id, output.clone())
                } else {
                    ToolResult::error(&tool_call.id, output.clone())
                };
                all_tool_results.push(tool_result);

                // Send tool call complete event
                if let Some(ref tx) = event_tx {
                    let _ = tx
                        .send(AgentEvent::ToolCallComplete {
                            name: tool_name.clone(),
                            args: args.clone(),
                            result: output.clone(),
                            success,
                            truncated,
                            run_id: Some(run_id.clone()),
                        })
                        .await;
                }

                // Add tool result to conversation
                conversation.push(Message::tool_result(&tool_call.id, &output));
            }

            // Continue to next iteration
            continue;
        }

        // No tool calls - this is the final response
        let final_response = response.content.unwrap_or_default();

        // Send complete event
        if let Some(ref tx) = event_tx {
            let _ = tx
                .send(AgentEvent::Complete {
                    response: final_response.clone(),
                    usage: total_usage.clone(),
                    run_id: Some(run_id.clone()),
                })
                .await;
        }

        return Ok(AgentRunResult {
            response: final_response,
            tool_results: all_tool_results,
            usage: total_usage,
        });
    }

    // Max iterations reached
    let error_msg = format!(
        "Agent reached maximum iterations ({}) without completing",
        config.max_iterations
    );

    if let Some(ref tx) = event_tx {
        let _ = tx
            .send(AgentEvent::Error {
                error: error_msg.clone(),
                run_id: Some(run_id),
            })
            .await;
    }

    Err(AgentError::MaxIterationsReached)
}

// ============================================================================
// Helper for simple single-shot calls
// ============================================================================

/// Run a simple agent task without streaming
#[allow(dead_code)]
pub async fn run_simple(
    task: &str,
    system_prompt: &str,
    workspace: &Path,
    config: AgentConfig,
) -> Result<String, AgentError> {
    let result = run_agent(task, system_prompt, vec![], workspace, config, None, None, None, None).await?;
    Ok(result.response)
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_agent_run_result() {
        let result = AgentRunResult {
            response: "Hello".to_string(),
            tool_results: vec![],
            usage: None,
        };

        assert_eq!(result.response, "Hello");
        assert!(result.tool_results.is_empty());
    }
}
