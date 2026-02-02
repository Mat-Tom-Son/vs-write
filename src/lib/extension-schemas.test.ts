/**
 * Tests for extension manifest Zod schemas
 */

import { describe, it, expect } from 'vitest';
import {
  validateExtensionManifest,
  safeValidateExtensionManifest,
  ExtensionManifestSchema,
  ToolDefinitionSchema,
  ExtensionPermissionsSchema,
} from './extension-schemas';

describe('ExtensionManifestSchema', () => {
  it('should validate a minimal valid manifest', () => {
    const manifest = {
      id: 'my-extension',
      name: 'My Extension',
      version: '1.0.0',
      permissions: {},
    };

    const result = validateExtensionManifest(manifest);
    expect(result.id).toBe('my-extension');
    expect(result.name).toBe('My Extension');
    expect(result.version).toBe('1.0.0');
  });

  it('should validate a complete manifest', () => {
    const manifest = {
      id: 'word-count',
      name: 'Word Count',
      displayName: 'Word Counter Pro',
      version: '1.2.3',
      author: 'John Doe',
      publisher: 'acme-corp',
      description: 'Count words in your project',
      categories: ['Utilities'],
      keywords: ['word', 'count', 'statistics'],
      icon: './icon.png',
      homepage: 'https://example.com',
      repository: {
        type: 'git',
        url: 'https://github.com/user/repo',
      },
      bugs: 'https://github.com/user/repo/issues',
      license: 'MIT',
      permissions: {
        tools: ['read_file', 'glob'],
        filesystem: 'project',
        settings: true,
        entityApi: {
          read: true,
        },
      },
      tools: [
        {
          name: 'count_words',
          description: 'Count words in sections',
          category: 'custom',
          icon: 'calculator',
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
      permissions: {},
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
      permissions: {},
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
      permissions: {},
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
      permissions: {},
    };

    const result = safeValidateExtensionManifest(manifest);
    expect(result.success).toBe(true);
  });

  it('should reject manifest with empty name', () => {
    const manifest = {
      id: 'my-extension',
      name: '',
      version: '1.0.0',
      permissions: {},
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
      permissions: {},
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
      permissions: {},
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
        permissions: {},
      };

      const result = safeValidateExtensionManifest(manifest);
      expect(result.success).toBe(true);
    });
  });

  it('should reject manifest missing permissions', () => {
    const manifest = {
      id: 'my-extension',
      name: 'My Extension',
      version: '1.0.0',
    };

    const result = safeValidateExtensionManifest(manifest);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.errors[0].path).toContain('permissions');
    }
  });

  it('should reject manifest with duplicate tool names', () => {
    const manifest = {
      id: 'my-extension',
      name: 'My Extension',
      version: '1.0.0',
      permissions: {},
      tools: [
        {
          name: 'my_tool',
          description: 'First tool',
          category: 'custom',
          icon: 'tool',
          pythonModule: './tools.py',
          pythonFunction: 'tool1',
          schema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'my_tool',
          description: 'Second tool with same name',
          category: 'custom',
          icon: 'tool',
          pythonModule: './tools.py',
          pythonFunction: 'tool2',
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
      expect(result.error.errors[0].message).toContain('unique');
    }
  });

  it('should reject manifest with invalid tool name (camelCase)', () => {
    const manifest = {
      id: 'my-extension',
      name: 'My Extension',
      version: '1.0.0',
      permissions: {},
      tools: [
        {
          name: 'myTool',
          description: 'Tool with camelCase name',
          category: 'custom',
          icon: 'tool',
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
      permissions: {},
      tools: [
        {
          name: 'my_tool_name',
          description: 'Tool with snake_case name',
          category: 'custom',
          icon: 'tool',
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

  it('should reject manifest with invalid URL', () => {
    const manifest = {
      id: 'my-extension',
      name: 'My Extension',
      version: '1.0.0',
      permissions: {},
      homepage: 'not-a-url',
    };

    const result = safeValidateExtensionManifest(manifest);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.errors[0].path).toContain('homepage');
      expect(result.error.errors[0].message).toContain('URL');
    }
  });

  it('should reject manifest with unknown properties', () => {
    const manifest = {
      id: 'my-extension',
      name: 'My Extension',
      version: '1.0.0',
      permissions: {},
      unknownField: 'should not be allowed',
    };

    const result = safeValidateExtensionManifest(manifest);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.errors[0].message).toContain('Unrecognized');
    }
  });

  it('should validate valid filesystem permission values', () => {
    const values = ['none', 'project', 'workspace', 'system'] as const;

    values.forEach((filesystem) => {
      const manifest = {
        id: 'my-extension',
        name: 'My Extension',
        version: '1.0.0',
        permissions: { filesystem },
      };

      const result = safeValidateExtensionManifest(manifest);
      expect(result.success).toBe(true);
    });
  });

  it('should reject invalid filesystem permission value', () => {
    const manifest = {
      id: 'my-extension',
      name: 'My Extension',
      version: '1.0.0',
      permissions: {
        filesystem: 'invalid',
      },
    };

    const result = safeValidateExtensionManifest(manifest);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.errors[0].path).toEqual(['permissions', 'filesystem']);
    }
  });

  it('should validate complete signature fields', () => {
    const manifest = {
      id: 'my-extension',
      name: 'My Extension',
      version: '1.0.0',
      permissions: {},
      signature: 'base64signature',
      signatureAlgorithm: 'ed25519' as const,
      publicKeyId: 'key-123',
    };

    const result = safeValidateExtensionManifest(manifest);
    expect(result.success).toBe(true);
  });

  it('should reject partial signature fields', () => {
    const manifest = {
      id: 'my-extension',
      name: 'My Extension',
      version: '1.0.0',
      permissions: {},
      signature: 'base64signature',
      // Missing signatureAlgorithm and publicKeyId
    };

    const result = safeValidateExtensionManifest(manifest);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.errors[0].message).toContain('signature');
    }
  });
});

describe('ToolDefinitionSchema', () => {
  it('should validate a complete tool definition', () => {
    const tool = {
      name: 'my_tool',
      description: 'A useful tool',
      category: 'custom' as const,
      icon: 'tool',
      pythonModule: './tools.py',
      pythonFunction: 'my_tool_func',
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
      examples: ['Example usage'],
      documentation: 'Full documentation',
      tips: ['Tip 1', 'Tip 2'],
    };

    const result = ToolDefinitionSchema.safeParse(tool);
    expect(result.success).toBe(true);
  });

  it('should reject tool with missing required fields', () => {
    const tool = {
      name: 'my_tool',
      description: 'A useful tool',
      // Missing category, icon, pythonModule, pythonFunction, schema
    };

    const result = ToolDefinitionSchema.safeParse(tool);
    expect(result.success).toBe(false);
  });
});

describe('ExtensionPermissionsSchema', () => {
  it('should validate empty permissions', () => {
    const permissions = {};

    const result = ExtensionPermissionsSchema.safeParse(permissions);
    expect(result.success).toBe(true);
  });

  it('should validate permissions with all fields', () => {
    const permissions = {
      tools: ['read_file', 'write_file'],
      filesystem: 'project' as const,
      network: true,
      settings: true,
      entityApi: {
        read: true,
        write: true,
        tags: true,
      },
    };

    const result = ExtensionPermissionsSchema.safeParse(permissions);
    expect(result.success).toBe(true);
  });

  it('should validate partial entityApi permissions', () => {
    const permissions = {
      entityApi: {
        read: true,
      },
    };

    const result = ExtensionPermissionsSchema.safeParse(permissions);
    expect(result.success).toBe(true);
  });
});
