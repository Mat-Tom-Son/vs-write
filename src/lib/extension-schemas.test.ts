/**
 * Tests for extension manifest Zod schemas
 */

import { describe, it, expect } from 'vitest';
import {
  validateExtensionManifest,
  safeValidateExtensionManifest,
  ExtensionManifestSchema,
  LuaToolDefinitionSchema,
  LifecycleConfigSchema,
} from './extension-schemas';

describe('ExtensionManifestSchema', () => {
  it('should validate a minimal valid manifest', () => {
    const manifest = {
      id: 'my-extension',
      name: 'My Extension',
      version: '1.0.0',
    };

    const result = validateExtensionManifest(manifest);
    expect(result.id).toBe('my-extension');
    expect(result.name).toBe('My Extension');
    expect(result.version).toBe('1.0.0');
    expect(result.tools).toEqual([]);
  });

  it('should validate a manifest with optional fields', () => {
    const manifest = {
      id: 'word-count',
      name: 'Word Count',
      version: '1.2.3',
      description: 'Count words in your project',
      permissions: ['read_file', 'glob'],
      tools: [
        {
          name: 'count_words',
          description: 'Count words in sections',
          pythonModule: './tools.py',
          pythonFunction: 'count_words',
          schema: {
            type: 'object',
            properties: {
              pattern: {
                type: 'string',
                description: 'Glob pattern for files',
                default: '*.md',
              },
            },
            required: ['pattern'],
          },
        },
      ],
    };

    const result = validateExtensionManifest(manifest);
    expect(result.id).toBe('word-count');
    expect(result.tools).toHaveLength(1);
    expect(result.tools![0].name).toBe('count_words');
  });

  it('should reject manifest with invalid id (uppercase)', () => {
    const manifest = {
      id: 'MyExtension',
      name: 'My Extension',
      version: '1.0.0',
    };

    const result = safeValidateExtensionManifest(manifest);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.errors[0].path).toContain('id');
      expect(result.error.errors[0].message).toContain('lowercase');
    }
  });

  it('should reject manifest with invalid id (spaces)', () => {
    const manifest = {
      id: 'my extension',
      name: 'My Extension',
      version: '1.0.0',
    };

    const result = safeValidateExtensionManifest(manifest);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.errors[0].path).toContain('id');
      expect(result.error.errors[0].message).toContain('lowercase');
    }
  });

  it('should reject manifest with invalid id (underscores)', () => {
    const manifest = {
      id: 'my_extension',
      name: 'My Extension',
      version: '1.0.0',
    };

    const result = safeValidateExtensionManifest(manifest);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.errors[0].path).toContain('id');
    }
  });

  it('should accept manifest with valid id (hyphens)', () => {
    const manifest = {
      id: 'my-extension-name',
      name: 'My Extension',
      version: '1.0.0',
    };

    const result = safeValidateExtensionManifest(manifest);
    expect(result.success).toBe(true);
  });

  it('should reject manifest with empty name', () => {
    const manifest = {
      id: 'my-extension',
      name: '',
      version: '1.0.0',
    };

    const result = safeValidateExtensionManifest(manifest);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.errors[0].path).toContain('name');
    }
  });

  it('should reject manifest with name too long', () => {
    const manifest = {
      id: 'my-extension',
      name: 'A'.repeat(101),
      version: '1.0.0',
    };

    const result = safeValidateExtensionManifest(manifest);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.errors[0].path).toContain('name');
      expect(result.error.errors[0].message).toContain('100');
    }
  });

  it('should reject manifest with invalid semver', () => {
    const manifest = {
      id: 'my-extension',
      name: 'My Extension',
      version: '1.0',
    };

    const result = safeValidateExtensionManifest(manifest);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.errors[0].path).toContain('version');
      expect(result.error.errors[0].message).toContain('semver');
    }
  });

  it('should accept valid semver versions', () => {
    const versions = ['0.0.1', '1.0.0', '10.20.30', '999.999.999'];

    versions.forEach((version) => {
      const manifest = {
        id: 'my-extension',
        name: 'My Extension',
        version,
      };

      const result = safeValidateExtensionManifest(manifest);
      expect(result.success).toBe(true);
    });
  });

  it('should reject manifest with invalid tool name (camelCase)', () => {
    const manifest = {
      id: 'my-extension',
      name: 'My Extension',
      version: '1.0.0',
      tools: [
        {
          name: 'myTool',
          description: 'Tool with camelCase name',
          pythonModule: './tools.py',
          pythonFunction: 'my_tool',
          schema: {
            type: 'object',
            properties: {},
          },
        },
      ],
    };

    const result = safeValidateExtensionManifest(manifest);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.errors[0].path).toEqual(['tools', 0, 'name']);
      expect(result.error.errors[0].message).toContain('snake_case');
    }
  });

  it('should accept tool with valid snake_case name', () => {
    const manifest = {
      id: 'my-extension',
      name: 'My Extension',
      version: '1.0.0',
      tools: [
        {
          name: 'my_tool_name',
          description: 'Tool with snake_case name',
          pythonModule: './tools.py',
          pythonFunction: 'my_tool_name',
          schema: {
            type: 'object',
            properties: {},
          },
        },
      ],
    };

    const result = safeValidateExtensionManifest(manifest);
    expect(result.success).toBe(true);
  });
});

describe('LuaToolDefinitionSchema', () => {
  it('should validate a complete tool definition', () => {
    const tool = {
      name: 'my_tool',
      description: 'A useful tool',
      luaScript: './tools.lua',
      luaFunction: 'my_tool',
      schema: {
        type: 'object' as const,
        properties: {
          input: {
            type: 'string' as const,
            description: 'Input value',
          },
        },
        required: ['input'],
      },
    };

    const result = LuaToolDefinitionSchema.safeParse(tool);
    expect(result.success).toBe(true);
  });

  it('should reject tool with missing required fields', () => {
    const tool = {
      name: 'my_tool',
      // Missing description
    };

    const result = LuaToolDefinitionSchema.safeParse(tool);
    expect(result.success).toBe(false);
  });
});

describe('LifecycleConfigSchema', () => {
  it('defaults missing hooks to false', () => {
    const parsed = LifecycleConfigSchema.parse({ onProjectOpen: true });
    expect(parsed.onProjectOpen).toBe(true);
    expect(parsed.onProjectClose).toBe(false);
    expect(parsed.onSectionSave).toBe(false);
  });
});

describe('validateExtensionManifest', () => {
  it('parses defaults and returns a typed manifest', () => {
    const manifest = validateExtensionManifest({
      id: 'my-extension',
      name: 'My Extension',
      version: '1.0.0',
    });

    expect(ExtensionManifestSchema.safeParse(manifest).success).toBe(true);
    expect(manifest.tools).toEqual([]);
  });
});
