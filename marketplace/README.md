# VS Write Extension Marketplace

This folder contains bundled **Lua extension folders** that ship with the app.

## Structure

```
marketplace/
└── extensions/
    ├── marketplace.json       # Extension catalog metadata
    ├── hello-extension-lua/   # Lua extension folder (manifest.json + .lua)
    └── ...more-extensions/
```

## Installing Extensions

### Via UI (Load from Folder)
1. Open VS Write
2. Click the Extensions icon (Puzzle) in the activity bar
3. Click "Load"
4. Select an extension **folder** (must contain `manifest.json`)

## Adding New Extensions

To add a new bundled Lua extension:

1. **Create a folder** under `marketplace/extensions/<my-extension-id>/` containing:
   - `manifest.json`
   - one or more `.lua` scripts (and optional `hooks.lua`)

2. **Update marketplace.json** with your extension metadata:
   ```json
   {
     "id": "my-extension",
     "name": "My Extension",
     "version": "1.0.0",
     "description": "What it does",
     "path": "my-extension",
     "featured": false
   }
   ```

## Extension Format

An extension folder must contain:
- `manifest.json` - Extension metadata and configuration
- Lua scripts referenced by `tools[].luaScript`
- Optional `hooks.lua` for lifecycle hooks

## Bundled Extensions

The local marketplace also includes:
- `entity-glossary-lua` - Build glossaries from entities.
- `tag-manager-lua` - Manage entity tags.
- `section-outline-lua` - Generate section outlines.
- `entity-stats-lua` - Entity stats + analytics.
- `hello-extension-lua` - Example extension + hooks.

## Global Installation

When a Lua extension is installed, it is copied to the app data extensions directory (and persists across restarts):
- **macOS**: `~/Library/Application Support/com.vswrite.vswrite/extensions/<extension-id>/`
- **Windows**: `%APPDATA%\\com.vswrite.vswrite\\extensions\\<extension-id>\\`
- **Linux**: `~/.local/share/com.vswrite.vswrite/extensions/<extension-id>/`

## Creating Extensions

See `examples/*-lua/` for reference implementations and `docs/extension-development.md` for a development guide.
