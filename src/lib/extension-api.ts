/**
 * VS Write Extension API
 *
 * This module provides the TypeScript API for creating VS Write extensions.
 * Extensions can add custom agent tools, UI components, and lifecycle hooks.
 *
 * @module extension-api
 * @example
 * ```typescript
 * import { defineExtension } from '@vswrite/extension-api';
 *
 * export default defineExtension({
 *   id: 'my-extension',
 *   name: 'My Extension',
 *   version: '1.0.0',
 *   // ... configuration
 * });
 * ```
 */

import type { Project, Section, Entity, Tag } from './schemas';
import type { LLMProvider } from '../services/AgentService';

/**
 * Extension Context - Runtime API provided to extensions
 *
 * The context object gives extensions controlled access to the application's
 * state, services, and capabilities while maintaining security boundaries.
 */
export interface ExtensionContext {
  /** Current project data (read-only) */
  project: Project;

  /** Absolute path to project root directory */
  projectRoot: string;

  /** Settings storage for this extension */
  settings: ExtensionSettings;

  /** Built-in tool access (permission-gated) */
  tools: ExtensionTools;

  /** Project state access (read-only) */
  state: ExtensionState;

  /** Entity and tag read/write API */
  entityApi: EntityAPI;

  /** UI interaction methods */
  ui: ExtensionUI;

  /** LLM provider for AI capabilities */
  llm: LLMProvider;
}

/**
 * Extension settings storage interface
 *
 * Provides persistent storage for extension settings using localStorage.
 * Each extension gets its own isolated namespace.
 */
export interface ExtensionSettings {
  /**
   * Get a setting value
   * @param key - Setting key
   * @param defaultValue - Default value if key doesn't exist
   * @returns The stored value or default
   */
  get<T>(key: string, defaultValue?: T): T;

  /**
   * Set a setting value
   * @param key - Setting key
   * @param value - Value to store (must be JSON-serializable)
   */
  set<T>(key: string, value: T): void;

  /**
   * Delete a setting
   * @param key - Setting key to delete
   */
  delete(key: string): void;
}

/**
 * Built-in tool access interface
 *
 * Provides access to VS Write's built-in agent tools.
 * Tool usage requires corresponding permission in manifest.
 */
export interface ExtensionTools {
  /**
   * Read a file from the project
   * @requires permission: tools includes 'read_file'
   */
  readFile(path: string, offset?: number, limit?: number): Promise<string>;

  /**
   * Write a file to the project
   * @requires permission: tools includes 'write_file'
   */
  writeFile(path: string, content: string, force?: boolean): Promise<string>;

  /**
   * Append content to a file
   * @requires permission: tools includes 'append_file'
   */
  appendFile(path: string, content: string): Promise<string>;

  /**
   * List directory contents
   * @requires permission: tools includes 'list_dir'
   */
  listDir(path?: string): Promise<Array<{ name: string; type: 'file' | 'dir' }>>;

  /**
   * Find files matching a glob pattern
   * @requires permission: tools includes 'glob'
   */
  glob(pattern: string, path?: string): Promise<string[]>;

  /**
   * Search file contents with regex
   * @requires permission: tools includes 'grep'
   */
  grep(pattern: string, path?: string): Promise<string[]>;
}

/**
 * Project state access interface (read-only)
 *
 * Provides read-only access to current project state.
 * For state mutations, use lifecycle hooks.
 */
export interface ExtensionState {
  /** Get the currently active section (in editor) */
  getActiveSection(): Section | null;

  /** Get all sections in display order */
  getSections(): Section[];

  /** Get all entities */
  getEntities(): Entity[];

  /** Get a specific entity by ID */
  getEntity(id: string): Entity | undefined;

  /** Get a specific section by ID */
  getSection(id: string): Section | undefined;
}

/**
 * Entity API interface
 *
 * Provides read/write access to entities, sections, and tags.
 */
export interface EntityAPI {
  getById(id: string): Promise<Entity | null>;
  listByType(type: Entity['type']): Promise<Entity[]>;
  search(query: string): Promise<Entity[]>;
  getRelationships(entityId: string): Promise<{ entity: Entity; sections: Section[] }>;
  create(entity: Entity): Promise<Entity>;
  update(id: string, updates: Partial<Entity>): Promise<Entity>;
  delete(id: string): Promise<void>;
  addTag(sectionId: string, entityId: string, from: number, to: number): Promise<Tag>;
  removeTag(sectionId: string, tagId: string): Promise<void>;
  getEntitiesByIds(ids: string[]): Promise<Entity[]>;
  getTagsBySection(sectionId: string): Promise<Tag[]>;
  onEntityChanged(handler: (event: { type: 'create' | 'update' | 'delete'; entity: Entity }) => void): () => void;
  onSectionChanged(handler: (event: { type: 'tags_updated'; section: Section }) => void): () => void;
  onTagsUpdated(handler: (event: { sectionId: string; tags: Tag[] }) => void): () => void;
}

/**
 * UI interaction interface
 *
 * Provides methods for extensions to interact with the UI.
 */
export interface ExtensionUI {
  /**
   * Show a notification message
   * @param message - Message to display
   * @param type - Notification type (affects styling)
   */
  showNotification(message: string, type?: 'info' | 'warning' | 'error'): void;

  /**
   * Show a confirmation dialog
   * @param title - Dialog title
   * @param message - Dialog message
   * @returns Promise resolving to true if user clicked OK, false otherwise
   */
  showDialog(title: string, message: string): Promise<boolean>;

  /**
   * Open an extension panel in the sidebar
   * @param panelId - ID of panel to open
   */
  openPanel(panelId: string): void;

  /**
   * Close an extension panel
   * @param panelId - ID of panel to close
   */
  closePanel(panelId: string): void;
}

/**
 * Extension Manifest - Main configuration object
 *
 * The manifest defines all aspects of an extension including
 * metadata, permissions, tools, UI components, and lifecycle hooks.
 */
export interface ExtensionManifest {
  /** Unique extension identifier (lowercase, hyphenated) */
  id: string;

  /** Human-readable extension name */
  name: string;

  /** Display name for marketplace (optional, defaults to name) */
  displayName?: string;

  /** Semantic version (e.g., "1.0.0") */
  version: string;

  /** Extension author name or email (optional) */
  author?: string;

  /** Publisher name (for marketplace) */
  publisher?: string;

  /** Short description of extension functionality (optional) */
  description?: string;

  /** Categories for marketplace organization */
  categories?: string[];

  /** Keywords for search and discovery */
  keywords?: string[];

  /** Path to extension icon (128x128 PNG) */
  icon?: string;

  /** Path to larger logo image (256x256 PNG) */
  logo?: string;

  /** Paths to screenshot images for marketplace */
  screenshots?: string[];

  /** Homepage URL */
  homepage?: string;

  /** Repository information */
  repository?: {
    type: 'git' | 'svn';
    url: string;
  };

  /** Bug tracker URL */
  bugs?: string;

  /** License identifier (SPDX) */
  license?: string;

  /** Path to README file */
  readme?: string;

  /** Path to changelog file */
  changelog?: string;

  /** Permissions requested by the extension */
  permissions: ExtensionPermissions;

  /** Custom agent tools provided by the extension (optional) */
  tools?: ToolDefinition[];

  /** UI components provided by the extension (optional) */
  components?: ComponentDefinitions;

  /** Lifecycle hook handlers (optional) */
  lifecycle?: LifecycleHooks;

  /** Extension-specific settings schema (optional) */
  settings?: SettingsSchema;
}

/**
 * Extension permissions configuration
 *
 * Declares what capabilities the extension needs.
 * Users will be prompted to approve high-risk permissions.
 */
export interface ExtensionPermissions {
  /**
   * Which built-in tools the extension can use
   * @example ['read_file', 'write_file', 'glob']
   */
  tools?: string[];

  /**
   * Filesystem access level
   * - 'none': No file access
   * - 'project': Read/write within project folder only
   * - 'workspace': Access to entire workspace
   * - 'system': Full filesystem access (requires user approval)
   */
  filesystem?: 'none' | 'project' | 'workspace' | 'system';

  /**
   * Whether extension can make network requests
   * Setting to true requires user approval for security
   */
  network?: boolean;

  /**
   * Whether extension can store settings
   * Grants access to ExtensionSettings API
   */
  settings?: boolean;

  /**
   * Entity API access levels
   * - read: read entities/sections/tags
   * - write: create/update/delete entities
   * - tags: add/remove tags
   */
  entityApi?: {
    read?: boolean;
    write?: boolean;
    tags?: boolean;
  };
}

/**
 * Tool definition for extension tools
 *
 * Defines a custom tool that the AI agent can call.
 * Tools can be implemented via Lua scripts (preferred) or Python modules (legacy).
 */
export interface ToolDefinition {
  /** Tool name (must be unique, lowercase_snake_case) */
  name: string;

  /** Description shown to AI agent (be clear and specific) */
  description: string;

  /** Tool category for organization */
  category: 'file' | 'search' | 'execution' | 'navigation' | 'custom';

  /** Lucide icon name for UI */
  icon: string;

  /**
   * Path to Python module containing tool implementation (legacy)
   * Relative to extension root (e.g., './tools.py')
   * @deprecated Use luaScript instead for new extensions
   */
  pythonModule: string;

  /**
   * Name of Python function to call (legacy)
   * Function signature: (ctx: ExtensionContext, arguments: dict) -> str
   * @deprecated Use luaScript instead for new extensions
   */
  pythonFunction: string;

  /**
   * JSON Schema for tool parameters
   * Defines what arguments the tool accepts
   */
  schema: {
    type: 'object';
    properties: Record<string, JSONSchemaProperty>;
    required?: string[];
  };

  /** Example usage strings for documentation */
  examples?: string[];

  /** Detailed documentation (optional) */
  documentation?: string;

  /** Usage tips (optional) */
  tips?: string[];
}

/**
 * JSON Schema property definition
 * Used in tool parameter schemas
 */
export interface JSONSchemaProperty {
  type: 'string' | 'integer' | 'number' | 'boolean' | 'array' | 'object';
  description?: string;
  default?: any;
  enum?: any[];
  items?: JSONSchemaProperty;
  properties?: Record<string, JSONSchemaProperty>;
  minimum?: number;
  maximum?: number;
}

/**
 * UI component definitions
 * Registers extension's React components
 */
export interface ComponentDefinitions {
  /** Sidebar/inspector panels */
  panels?: PanelDefinition[];

  /** Custom file type viewers */
  views?: ViewDefinition[];
}

/**
 * Panel definition for sidebar/inspector panels
 */
export interface PanelDefinition {
  /** Unique panel identifier */
  id: string;

  /** Panel title shown in UI */
  title: string;

  /** Lucide icon name */
  icon: string;

  /**
   * Where to display the panel
   * - 'sidebar': Left sidebar with sections/entities
   * - 'inspector': Right sidebar with diagnostics
   * - 'editor': Main editor area (not yet implemented)
   */
  location: 'sidebar' | 'inspector' | 'editor';

  /**
   * Lazy-loaded React component
   * @returns Promise resolving to module with default export
   */
  component: () => Promise<{ default: React.ComponentType<ExtensionPanelProps> }>;
}

/**
 * Props passed to extension panel components
 */
export interface ExtensionPanelProps {
  /** Extension context for API access */
  context: ExtensionContext;
}

/**
 * View definition for custom file type viewers
 */
export interface ViewDefinition {
  /** Unique view identifier */
  id: string;

  /**
   * File pattern to match (glob)
   * @example "*.custom", "*.data.json"
   */
  filePattern: string;

  /**
   * Lazy-loaded React component
   * @returns Promise resolving to module with default export
   */
  component: () => Promise<{ default: React.ComponentType<ExtensionViewProps> }>;
}

/**
 * Props passed to extension view components
 */
export interface ExtensionViewProps {
  /** Extension context for API access */
  context: ExtensionContext;

  /** Path to file being viewed */
  filePath: string;

  /** File content as string */
  content: string;
}

/**
 * Lifecycle hooks for extension events
 *
 * Hooks allow extensions to react to application events.
 * All hooks are optional and can be async.
 */
export interface LifecycleHooks {
  /**
   * Called when extension is first activated
   * Use for initialization, setup, etc.
   */
  onActivate?: (ctx: ExtensionContext) => Promise<void> | void;

  /**
   * Called when extension is deactivated
   * Use for cleanup, save state, etc.
   */
  onDeactivate?: (ctx: ExtensionContext) => Promise<void> | void;

  /**
   * Called when a project is opened
   * @param project - The opened project
   */
  onProjectOpen?: (ctx: ExtensionContext, project: Project) => Promise<void> | void;

  /**
   * Called when a project is closed
   */
  onProjectClose?: (ctx: ExtensionContext) => Promise<void> | void;

  /**
   * Called after a section is saved
   * @param section - The section that was saved
   */
  onSectionSave?: (ctx: ExtensionContext, section: Section) => Promise<void> | void;

  /**
   * Called after a section is deleted
   * @param sectionId - ID of the deleted section
   */
  onSectionDelete?: (ctx: ExtensionContext, sectionId: string) => Promise<void> | void;

  /**
   * Called when an entity is created, updated, or deleted
   * @param entity - The entity that changed
   */
  onEntityChange?: (ctx: ExtensionContext, entity: Entity) => Promise<void> | void;
}

/**
 * Settings schema definition
 * Defines what settings the extension can store
 */
export interface SettingsSchema {
  /** JSON Schema for settings */
  schema: {
    type: 'object';
    properties: Record<string, JSONSchemaProperty>;
  };
}

/**
 * Define an extension manifest with type checking
 *
 * This is a helper function that provides TypeScript type checking
 * while allowing the manifest to be a plain JavaScript object.
 *
 * @param manifest - Extension manifest configuration
 * @returns The same manifest (identity function)
 *
 * @example
 * ```typescript
 * export default defineExtension({
 *   id: 'word-count',
 *   name: 'Word Count',
 *   version: '1.0.0',
 *   permissions: {
 *     tools: ['read_file', 'glob'],
 *     filesystem: 'project',
 *   },
 *   tools: [{
 *     name: 'count_words',
 *     description: 'Count words in sections',
 *     pythonModule: './tools.py',
 *     pythonFunction: 'count_words',
 *     schema: {
 *       type: 'object',
 *       properties: {
 *         pattern: { type: 'string', default: 'sections/*.md' }
 *       }
 *     }
 *   }]
 * });
 * ```
 */
export function defineExtension(manifest: ExtensionManifest): ExtensionManifest {
  return manifest;
}

/**
 * Extension metadata from package.json
 */
export interface ExtensionPackageJson {
  name: string;
  version: string;
  type: 'module';
  main: string;
  vswrite?: {
    minVersion?: string;
    maxVersion?: string;
  };
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

/**
 * Signature verification result
 *
 * Extensions can be signed by publishers to prove authenticity.
 * This interface represents the result of verifying an extension's signature.
 */
export interface SignatureVerification {
  /** Whether the extension has a signature */
  is_signed: boolean;

  /** Whether the signature is cryptographically valid */
  is_valid: boolean;

  /** Publisher/key ID that signed the extension */
  publisher_id: string | null;

  /** Whether the publisher is in the trusted list */
  is_trusted: boolean;

  /** Human-readable status message */
  status: string;

  /** Error message if verification failed */
  error: string | null;
}

/**
 * Signature fields that can be added to a manifest for signing
 */
export interface SignatureFields {
  /** Base64-encoded Ed25519 signature */
  signature: string;

  /** Algorithm used (currently only 'ed25519') */
  signatureAlgorithm: 'ed25519';

  /** ID of the public key/publisher that signed */
  publicKeyId: string;

  /** Optional: Base64-encoded public key for self-signed extensions */
  publicKey?: string;
}
