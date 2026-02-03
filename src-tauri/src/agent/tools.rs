//! Tool implementations for the Rust agent.
//!
//! Each tool:
//! - Has a JSON schema for its parameters
//! - Returns a Result with string output or error
//! - Validates paths to prevent workspace escape

use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;

use crate::agent::types::{JsonSchema, PropertySchema, Tool};

// ============================================================================
// Path Safety
// ============================================================================

/// Patterns for sensitive files that should never be accessed by the agent
/// These patterns are checked against the file name (not the full path)
const SENSITIVE_FILE_PATTERNS: &[&str] = &[
    // Environment and secrets
    ".env",
    ".env.local",
    ".env.development",
    ".env.production",
    ".env.test",
    ".envrc",
    // Credentials and keys
    "credentials",
    "credentials.json",
    ".credentials",
    "secrets",
    "secrets.json",
    ".secrets",
    // SSH keys
    "id_rsa",
    "id_rsa.pub",
    "id_dsa",
    "id_dsa.pub",
    "id_ecdsa",
    "id_ecdsa.pub",
    "id_ed25519",
    "id_ed25519.pub",
    "authorized_keys",
    "known_hosts",
    // Private keys
    "private.pem",
    "private.key",
    "server.key",
    "client.key",
    // Git credentials
    ".git-credentials",
    ".gitconfig",
    // NPM tokens
    ".npmrc",
    // Docker secrets
    ".docker/config.json",
    // Cloud provider credentials
    ".aws/credentials",
    ".azure/credentials",
    ".gcloud/credentials",
    // Password stores
    ".password-store",
    ".gnupg",
    // Keychain
    "keychain.db",
    "keychain-db.sqlite",
];

/// Patterns for sensitive file extensions
const SENSITIVE_EXTENSIONS: &[&str] = &[
    ".pem",
    ".key",
    ".p12",
    ".pfx",
    ".keystore",
    ".jks",
];

/// Check if a path points to a sensitive file that should not be accessed
fn is_sensitive_path(path: &Path) -> Option<String> {
    // Get the file name
    let file_name = path.file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("");

    // Check against sensitive file patterns (case-insensitive)
    let file_name_lower = file_name.to_lowercase();
    for pattern in SENSITIVE_FILE_PATTERNS {
        if file_name_lower == *pattern || file_name_lower.starts_with(&format!("{}.", pattern)) {
            return Some(format!(
                "Access denied: '{}' matches sensitive file pattern '{}'",
                file_name, pattern
            ));
        }
    }

    // Check against sensitive extensions
    for ext in SENSITIVE_EXTENSIONS {
        if file_name_lower.ends_with(ext) {
            return Some(format!(
                "Access denied: '{}' has sensitive extension '{}'",
                file_name, ext
            ));
        }
    }

    // Check if path contains sensitive directories
    let path_str = path.to_string_lossy().to_lowercase();
    let sensitive_dirs = [".ssh", ".gnupg", ".password-store"];
    for dir in sensitive_dirs {
        if path_str.contains(&format!("{}/", dir)) || path_str.contains(&format!("{}\\", dir)) {
            return Some(format!(
                "Access denied: path contains sensitive directory '{}'",
                dir
            ));
        }
    }

    None
}

/// Check that no component of the path is a symlink.
/// This prevents TOCTOU vulnerabilities where symlink targets could change
/// between validation and actual file operation.
fn check_no_symlinks_in_path(path: &Path, workspace: &Path) -> Result<(), String> {
    // Get the path relative to workspace to check each component
    let relative = if path.starts_with(workspace) {
        path.strip_prefix(workspace).unwrap_or(path)
    } else {
        // For absolute paths that don't start with workspace, check from root
        path
    };

    // Check each component from workspace down to the target
    let mut current = workspace.to_path_buf();
    for component in relative.components() {
        current.push(component);

        // Use symlink_metadata which doesn't follow symlinks
        // (unlike metadata() which does follow them)
        if let Ok(metadata) = fs::symlink_metadata(&current) {
            if metadata.file_type().is_symlink() {
                return Err(format!(
                    "Symlinks not allowed for security: '{}'",
                    current.display()
                ));
            }
        }
        // If metadata fails, the path doesn't exist yet - that's OK for write operations
    }

    // Also check the final target itself
    if let Ok(metadata) = fs::symlink_metadata(path) {
        if metadata.file_type().is_symlink() {
            return Err(format!(
                "Symlinks not allowed for security: '{}'",
                path.display()
            ));
        }
    }

    Ok(())
}

/// Validate that a path is within the workspace and return the canonical path.
/// This prevents directory traversal attacks and access outside the workspace.
///
/// Security: This function rejects symlinks to prevent TOCTOU (time-of-check-time-of-use)
/// vulnerabilities where a symlink target could change between validation and use.
pub fn safe_path(workspace: &Path, requested: &str) -> Result<PathBuf, String> {
    // Handle empty path as workspace root
    let requested = if requested.is_empty() || requested == "." {
        workspace.to_path_buf()
    } else {
        // Join with workspace
        let path = if Path::new(requested).is_absolute() {
            PathBuf::from(requested)
        } else {
            workspace.join(requested)
        };
        path
    };

    // Canonicalize workspace first
    let canonical_workspace = workspace
        .canonicalize()
        .map_err(|e| format!("Failed to canonicalize workspace: {}", e))?;

    // Security: Check for symlinks in the path to prevent TOCTOU attacks
    // A symlink's target could change between our check and actual file operation
    if requested.exists() {
        check_no_symlinks_in_path(&requested, &canonical_workspace)?;
    }

    // Security: Check for sensitive files that should never be accessed
    if let Some(error) = is_sensitive_path(&requested) {
        return Err(error);
    }

    // For paths that might not exist yet (write operations), we need to check parent
    let canonical_requested = if requested.exists() {
        requested
            .canonicalize()
            .map_err(|e| format!("Failed to canonicalize path: {}", e))?
    } else {
        // Path doesn't exist - check if parent is valid
        let parent = requested.parent().unwrap_or(&canonical_workspace);
        let canonical_parent = if parent.exists() {
            parent
                .canonicalize()
                .map_err(|e| format!("Failed to canonicalize parent: {}", e))?
        } else {
            // Parent doesn't exist either - construct manually and verify
            // This handles nested directory creation
            // Use strip_prefix on the original workspace to handle Windows path differences
            let relative = requested
                .strip_prefix(workspace)
                .or_else(|_| requested.strip_prefix(&canonical_workspace))
                .unwrap_or(&requested);

            let mut current = canonical_workspace.clone();
            for component in relative.components() {
                match component {
                    std::path::Component::Normal(c) => current.push(c),
                    std::path::Component::ParentDir => {
                        return Err("Path traversal detected: '..' not allowed".to_string());
                    }
                    std::path::Component::RootDir | std::path::Component::Prefix(_) => {
                        // Absolute path - reject
                        return Err("Absolute paths not allowed".to_string());
                    }
                    _ => {}
                }
            }
            return if current.starts_with(&canonical_workspace) {
                Ok(current)
            } else {
                Err(format!(
                    "Path '{}' escapes workspace '{}'",
                    requested.display(),
                    canonical_workspace.display()
                ))
            };
        };

        // Reconstruct full path with canonical parent
        if let Some(file_name) = requested.file_name() {
            canonical_parent.join(file_name)
        } else {
            canonical_parent
        }
    };

    // Verify the path is within workspace
    if canonical_requested.starts_with(&canonical_workspace) {
        Ok(canonical_requested)
    } else {
        Err(format!(
            "Path '{}' escapes workspace '{}'",
            requested.display(),
            canonical_workspace.display()
        ))
    }
}

// ============================================================================
// Tool Schemas
// ============================================================================

/// Get all available tool definitions
pub fn get_tool_schemas() -> Vec<Tool> {
    vec![
        read_file_schema(),
        write_file_schema(),
        delete_file_schema(),
        append_file_schema(),
        list_dir_schema(),
        glob_schema(),
        grep_schema(),
        run_shell_schema(),
    ]
}

fn read_file_schema() -> Tool {
    let mut properties = HashMap::new();
    properties.insert(
        "path".to_string(),
        PropertySchema {
            prop_type: "string".to_string(),
            description: Some("Path to the file (relative to workspace)".to_string()),
            default: None,
        },
    );
    properties.insert(
        "offset".to_string(),
        PropertySchema {
            prop_type: "integer".to_string(),
            description: Some("Line number to start reading from (1-based)".to_string()),
            default: Some(serde_json::json!(1)),
        },
    );
    properties.insert(
        "limit".to_string(),
        PropertySchema {
            prop_type: "integer".to_string(),
            description: Some("Maximum number of lines to read".to_string()),
            default: Some(serde_json::json!(4000)),
        },
    );

    Tool::new(
        "read_file",
        "Read a file with optional line offset and limit.",
        JsonSchema {
            schema_type: "object".to_string(),
            properties: Some(properties),
            required: Some(vec!["path".to_string()]),
        },
    )
}

fn write_file_schema() -> Tool {
    let mut properties = HashMap::new();
    properties.insert(
        "path".to_string(),
        PropertySchema {
            prop_type: "string".to_string(),
            description: Some("Path to write to (relative to workspace)".to_string()),
            default: None,
        },
    );
    properties.insert(
        "content".to_string(),
        PropertySchema {
            prop_type: "string".to_string(),
            description: Some("Content to write".to_string()),
            default: None,
        },
    );

    Tool::new(
        "write_file",
        "Write content to a file. Creates parent directories if needed.",
        JsonSchema {
            schema_type: "object".to_string(),
            properties: Some(properties),
            required: Some(vec!["path".to_string(), "content".to_string()]),
        },
    )
}

fn delete_file_schema() -> Tool {
    let mut properties = HashMap::new();
    properties.insert(
        "path".to_string(),
        PropertySchema {
            prop_type: "string".to_string(),
            description: Some("Path to the file to delete (relative to workspace)".to_string()),
            default: None,
        },
    );

    Tool::new(
        "delete_file",
        "Delete a file. Does not delete directories.",
        JsonSchema {
            schema_type: "object".to_string(),
            properties: Some(properties),
            required: Some(vec!["path".to_string()]),
        },
    )
}

fn append_file_schema() -> Tool {
    let mut properties = HashMap::new();
    properties.insert(
        "path".to_string(),
        PropertySchema {
            prop_type: "string".to_string(),
            description: Some("Path to append to (relative to workspace)".to_string()),
            default: None,
        },
    );
    properties.insert(
        "content".to_string(),
        PropertySchema {
            prop_type: "string".to_string(),
            description: Some("Content to append".to_string()),
            default: None,
        },
    );

    Tool::new(
        "append_file",
        "Append content to a file. Creates the file if it doesn't exist.",
        JsonSchema {
            schema_type: "object".to_string(),
            properties: Some(properties),
            required: Some(vec!["path".to_string(), "content".to_string()]),
        },
    )
}

fn list_dir_schema() -> Tool {
    let mut properties = HashMap::new();
    properties.insert(
        "path".to_string(),
        PropertySchema {
            prop_type: "string".to_string(),
            description: Some("Directory path (relative to workspace, defaults to '.')".to_string()),
            default: Some(serde_json::json!(".")),
        },
    );

    Tool::new(
        "list_dir",
        "List files and directories at a path.",
        JsonSchema {
            schema_type: "object".to_string(),
            properties: Some(properties),
            required: Some(vec![]),
        },
    )
}

fn glob_schema() -> Tool {
    let mut properties = HashMap::new();
    properties.insert(
        "pattern".to_string(),
        PropertySchema {
            prop_type: "string".to_string(),
            description: Some("Glob pattern (e.g., '**/*.md', '*.txt')".to_string()),
            default: None,
        },
    );
    properties.insert(
        "path".to_string(),
        PropertySchema {
            prop_type: "string".to_string(),
            description: Some("Base path to search from (relative to workspace)".to_string()),
            default: Some(serde_json::json!(".")),
        },
    );

    Tool::new(
        "glob",
        "Find files matching a glob pattern.",
        JsonSchema {
            schema_type: "object".to_string(),
            properties: Some(properties),
            required: Some(vec!["pattern".to_string()]),
        },
    )
}

fn grep_schema() -> Tool {
    let mut properties = HashMap::new();
    properties.insert(
        "pattern".to_string(),
        PropertySchema {
            prop_type: "string".to_string(),
            description: Some("Search pattern (substring match)".to_string()),
            default: None,
        },
    );
    properties.insert(
        "path".to_string(),
        PropertySchema {
            prop_type: "string".to_string(),
            description: Some("Path to search in (file or directory)".to_string()),
            default: Some(serde_json::json!(".")),
        },
    );

    Tool::new(
        "grep",
        "Search file contents for a pattern.",
        JsonSchema {
            schema_type: "object".to_string(),
            properties: Some(properties),
            required: Some(vec!["pattern".to_string()]),
        },
    )
}

fn run_shell_schema() -> Tool {
    let mut properties = HashMap::new();
    properties.insert(
        "command".to_string(),
        PropertySchema {
            prop_type: "string".to_string(),
            description: Some("Shell command to execute".to_string()),
            default: None,
        },
    );
    properties.insert(
        "cwd".to_string(),
        PropertySchema {
            prop_type: "string".to_string(),
            description: Some("Working directory (relative to workspace)".to_string()),
            default: Some(serde_json::json!(".")),
        },
    );
    properties.insert(
        "timeout".to_string(),
        PropertySchema {
            prop_type: "integer".to_string(),
            description: Some("Timeout in seconds (max 60)".to_string()),
            default: Some(serde_json::json!(30)),
        },
    );

    Tool::new(
        "run_shell",
        "Execute a shell command inside the workspace.",
        JsonSchema {
            schema_type: "object".to_string(),
            properties: Some(properties),
            required: Some(vec!["command".to_string()]),
        },
    )
}

// ============================================================================
// Tool Implementations
// ============================================================================

/// Read file contents with optional offset and limit
pub fn read_file(
    workspace: &Path,
    path: &str,
    offset: Option<usize>,
    limit: Option<usize>,
) -> Result<String, String> {
    let safe = safe_path(workspace, path)?;

    if !safe.exists() {
        return Err(format!("File not found: {}", path));
    }

    if !safe.is_file() {
        return Err(format!("Not a file: {}", path));
    }

    let file = fs::File::open(&safe).map_err(|e| format!("Failed to open file: {}", e))?;
    let reader = BufReader::new(file);

    let offset = offset.unwrap_or(1).max(1);
    let limit = limit.unwrap_or(4000);

    let mut result = String::new();
    let mut line_num = 0;

    for line_result in reader.lines() {
        line_num += 1;

        if line_num < offset {
            continue;
        }

        if line_num >= offset + limit {
            break;
        }

        let line = line_result.map_err(|e| format!("Error reading line {}: {}", line_num, e))?;

        // Truncate very long lines
        let truncated_line = if line.len() > 2000 {
            format!("{}...[truncated]", &line[..2000])
        } else {
            line
        };

        result.push_str(&format!("{:>6}\t{}\n", line_num, truncated_line));
    }

    if result.is_empty() && line_num < offset {
        return Err(format!(
            "Offset {} is beyond file end (file has {} lines)",
            offset, line_num
        ));
    }

    Ok(result)
}

/// Write content to a file
pub fn write_file(workspace: &Path, path: &str, content: &str) -> Result<String, String> {
    let safe = safe_path(workspace, path)?;

    // Create parent directories if needed
    if let Some(parent) = safe.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create directories: {}", e))?;
        }
    }

    fs::write(&safe, content).map_err(|e| format!("Failed to write file: {}", e))?;

    Ok(format!("Wrote {} bytes to {}", content.len(), path))
}

/// Delete a file (not directories)
pub fn delete_file(workspace: &Path, path: &str) -> Result<String, String> {
    let safe = safe_path(workspace, path)?;

    if !safe.exists() {
        return Err(format!("File not found: {}", path));
    }

    if !safe.is_file() {
        return Err(format!("Not a file (cannot delete directories): {}", path));
    }

    fs::remove_file(&safe).map_err(|e| format!("Failed to delete file: {}", e))?;

    Ok(format!("Deleted {}", path))
}

/// Append content to a file (creates if doesn't exist)
pub fn append_file(workspace: &Path, path: &str, content: &str) -> Result<String, String> {
    use std::io::Write;

    let safe = safe_path(workspace, path)?;

    // Create parent directories if needed
    if let Some(parent) = safe.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create directories: {}", e))?;
        }
    }

    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&safe)
        .map_err(|e| format!("Failed to open file for appending: {}", e))?;

    file.write_all(content.as_bytes())
        .map_err(|e| format!("Failed to append to file: {}", e))?;

    Ok(format!("Appended {} bytes to {}", content.len(), path))
}

/// List directory contents
pub fn list_dir(workspace: &Path, path: &str) -> Result<String, String> {
    let safe = safe_path(workspace, path)?;

    if !safe.exists() {
        return Err(format!("Directory not found: {}", path));
    }

    if !safe.is_dir() {
        return Err(format!("Not a directory: {}", path));
    }

    let entries = fs::read_dir(&safe).map_err(|e| format!("Failed to read directory: {}", e))?;

    let mut files: Vec<String> = Vec::new();
    let mut dirs: Vec<String> = Vec::new();

    for entry in entries {
        let entry = entry.map_err(|e| format!("Error reading entry: {}", e))?;
        let name = entry.file_name().to_string_lossy().to_string();

        if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            dirs.push(format!("{}/", name));
        } else {
            files.push(name);
        }
    }

    // Sort for consistent output
    dirs.sort();
    files.sort();

    // Combine: directories first, then files
    let mut result: Vec<String> = dirs;
    result.extend(files);

    Ok(serde_json::to_string_pretty(&result)
        .unwrap_or_else(|_| format!("{:?}", result)))
}

/// Find files matching a glob pattern
pub fn glob_files(workspace: &Path, pattern: &str, base_path: &str) -> Result<String, String> {
    let safe_base = safe_path(workspace, base_path)?;

    if !safe_base.exists() {
        return Err(format!("Base path not found: {}", base_path));
    }

    // Build the full glob pattern
    let full_pattern = safe_base.join(pattern);
    let pattern_str = full_pattern.to_string_lossy();

    let mut matches: Vec<String> = Vec::new();
    let canonical_workspace = workspace
        .canonicalize()
        .map_err(|e| format!("Failed to canonicalize workspace: {}", e))?;

    for entry in glob::glob(&pattern_str).map_err(|e| format!("Invalid glob pattern: {}", e))? {
        match entry {
            Ok(path) => {
                // Ensure path is within workspace
                if let Ok(canonical) = path.canonicalize() {
                    if canonical.starts_with(&canonical_workspace) {
                        // Return relative path
                        if let Ok(relative) = canonical.strip_prefix(&canonical_workspace) {
                            matches.push(relative.to_string_lossy().to_string());
                        }
                    }
                }
            }
            Err(e) => {
                log::warn!("Glob error for entry: {}", e);
            }
        }
    }

    matches.sort();

    // Limit results to prevent overwhelming output
    if matches.len() > 500 {
        let total = matches.len();
        matches.truncate(500);
        matches.push(format!("... and {} more files", total - 500));
    }

    Ok(serde_json::to_string_pretty(&matches)
        .unwrap_or_else(|_| format!("{:?}", matches)))
}

/// Search file contents for a pattern
pub fn grep_files(workspace: &Path, pattern: &str, path: &str) -> Result<String, String> {
    let safe = safe_path(workspace, path)?;

    if !safe.exists() {
        return Err(format!("Path not found: {}", path));
    }

    let canonical_workspace = workspace
        .canonicalize()
        .map_err(|e| format!("Failed to canonicalize workspace: {}", e))?;

    let mut results: Vec<serde_json::Value> = Vec::new();
    let pattern_lower = pattern.to_lowercase();

    fn search_file(
        file_path: &Path,
        pattern: &str,
        workspace: &Path,
        results: &mut Vec<serde_json::Value>,
    ) -> Result<(), String> {
        let file = match fs::File::open(file_path) {
            Ok(f) => f,
            Err(_) => return Ok(()), // Skip files we can't open
        };

        let reader = BufReader::new(file);
        let relative_path = file_path
            .strip_prefix(workspace)
            .unwrap_or(file_path)
            .to_string_lossy()
            .to_string();

        for (line_num, line_result) in reader.lines().enumerate() {
            if let Ok(line) = line_result {
                if line.to_lowercase().contains(pattern) {
                    results.push(serde_json::json!({
                        "file": relative_path,
                        "line": line_num + 1,
                        "content": if line.len() > 200 {
                            format!("{}...", &line[..200])
                        } else {
                            line
                        }
                    }));

                    // Limit matches per file
                    if results.len() >= 100 {
                        return Ok(());
                    }
                }
            }
        }

        Ok(())
    }

    fn search_dir(
        dir_path: &Path,
        pattern: &str,
        workspace: &Path,
        results: &mut Vec<serde_json::Value>,
    ) -> Result<(), String> {
        if results.len() >= 100 {
            return Ok(());
        }

        let entries = match fs::read_dir(dir_path) {
            Ok(e) => e,
            Err(_) => return Ok(()), // Skip directories we can't read
        };

        for entry in entries {
            if results.len() >= 100 {
                break;
            }

            if let Ok(entry) = entry {
                let path = entry.path();

                // Skip hidden files and common non-text directories
                let name = entry.file_name().to_string_lossy().to_string();
                if name.starts_with('.')
                    || name == "node_modules"
                    || name == "target"
                    || name == "__pycache__"
                    || name == ".git"
                {
                    continue;
                }

                if path.is_dir() {
                    search_dir(&path, pattern, workspace, results)?;
                } else if path.is_file() {
                    // Only search text-like files
                    if let Some(ext) = path.extension() {
                        let ext = ext.to_string_lossy().to_lowercase();
                        if matches!(
                            ext.as_str(),
                            "txt" | "md" | "rs" | "py" | "js" | "ts" | "tsx"
                                | "jsx" | "json" | "yaml" | "yml" | "toml"
                                | "html" | "css" | "scss" | "vue" | "svelte"
                        ) {
                            search_file(&path, pattern, workspace, results)?;
                        }
                    } else {
                        // No extension - might be a text file, try it
                        search_file(&path, pattern, workspace, results)?;
                    }
                }
            }
        }

        Ok(())
    }

    if safe.is_file() {
        search_file(&safe, &pattern_lower, &canonical_workspace, &mut results)?;
    } else {
        search_dir(&safe, &pattern_lower, &canonical_workspace, &mut results)?;
    }

    if results.len() >= 100 {
        results.push(serde_json::json!({
            "note": "Results truncated at 100 matches"
        }));
    }

    Ok(serde_json::to_string_pretty(&results)
        .unwrap_or_else(|_| format!("{:?}", results)))
}

/// Execute a shell command
pub fn run_shell(
    workspace: &Path,
    command: &str,
    cwd: Option<&str>,
    timeout_secs: Option<u64>,
) -> Result<String, String> {
    let working_dir = if let Some(c) = cwd {
        safe_path(workspace, c)?
    } else {
        workspace.to_path_buf()
    };

    if !working_dir.exists() || !working_dir.is_dir() {
        return Err(format!(
            "Working directory not found: {}",
            working_dir.display()
        ));
    }

    let timeout = Duration::from_secs(timeout_secs.unwrap_or(30).min(60));

    // Use appropriate shell based on platform
    let (shell, shell_arg) = if cfg!(target_os = "windows") {
        ("cmd", "/C")
    } else {
        ("sh", "-c")
    };

    let mut cmd = Command::new(shell);
    cmd.arg(shell_arg)
        .arg(command)
        .current_dir(&working_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    // On macOS (especially when the app is launched from Finder), PATH is often minimal and
    // won't include Homebrew locations like /opt/homebrew/bin. Add common locations to improve
    // cross-platform usability without relying on shell init files.
    if !cfg!(target_os = "windows") {
        let mut entries: Vec<String> = std::env::var("PATH")
            .unwrap_or_default()
            .split(':')
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string())
            .collect();

        let mut extra: Vec<String> = Vec::new();

        if let Ok(home) = std::env::var("HOME") {
            extra.push(format!("{}/.cargo/bin", home));
            extra.push(format!("{}/.local/bin", home));
        }

        if cfg!(target_os = "macos") {
            extra.push("/opt/homebrew/bin".to_string());
            extra.push("/opt/homebrew/sbin".to_string());
            extra.push("/usr/local/bin".to_string());
            extra.push("/usr/local/sbin".to_string());
        } else {
            extra.push("/usr/local/bin".to_string());
            extra.push("/usr/local/sbin".to_string());
        }

        // Always include standard system locations as a fallback.
        extra.push("/usr/bin".to_string());
        extra.push("/bin".to_string());
        extra.push("/usr/sbin".to_string());
        extra.push("/sbin".to_string());

        for path in extra.into_iter().rev() {
            if !entries.iter().any(|p| p == &path) {
                entries.insert(0, path);
            }
        }

        cmd.env("PATH", entries.join(":"));
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn command: {}", e))?;

    // Wait with timeout using a simple polling approach
    let start = std::time::Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                // Process completed
                let stdout = child.stdout.take();
                let stderr = child.stderr.take();

                let mut output = String::new();

                if let Some(out) = stdout {
                    let reader = BufReader::new(out);
                    for line in reader.lines().take(500) {
                        if let Ok(l) = line {
                            output.push_str(&l);
                            output.push('\n');
                        }
                    }
                }

                if let Some(err) = stderr {
                    let reader = BufReader::new(err);
                    let stderr_lines: Vec<String> = reader
                        .lines()
                        .take(100)
                        .filter_map(|l| l.ok())
                        .collect();

                    if !stderr_lines.is_empty() {
                        output.push_str("\n--- stderr ---\n");
                        output.push_str(&stderr_lines.join("\n"));
                    }
                }

                let result = serde_json::json!({
                    "exit_code": status.code().unwrap_or(-1),
                    "output": if output.len() > 10000 {
                        format!("{}...[truncated]", &output[..10000])
                    } else {
                        output
                    }
                });

                return Ok(serde_json::to_string_pretty(&result)
                    .unwrap_or_else(|_| format!("{:?}", result)));
            }
            Ok(None) => {
                // Still running
                if start.elapsed() > timeout {
                    let _ = child.kill();
                    return Err(format!(
                        "Command timed out after {} seconds",
                        timeout.as_secs()
                    ));
                }
                std::thread::sleep(Duration::from_millis(100));
            }
            Err(e) => {
                return Err(format!("Error waiting for command: {}", e));
            }
        }
    }
}

// ============================================================================
// Tool Dispatcher
// ============================================================================

/// Dispatch a tool call to the appropriate implementation
pub fn dispatch_tool(
    workspace: &Path,
    name: &str,
    args: &serde_json::Value,
    shell_timeout: u64,
) -> Result<String, String> {
    match name {
        "read_file" => {
            let path = args
                .get("path")
                .and_then(|v| v.as_str())
                .ok_or("Missing 'path' parameter")?;
            let offset = args.get("offset").and_then(|v| v.as_u64()).map(|v| v as usize);
            let limit = args.get("limit").and_then(|v| v.as_u64()).map(|v| v as usize);
            read_file(workspace, path, offset, limit)
        }

        "write_file" => {
            let path = args
                .get("path")
                .and_then(|v| v.as_str())
                .ok_or("Missing 'path' parameter")?;
            let content = args
                .get("content")
                .and_then(|v| v.as_str())
                .ok_or("Missing 'content' parameter")?;
            write_file(workspace, path, content)
        }

        "delete_file" => {
            let path = args
                .get("path")
                .and_then(|v| v.as_str())
                .ok_or("Missing 'path' parameter")?;
            delete_file(workspace, path)
        }

        "append_file" => {
            let path = args
                .get("path")
                .and_then(|v| v.as_str())
                .ok_or("Missing 'path' parameter")?;
            let content = args
                .get("content")
                .and_then(|v| v.as_str())
                .ok_or("Missing 'content' parameter")?;
            append_file(workspace, path, content)
        }

        "list_dir" => {
            let path = args
                .get("path")
                .and_then(|v| v.as_str())
                .unwrap_or(".");
            list_dir(workspace, path)
        }

        "glob" => {
            let pattern = args
                .get("pattern")
                .and_then(|v| v.as_str())
                .ok_or("Missing 'pattern' parameter")?;
            let path = args
                .get("path")
                .and_then(|v| v.as_str())
                .unwrap_or(".");
            glob_files(workspace, pattern, path)
        }

        "grep" => {
            let pattern = args
                .get("pattern")
                .and_then(|v| v.as_str())
                .ok_or("Missing 'pattern' parameter")?;
            let path = args
                .get("path")
                .and_then(|v| v.as_str())
                .unwrap_or(".");
            grep_files(workspace, pattern, path)
        }

        "run_shell" => {
            let command = args
                .get("command")
                .and_then(|v| v.as_str())
                .ok_or("Missing 'command' parameter")?;
            let cwd = args.get("cwd").and_then(|v| v.as_str());
            let timeout = args
                .get("timeout")
                .and_then(|v| v.as_u64())
                .unwrap_or(shell_timeout)
                .min(60);
            run_shell(workspace, command, cwd, Some(timeout))
        }

        _ => Err(format!("Unknown tool: {}", name)),
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    fn setup_test_workspace() -> TempDir {
        let dir = TempDir::new().unwrap();

        // Create some test files
        fs::write(dir.path().join("test.txt"), "line 1\nline 2\nline 3\n").unwrap();
        fs::create_dir(dir.path().join("subdir")).unwrap();
        fs::write(
            dir.path().join("subdir").join("nested.md"),
            "# Title\nSome content",
        )
        .unwrap();

        dir
    }

    #[test]
    fn test_safe_path_valid() {
        let dir = setup_test_workspace();
        let result = safe_path(dir.path(), "test.txt");
        assert!(result.is_ok());
    }

    #[test]
    fn test_safe_path_traversal_blocked() {
        let dir = setup_test_workspace();
        let result = safe_path(dir.path(), "../../../etc/passwd");
        assert!(result.is_err());
        let err = result.unwrap_err();
        // Either error message is valid - path traversal or escapes workspace
        assert!(err.contains("traversal") || err.contains("escapes workspace"));
    }

    #[test]
    fn test_read_file() {
        let dir = setup_test_workspace();
        let result = read_file(dir.path(), "test.txt", None, None);
        assert!(result.is_ok());
        let content = result.unwrap();
        assert!(content.contains("line 1"));
        assert!(content.contains("line 2"));
    }

    #[test]
    fn test_read_file_not_found() {
        let dir = setup_test_workspace();
        let result = read_file(dir.path(), "nonexistent.txt", None, None);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not found"));
    }

    #[test]
    fn test_write_file() {
        let dir = setup_test_workspace();
        let result = write_file(dir.path(), "new_file.txt", "hello world");
        assert!(result.is_ok());

        // Verify file was written
        let content = fs::read_to_string(dir.path().join("new_file.txt")).unwrap();
        assert_eq!(content, "hello world");
    }

    #[test]
    fn test_write_file_creates_dirs() {
        let dir = setup_test_workspace();
        let result = write_file(dir.path(), "deep/nested/file.txt", "content");
        assert!(result.is_ok());

        // Verify directory structure was created
        assert!(dir.path().join("deep/nested/file.txt").exists());
    }

    #[test]
    fn test_list_dir() {
        let dir = setup_test_workspace();
        let result = list_dir(dir.path(), ".");
        assert!(result.is_ok());
        let content = result.unwrap();
        assert!(content.contains("test.txt"));
        assert!(content.contains("subdir/"));
    }

    #[test]
    fn test_glob_files() {
        let dir = setup_test_workspace();
        let result = glob_files(dir.path(), "**/*.txt", ".");
        assert!(result.is_ok());
        let content = result.unwrap();
        assert!(content.contains("test.txt"));
    }

    #[test]
    fn test_grep_files() {
        let dir = setup_test_workspace();
        let result = grep_files(dir.path(), "line", ".");
        assert!(result.is_ok());
        let content = result.unwrap();
        assert!(content.contains("test.txt"));
    }

    #[test]
    fn test_tool_schemas() {
        let schemas = get_tool_schemas();
        assert!(!schemas.is_empty());

        let names: Vec<&str> = schemas.iter().map(|t| t.function.name.as_str()).collect();
        assert!(names.contains(&"read_file"));
        assert!(names.contains(&"write_file"));
        assert!(names.contains(&"list_dir"));
        assert!(names.contains(&"glob"));
        assert!(names.contains(&"grep"));
        assert!(names.contains(&"run_shell"));
    }

    #[test]
    fn test_dispatch_read_file() {
        let dir = setup_test_workspace();
        let args = serde_json::json!({"path": "test.txt"});
        let result = dispatch_tool(dir.path(), "read_file", &args, 30);
        assert!(result.is_ok());
    }

    #[test]
    fn test_dispatch_unknown_tool() {
        let dir = setup_test_workspace();
        let args = serde_json::json!({});
        let result = dispatch_tool(dir.path(), "unknown_tool", &args, 30);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Unknown tool"));
    }

    /// Test that symlinks are rejected for security (TOCTOU prevention)
    #[cfg(unix)]
    #[test]
    fn test_symlink_rejected() {
        use std::os::unix::fs::symlink;

        let dir = setup_test_workspace();

        // Create a symlink inside the workspace pointing to /etc/passwd
        let symlink_path = dir.path().join("evil_link");
        symlink("/etc/passwd", &symlink_path).unwrap();

        // Should reject the symlink
        let result = safe_path(dir.path(), "evil_link");
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.contains("Symlinks not allowed"));
    }

    /// Test that symlinks in path components are also rejected
    #[cfg(unix)]
    #[test]
    fn test_symlink_in_path_component_rejected() {
        use std::os::unix::fs::symlink;

        let dir = setup_test_workspace();

        // Create a symlink directory pointing elsewhere
        let outside_dir = TempDir::new().unwrap();
        fs::write(outside_dir.path().join("secret.txt"), "secret content").unwrap();

        let symlink_dir = dir.path().join("linked_dir");
        symlink(outside_dir.path(), &symlink_dir).unwrap();

        // Trying to access file through symlink directory should fail
        let result = safe_path(dir.path(), "linked_dir/secret.txt");
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.contains("Symlinks not allowed"));
    }

    /// Test that .env files are blocked for security
    #[test]
    fn test_sensitive_env_file_blocked() {
        let dir = setup_test_workspace();

        // Create a .env file
        fs::write(dir.path().join(".env"), "SECRET=value").unwrap();

        // Should reject .env file
        let result = safe_path(dir.path(), ".env");
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.contains("Access denied"));
        assert!(err.contains(".env"));
    }

    /// Test that various sensitive files are blocked
    #[test]
    fn test_sensitive_files_blocked() {
        let dir = setup_test_workspace();

        // Test various sensitive file patterns
        let sensitive_files = [
            ".env.local",
            ".env.production",
            "credentials.json",
            ".npmrc",
            ".git-credentials",
        ];

        for file_name in sensitive_files {
            fs::write(dir.path().join(file_name), "sensitive data").unwrap();
            let result = safe_path(dir.path(), file_name);
            assert!(result.is_err(), "Should block {}", file_name);
            assert!(result.unwrap_err().contains("Access denied"));
        }
    }

    /// Test that sensitive extensions are blocked
    #[test]
    fn test_sensitive_extensions_blocked() {
        let dir = setup_test_workspace();

        // Test sensitive extensions
        let sensitive_extensions = [
            "server.pem",
            "private.key",
            "keystore.p12",
        ];

        for file_name in sensitive_extensions {
            fs::write(dir.path().join(file_name), "key data").unwrap();
            let result = safe_path(dir.path(), file_name);
            assert!(result.is_err(), "Should block {}", file_name);
            let err = result.unwrap_err();
            assert!(
                err.contains("Access denied"),
                "Expected 'Access denied' in error for {}, got: {}",
                file_name,
                err
            );
        }
    }

    /// Test that regular files are still allowed
    #[test]
    fn test_regular_files_allowed() {
        let dir = setup_test_workspace();

        // These should be allowed
        let allowed_files = [
            "test.txt",
            "config.json",
            "README.md",
            "src/main.rs",
            ".gitignore",
        ];

        for file_name in allowed_files {
            // Create parent dirs if needed
            if file_name.contains('/') {
                let parent = dir.path().join(file_name).parent().unwrap().to_path_buf();
                fs::create_dir_all(parent).unwrap();
            }
            fs::write(dir.path().join(file_name), "content").unwrap();
            let result = safe_path(dir.path(), file_name);
            assert!(result.is_ok(), "Should allow {}", file_name);
        }
    }
}
