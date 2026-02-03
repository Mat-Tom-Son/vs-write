# Tag Manager (Lua)

Manage entity tags in sections - add, remove, and view tags.

## Tools

### add_entity_tag

Add an entity tag to a section at a specific text range.

**Parameters:**
- `section_id` (string, required): The ID of the section
- `entity_id` (string, required): The ID of the entity to tag
- `from_pos` (integer, required): Start position (character offset)
- `to_pos` (integer, required): End position (character offset)

**Example:**
```lua
add_entity_tag({
    section_id = "chapter-1",
    entity_id = "alice",
    from_pos = 100,
    to_pos = 105
})
-- Returns: "Successfully added tag for 'Alice' in section 'Chapter 1' (tag ID: abc123)"
```

### remove_entity_tag

Remove an entity tag from a section.

**Parameters:**
- `section_id` (string, required): The ID of the section
- `tag_id` (string, required): The ID of the tag to remove

**Example:**
```lua
remove_entity_tag({
    section_id = "chapter-1",
    tag_id = "abc123"
})
-- Returns: "Successfully removed tag abc123 from section chapter-1"
```

### tag_overview

Get an overview of all tags in a section or the entire project.

**Parameters:**
- `section_id` (string, optional): Filter to a specific section
- `group_by` (string, optional): 'section' (default) or 'entity'

**Example:**
```lua
tag_overview({ group_by = "entity" })
```

**Sample Output:**
```markdown
# Tag Overview

## Alice

**Appearances:** 3

- Down the Rabbit Hole (pos 100-105)
- The Pool of Tears (pos 50-55)
- A Mad Tea-Party (pos 200-205)

## White Rabbit

**Appearances:** 2

- Down the Rabbit Hole (pos 20-32)
- The Rabbit Sends in a Little Bill (pos 10-22)
```

## Entity API Functions Used

- `tools.entities.get(id)` - Get entity details
- `tools.entities.get_section(id)` - Get section details
- `tools.entities.get_tags(section_id)` - Get tags in a section
- `tools.entities.add_tag(section_id, entity_id, from, to)` - Add a tag
- `tools.entities.remove_tag(section_id, tag_id)` - Remove a tag
- `tools.entities.list_sections()` - List all sections

## Installation

1. Copy this directory to your VS Write extensions folder
2. Load the extension through the Extensions panel
3. The tools will be available to the AI agent

## Use Cases

- Batch-add entity tags across sections
- Clean up duplicate or incorrect tags
- Generate tag reports for consistency checking
- Analyze entity distribution across the project
