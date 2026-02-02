# Hello Extension (Lua)

A simple example extension demonstrating Lua tool implementation for VS Write.

## Tools

### say_hello

Says hello to a person by name.

**Parameters:**
- `name` (string, optional): The name of the person to greet. Defaults to "World".

**Example:**
```
say_hello({ name = "Alice" })
-- Returns: "Hello, Alice! Welcome to VS Write."
```

### count_files

Counts files matching a glob pattern in the workspace.

**Parameters:**
- `pattern` (string, optional): Glob pattern to match files. Defaults to "*".

**Example:**
```
count_files({ pattern = "*.md" })
-- Returns: "Found 5 files matching pattern: *.md"
```

## Lifecycle Hooks

This extension implements the following lifecycle hooks:

- `on_activate`: Called when the extension is loaded
- `on_deactivate`: Called when the extension is unloaded

## Installation

1. Copy this directory to your VS Write extensions folder
2. Load the extension through the Extensions panel
3. The tools will be available to the AI agent

## File Structure

```
hello-extension-lua/
├── manifest.json   # Extension metadata and tool definitions
├── tools.lua       # Tool implementations
├── hooks.lua       # Lifecycle hook implementations
└── README.md       # This file
```

## Development Notes

This extension demonstrates:
- Basic tool parameter handling with defaults
- Using the `tools.glob()` function from the runtime
- JSON parsing with `json.decode()`
- Lifecycle hook implementation
