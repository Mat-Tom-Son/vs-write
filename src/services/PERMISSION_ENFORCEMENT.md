# Extension Permission Enforcement

This document describes the permission enforcement system implemented in the ExtensionService.

## Overview

The extension system enforces permissions for sensitive operations to prevent unauthorized access to user data and system resources. Permissions are declared in the extension's `manifest.json` and are checked at runtime before allowing access to protected APIs.

## Enforced Permissions

### 1. Settings Permission (`permissions.settings`)

**What it controls:** Access to the ExtensionSettings API (localStorage-backed storage)

**Required for:**
- `context.settings.get()` - Reading stored settings
- `context.settings.set()` - Writing/updating settings
- `context.settings.delete()` - Deleting settings

**Example:**
```json
{
  "permissions": {
    "settings": true
  }
}
```

**Error message if not granted:**
```
Extension {id} does not have settings permission.
Add 'settings: true' to permissions in manifest.
```

### 2. Tools Permission (`permissions.tools`)

**What it controls:** Access to built-in agent tools

**Required for each tool:**
- `context.tools.readFile()` - Requires `"read_file"` in tools array
- `context.tools.writeFile()` - Requires `"write_file"` in tools array
- `context.tools.appendFile()` - Requires `"append_file"` in tools array
- `context.tools.listDir()` - Requires `"list_dir"` in tools array
- `context.tools.glob()` - Requires `"glob"` in tools array
- `context.tools.grep()` - Requires `"grep"` in tools array

**Example:**
```json
{
  "permissions": {
    "tools": ["read_file", "glob", "grep"]
  }
}
```

**Error message if not granted:**
```
Extension {id} does not have permission to use {tool_name}.
Add '{tool_name}' to permissions.tools in manifest.
```

### 3. Filesystem Permission (`permissions.filesystem`)

**What it controls:** Scope of file access when using tools

**Levels:**
- `"none"` - No filesystem access (default)
- `"project"` - Read/write within project folder only
- `"workspace"` - Access to entire workspace
- `"system"` - Full filesystem access (high-privilege, triggers warnings)

**Validation:**
- Path traversal attempts (e.g., `../`) are blocked unless `filesystem: "system"`
- Absolute paths are blocked unless `filesystem: "system"`

**Example:**
```json
{
  "permissions": {
    "filesystem": "project",
    "tools": ["read_file", "write_file"]
  }
}
```

**Error message if not granted:**
```
Extension {id} does not have filesystem permission.
Add 'filesystem: "project"' to permissions in manifest.
```

### 4. Entity API Permission (`permissions.entityApi`)

**What it controls:** Access to entity/section/tag operations

**Granular permissions:**
- `read` - Read entities, sections, tags
- `write` - Create, update, delete entities
- `tags` - Add and remove tags

**Example:**
```json
{
  "permissions": {
    "entityApi": {
      "read": true,
      "write": true,
      "tags": true
    }
  }
}
```

**Error message if not granted:**
```
Extension {id} lacks entityApi.{scope} permission.
Add 'entityApi: { {scope}: true }' to permissions in manifest.
```

## Network Permission (Declarative Only)

### Current State: Not Enforced

**Permission:** `permissions.network`

**Important limitation:**
- This permission is **declarative only** and is **not enforced** at runtime
- Extensions can access `window.fetch` and `WebSocket` directly from JavaScript
- The permission serves as documentation of network usage intent
- Users are warned during installation if network permission is requested

**Why not enforced:**
JavaScript running in the browser/webview context cannot be fully sandboxed from network access without implementing Content Security Policy (CSP) headers, which is a future enhancement.

**Warning message:**
```
Extension {id} has network permission declared.
NOTE: Currently, extensions can access window.fetch and WebSocket directly from JavaScript,
so this permission is declarative only (not enforced). Future versions may add network sandboxing.
```

**Example:**
```json
{
  "permissions": {
    "network": true
  }
}
```

## Security Warnings

The system warns users about potentially dangerous permission combinations:

### 1. Network-Only Permission
```
Extension requests network permission without any other capabilities.
This is unusual and may indicate unnecessary permission requests.
```

### 2. System Filesystem Access
```
Extension requests system-level filesystem access.
This is a high-privilege permission that should only be granted to trusted extensions.
```

### 3. Settings + Network
```
Extension requests both settings and network permissions.
This combination allows the extension to read stored settings and transmit them over the network.
Only install this extension if you trust the publisher.
```

### 4. Entity Write + Network
```
Extension requests both entity write and network permissions.
This combination allows the extension to modify project data and transmit it over the network.
Ensure you trust this extension before installing.
```

## Implementation Details

### Settings Enforcement

Location: `ExtensionService.createExtensionSettings()`

```typescript
private createExtensionSettings(
  extensionId: string,
  permissions: ExtensionManifest['permissions']
) {
  const checkSettingsPermission = () => {
    if (!permissions.settings) {
      throw new Error(
        `Extension ${extensionId} does not have settings permission. ` +
        `Add 'settings: true' to permissions in manifest.`
      );
    }
  };

  return {
    get<T>(settingKey: string, defaultValue?: T): T {
      checkSettingsPermission();
      // ... implementation
    },
    set<T>(settingKey: string, value: T): void {
      checkSettingsPermission();
      // ... implementation
    },
    delete(settingKey: string): void {
      checkSettingsPermission();
      // ... implementation
    },
  };
}
```

### Tools Enforcement

Location: `ExtensionService.createToolsProxy()`

```typescript
private createToolsProxy(
  permissions: ExtensionManifest['permissions'],
  extensionId: string
): ExtensionTools {
  const checkToolPermission = (toolName: string) => {
    if (!permissions.tools?.includes(toolName)) {
      throw new Error(
        `Extension ${extensionId} does not have permission to use ${toolName}. ` +
        `Add '${toolName}' to permissions.tools in manifest.`
      );
    }
  };

  return {
    readFile: async (path: string, offset = 1, limit = 4000) => {
      checkToolPermission('read_file');
      checkFilesystemPermission('read');
      validatePath(path);
      // ... implementation
    },
    // ... other tools
  };
}
```

### Entity API Enforcement

Location: `ExtensionService.createEntityApiProxy()`

```typescript
private createEntityApiProxy(
  permissions: ExtensionManifest['permissions'],
  extensionId: string
): EntityAPI {
  const requirePermission = (scope: 'read' | 'write' | 'tags') => {
    const allowed = permissions.entityApi?.[scope];
    if (!allowed) {
      throw new Error(
        `Extension ${extensionId} lacks entityApi.${scope} permission. ` +
        `Add 'entityApi: { ${scope}: true }' to permissions in manifest.`
      );
    }
  };

  return {
    getById: (id) => {
      requirePermission('read');
      return getService().getById(id);
    },
    create: (entity) => {
      requirePermission('write');
      return getService().create(entity);
    },
    addTag: (sectionId, entityId, from, to) => {
      requirePermission('tags');
      return getService().addTag(sectionId, entityId, from, to);
    },
    // ... other methods
  };
}
```

## Testing

Comprehensive tests are in `src/services/ExtensionService.test.ts`:

- Settings permission enforcement tests
- Network permission warning tests
- Unusual permission combination detection tests
- Permission validation tests

Run tests:
```bash
npm run test -- ExtensionService.test.ts
```

## Future Improvements

1. **Network Sandboxing**
   - Implement Content Security Policy (CSP) headers
   - Proxy network requests through a controlled backend endpoint
   - Add per-domain allow/blocklists

2. **Fine-grained Tool Permissions**
   - Separate read vs. write permissions for file tools
   - Path-based restrictions (e.g., only allow access to specific folders)

3. **Runtime Permission Requests**
   - Allow extensions to request permissions on-demand
   - Show user consent dialogs for elevated permissions
   - Track permission usage and revocation

4. **Permission Auditing**
   - Log all permission-gated operations
   - Generate audit reports for security review
   - Alert on suspicious permission usage patterns

## References

- Extension manifest schema: `src/lib/extension-api.ts`
- Extension service implementation: `src/services/ExtensionService.ts`
- Permission validation tests: `src/services/ExtensionService.test.ts`
