# Settings Demo Extension

This extension demonstrates all the settings types supported by VS Write's extension settings system.

## Features

This extension showcases:

- **String input** - For API keys and text values
- **String enum** - Dropdown selection for predefined options
- **Boolean** - Checkbox for true/false settings
- **Integer** - Number input for whole numbers with min/max
- **Number** - Float input for decimal values with min/max
- **Array** - Comma-separated list input

## Settings

### apiKey (string)
API key for external service integration.

### theme (string enum)
Preferred theme selection:
- `auto` - Follow system theme (default)
- `light` - Light theme
- `dark` - Dark theme
- `high-contrast` - High contrast theme

### enableNotifications (boolean)
Show notifications when tasks complete. Default: `true`

### maxRetries (integer)
Maximum number of retry attempts (0-10). Default: `3`

### timeout (number)
Timeout in seconds (1.0-300.0). Default: `30.0`

### ignoredFiles (array)
Files to ignore, specified as comma-separated glob patterns.
Default: `node_modules, .git, dist`

### debugMode (boolean)
Enable debug logging. Default: `false`

### logLevel (string enum)
Logging level:
- `debug` - Verbose debug information
- `info` - General information (default)
- `warn` - Warnings only
- `error` - Errors only
- `none` - No logging

## Testing the Settings UI

1. Install this extension
2. Click the Settings button (gear icon) next to the extension in the Extensions panel
3. The Settings Dialog will open with all the settings types
4. Try modifying values and clicking Save
5. Click Reset to Defaults to restore default values
6. Check the browser console to see the settings being logged on activation

## Implementation Details

Settings are persisted to `localStorage` with keys in the format:
```
extension_settings-demo_<setting-name>
```

The ExtensionContext provides a settings API that extensions can use:
```typescript
ctx.settings.get('apiKey', 'default-value')
ctx.settings.set('apiKey', 'new-value')
ctx.settings.delete('apiKey')
```

Settings schemas are defined using JSON Schema in the extension manifest:
```typescript
settings: {
  schema: {
    type: 'object',
    properties: {
      myStringSetting: {
        type: 'string',
        description: 'Description shown in UI',
        default: 'default value',
      },
      // ... more properties
    },
  },
}
```
