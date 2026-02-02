# VS Write Extension Marketplace

This folder contains local extensions that can be installed through the VS Write Extensions panel.

## Structure

```
marketplace/
└── extensions/
    ├── marketplace.json       # Extension catalog metadata
    ├── hello-extension.vsext  # Packaged extensions (.vsext files)
    └── ...more-extensions.vsext
```

## Installing Extensions

### Via UI
1. Open VS Write
2. Click the Extensions icon (Puzzle) in the activity bar
3. Switch to the "Marketplace" tab
4. Click "Install" on any available extension

### Via File
1. Click "Install from File" button
2. Select any `.vsext` file
3. Extension will be extracted to global directory and activated

## Adding New Extensions

To add a new extension to the marketplace:

1. **Package your extension** as a `.vsext` file (ZIP archive):
   ```bash
   # Windows PowerShell
   Compress-Archive -Path * -DestinationPath my-extension.zip
   mv my-extension.zip my-extension.vsext

   # macOS/Linux
   zip -r my-extension.vsext *
   ```

2. **Place the .vsext file** in `marketplace/extensions/`

3. **Update marketplace.json** with your extension metadata:
   ```json
   {
     "id": "my-extension",
     "name": "My Extension",
     "version": "1.0.0",
     "description": "What it does",
     "filename": "my-extension.vsext",
     "featured": false
   }
   ```

## Extension Format

A `.vsext` file must contain:
- `manifest.json` - Extension metadata and configuration
- `extension.js` - Compiled JavaScript manifest (optional, falls back to manifest.json)
- `tools.py` - Python tool implementations (if using custom tools)
- Other assets (components, README, etc.)

## Example: Hello Extension

The included `hello-extension.vsext` demonstrates:
- Custom agent tools (`say_hello`, `count_files`)
- Permission system
- Lifecycle hooks
- Proper packaging format

Install it to test the extension system!

## Bundled Extensions

The local marketplace also includes:
- `entity-glossary` - Build Markdown glossaries from entities.
- `tag-manager` - Add/remove tags quickly by ID.
- `section-outline` - Generate a section outline from frontmatter.
- `entity-stats` - Quick count summary by entity type.

## Packaging Helper

To rebuild bundled `.vsext` packages:
```bash
node scripts/package-extensions.cjs
```

## Global Installation

When an extension is installed:
1. It's extracted to the global extensions directory:
   - **Windows**: `%APPDATA%\vswrite\extensions\{extension-id}\`
   - **macOS**: `~/Library/Application Support/vswrite/extensions/{extension-id}/`
   - **Linux**: `~/.local/share/vswrite/extensions/{extension-id}/`

2. It's registered with the Python backend

3. It's activated and tools become available to the AI agent

4. It persists across projects and app restarts

## Creating Extensions

See `examples/hello-extension/` for a complete reference implementation and `EXTENSION_TESTING.md` for development guide.

## Future: Online Marketplace

This local marketplace is a stepping stone toward an online extension marketplace where developers can publish and users can browse/install extensions directly from the internet.
