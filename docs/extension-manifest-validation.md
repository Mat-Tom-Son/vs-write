# Extension Manifest Validation

VS Write uses comprehensive Zod schemas to validate extension manifests. This ensures extensions follow the correct structure and helps catch errors early.

## What is Validated

The manifest validation checks:

1. **Extension ID**: Must be lowercase alphanumeric with hyphens only (regex: `/^[a-z0-9-]+$/`)
   - Valid: `my-extension`, `word-count`, `ai-helper`
   - Invalid: `MyExtension`, `my_extension`, `my extension`

2. **Name**: Non-empty string, maximum 100 characters

3. **Version**: Semantic versioning format `x.y.z` where x, y, z are integers
   - Valid: `1.0.0`, `0.1.0`, `10.20.30`
   - Invalid: `1.0`, `1`, `v1.0.0`, `1.0.0-beta`

4. **Permissions**: Proper structure with valid values
   - `filesystem`: Must be one of `none`, `project`, `workspace`, or `system`
   - `tools`: Array of strings
   - `network`: Boolean
   - `settings`: Boolean
   - `entityApi`: Object with optional `read`, `write`, `tags` boolean fields

5. **Tools**: Array of tool definitions with:
   - `name`: Lowercase snake_case (regex: `/^[a-z_][a-z0-9_]*$/`)
   - `description`: Non-empty, max 500 characters
   - `category`: One of `file`, `search`, `execution`, `navigation`, `custom`
   - `icon`: Non-empty string (Lucide icon name)
   - `pythonModule`: Non-empty string
   - `pythonFunction`: Non-empty string
   - `schema`: Valid JSON Schema object
   - No duplicate tool names across all tools

6. **No Unknown Properties**: The manifest uses strict mode and rejects any fields not defined in the schema

## Usage

### Basic Validation

```typescript
import { validateExtensionManifest } from '../lib/extension-schemas';

try {
  const manifest = validateExtensionManifest(rawManifest);
  console.log('Manifest is valid:', manifest);
} catch (error) {
  if (error instanceof ZodError) {
    console.error('Validation errors:', error.errors);
  }
}
```

### Safe Validation (No Throw)

```typescript
import { safeValidateExtensionManifest } from '../lib/extension-schemas';

const result = safeValidateExtensionManifest(rawManifest);
if (result.success) {
  console.log('Valid manifest:', result.data);
} else {
  console.error('Validation errors:', result.error.errors);
}
```

## Validation Error Messages

The validation system provides detailed, user-friendly error messages:

```
Extension manifest validation failed:
  - id: Extension ID must be lowercase alphanumeric with hyphens only (e.g., my-extension)
  - version: Extension version must be in semver format (e.g., 1.0.0)
  - tools.0.name: Tool name must be lowercase snake_case
  - tools: Tool names must be unique across all tools

Please check your manifest.json file for the issues listed above.
```

## Example Valid Manifest

```json
{
  "id": "word-count",
  "name": "Word Count",
  "version": "1.0.0",
  "description": "Count words in your sections",
  "author": "John Doe",
  "permissions": {
    "tools": ["read_file", "glob"],
    "filesystem": "project",
    "entityApi": {
      "read": true
    }
  },
  "tools": [
    {
      "name": "count_words",
      "description": "Count words in markdown files",
      "category": "custom",
      "icon": "calculator",
      "pythonModule": "./tools.py",
      "pythonFunction": "count_words",
      "schema": {
        "type": "object",
        "properties": {
          "pattern": {
            "type": "string",
            "description": "Glob pattern for files to count",
            "default": "*.md"
          }
        },
        "required": ["pattern"]
      }
    }
  ]
}
```

## Common Validation Errors

### Invalid ID Format

```json
{
  "id": "MyExtension",  // ❌ Uppercase not allowed
  "id": "my_extension", // ❌ Underscores not allowed
  "id": "my extension", // ❌ Spaces not allowed
  "id": "my-extension"  // ✅ Correct
}
```

### Invalid Version Format

```json
{
  "version": "1.0",      // ❌ Must have three parts
  "version": "v1.0.0",   // ❌ No 'v' prefix
  "version": "1.0.0-beta", // ❌ No prerelease tags
  "version": "1.0.0"     // ✅ Correct
}
```

### Invalid Tool Name

```json
{
  "tools": [
    {
      "name": "countWords",  // ❌ camelCase not allowed
      "name": "count-words", // ❌ Hyphens not allowed
      "name": "count_words"  // ✅ Correct (snake_case)
    }
  ]
}
```

### Duplicate Tool Names

```json
{
  "tools": [
    { "name": "my_tool", ... },
    { "name": "my_tool", ... }  // ❌ Duplicate name
  ]
}
```

### Missing Permissions

```json
{
  "id": "my-extension",
  "name": "My Extension",
  "version": "1.0.0"
  // ❌ Missing required 'permissions' field
}
```

## Security Warnings

The validation system also provides warnings for suspicious permission combinations:

1. **Network without capabilities**: Extension requests network but no other permissions
2. **System filesystem access**: High-privilege permission that should only be granted to trusted extensions
3. **Settings + Network**: Could allow data exfiltration
4. **Entity write + Network**: Could transmit project data

These warnings are logged but don't prevent installation.

## Schema Files

- **src/lib/extension-schemas.ts**: Main schema definitions
- **src/lib/extension-api.ts**: TypeScript interfaces
- **src/services/ExtensionService.ts**: Service that uses the schemas

## Testing

Run the test suite to verify schema validation:

```bash
npm test -- src/lib/extension-schemas.test.ts
```

The test suite covers:
- Valid manifests with all optional fields
- Invalid IDs (uppercase, spaces, underscores)
- Invalid versions (wrong format)
- Invalid tool names (camelCase, hyphens)
- Duplicate tool names
- Missing required fields
- Unknown properties
- Invalid URL formats
- Permission validation
- Signature field validation
