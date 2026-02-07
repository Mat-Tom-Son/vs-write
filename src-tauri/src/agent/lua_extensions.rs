//! Lua extension management for the native agent.
//!
//! This module handles loading, registering, and executing Lua-based extension tools.
//! It also supports lifecycle hooks for responding to app events.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use super::lua_runtime::{call_function, create_lua_runtime, LuaContext};
use super::types::{JsonSchema, Tool};

// ============================================================================
// Lifecycle Hook Types
// ============================================================================

/// Lifecycle hook names
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LifecycleHook {
    OnActivate,
    OnDeactivate,
    OnProjectOpen,
    OnProjectClose,
    OnSectionSave,
    OnEntityChange,
}

impl LifecycleHook {
    /// Get the function name for this hook
    pub fn function_name(&self) -> &'static str {
        match self {
            LifecycleHook::OnActivate => "on_activate",
            LifecycleHook::OnDeactivate => "on_deactivate",
            LifecycleHook::OnProjectOpen => "on_project_open",
            LifecycleHook::OnProjectClose => "on_project_close",
            LifecycleHook::OnSectionSave => "on_section_save",
            LifecycleHook::OnEntityChange => "on_entity_change",
        }
    }
}

/// Lifecycle configuration in manifest
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LifecycleConfig {
    #[serde(default)]
    pub on_activate: bool,
    #[serde(default)]
    pub on_deactivate: bool,
    #[serde(default)]
    pub on_project_open: bool,
    #[serde(default)]
    pub on_project_close: bool,
    #[serde(default)]
    pub on_section_save: bool,
    #[serde(default)]
    pub on_section_delete: bool,
    #[serde(default)]
    pub on_entity_change: bool,
}

impl LifecycleConfig {
    /// Check if a hook is enabled
    pub fn is_enabled(&self, hook: LifecycleHook) -> bool {
        match hook {
            LifecycleHook::OnActivate => self.on_activate,
            LifecycleHook::OnDeactivate => self.on_deactivate,
            LifecycleHook::OnProjectOpen => self.on_project_open,
            LifecycleHook::OnProjectClose => self.on_project_close,
            LifecycleHook::OnSectionSave => self.on_section_save,
            LifecycleHook::OnEntityChange => self.on_entity_change,
        }
    }
}

/// Result of executing a lifecycle hook
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HookResult {
    pub success: bool,
    pub result: Option<String>,
    pub error: Option<String>,
}

// ============================================================================
// Extension Manifest Types
// ============================================================================

/// Extension manifest (manifest.json in extension directory)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtensionManifest {
    pub id: String,
    pub name: String,
    pub version: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub tools: Vec<LuaToolDefinition>,
    /// Lifecycle hooks configuration
    #[serde(default)]
    pub lifecycle: Option<LifecycleConfig>,
}

/// Tool definition within an extension
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LuaToolDefinition {
    pub name: String,
    pub description: String,
    /// Path to Lua script file (relative to extension directory)
    #[serde(rename = "luaScript")]
    #[serde(default)]
    pub lua_script: Option<String>,
    /// Function name to call in the script
    #[serde(rename = "luaFunction")]
    #[serde(default)]
    pub lua_function: Option<String>,
    /// Path to Python module (legacy, for dual support)
    #[serde(rename = "pythonModule")]
    #[serde(default)]
    pub python_module: Option<String>,
    /// Python function name (legacy)
    #[serde(rename = "pythonFunction")]
    #[serde(default)]
    pub python_function: Option<String>,
    /// JSON schema for tool parameters
    #[serde(default)]
    pub parameters: Option<serde_json::Value>,
    /// Alternative schema field name
    #[serde(default)]
    pub schema: Option<serde_json::Value>,
}

/// A loaded extension with its tools and hooks
#[derive(Debug, Clone)]
pub struct LoadedExtension {
    pub manifest: ExtensionManifest,
    #[allow(dead_code)]
    pub directory: PathBuf,
    pub scripts: HashMap<String, String>, // tool_name -> script content
    pub hooks_script: Option<String>,     // hooks.lua content if present
}

/// Registry of loaded extensions and their tools
#[derive(Debug, Clone)]
pub struct ExtensionRegistry {
    extensions: HashMap<String, LoadedExtension>,
    tool_to_extension: HashMap<String, String>, // tool_name -> extension_id
}

impl ExtensionRegistry {
    pub fn new() -> Self {
        ExtensionRegistry {
            extensions: HashMap::new(),
            tool_to_extension: HashMap::new(),
        }
    }

    /// Load an extension from a directory
    pub fn load_extension(&mut self, extension_dir: &Path) -> Result<(), String> {
        let manifest_path = extension_dir.join("manifest.json");

        if !manifest_path.exists() {
            return Err(format!(
                "No manifest.json found in {}",
                extension_dir.display()
            ));
        }

        let manifest_content = fs::read_to_string(&manifest_path)
            .map_err(|e| format!("Failed to read manifest: {}", e))?;

        let manifest: ExtensionManifest = serde_json::from_str(&manifest_content)
            .map_err(|e| format!("Failed to parse manifest: {}", e))?;

        // Load all Lua scripts for tools
        let mut scripts = HashMap::new();
        for tool in &manifest.tools {
            // Support both luaScript (preferred) and pythonModule (legacy)
            if let Some(lua_script) = &tool.lua_script {
                let script_path = extension_dir.join(lua_script);
                if !script_path.exists() {
                    return Err(format!(
                        "Lua script not found: {} for tool {}",
                        lua_script, tool.name
                    ));
                }

                let script_content = fs::read_to_string(&script_path)
                    .map_err(|e| format!("Failed to read script {}: {}", lua_script, e))?;

                scripts.insert(tool.name.clone(), script_content);

                // Register tool -> extension mapping
                let full_tool_name = format!("{}:{}", manifest.id, tool.name);
                self.tool_to_extension
                    .insert(full_tool_name, manifest.id.clone());
            } else if tool.python_module.is_some() {
                // Legacy Python tool - skip for Lua registry but log
                log::info!(
                    "Tool '{}' uses Python (legacy) - not loaded into Lua registry",
                    tool.name
                );
            } else {
                return Err(format!(
                    "Tool '{}' has neither luaScript nor pythonModule defined",
                    tool.name
                ));
            }
        }

        // Load hooks.lua if present
        let hooks_path = extension_dir.join("hooks.lua");
        let hooks_script = if hooks_path.exists() {
            Some(
                fs::read_to_string(&hooks_path)
                    .map_err(|e| format!("Failed to read hooks.lua: {}", e))?,
            )
        } else {
            None
        };

        let has_hooks = hooks_script.is_some();

        let loaded = LoadedExtension {
            manifest: manifest.clone(),
            directory: extension_dir.to_path_buf(),
            scripts,
            hooks_script,
        };

        self.extensions.insert(manifest.id.clone(), loaded);

        log::info!(
            "Loaded extension '{}' with {} tools{}",
            manifest.name,
            manifest.tools.len(),
            if has_hooks { " and hooks" } else { "" }
        );

        Ok(())
    }

    /// Unload an extension
    pub fn unload_extension(&mut self, extension_id: &str) -> Result<(), String> {
        if let Some(ext) = self.extensions.remove(extension_id) {
            // Remove tool mappings
            for tool in &ext.manifest.tools {
                let full_name = format!("{}:{}", extension_id, tool.name);
                self.tool_to_extension.remove(&full_name);
            }
            Ok(())
        } else {
            Err(format!("Extension '{}' not found", extension_id))
        }
    }

    /// Get all tool schemas from loaded extensions
    pub fn get_extension_tool_schemas(&self) -> Vec<Tool> {
        let mut tools = Vec::new();

        for (ext_id, ext) in &self.extensions {
            for tool_def in &ext.manifest.tools {
                // Only include tools that have Lua implementations
                if tool_def.lua_script.is_none() {
                    continue;
                }

                let full_name = format!("{}:{}", ext_id, tool_def.name);

                // Build parameters schema - check both 'parameters' and 'schema' fields
                let schema_value = tool_def.parameters.as_ref().or(tool_def.schema.as_ref());

                let parameters = if let Some(params) = schema_value {
                    // Use provided schema
                    serde_json::from_value(params.clone()).unwrap_or_else(|_| JsonSchema {
                        schema_type: "object".to_string(),
                        properties: None,
                        required: None,
                    })
                } else {
                    // Default empty schema
                    JsonSchema {
                        schema_type: "object".to_string(),
                        properties: Some(HashMap::new()),
                        required: Some(vec![]),
                    }
                };

                tools.push(Tool::new(
                    &full_name,
                    &format!("[{}] {}", ext.manifest.name, tool_def.description),
                    parameters,
                ));
            }
        }

        tools
    }

    /// Execute an extension tool
    pub fn execute_tool(
        &self,
        tool_name: &str,
        args: &serde_json::Value,
        workspace: &Path,
        shell_timeout: u64,
    ) -> Result<String, String> {
        // Parse tool name (format: "extension_id:tool_name")
        let parts: Vec<&str> = tool_name.splitn(2, ':').collect();
        if parts.len() != 2 {
            return Err(format!(
                "Invalid extension tool name '{}'. Expected format: 'extension_id:tool_name'",
                tool_name
            ));
        }

        let ext_id = parts[0];
        let local_tool_name = parts[1];

        let extension = self
            .extensions
            .get(ext_id)
            .ok_or_else(|| format!("Extension '{}' not found", ext_id))?;

        let script = extension.scripts.get(local_tool_name).ok_or_else(|| {
            format!(
                "Tool '{}' not found in extension '{}'",
                local_tool_name, ext_id
            )
        })?;

        let tool_def = extension
            .manifest
            .tools
            .iter()
            .find(|t| t.name == local_tool_name)
            .ok_or_else(|| format!("Tool definition not found for '{}'", local_tool_name))?;

        // Get function name (default to tool name if not specified)
        let function_name = tool_def
            .lua_function
            .as_ref()
            .map(|s| s.as_str())
            .unwrap_or(local_tool_name);

        // Create Lua runtime
        let ctx = LuaContext::new(workspace, shell_timeout);
        let lua =
            create_lua_runtime(&ctx).map_err(|e| format!("Failed to create Lua runtime: {}", e))?;

        // Execute the tool function
        call_function(&lua, script, function_name, args.clone())
    }

    /// Execute a lifecycle hook for an extension
    pub fn execute_hook(
        &self,
        extension_id: &str,
        hook: LifecycleHook,
        args: serde_json::Value,
        workspace: &Path,
        shell_timeout: u64,
    ) -> Result<HookResult, String> {
        let extension = self
            .extensions
            .get(extension_id)
            .ok_or_else(|| format!("Extension '{}' not found", extension_id))?;

        // Check if hook is enabled in manifest
        let lifecycle = extension.manifest.lifecycle.as_ref();
        if let Some(lc) = lifecycle {
            if !lc.is_enabled(hook) {
                return Ok(HookResult {
                    success: true,
                    result: None,
                    error: Some(format!("Hook {:?} not enabled for extension", hook)),
                });
            }
        } else {
            return Ok(HookResult {
                success: true,
                result: None,
                error: Some("No lifecycle hooks configured".to_string()),
            });
        }

        // Check if hooks.lua exists
        let script = extension.hooks_script.as_ref().ok_or_else(|| {
            format!(
                "Extension '{}' has lifecycle config but no hooks.lua file",
                extension_id
            )
        })?;

        // Create Lua runtime
        let ctx = LuaContext::new(workspace, shell_timeout);
        let lua =
            create_lua_runtime(&ctx).map_err(|e| format!("Failed to create Lua runtime: {}", e))?;

        // Execute the hook function
        let function_name = hook.function_name();
        match call_function(&lua, script, function_name, args) {
            Ok(result) => Ok(HookResult {
                success: true,
                result: Some(result),
                error: None,
            }),
            Err(e) => Ok(HookResult {
                success: false,
                result: None,
                error: Some(e),
            }),
        }
    }

    /// Execute a lifecycle hook for all extensions that have it enabled
    pub fn execute_hook_all(
        &self,
        hook: LifecycleHook,
        args: serde_json::Value,
        workspace: &Path,
        shell_timeout: u64,
    ) -> Vec<(String, HookResult)> {
        let mut results = Vec::new();

        for ext_id in self.extensions.keys() {
            match self.execute_hook(ext_id, hook, args.clone(), workspace, shell_timeout) {
                Ok(result) => results.push((ext_id.clone(), result)),
                Err(e) => results.push((
                    ext_id.clone(),
                    HookResult {
                        success: false,
                        result: None,
                        error: Some(e),
                    },
                )),
            }
        }

        results
    }

    /// Get list of hooks enabled for an extension
    pub fn get_enabled_hooks(&self, extension_id: &str) -> Vec<LifecycleHook> {
        let extension = match self.extensions.get(extension_id) {
            Some(ext) => ext,
            None => return Vec::new(),
        };

        let lifecycle = match &extension.manifest.lifecycle {
            Some(lc) => lc,
            None => return Vec::new(),
        };

        let all_hooks = [
            LifecycleHook::OnActivate,
            LifecycleHook::OnDeactivate,
            LifecycleHook::OnProjectOpen,
            LifecycleHook::OnProjectClose,
            LifecycleHook::OnSectionSave,
            LifecycleHook::OnEntityChange,
        ];

        all_hooks
            .into_iter()
            .filter(|h| lifecycle.is_enabled(*h))
            .collect()
    }

    /// Check if a tool name is an extension tool
    pub fn is_extension_tool(&self, tool_name: &str) -> bool {
        tool_name.contains(':') && self.tool_to_extension.contains_key(tool_name)
    }

    /// Get list of loaded extension IDs
    pub fn list_extensions(&self) -> Vec<&str> {
        self.extensions.keys().map(|s| s.as_str()).collect()
    }

    /// Get extension directories for signature verification
    /// Returns a list of (extension_id, manifest_path) pairs
    pub fn get_extension_manifest_paths(&self) -> Vec<(String, PathBuf)> {
        self.extensions
            .iter()
            .map(|(id, ext)| (id.clone(), ext.directory.join("manifest.json")))
            .collect()
    }
}

impl Default for ExtensionRegistry {
    fn default() -> Self {
        Self::new()
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

    fn create_test_extension(dir: &Path) {
        // Create manifest
        let manifest = r#"{
            "id": "test-ext",
            "name": "Test Extension",
            "version": "1.0.0",
            "tools": [
                {
                    "name": "greet",
                    "description": "Say hello",
                    "luaScript": "greet.lua",
                    "luaFunction": "greet",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "name": {"type": "string", "description": "Name to greet"}
                        },
                        "required": ["name"]
                    }
                }
            ]
        }"#;

        fs::write(dir.join("manifest.json"), manifest).unwrap();

        // Create Lua script
        let script = r#"
            function greet(args)
                return "Hello, " .. args.name .. "!"
            end
        "#;

        fs::write(dir.join("greet.lua"), script).unwrap();
    }

    #[test]
    fn test_load_extension() {
        let dir = TempDir::new().unwrap();
        create_test_extension(dir.path());

        let mut registry = ExtensionRegistry::new();
        registry.load_extension(dir.path()).unwrap();

        assert_eq!(registry.list_extensions(), vec!["test-ext"]);
    }

    #[test]
    fn test_get_tool_schemas() {
        let dir = TempDir::new().unwrap();
        create_test_extension(dir.path());

        let mut registry = ExtensionRegistry::new();
        registry.load_extension(dir.path()).unwrap();

        let schemas = registry.get_extension_tool_schemas();
        assert_eq!(schemas.len(), 1);
        assert_eq!(schemas[0].function.name, "test-ext:greet");
    }

    #[test]
    fn test_execute_tool() {
        let ext_dir = TempDir::new().unwrap();
        create_test_extension(ext_dir.path());

        let workspace = TempDir::new().unwrap();

        let mut registry = ExtensionRegistry::new();
        registry.load_extension(ext_dir.path()).unwrap();

        let args = serde_json::json!({"name": "World"});
        let result = registry
            .execute_tool("test-ext:greet", &args, workspace.path(), 30)
            .unwrap();

        assert_eq!(result, "Hello, World!");
    }

    #[test]
    fn test_is_extension_tool() {
        let dir = TempDir::new().unwrap();
        create_test_extension(dir.path());

        let mut registry = ExtensionRegistry::new();
        registry.load_extension(dir.path()).unwrap();

        assert!(registry.is_extension_tool("test-ext:greet"));
        assert!(!registry.is_extension_tool("read_file"));
        assert!(!registry.is_extension_tool("unknown:tool"));
    }

    #[test]
    fn test_unload_extension() {
        let dir = TempDir::new().unwrap();
        create_test_extension(dir.path());

        let mut registry = ExtensionRegistry::new();
        registry.load_extension(dir.path()).unwrap();

        assert_eq!(registry.list_extensions().len(), 1);

        registry.unload_extension("test-ext").unwrap();

        assert_eq!(registry.list_extensions().len(), 0);
        assert!(!registry.is_extension_tool("test-ext:greet"));
    }
}
