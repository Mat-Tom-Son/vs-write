# Entity Glossary (Lua)

Generate glossaries and relationship maps from project entities.

## Tools

### entity_glossary

Generate a formatted glossary of all entities in the project, grouped by type.

**Parameters:**
- `entity_type` (string, optional): Filter by entity type (e.g., 'character', 'location', 'item')
- `format` (string, optional): Output format - 'markdown' (default), 'plain', or 'json'

**Example:**
```lua
entity_glossary({ entity_type = "character", format = "markdown" })
```

**Sample Output (Markdown):**
```markdown
# Entity Glossary

## Characters

### Alice
A curious young girl who falls down a rabbit hole.

**Aliases:** Alice Liddell

### White Rabbit
A nervous rabbit always worried about being late.
```

### entity_relationships

Show relationships between entities and the sections they appear in.

**Parameters:**
- `entity_id` (string, optional): Specific entity ID to show relationships for
- `include_sections` (boolean, optional): Include section appearances. Defaults to true.

**Example:**
```lua
entity_relationships({ entity_id = "alice", include_sections = true })
```

**Sample Output:**
```markdown
# Relationships for: Alice

**Type:** character

A curious young girl who falls down a rabbit hole.

## Appears In

- Down the Rabbit Hole (`chapter-1`)
- The Pool of Tears (`chapter-2`)
```

## Entity API

This extension demonstrates use of the Entity API:

- `tools.entities.list_all()` - Get all entities
- `tools.entities.list_by_type(type)` - Get entities of a specific type
- `tools.entities.get(id)` - Get a single entity
- `tools.entities.get_relationships(id)` - Get entity with section appearances

## Installation

1. Copy this directory to your VS Write extensions folder
2. Load the extension through the Extensions panel
3. The tools will be available to the AI agent

## Use Cases

- Generate a character glossary for reference
- Create a location index for worldbuilding
- Map entity appearances across sections
- Export entity data for external tools
