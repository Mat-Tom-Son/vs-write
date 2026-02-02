mod agent;
mod agent_commands;
mod extensions;

use std::sync::{Arc, RwLock};
use tauri::Manager;

use agent::credentials::{CredentialManager, SharedCredentialManager};
use agent::lua_extensions::ExtensionRegistry;
use agent::session::{SessionStore, SharedSessionStore};
use agent_commands::{RunningTasks, SharedExtensionRegistry};

#[tauri::command]
fn reveal_path(path: String) -> Result<(), String> {
  open::that(path).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_app_cwd() -> Result<String, String> {
  std::env::current_dir()
    .map_err(|e| e.to_string())
    .map(|path| path.to_string_lossy().to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_sql::Builder::new().build())
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      // Create credential manager for secure API key handling
      // Keys are read from environment variables, never exposed to frontend
      let credential_manager: SharedCredentialManager = Arc::new(CredentialManager::new());
      app.manage(credential_manager);

      // Create extension registry for Lua extensions (RwLock allows concurrent reads)
      let extension_registry: SharedExtensionRegistry = Arc::new(RwLock::new(ExtensionRegistry::new()));
      app.manage(extension_registry);

      // Create running tasks map for agent cancellation
      let running_tasks: RunningTasks = Arc::new(RwLock::new(std::collections::HashMap::new()));
      app.manage(running_tasks);

      // Create session store for tracking agent sessions and audit logging
      let session_store: SharedSessionStore = Arc::new(SessionStore::new());
      app.manage(session_store);

      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      reveal_path,
      get_app_cwd,
      extensions::extract_extension,
      extensions::delete_extension,
      extensions::read_extension_info,
      extensions::verify_extension_signature,
      extensions::get_trusted_publishers,
      // Native agent commands
      agent_commands::run_native_agent,
      agent_commands::get_native_agent_status,
      agent_commands::get_available_providers,
      agent_commands::cancel_agent_task,
      agent_commands::list_running_tasks,
      agent_commands::get_agent_run_capacity,
      // Lua extension management commands
      agent_commands::load_lua_extension,
      agent_commands::unload_lua_extension,
      agent_commands::list_lua_extensions,
      agent_commands::get_extension_tools,
      // Lifecycle hook commands
      agent_commands::execute_extension_hook,
      agent_commands::execute_hook_all,
      agent_commands::get_extension_hooks,
      // Health check
      agent_commands::run_agent_health_check,
      // Session management
      agent_commands::list_agent_sessions,
      agent_commands::get_agent_session,
      agent_commands::get_session_audit_log,
      agent_commands::get_recent_audit_log
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
