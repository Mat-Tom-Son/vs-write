/**
 * NativeExtensionService - Wraps Tauri commands for Lua extension management
 *
 * This service provides a TypeScript interface to the native Rust extension system.
 * It handles loading, unloading, and executing Lua extensions via Tauri IPC.
 *
 * @module NativeExtensionService
 */

import { invoke } from '@tauri-apps/api/core';
import { appDataDir, join } from '@tauri-apps/api/path';
import { readDir, exists } from '@tauri-apps/plugin-fs';
import type {
  ExtensionInfo,
  ExtensionToolInfo,
  HookResult,
  LifecycleHookName,
} from '../lib/extension-schemas';

/**
 * Loaded extension state for UI display
 */
export interface LoadedExtension {
  id: string;
  name: string;
  version: string;
  description?: string;
  toolCount: number;
  hooks: LifecycleHookName[];
  loadedAt: Date;
}

/**
 * NativeExtensionService - Manages Lua extensions via Tauri commands
 */
class NativeExtensionServiceClass {
  /** Cache of loaded extensions */
  private loadedExtensions: Map<string, LoadedExtension> = new Map();

  /**
   * Load a Lua extension from a directory
   *
   * @param extensionPath - Path to the extension directory (containing manifest.json)
   * @returns ExtensionInfo with details about the loaded extension
   */
  async loadExtension(extensionPath: string): Promise<ExtensionInfo> {
    console.log(`[NativeExtensionService] Loading extension from ${extensionPath}`);

    const info = await invoke<ExtensionInfo>('load_lua_extension', {
      extensionPath,
    });

    // Fetch hooks for this extension
    const hooks = await this.getExtensionHooks(info.id);

    // Cache the loaded extension
    this.loadedExtensions.set(info.id, {
      id: info.id,
      name: info.name,
      version: info.version,
      description: info.description,
      toolCount: info.tool_count,
      hooks,
      loadedAt: new Date(),
    });

    console.log(`[NativeExtensionService] Loaded extension: ${info.name} (${info.tool_count} tools)`);

    // Execute onActivate hook if enabled
    if (hooks.includes('on_activate')) {
      try {
        await this.executeHook(info.id, 'on_activate', {});
        console.log(`[NativeExtensionService] Executed on_activate hook for ${info.id}`);
      } catch (error) {
        console.warn(`[NativeExtensionService] on_activate hook failed for ${info.id}:`, error);
      }
    }

    return info;
  }

  /**
   * Unload a Lua extension
   *
   * @param extensionId - ID of the extension to unload
   */
  async unloadExtension(extensionId: string): Promise<void> {
    console.log(`[NativeExtensionService] Unloading extension: ${extensionId}`);

    const ext = this.loadedExtensions.get(extensionId);

    // Execute onDeactivate hook if enabled
    if (ext?.hooks.includes('on_deactivate')) {
      try {
        await this.executeHook(extensionId, 'on_deactivate', {});
        console.log(`[NativeExtensionService] Executed on_deactivate hook for ${extensionId}`);
      } catch (error) {
        console.warn(`[NativeExtensionService] on_deactivate hook failed for ${extensionId}:`, error);
      }
    }

    await invoke('unload_lua_extension', { extensionId });

    this.loadedExtensions.delete(extensionId);

    console.log(`[NativeExtensionService] Unloaded extension: ${extensionId}`);
  }

  /**
   * List all loaded extension IDs
   *
   * @returns Array of extension IDs
   */
  async listExtensions(): Promise<string[]> {
    return await invoke<string[]>('list_lua_extensions');
  }

  /**
   * Get tools from all loaded extensions
   *
   * @returns Array of tool info objects
   */
  async getExtensionTools(): Promise<ExtensionToolInfo[]> {
    return await invoke<ExtensionToolInfo[]>('get_extension_tools');
  }

  /**
   * Execute a lifecycle hook for a specific extension
   *
   * @param extensionId - ID of the extension
   * @param hookName - Name of the hook to execute
   * @param args - Arguments to pass to the hook
   * @param workspace - Workspace path for file operations
   * @returns HookResult with success status and any output
   */
  async executeHook(
    extensionId: string,
    hookName: LifecycleHookName,
    args: Record<string, unknown>,
    workspace?: string
  ): Promise<HookResult> {
    return await invoke<HookResult>('execute_extension_hook', {
      extensionId,
      hookName,
      args,
      workspace: workspace || '',
    });
  }

  /**
   * Execute a lifecycle hook for all extensions that have it enabled
   *
   * @param hookName - Name of the hook to execute
   * @param args - Arguments to pass to the hook
   * @param workspace - Workspace path for file operations
   * @returns Array of [extensionId, HookResult] tuples
   */
  async executeHookAll(
    hookName: LifecycleHookName,
    args: Record<string, unknown>,
    workspace: string
  ): Promise<Array<[string, HookResult]>> {
    return await invoke<Array<[string, HookResult]>>('execute_hook_all', {
      hookName,
      args,
      workspace,
    });
  }

  /**
   * Get list of enabled hooks for an extension
   *
   * @param extensionId - ID of the extension
   * @returns Array of enabled hook names
   */
  async getExtensionHooks(extensionId: string): Promise<LifecycleHookName[]> {
    return await invoke<LifecycleHookName[]>('get_extension_hooks', { extensionId });
  }

  /**
   * Get cached loaded extensions (for UI display)
   *
   * @returns Array of LoadedExtension objects
   */
  getLoadedExtensions(): LoadedExtension[] {
    return Array.from(this.loadedExtensions.values());
  }

  /**
   * Get a specific loaded extension by ID
   *
   * @param extensionId - ID of the extension
   * @returns LoadedExtension or undefined if not found
   */
  getExtension(extensionId: string): LoadedExtension | undefined {
    return this.loadedExtensions.get(extensionId);
  }

  /**
   * Check if an extension is loaded
   *
   * @param extensionId - ID of the extension
   * @returns true if the extension is loaded
   */
  isLoaded(extensionId: string): boolean {
    return this.loadedExtensions.has(extensionId);
  }

  /**
   * Refresh the cache of loaded extensions from the backend
   */
  async refreshLoadedExtensions(): Promise<void> {
    const extensionIds = await this.listExtensions();
    const tools = await this.getExtensionTools();

    // Build tool count map
    const toolCountMap = new Map<string, number>();
    for (const tool of tools) {
      // Tool names are in format "extension_id:tool_name"
      const [extId] = tool.name.split(':');
      toolCountMap.set(extId, (toolCountMap.get(extId) || 0) + 1);
    }

    // Update cache for each extension
    for (const id of extensionIds) {
      const toolCount = toolCountMap.get(id) || 0;
      const existing = this.loadedExtensions.get(id);
      if (existing) {
        this.loadedExtensions.set(id, { ...existing, toolCount });
        continue;
      }

      const hooks = await this.getExtensionHooks(id);
      this.loadedExtensions.set(id, {
        id,
        name: id, // We don't have the full name without re-reading manifest
        version: 'unknown',
        toolCount,
        hooks,
        loadedAt: new Date(),
      });
    }

    // Remove extensions that are no longer loaded
    for (const id of this.loadedExtensions.keys()) {
      if (!extensionIds.includes(id)) {
        this.loadedExtensions.delete(id);
      }
    }
  }

  /**
   * Clear the extension cache (for cleanup)
   */
  clearCache(): void {
    this.loadedExtensions.clear();
  }

  /**
   * Auto-load all extensions from the app's extensions directory
   *
   * Scans the extensions directory (appDataDir/extensions) for subdirectories
   * containing manifest.json files and loads each valid extension.
   *
   * @returns Array of successfully loaded extension IDs
   */
  async autoLoadExtensions(): Promise<string[]> {
    console.log('[NativeExtensionService] Auto-loading extensions from app data directory');

    const loadedIds: string[] = [];

    try {
      // Get the extensions directory path
      const appData = await appDataDir();
      const extensionsDir = await join(appData, 'extensions');

      // Check if extensions directory exists
      const dirExists = await exists(extensionsDir);
      if (!dirExists) {
        console.log('[NativeExtensionService] Extensions directory does not exist, skipping auto-load');
        return [];
      }

      // Read all entries in the extensions directory
      const entries = await readDir(extensionsDir);

      for (const entry of entries) {
        // Only process directories
        if (!entry.isDirectory) {
          continue;
        }

        const extPath = await join(extensionsDir, entry.name);
        const manifestPath = await join(extPath, 'manifest.json');

        // Check if this directory has a manifest.json
        const hasManifest = await exists(manifestPath);
        if (!hasManifest) {
          console.log(`[NativeExtensionService] Skipping ${entry.name} - no manifest.json found`);
          continue;
        }

        // Try to load the extension
        try {
          const info = await this.loadExtension(extPath);
          loadedIds.push(info.id);
          console.log(`[NativeExtensionService] Auto-loaded: ${info.name}`);
        } catch (error) {
          console.error(`[NativeExtensionService] Failed to load extension ${entry.name}:`, error);
        }
      }

      console.log(`[NativeExtensionService] Auto-loaded ${loadedIds.length} extension(s)`);
    } catch (error) {
      console.error('[NativeExtensionService] Auto-load scan failed:', error);
    }

    return loadedIds;
  }

  /**
   * Install bundled Lua extensions shipped with the app.
   *
   * This copies bundled extension folders (from app resources) into the app data
   * extensions directory so they can be auto-loaded on startup.
   *
   * @returns Array of extension IDs that were installed or updated
   */
  async installBundledLuaExtensions(): Promise<string[]> {
    return await invoke<string[]>('install_bundled_lua_extensions');
  }

  /**
   * Get the extensions directory path
   *
   * @returns Path to the extensions directory
   */
  async getExtensionsDirectory(): Promise<string> {
    const appData = await appDataDir();
    return await join(appData, 'extensions');
  }
}

// Export a singleton instance
export const NativeExtensionService = new NativeExtensionServiceClass();
