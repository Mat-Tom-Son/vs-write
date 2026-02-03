mod agent;
mod agent_commands;
mod extensions;

use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use tauri::{Emitter, Manager};
use tokio::sync::Mutex;
use serde::Serialize;

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

#[derive(Clone, Serialize)]
struct NativeMenuAction {
  action: String,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let builder = tauri::Builder::default()
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_sql::Builder::new().build())
    ;

  #[cfg(target_os = "macos")]
  let builder = builder
    .menu(|handle| {
      use tauri::menu::{AboutMetadata, Menu, MenuItemBuilder, PredefinedMenuItem, Submenu};

      let pkg_info = handle.package_info();
      let config = handle.config();
      let about_metadata = AboutMetadata {
        name: Some(pkg_info.name.clone()),
        version: Some(pkg_info.version.to_string()),
        copyright: config.bundle.copyright.clone(),
        authors: config.bundle.publisher.clone().map(|p| vec![p]),
        ..Default::default()
      };

      let new_project = MenuItemBuilder::with_id("vswrite:new_project", "New Project")
        .accelerator("CmdOrCtrl+N")
        .build(handle)?;
      let open_project = MenuItemBuilder::with_id("vswrite:open_project", "Open Project…")
        .accelerator("CmdOrCtrl+O")
        .build(handle)?;
      let save_project = MenuItemBuilder::with_id("vswrite:save_project", "Save")
        .accelerator("CmdOrCtrl+S")
        .build(handle)?;
      let settings = MenuItemBuilder::with_id("vswrite:settings", "Settings…")
        .accelerator("CmdOrCtrl+,")
        .build(handle)?;
      let close_project = MenuItemBuilder::with_id("vswrite:close_project", "Close Project")
        .build(handle)?;

      let app_menu = Submenu::with_items(
        handle,
        pkg_info.name.clone(),
        true,
        &[
          &PredefinedMenuItem::about(handle, None, Some(about_metadata))?,
          &PredefinedMenuItem::separator(handle)?,
          &PredefinedMenuItem::services(handle, None)?,
          &PredefinedMenuItem::separator(handle)?,
          &PredefinedMenuItem::hide(handle, None)?,
          &PredefinedMenuItem::hide_others(handle, None)?,
          &PredefinedMenuItem::separator(handle)?,
          &PredefinedMenuItem::quit(handle, None)?,
        ],
      )?;

      let file_menu = Submenu::with_items(
        handle,
        "File",
        true,
        &[
          &new_project,
          &open_project,
          &PredefinedMenuItem::separator(handle)?,
          &save_project,
          &PredefinedMenuItem::separator(handle)?,
          &settings,
          &PredefinedMenuItem::separator(handle)?,
          &close_project,
        ],
      )?;

      let edit_menu = Submenu::with_items(
        handle,
        "Edit",
        true,
        &[
          &PredefinedMenuItem::undo(handle, None)?,
          &PredefinedMenuItem::redo(handle, None)?,
          &PredefinedMenuItem::separator(handle)?,
          &PredefinedMenuItem::cut(handle, None)?,
          &PredefinedMenuItem::copy(handle, None)?,
          &PredefinedMenuItem::paste(handle, None)?,
          &PredefinedMenuItem::select_all(handle, None)?,
        ],
      )?;

      let window_menu = Submenu::with_items(
        handle,
        "Window",
        true,
        &[
          &PredefinedMenuItem::minimize(handle, None)?,
          &PredefinedMenuItem::maximize(handle, None)?,
          &PredefinedMenuItem::separator(handle)?,
          &PredefinedMenuItem::close_window(handle, None)?,
        ],
      )?;

      let help_menu = Submenu::with_items(handle, "Help", true, &[])?;

      Menu::with_items(handle, &[&app_menu, &file_menu, &edit_menu, &window_menu, &help_menu])
    })
    .on_menu_event(|app, event| {
      let action = if event.id() == "vswrite:new_project" {
        Some("new_project")
      } else if event.id() == "vswrite:open_project" {
        Some("open_project")
      } else if event.id() == "vswrite:save_project" {
        Some("save_project")
      } else if event.id() == "vswrite:close_project" {
        Some("close_project")
      } else if event.id() == "vswrite:settings" {
        Some("settings")
      } else {
        None
      };

      let Some(action) = action else {
        return;
      };

      if let Some(window) = app.get_webview_window("main") {
        let _ = window.emit(
          "native_menu_action",
          NativeMenuAction {
            action: action.to_string(),
          },
        );
      }
    });

  builder
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

      // Create tool approval store for gated tool execution
      let tool_approvals: agent::ToolApprovalStore = Arc::new(Mutex::new(HashMap::new()));
      app.manage(tool_approvals);

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
      extensions::install_bundled_lua_extensions,
      // Native agent commands
      agent_commands::run_native_agent,
      agent_commands::get_native_agent_status,
      agent_commands::get_available_providers,
      agent_commands::cancel_agent_task,
      agent_commands::list_running_tasks,
      agent_commands::get_agent_run_capacity,
      agent_commands::respond_tool_approval,
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
