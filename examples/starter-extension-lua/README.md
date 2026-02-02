# Starter Extension (Lua)

A comprehensive template for creating VS Write Lua extensions.

## Getting Started

1. **Copy this directory** to create your own extension
2. **Rename the directory** to match your extension name
3. **Update manifest.json** with your extension's details
4. **Implement your tools** in `tools.lua`
5. **Add lifecycle hooks** in `hooks.lua` (optional)

## File Structure

```
my-extension/
├── manifest.json   # Extension metadata and tool definitions
├── tools.lua       # Tool implementations
├── hooks.lua       # Lifecycle hooks (optional)
└── README.md       # Documentation
```

## manifest.json

The manifest defines your extension's metadata, tools, and permissions.

```json
{
  "id": "unique-extension-id",
  "name": "Human Readable Name",
  "version": "1.0.0",
  "description": "What your extension does",
  "author": "Your Name",
  "permissions": ["file_read", "file_write", "entity_read", "entity_write"],
  "tools": [...],
  "lifecycle": {
    "hooks": ["on_activate", "on_project_open"],
    "hooksScript": "./hooks.lua"
  }
}
```

### Permissions

- `file_read` - Read files in the workspace
- `file_write` - Write/create files in the workspace
- `entity_read` - Read entities and sections
- `entity_write` - Create/update/delete entities and tags

### Tool Definition

```json
{
  "name": "tool_name",
  "description": "What the tool does (shown to AI)",
  "luaScript": "./tools.lua",
  "luaFunction": "function_name",
  "parameters": {
    "type": "object",
    "properties": {
      "param1": {
        "type": "string",
        "description": "Parameter description"
      }
    },
    "required": ["param1"]
  }
}
```

## Available APIs

### File Operations

```lua
-- Read a file
local content = tools.read_file("path/to/file.txt")

-- Write a file (creates or overwrites)
tools.write_file("path/to/file.txt", "content")

-- Append to a file
tools.append_file("path/to/file.txt", "more content")

-- Delete a file
tools.delete_file("path/to/file.txt")

-- Find files matching a pattern
local files_json = tools.glob("*.md", ".")
local files = json.decode(files_json)
```

### Entity Operations

```lua
-- Get an entity
local entity_json = tools.entities.get("entity-id")
local entity = json.decode(entity_json)

-- List all entities
local all_json = tools.entities.list_all()
local all = json.decode(all_json)

-- List entities by type
local chars_json = tools.entities.list_by_type("character")
local chars = json.decode(chars_json)

-- Search entities
local results_json = tools.entities.search("alice")
local results = json.decode(results_json)

-- Create an entity
local entity = {
    id = "new-entity",
    name = "New Entity",
    entity_type = "character",
    description = "A description"
}
local created_json = tools.entities.create(json.encode(entity))

-- Update an entity
local updates = { description = "Updated description" }
tools.entities.update("entity-id", json.encode(updates))

-- Delete an entity
tools.entities.delete("entity-id")

-- Get entity relationships (which sections it appears in)
local rel_json = tools.entities.get_relationships("entity-id")
local rel = json.decode(rel_json)
```

### Section Operations

```lua
-- Get a section
local section_json = tools.entities.get_section("section-id")
local section = json.decode(section_json)

-- List all sections
local sections_json = tools.entities.list_sections()
local sections = json.decode(sections_json)

-- Get tags in a section
local tags_json = tools.entities.get_tags("section-id")
local tags = json.decode(tags_json)

-- Add a tag
local tag_json = tools.entities.add_tag("section-id", "entity-id", 100, 110)
local tag = json.decode(tag_json)

-- Remove a tag
tools.entities.remove_tag("section-id", "tag-id")
```

### JSON Utilities

```lua
-- Encode Lua table to JSON string
local json_str = json.encode({ key = "value", num = 42 })

-- Decode JSON string to Lua table
local table = json.decode('{"key": "value", "num": 42}')
```

## Lifecycle Hooks

Enable hooks in manifest.json and implement them in hooks.lua:

| Hook | When Called | Args |
|------|-------------|------|
| `on_activate` | Extension loaded | `{}` |
| `on_deactivate` | Extension unloaded | `{}` |
| `on_project_open` | Project opened | `{ project_path, project_name }` |
| `on_project_close` | Project closed | `{}` |
| `on_section_save` | Section saved | `{ section_id, section_title, content }` |
| `on_entity_change` | Entity changed | `{ entity_id, entity_name, entity_type, action }` |

Hook functions must return `{ success = true/false, result/error = "..." }`.

## Best Practices

1. **Validate inputs** - Check required parameters before processing
2. **Handle errors gracefully** - Return helpful error messages
3. **Use helper functions** - Keep tool functions focused
4. **Document your tools** - Clear descriptions help the AI use them correctly
5. **Request minimal permissions** - Only request what you need

## Testing

1. Load your extension in VS Write
2. Open a project
3. Use the AI chat to invoke your tools
4. Check the console for any errors

## Example Tools

See the other example extensions for more complex implementations:

- `hello-extension-lua` - Basic tool implementation
- `entity-glossary-lua` - Entity API usage
- `tag-manager-lua` - Tag operations
- `section-outline-lua` - Section operations
- `entity-stats-lua` - Analytics and statistics
