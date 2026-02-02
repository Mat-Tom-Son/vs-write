# Extension Development Guide

Create custom tools for VS Write using Lua.

## Quick Start

1. Create a directory for your extension
2. Add a `manifest.json` with metadata and tool definitions
3. Implement tools in `tools.lua`
4. Load the extension in VS Write

## Extension Structure

```
my-extension/
├── manifest.json    # Required: metadata and tool definitions
├── tools.lua        # Required: tool implementations
├── hooks.lua        # Optional: lifecycle hooks
└── README.md        # Recommended: documentation
```

## manifest.json

```json
{
  "id": "my-extension",
  "name": "My Extension",
  "version": "1.0.0",
  "description": "What it does",
  "author": "Your Name",
  "permissions": ["file_read", "entity_read"],
  "tools": [
    {
      "name": "my_tool",
      "description": "Tool description for the AI",
      "luaScript": "./tools.lua",
      "luaFunction": "my_tool",
      "parameters": {
        "type": "object",
        "properties": {
          "input": {
            "type": "string",
            "description": "Input parameter"
          }
        },
        "required": ["input"]
      }
    }
  ]
}
```

### Permissions

| Permission | Description |
|------------|-------------|
| `file_read` | Read files in workspace |
| `file_write` | Write/create files |
| `entity_read` | Read entities/sections |
| `entity_write` | Modify entities/tags |

## Tool Implementation

```lua
-- tools.lua

function my_tool(args)
    local input = args.input
    if not input then
        return "Error: input is required"
    end

    -- Your logic here
    return "Result: " .. input
end
```

## Available APIs

### File Operations

```lua
tools.read_file(path)           -- Returns file content
tools.write_file(path, content) -- Write/create file
tools.append_file(path, content)-- Append to file
tools.delete_file(path)         -- Delete file
tools.glob(pattern, dir)        -- Find files (returns JSON)
```

### Entity API

```lua
-- Read operations
tools.entities.get(id)              -- Get entity by ID
tools.entities.list_all()           -- All entities
tools.entities.list_by_type(type)   -- Filter by type
tools.entities.search(query)        -- Search entities
tools.entities.get_relationships(id)-- Entity with sections

-- Write operations
tools.entities.create(entity_json)  -- Create entity
tools.entities.update(id, json)     -- Update entity
tools.entities.delete(id)           -- Delete entity
```

### Section API

```lua
tools.entities.get_section(id)      -- Get section
tools.entities.list_sections()      -- All sections
tools.entities.get_tags(section_id) -- Tags in section
tools.entities.add_tag(section, entity, from, to)
tools.entities.remove_tag(section, tag_id)
```

### JSON

```lua
json.encode(table)  -- Table to JSON string
json.decode(string) -- JSON string to table
```

## Lifecycle Hooks

Add `hooks.lua` and configure in manifest:

```json
{
  "lifecycle": {
    "hooks": ["on_activate", "on_project_open"],
    "hooksScript": "./hooks.lua"
  }
}
```

```lua
-- hooks.lua

function on_activate(args)
    return { success = true, result = "Activated" }
end

function on_project_open(args)
    local name = args.project_name
    return { success = true, result = "Opened: " .. name }
end
```

### Available Hooks

| Hook | Trigger | Args |
|------|---------|------|
| `on_activate` | Extension loaded | `{}` |
| `on_deactivate` | Extension unloaded | `{}` |
| `on_project_open` | Project opened | `{project_path, project_name}` |
| `on_project_close` | Project closed | `{}` |
| `on_section_save` | Section saved | `{section_id, section_title, content}` |
| `on_entity_change` | Entity modified | `{entity_id, entity_name, action}` |

## Examples

See `examples/` directory:
- `hello-extension-lua` - Basic tools
- `entity-glossary-lua` - Entity API
- `tag-manager-lua` - Tag operations
- `starter-extension-lua` - Full template

## Testing

1. Load extension in VS Write (Extensions panel)
2. Use AI chat to invoke your tools
3. Check console for errors

## Tips

- Return strings from tools (the AI reads them)
- Validate required parameters
- Handle errors gracefully
- Write clear tool descriptions for the AI
- Request only needed permissions
