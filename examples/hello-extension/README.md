# Hello Extension - Test Extension for VS Write

This is a minimal test extension that demonstrates the VS Write extension system working.

## What It Does

This extension adds two custom tools:

1. **say_hello** - Returns a greeting message (optionally personalized with a name)
2. **count_files** - Counts files in the project matching a glob pattern

## Installation

1. Copy this folder to your project's `extensions/` directory:
   ```
   your-project/
   └── extensions/
       └── hello-extension/
           ├── package.json
           ├── extension.ts
           ├── tools.py
           └── README.md
   ```

2. Compile the TypeScript manifest:
   ```bash
   cd extensions/hello-extension
   npx tsc extension.ts --module es2020 --target es2020 --moduleResolution node
   ```

   This creates `extension.js` which is loaded by VS Write.

## Usage

Once installed and the project is opened in VS Write:

1. The extension will automatically load and register its tools
2. In the chat, you can ask the AI to use the tools:
   - "Use say_hello to greet Alice"
   - "Count the markdown files in the project"
   - "How many sections do I have?" (will use count_files)

## Testing the Extension System

This extension serves as a test to verify Phase 1 of the extension system is working:

- ✅ Extension discovery and loading
- ✅ Python tool registration
- ✅ Tool schema generation
- ✅ Agent can call extension tools
- ✅ Extension context provides sandboxed access
- ✅ Lifecycle hooks execute (onActivate, onProjectOpen)
- ✅ Settings storage works

## Files

- `package.json` - Extension metadata
- `extension.ts` - Manifest defining tools and lifecycle hooks
- `tools.py` - Python implementations of custom tools
- `README.md` - This file

## Development

To modify this extension:

1. Edit `tools.py` to add new tool implementations
2. Edit `extension.ts` to register new tools in the manifest
3. Recompile: `npx tsc extension.ts --module es2020 --target es2020 --moduleResolution node`
4. Restart VS Write or reload the project

## Permissions

This extension requests:

- `tools: ['read_file']` - Access to the read_file built-in tool
- `filesystem: 'project'` - Read/write access within the project folder
- `settings: true` - Ability to store extension settings

All permissions are declared in the manifest and enforced by the extension system.
