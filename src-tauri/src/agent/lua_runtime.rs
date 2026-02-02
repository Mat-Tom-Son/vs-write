//! Lua runtime for extension scripts.
//!
//! This module provides a sandboxed Lua environment for running extension tools.
//! Extensions can access a limited set of safe functions for file I/O and searching.

use mlua::{Function, Lua, LuaSerdeExt, Result as LuaResult, Table, Value};
use std::path::Path;
use std::sync::Arc;

use super::entity_api::EntityStore;
use super::tools;

/// Context passed to Lua scripts with access to safe operations
pub struct LuaContext {
    workspace: Arc<Path>,
    shell_timeout: u64,
}

impl LuaContext {
    pub fn new(workspace: &Path, shell_timeout: u64) -> Self {
        LuaContext {
            workspace: Arc::from(workspace),
            shell_timeout,
        }
    }
}

/// Create a new sandboxed Lua runtime with tool functions exposed
pub fn create_lua_runtime(ctx: &LuaContext) -> LuaResult<Lua> {
    // Create Lua instance with safe subset (no os, io, debug by default with Lua::new_with)
    let lua = Lua::new();

    // Remove dangerous globals
    sandbox_lua(&lua)?;

    // Create the 'tools' table with our safe functions
    let tools_table = create_tools_table(&lua, ctx)?;
    lua.globals().set("tools", tools_table)?;

    // Add some helpful utilities
    add_utilities(&lua)?;

    Ok(lua)
}

/// Remove dangerous Lua globals to create a sandbox
fn sandbox_lua(lua: &Lua) -> LuaResult<()> {
    let globals = lua.globals();

    // Remove dangerous modules
    globals.set("os", Value::Nil)?;
    globals.set("io", Value::Nil)?;
    globals.set("debug", Value::Nil)?;
    globals.set("package", Value::Nil)?; // No require()

    // Remove dangerous loading functions
    globals.set("loadfile", Value::Nil)?;
    globals.set("dofile", Value::Nil)?;
    globals.set("load", Value::Nil)?; // Prevent loading arbitrary bytecode
    globals.set("loadstring", Value::Nil)?; // Lua 5.1 compat

    // Remove raw table access (can bypass metatables/sandboxing)
    globals.set("rawget", Value::Nil)?;
    globals.set("rawset", Value::Nil)?;
    globals.set("rawequal", Value::Nil)?;
    globals.set("rawlen", Value::Nil)?;

    // Remove other potentially dangerous functions
    globals.set("collectgarbage", Value::Nil)?; // Could be used for timing attacks
    globals.set("newproxy", Value::Nil)?; // Lua 5.1 - creates userdata

    // Restrict string library - remove string.dump (bytecode extraction)
    if let Ok(string_table) = globals.get::<Table>("string") {
        string_table.set("dump", Value::Nil)?;
    }

    // Note: We keep getmetatable/setmetatable but they're restricted to user tables
    // by mlua's default behavior. If more restriction is needed, we could replace
    // them with custom restricted versions.

    Ok(())
}

/// Create the 'tools' table with safe file operations
fn create_tools_table(lua: &Lua, ctx: &LuaContext) -> LuaResult<Table> {
    let tools_table = lua.create_table()?;

    // read_file(path, [offset], [limit]) -> string
    let workspace = ctx.workspace.clone();
    tools_table.set(
        "read_file",
        lua.create_function(move |_, args: (String, Option<usize>, Option<usize>)| {
            let (path, offset, limit) = args;
            match tools::read_file(&workspace, &path, offset, limit) {
                Ok(content) => Ok(content),
                Err(e) => Err(mlua::Error::runtime(e)),
            }
        })?,
    )?;

    // write_file(path, content) -> string
    let workspace = ctx.workspace.clone();
    tools_table.set(
        "write_file",
        lua.create_function(move |_, args: (String, String)| {
            let (path, content) = args;
            match tools::write_file(&workspace, &path, &content) {
                Ok(msg) => Ok(msg),
                Err(e) => Err(mlua::Error::runtime(e)),
            }
        })?,
    )?;

    // delete_file(path) -> string
    let workspace = ctx.workspace.clone();
    tools_table.set(
        "delete_file",
        lua.create_function(move |_, path: String| {
            match tools::delete_file(&workspace, &path) {
                Ok(msg) => Ok(msg),
                Err(e) => Err(mlua::Error::runtime(e)),
            }
        })?,
    )?;

    // append_file(path, content) -> string
    let workspace = ctx.workspace.clone();
    tools_table.set(
        "append_file",
        lua.create_function(move |_, args: (String, String)| {
            let (path, content) = args;
            match tools::append_file(&workspace, &path, &content) {
                Ok(msg) => Ok(msg),
                Err(e) => Err(mlua::Error::runtime(e)),
            }
        })?,
    )?;

    // list_dir(path) -> string (JSON array)
    let workspace = ctx.workspace.clone();
    tools_table.set(
        "list_dir",
        lua.create_function(move |_, path: Option<String>| {
            let path = path.unwrap_or_else(|| ".".to_string());
            match tools::list_dir(&workspace, &path) {
                Ok(result) => Ok(result),
                Err(e) => Err(mlua::Error::runtime(e)),
            }
        })?,
    )?;

    // glob(pattern, [base_path]) -> string (JSON array)
    let workspace = ctx.workspace.clone();
    tools_table.set(
        "glob",
        lua.create_function(move |_, args: (String, Option<String>)| {
            let (pattern, base_path) = args;
            let base = base_path.unwrap_or_else(|| ".".to_string());
            match tools::glob_files(&workspace, &pattern, &base) {
                Ok(result) => Ok(result),
                Err(e) => Err(mlua::Error::runtime(e)),
            }
        })?,
    )?;

    // grep(pattern, [path]) -> string (JSON array of matches)
    let workspace = ctx.workspace.clone();
    tools_table.set(
        "grep",
        lua.create_function(move |_, args: (String, Option<String>)| {
            let (pattern, path) = args;
            let search_path = path.unwrap_or_else(|| ".".to_string());
            match tools::grep_files(&workspace, &pattern, &search_path) {
                Ok(result) => Ok(result),
                Err(e) => Err(mlua::Error::runtime(e)),
            }
        })?,
    )?;

    // run_shell(command, [cwd], [timeout]) -> string (JSON with exit_code and output)
    let workspace = ctx.workspace.clone();
    let shell_timeout = ctx.shell_timeout;
    tools_table.set(
        "run_shell",
        lua.create_function(move |_, args: (String, Option<String>, Option<u64>)| {
            let (command, cwd, timeout) = args;
            let timeout = timeout.unwrap_or(shell_timeout).min(60);
            match tools::run_shell(&workspace, &command, cwd.as_deref(), Some(timeout)) {
                Ok(result) => Ok(result),
                Err(e) => Err(mlua::Error::runtime(e)),
            }
        })?,
    )?;

    // Add entities sub-table
    let entities_table = create_entities_table(lua, ctx)?;
    tools_table.set("entities", entities_table)?;

    Ok(tools_table)
}

/// Create the 'tools.entities' table with entity API operations
fn create_entities_table(lua: &Lua, ctx: &LuaContext) -> LuaResult<Table> {
    let entities = lua.create_table()?;

    // entities.get(entity_id) -> entity or nil (as JSON)
    let workspace = ctx.workspace.clone();
    entities.set(
        "get",
        lua.create_function(move |_, entity_id: String| {
            let store = EntityStore::new(&workspace);
            match store.get_entity(&entity_id) {
                Ok(Some(entity)) => {
                    let json = serde_json::to_string_pretty(&entity)
                        .map_err(|e| mlua::Error::runtime(e.to_string()))?;
                    Ok(json)
                }
                Ok(None) => Ok("null".to_string()),
                Err(e) => Err(mlua::Error::runtime(e)),
            }
        })?,
    )?;

    // entities.list_by_type(type) -> array of entities (as JSON)
    let workspace = ctx.workspace.clone();
    entities.set(
        "list_by_type",
        lua.create_function(move |_, entity_type: String| {
            let store = EntityStore::new(&workspace);
            match store.list_by_type(&entity_type) {
                Ok(list) => {
                    let json = serde_json::to_string_pretty(&list)
                        .map_err(|e| mlua::Error::runtime(e.to_string()))?;
                    Ok(json)
                }
                Err(e) => Err(mlua::Error::runtime(e)),
            }
        })?,
    )?;

    // entities.list_all() -> array of entities (as JSON)
    let workspace = ctx.workspace.clone();
    entities.set(
        "list_all",
        lua.create_function(move |_, ()| {
            let store = EntityStore::new(&workspace);
            match store.list_all() {
                Ok(list) => {
                    let json = serde_json::to_string_pretty(&list)
                        .map_err(|e| mlua::Error::runtime(e.to_string()))?;
                    Ok(json)
                }
                Err(e) => Err(mlua::Error::runtime(e)),
            }
        })?,
    )?;

    // entities.search(query) -> array of entities (as JSON)
    let workspace = ctx.workspace.clone();
    entities.set(
        "search",
        lua.create_function(move |_, query: String| {
            let store = EntityStore::new(&workspace);
            match store.search(&query) {
                Ok(list) => {
                    let json = serde_json::to_string_pretty(&list)
                        .map_err(|e| mlua::Error::runtime(e.to_string()))?;
                    Ok(json)
                }
                Err(e) => Err(mlua::Error::runtime(e)),
            }
        })?,
    )?;

    // entities.get_relationships(entity_id) -> { entity, sections } (as JSON)
    let workspace = ctx.workspace.clone();
    entities.set(
        "get_relationships",
        lua.create_function(move |_, entity_id: String| {
            let store = EntityStore::new(&workspace);
            match store.get_relationships(&entity_id) {
                Ok(rels) => {
                    let json = serde_json::to_string_pretty(&rels)
                        .map_err(|e| mlua::Error::runtime(e.to_string()))?;
                    Ok(json)
                }
                Err(e) => Err(mlua::Error::runtime(e)),
            }
        })?,
    )?;

    // entities.add_tag(section_id, entity_id, from, to) -> tag (as JSON)
    let workspace = ctx.workspace.clone();
    entities.set(
        "add_tag",
        lua.create_function(move |_, args: (String, String, i64, i64)| {
            let (section_id, entity_id, from, to) = args;
            let store = EntityStore::new(&workspace);
            match store.add_tag(&section_id, &entity_id, from, to) {
                Ok(tag) => {
                    let json = serde_json::to_string_pretty(&tag)
                        .map_err(|e| mlua::Error::runtime(e.to_string()))?;
                    Ok(json)
                }
                Err(e) => Err(mlua::Error::runtime(e)),
            }
        })?,
    )?;

    // entities.remove_tag(section_id, tag_id) -> true/false
    let workspace = ctx.workspace.clone();
    entities.set(
        "remove_tag",
        lua.create_function(move |_, args: (String, String)| {
            let (section_id, tag_id) = args;
            let store = EntityStore::new(&workspace);
            match store.remove_tag(&section_id, &tag_id) {
                Ok(removed) => Ok(removed),
                Err(e) => Err(mlua::Error::runtime(e)),
            }
        })?,
    )?;

    // entities.get_tags(section_id) -> array of tags (as JSON)
    let workspace = ctx.workspace.clone();
    entities.set(
        "get_tags",
        lua.create_function(move |_, section_id: String| {
            let store = EntityStore::new(&workspace);
            match store.get_tags(&section_id) {
                Ok(tags) => {
                    let json = serde_json::to_string_pretty(&tags)
                        .map_err(|e| mlua::Error::runtime(e.to_string()))?;
                    Ok(json)
                }
                Err(e) => Err(mlua::Error::runtime(e)),
            }
        })?,
    )?;

    // entities.get_section(section_id) -> section or nil (as JSON)
    let workspace = ctx.workspace.clone();
    entities.set(
        "get_section",
        lua.create_function(move |_, section_id: String| {
            let store = EntityStore::new(&workspace);
            match store.get_section(&section_id) {
                Ok(Some(section)) => {
                    let json = serde_json::to_string_pretty(&section)
                        .map_err(|e| mlua::Error::runtime(e.to_string()))?;
                    Ok(json)
                }
                Ok(None) => Ok("null".to_string()),
                Err(e) => Err(mlua::Error::runtime(e)),
            }
        })?,
    )?;

    // entities.list_sections() -> array of sections (as JSON)
    let workspace = ctx.workspace.clone();
    entities.set(
        "list_sections",
        lua.create_function(move |_, ()| {
            let store = EntityStore::new(&workspace);
            match store.list_all_sections() {
                Ok(sections) => {
                    let json = serde_json::to_string_pretty(&sections)
                        .map_err(|e| mlua::Error::runtime(e.to_string()))?;
                    Ok(json)
                }
                Err(e) => Err(mlua::Error::runtime(e)),
            }
        })?,
    )?;

    Ok(entities)
}

/// Add utility functions to the Lua environment
fn add_utilities(lua: &Lua) -> LuaResult<()> {
    let globals = lua.globals();

    // json_decode(str) -> table
    globals.set(
        "json_decode",
        lua.create_function(|lua, s: String| {
            let value: serde_json::Value =
                serde_json::from_str(&s).map_err(|e| mlua::Error::runtime(e.to_string()))?;
            lua.to_value(&value)
        })?,
    )?;

    // json_encode(table) -> string
    globals.set(
        "json_encode",
        lua.create_function(|lua, value: Value| {
            let json: serde_json::Value = lua.from_value(value)?;
            serde_json::to_string_pretty(&json).map_err(|e| mlua::Error::runtime(e.to_string()))
        })?,
    )?;

    // print() - safe version that just collects output (we'll capture it)
    // For now, just make it a no-op. In the future, we could collect prints.
    globals.set(
        "print",
        lua.create_function(|_, args: mlua::Variadic<String>| {
            // Log for debugging
            for arg in args {
                log::debug!("[Lua] {}", arg);
            }
            Ok(())
        })?,
    )?;

    Ok(())
}

/// Execute a Lua script and return its result
#[allow(dead_code)]
pub fn execute_script(
    lua: &Lua,
    script: &str,
    args: Option<serde_json::Value>,
) -> Result<String, String> {
    // Set the arguments as a global if provided
    if let Some(args) = args {
        let lua_args = lua
            .to_value(&args)
            .map_err(|e| format!("Failed to convert args: {}", e))?;
        lua.globals()
            .set("args", lua_args)
            .map_err(|e| format!("Failed to set args: {}", e))?;
    }

    // Execute the script
    let result: Value = lua
        .load(script)
        .eval()
        .map_err(|e| format!("Lua error: {}", e))?;

    // Convert result to string
    match result {
        Value::Nil => Ok("nil".to_string()),
        Value::Boolean(b) => Ok(b.to_string()),
        Value::Integer(i) => Ok(i.to_string()),
        Value::Number(n) => Ok(n.to_string()),
        Value::String(s) => Ok(s.to_str().map(|s| s.to_string()).unwrap_or_default()),
        Value::Table(_) => {
            // Convert table to JSON
            let json: serde_json::Value = lua
                .from_value(result)
                .map_err(|e| format!("Failed to convert result: {}", e))?;
            serde_json::to_string_pretty(&json)
                .map_err(|e| format!("Failed to serialize result: {}", e))
        }
        _ => Ok(format!("{:?}", result)),
    }
}

/// Execute a Lua function by name with arguments
pub fn call_function(
    lua: &Lua,
    script: &str,
    function_name: &str,
    args: serde_json::Value,
) -> Result<String, String> {
    // Load the script to define functions
    lua.load(script)
        .exec()
        .map_err(|e| format!("Failed to load script: {}", e))?;

    // Get the function
    let func: Function = lua
        .globals()
        .get(function_name)
        .map_err(|e| format!("Function '{}' not found: {}", function_name, e))?;

    // Convert args to Lua value
    let lua_args = lua
        .to_value(&args)
        .map_err(|e| format!("Failed to convert args: {}", e))?;

    // Call the function
    let result: Value = func
        .call(lua_args)
        .map_err(|e| format!("Function call failed: {}", e))?;

    // Convert result to string
    match result {
        Value::Nil => Ok("".to_string()),
        Value::Boolean(b) => Ok(b.to_string()),
        Value::Integer(i) => Ok(i.to_string()),
        Value::Number(n) => Ok(n.to_string()),
        Value::String(s) => Ok(s.to_str().map(|s| s.to_string()).unwrap_or_default()),
        Value::Table(_) => {
            let json: serde_json::Value = lua
                .from_value(result)
                .map_err(|e| format!("Failed to convert result: {}", e))?;
            serde_json::to_string_pretty(&json)
                .map_err(|e| format!("Failed to serialize result: {}", e))
        }
        _ => Ok(format!("{:?}", result)),
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn setup_test_workspace() -> TempDir {
        let dir = TempDir::new().unwrap();
        std::fs::write(dir.path().join("test.txt"), "hello world\nline 2\n").unwrap();
        std::fs::create_dir(dir.path().join("subdir")).unwrap();
        std::fs::write(dir.path().join("subdir/nested.md"), "# Title\nContent").unwrap();
        dir
    }

    #[test]
    fn test_sandbox_removes_dangerous() {
        let ctx = LuaContext::new(Path::new("/tmp"), 30);
        let lua = create_lua_runtime(&ctx).unwrap();

        // os should be nil
        let result: Value = lua.load("return os").eval().unwrap();
        assert!(matches!(result, Value::Nil));

        // io should be nil
        let result: Value = lua.load("return io").eval().unwrap();
        assert!(matches!(result, Value::Nil));

        // debug should be nil
        let result: Value = lua.load("return debug").eval().unwrap();
        assert!(matches!(result, Value::Nil));

        // loadfile should be nil
        let result: Value = lua.load("return loadfile").eval().unwrap();
        assert!(matches!(result, Value::Nil));

        // load should be nil
        let result: Value = lua.load("return load").eval().unwrap();
        assert!(matches!(result, Value::Nil));

        // rawget should be nil
        let result: Value = lua.load("return rawget").eval().unwrap();
        assert!(matches!(result, Value::Nil));

        // rawset should be nil
        let result: Value = lua.load("return rawset").eval().unwrap();
        assert!(matches!(result, Value::Nil));

        // string.dump should be nil
        let result: Value = lua.load("return string.dump").eval().unwrap();
        assert!(matches!(result, Value::Nil));
    }

    #[test]
    fn test_sandbox_allows_safe_operations() {
        let ctx = LuaContext::new(Path::new("/tmp"), 30);
        let lua = create_lua_runtime(&ctx).unwrap();

        // Basic Lua operations should still work
        let result: i32 = lua.load("return 1 + 2").eval().unwrap();
        assert_eq!(result, 3);

        // String operations should work (except dump)
        let result: String = lua.load("return string.upper('hello')").eval().unwrap();
        assert_eq!(result, "HELLO");

        // Table operations should work
        let result: i32 = lua.load("local t = {1,2,3}; return #t").eval().unwrap();
        assert_eq!(result, 3);

        // Math operations should work
        let result: f64 = lua.load("return math.sqrt(4)").eval().unwrap();
        assert!((result - 2.0).abs() < 0.001);
    }

    #[test]
    fn test_read_file() {
        let dir = setup_test_workspace();
        let ctx = LuaContext::new(dir.path(), 30);
        let lua = create_lua_runtime(&ctx).unwrap();

        let script = r#"return tools.read_file("test.txt")"#;
        let result = execute_script(&lua, script, None).unwrap();
        assert!(result.contains("hello world"));
    }

    #[test]
    fn test_list_dir() {
        let dir = setup_test_workspace();
        let ctx = LuaContext::new(dir.path(), 30);
        let lua = create_lua_runtime(&ctx).unwrap();

        let script = r#"return tools.list_dir(".")"#;
        let result = execute_script(&lua, script, None).unwrap();
        assert!(result.contains("test.txt"));
        assert!(result.contains("subdir"));
    }

    #[test]
    fn test_glob() {
        let dir = setup_test_workspace();
        let ctx = LuaContext::new(dir.path(), 30);
        let lua = create_lua_runtime(&ctx).unwrap();

        let script = r#"return tools.glob("**/*.md")"#;
        let result = execute_script(&lua, script, None).unwrap();
        assert!(result.contains("nested.md"));
    }

    #[test]
    fn test_json_utilities() {
        let ctx = LuaContext::new(Path::new("/tmp"), 30);
        let lua = create_lua_runtime(&ctx).unwrap();

        let script = r#"
            local data = {name = "test", value = 42}
            local json_str = json_encode(data)
            local decoded = json_decode(json_str)
            return decoded.value
        "#;
        let result = execute_script(&lua, script, None).unwrap();
        assert_eq!(result, "42");
    }

    #[test]
    fn test_call_function() {
        let dir = setup_test_workspace();
        let ctx = LuaContext::new(dir.path(), 30);
        let lua = create_lua_runtime(&ctx).unwrap();

        let script = r#"
            function process(args)
                local files = tools.glob(args.pattern)
                return files
            end
        "#;

        let args = serde_json::json!({"pattern": "*.txt"});
        let result = call_function(&lua, script, "process", args).unwrap();
        assert!(result.contains("test.txt"));
    }

    #[test]
    fn test_write_file() {
        let dir = setup_test_workspace();
        let ctx = LuaContext::new(dir.path(), 30);
        let lua = create_lua_runtime(&ctx).unwrap();

        let script = r#"
            tools.write_file("new_file.txt", "created by lua")
            return tools.read_file("new_file.txt")
        "#;
        let result = execute_script(&lua, script, None).unwrap();
        assert!(result.contains("created by lua"));
    }
}
