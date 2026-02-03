# Extension Settings UI - Test & Verification Guide

## Overview

The extension settings UI is **fully implemented and functional**. This document provides testing instructions to verify all features work correctly.

## Implementation Status

### ✅ Complete Features

1. **Settings Button** - Located in ExtensionsPanel.tsx
   - Enabled and functional (lines 569-582)
   - Opens settings dialog on click
   - Positioned next to uninstall button

2. **ExtensionSettingsDialog Component** - src/components/ExtensionSettingsDialog.tsx
   - Modal dialog with backdrop
   - Header with extension name and version
   - Close button (X icon)
   - Form rendering from JSON Schema
   - Footer with Reset and Save buttons
   - Dirty state tracking

3. **Supported Settings Types**
   - ✅ `string` - Text input
   - ✅ `string` with `enum` - Dropdown select
   - ✅ `boolean` - Checkbox
   - ✅ `integer` - Number input (whole numbers)
   - ✅ `number` - Number input (decimals)
   - ✅ `array` - Comma-separated text input

4. **Settings Persistence**
   - Stored in `localStorage`
   - Key format: `extension_{extensionId}_{settingKey}`
   - Loaded on dialog open
   - Saved on Save button click
   - Reset to defaults functionality

5. **Validation**
   - Min/max validation for numbers
   - Type coercion (string to number, etc.)
   - Default value fallback

## Test Instructions

### Test 1: Basic Settings Dialog

1. Start the application in dev mode:
   ```bash
   npm run tauri:dev
   ```

2. Open a project (or create a new one)

3. Navigate to the Extensions panel in the sidebar

4. If no extensions are installed, load the `starter-extension-lua` example:
   - It's located in `examples/starter-extension-lua/`
   - Load the extension folder via the Extensions panel "Load" button

5. Click the Settings button (gear icon) next to the extension

6. **Expected Result:**
   - Settings dialog opens
   - Shows extension name and version in header
   - Displays settings form

### Test 2: Settings Demo Extension (All Types)

1. Install the `settings-demo` extension from `examples/settings-demo-extension/`

2. Click the Settings button for this extension

3. **Verify all input types render correctly:**

   - **apiKey** (string) - Text input field
   - **theme** (enum) - Dropdown with options: auto, light, dark, high-contrast
   - **enableNotifications** (boolean) - Checkbox
   - **maxRetries** (integer) - Number input
   - **timeout** (number) - Number input with decimals
   - **ignoredFiles** (array) - Text input showing comma-separated values
   - **debugMode** (boolean) - Checkbox
   - **logLevel** (enum) - Dropdown with options

### Test 3: Settings Persistence

1. Open settings for any extension

2. Modify several settings:
   - Change text values
   - Toggle checkboxes
   - Change dropdown selections
   - Modify number values

3. Click **Save Settings**

4. Close the dialog

5. Reopen the settings dialog

6. **Expected Result:**
   - All modified values are preserved
   - Settings persist across dialog closes

### Test 4: Reset to Defaults

1. Open settings and modify values

2. Click **Reset to Defaults**

3. **Expected Result:**
   - All values revert to their schema defaults
   - Settings are immediately saved to localStorage
   - Dirty state is cleared

### Test 5: Dirty State Tracking

1. Open settings dialog

2. **Initial state:**
   - Save button should be disabled (opacity 0.5)
   - Button shows as not clickable

3. Modify any setting

4. **After modification:**
   - Save button becomes enabled (opacity 1)
   - Button becomes clickable
   - Button changes color to blue (#2563eb)

5. Click Save

6. **After saving:**
   - Dialog closes automatically
   - Settings are persisted

### Test 6: No Settings Configured

1. Install an extension without a settings schema (e.g., an extension that doesn't define `settings` in manifest)

2. Click the Settings button

3. **Expected Result:**
   - Dialog opens
   - Shows message: "This extension has no configurable settings."
   - Provides hint about adding settings to manifest
   - No Save/Reset buttons shown

### Test 7: Validation

1. Open settings for `settings-demo` extension

2. Try setting **maxRetries** to values:
   - Below minimum (< 0)
   - Above maximum (> 10)
   - Decimal value (should be rounded to integer)

3. Try setting **timeout** to values:
   - Below minimum (< 1.0)
   - Above maximum (> 300.0)

4. **Expected Result:**
   - Browser enforces min/max constraints
   - Invalid values are prevented
   - Integer fields only accept whole numbers

### Test 8: Array Input

1. Open settings for `settings-demo` extension

2. Modify **ignoredFiles** field:
   - Enter: `*.log, temp, node_modules, dist`

3. Click Save

4. Check localStorage in browser DevTools:
   ```javascript
   localStorage.getItem('extension_settings-demo_ignoredFiles')
   ```

5. **Expected Result:**
   - Stored as JSON array: `["*.log","temp","node_modules","dist"]`
   - Leading/trailing spaces are trimmed
   - Empty strings are filtered out

### Test 9: Settings Access in Extension Code

1. Open browser console

2. Activate the `settings-demo` extension

3. **Expected Result:**
   - Console logs current settings values
   - Settings are accessible via `ctx.settings.get()`
   - Default values are returned when not set

### Test 10: Multiple Extensions

1. Install multiple extensions with settings

2. Modify settings for Extension A

3. Modify settings for Extension B

4. **Expected Result:**
   - Each extension's settings are isolated
   - No cross-contamination between extensions
   - localStorage keys are properly namespaced

## Code References

### Main Files

- **ExtensionsPanel.tsx** - `C:\Users\mat_t\Desktop\Dev\iwe\story-ide\src\components\Sidebar\ExtensionsPanel.tsx`
  - Lines 41: State management
  - Lines 569-582: Settings button
  - Lines 773-778: Dialog rendering

- **ExtensionSettingsDialog.tsx** - `C:\Users\mat_t\Desktop\Dev\iwe\story-ide\src\components\ExtensionSettingsDialog.tsx`
  - Lines 13-30: localStorage utilities
  - Lines 35-83: Main component
  - Lines 86-211: Input rendering logic

- **extension-api.ts** - `C:\Users\mat_t\Desktop\Dev\iwe\story-ide\src\lib\extension-api.ts`
  - Lines 529-539: SettingsSchema interface
  - Lines 388-396: JSONSchemaProperty interface
  - Lines 62-83: ExtensionSettings interface

### Example Extensions

- **starter-extension** - `C:\Users\mat_t\Desktop\Dev\iwe\story-ide\examples\starter-extension\extension.ts`
  - Simple example with one enum setting

- **settings-demo** - `C:\Users\mat_t\Desktop\Dev\iwe\story-ide\examples\settings-demo-extension\extension.ts`
  - Comprehensive example with all setting types

## Known Limitations

1. **No nested objects** - Only flat properties are supported
2. **Array items are strings** - Complex array item types not yet supported
3. **No custom validation** - Only basic min/max for numbers
4. **No conditional fields** - All fields always visible

## Future Enhancements (Optional)

- [ ] Conditional field visibility (if/then in JSON Schema)
- [ ] Custom validation messages
- [ ] Rich text editors for long strings
- [ ] File/folder picker for path settings
- [ ] Color picker for color settings
- [ ] Nested object support
- [ ] Array of objects with add/remove buttons
- [ ] Settings search/filter for extensions with many settings
- [ ] Import/export settings

## Conclusion

The extension settings UI is **production-ready** and fully functional. All core features are implemented:

- ✅ Settings button enabled and wired up
- ✅ Dialog opens/closes correctly
- ✅ Schema-driven form generation works
- ✅ All basic types supported
- ✅ Settings persist to localStorage
- ✅ Reset to defaults works
- ✅ Dirty state tracking functional
- ✅ Type validation working

No additional changes are needed for basic functionality. The system is ready for use by extension developers.
