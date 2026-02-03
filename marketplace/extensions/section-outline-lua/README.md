# Section Outline (Lua)

Generate outlines and summaries of project sections.

## Tools

### section_outline

Generate a structured outline of the project sections.

**Parameters:**
- `include_word_count` (boolean, optional): Include word counts. Defaults to true.
- `include_entities` (boolean, optional): Include entity mentions. Defaults to true.
- `format` (string, optional): 'markdown' (default), 'plain', or 'tree'

**Example:**
```lua
section_outline({ format = "tree", include_entities = false })
```

**Sample Output (tree format):**
```
PROJECT OUTLINE

├── Down the Rabbit Hole (1500 words)
├── The Pool of Tears (1200 words)
├── A Caucus-Race (900 words)
└── The Rabbit Sends in a Little Bill (1100 words)

Total: 4700 words
```

**Sample Output (markdown format):**
```markdown
# Project Outline

**Total:** 4700 words | 4 sections

---

## 1. Down the Rabbit Hole *(1500 words)*

> Alice follows the White Rabbit down a mysterious hole.

**Entities:** Alice, White Rabbit, Dinah

## 2. The Pool of Tears *(1200 words)*

> Alice cries a pool of tears and meets various creatures.

**Entities:** Alice, Mouse, Duck
```

### section_detail

Get detailed information about a specific section.

**Parameters:**
- `section_id` (string, required): The ID of the section
- `preview_length` (integer, optional): Characters to preview. Defaults to 500.

**Example:**
```lua
section_detail({ section_id = "chapter-1", preview_length = 200 })
```

**Sample Output:**
```markdown
# Down the Rabbit Hole

## Metadata

- **ID:** `chapter-1`
- **Order:** 1
- **Word Count:** 1500
- **Character Count:** 8500

## Synopsis

Alice follows the White Rabbit down a mysterious hole.

## Entities (5 mentions)

- Alice (3 mentions)
- White Rabbit (2 mentions)

## Content Preview

Alice was beginning to get very tired of sitting by her sister on the bank...
```

## Entity API Functions Used

- `tools.entities.list_sections()` - List all sections
- `tools.entities.get_section(id)` - Get section details
- `tools.entities.get_tags(section_id)` - Get entity tags in section
- `tools.entities.get(id)` - Get entity details

## Installation

1. Copy this directory to your VS Write extensions folder
2. Load the extension through the Extensions panel
3. The tools will be available to the AI agent

## Use Cases

- Generate a table of contents for the project
- Track progress by section word count
- Identify which sections mention specific entities
- Get a quick overview of project structure
