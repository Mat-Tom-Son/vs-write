/**
 * Zod schemas for Lua extension manifest validation
 *
 * These schemas match the Rust ExtensionManifest structure in
 * src-tauri/src/agent/lua_extensions.rs
 *
 * @module extension-schemas
 */

import { z } from 'zod';

/**
 * Regex for valid extension IDs
 * Must be lowercase alphanumeric with hyphens only
 */
const EXTENSION_ID_REGEX = /^[a-z0-9-]+$/;

/**
 * Regex for valid semver versions
 * Matches x.y.z format where x, y, z are integers
 */
const SEMVER_REGEX = /^\d+\.\d+\.\d+$/;

/**
 * Regex for valid tool names
 * Must be lowercase snake_case
 */
const TOOL_NAME_REGEX = /^[a-z_][a-z0-9_]*$/;

/**
 * JSON Schema property definition
 * Used in tool parameter schemas
 */
export const JSONSchemaPropertySchema: z.ZodType<unknown> = z.lazy(() =>
  z.object({
    type: z.enum(['string', 'integer', 'number', 'boolean', 'array', 'object']),
    description: z.string().optional(),
    default: z.unknown().optional(),
    enum: z.array(z.unknown()).optional(),
    items: z.lazy(() => JSONSchemaPropertySchema).optional(),
    properties: z.record(z.lazy(() => JSONSchemaPropertySchema)).optional(),
  })
);

/**
 * JSON Schema for tool parameters
 * Matches the Rust JsonSchema structure
 */
export const ParametersSchemaSchema = z.object({
  type: z.literal('object'),
  properties: z.record(JSONSchemaPropertySchema).optional(),
  required: z.array(z.string()).optional(),
});

export type ParametersSchema = z.infer<typeof ParametersSchemaSchema>;

/**
 * Lua tool definition schema
 * Matches the Rust LuaToolDefinition structure
 */
export const LuaToolDefinitionSchema = z.object({
  name: z
    .string()
    .min(1, 'Tool name is required')
    .regex(TOOL_NAME_REGEX, 'Tool name must be lowercase snake_case'),
  description: z
    .string()
    .min(1, 'Tool description is required')
    .max(500, 'Tool description must be 500 characters or less'),
  // Lua implementation (preferred)
  luaScript: z.string().optional(),
  luaFunction: z.string().optional(),
  // Legacy Python support (optional)
  pythonModule: z.string().optional(),
  pythonFunction: z.string().optional(),
  // Parameter schema - supports both 'parameters' and 'schema' field names
  parameters: ParametersSchemaSchema.optional(),
  schema: ParametersSchemaSchema.optional(),
});

export type LuaToolDefinition = z.infer<typeof LuaToolDefinitionSchema>;

/**
 * Lifecycle configuration schema
 * Matches the Rust LifecycleConfig structure
 * All fields are optional booleans that default to false
 */
export const LifecycleConfigSchema = z.object({
  onActivate: z.boolean().optional().default(false),
  onDeactivate: z.boolean().optional().default(false),
  onProjectOpen: z.boolean().optional().default(false),
  onProjectClose: z.boolean().optional().default(false),
  onSectionSave: z.boolean().optional().default(false),
  onEntityChange: z.boolean().optional().default(false),
  // Also support the script path (used by hooks.lua loading)
  hooksScript: z.string().optional(),
});

export type LifecycleConfig = z.infer<typeof LifecycleConfigSchema>;

/**
 * Extension manifest schema
 * Matches the Rust ExtensionManifest structure exactly
 */
export const LuaExtensionManifestSchema = z.object({
  // Required fields
  id: z
    .string()
    .min(1, 'Extension ID is required')
    .max(100, 'Extension ID must be 100 characters or less')
    .regex(EXTENSION_ID_REGEX, 'Extension ID must be lowercase alphanumeric with hyphens only'),
  name: z
    .string()
    .min(1, 'Extension name is required')
    .max(100, 'Extension name must be 100 characters or less'),
  version: z
    .string()
    .min(1, 'Extension version is required')
    .regex(SEMVER_REGEX, 'Extension version must be in semver format (e.g., 1.0.0)'),

  // Optional metadata
  description: z.string().max(500).optional(),
  author: z.string().max(200).optional(),
  permissions: z.array(z.string()).optional(),

  // Tools
  tools: z.array(LuaToolDefinitionSchema).default([]),

  // Lifecycle hooks
  lifecycle: LifecycleConfigSchema.optional(),
});

export type LuaExtensionManifest = z.infer<typeof LuaExtensionManifestSchema>;

/**
 * Validate a Lua extension manifest
 */
export function validateLuaExtensionManifest(manifest: unknown): LuaExtensionManifest {
  return LuaExtensionManifestSchema.parse(manifest);
}

/**
 * Safely validate a Lua extension manifest without throwing
 */
export function safeValidateLuaExtensionManifest(
  manifest: unknown
): z.SafeParseReturnType<unknown, LuaExtensionManifest> {
  return LuaExtensionManifestSchema.safeParse(manifest);
}

// ============================================================================
// Extension Info Types (returned from Tauri commands)
// ============================================================================

/**
 * Extension info returned from load_lua_extension command
 */
export interface ExtensionInfo {
  id: string;
  name: string;
  version: string;
  description?: string;
  tool_count: number;
}

/**
 * Tool info returned from get_extension_tools command
 */
export interface ExtensionToolInfo {
  name: string;
  description: string;
}

/**
 * Hook result returned from execute_extension_hook command
 */
export interface HookResult {
  success: boolean;
  result?: string;
  error?: string;
}

/**
 * Lifecycle hook names (matches Rust LifecycleHook enum)
 */
export type LifecycleHookName =
  | 'on_activate'
  | 'on_deactivate'
  | 'on_project_open'
  | 'on_project_close'
  | 'on_section_save'
  | 'on_entity_change';

/**
 * All available lifecycle hooks
 */
export const LIFECYCLE_HOOKS: LifecycleHookName[] = [
  'on_activate',
  'on_deactivate',
  'on_project_open',
  'on_project_close',
  'on_section_save',
  'on_entity_change',
];

// ============================================================================
// Legacy exports for backward compatibility
// ============================================================================

// Re-export with old names for any existing code
export const ExtensionManifestSchema = LuaExtensionManifestSchema;
export type ExtensionManifest = LuaExtensionManifest;
export const validateExtensionManifest = validateLuaExtensionManifest;
export const safeValidateExtensionManifest = safeValidateLuaExtensionManifest;
