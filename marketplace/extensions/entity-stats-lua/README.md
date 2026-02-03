# Entity Stats (Lua)

Generate statistics and analytics about entities in the project.

## Tools

### entity_stats

Generate comprehensive statistics about entities in the project.

**Parameters:**
- `include_mentions` (boolean, optional): Include mention counts. Defaults to true.
- `include_distribution` (boolean, optional): Include section distribution. Defaults to true.

**Example:**
```lua
entity_stats({ include_mentions = true })
```

**Sample Output:**
```markdown
# Entity Statistics

## Overview

| Metric | Value |
|--------|-------|
| Total Entities | 15 |
| Total Sections | 8 |
| Total Mentions | 127 |
| Avg Mentions/Entity | 8.5 |

## Entities by Type

| Type | Count |
|------|-------|
| character | 8 |
| location | 5 |
| item | 2 |

## Mention Counts

| Entity | Type | Mentions |
|--------|------|----------|
| Alice | character | 45 |
| White Rabbit | character | 23 |
| Wonderland | location | 18 |
```

### entity_frequency

Get the most or least frequently mentioned entities.

**Parameters:**
- `top` (integer, optional): Number of results. Defaults to 10.
- `order` (string, optional): 'most' (default) or 'least'
- `entity_type` (string, optional): Filter by entity type

**Example:**
```lua
entity_frequency({ top = 5, order = "least", entity_type = "character" })
```

**Sample Output:**
```markdown
# Least Frequently Mentioned Entities
*Filtered to type: character*

| Rank | Entity | Type | Mentions |
|------|--------|------|----------|
| 1 | Dodo | character | 1 |
| 2 | Mouse | character | 2 |
| 3 | Duchess | character | 3 |
```

### entity_coverage

Identify entities that may need more coverage or are over-represented.

**Parameters:**
- `threshold_low` (integer, optional): Under-covered threshold. Defaults to 2.
- `threshold_high` (integer, optional): Over-covered threshold. Defaults to 20.

**Example:**
```lua
entity_coverage({ threshold_low = 3, threshold_high = 30 })
```

**Sample Output:**
```markdown
# Entity Coverage Analysis

*Thresholds: under=3, over=30*

## Summary

| Category | Count |
|----------|-------|
| Under-covered (<3) | 4 |
| Normal coverage | 9 |
| Over-covered (>30) | 2 |

## Under-Covered Entities

These entities may need more mentions or could be removed:

- **Dodo** (1 mentions)
- **Mouse** (2 mentions)

## Over-Covered Entities

These entities appear very frequently:

- **Alice** (45 mentions)
- **White Rabbit** (35 mentions)
```

## Entity API Functions Used

- `tools.entities.list_all()` - Get all entities
- `tools.entities.list_by_type(type)` - Get entities by type
- `tools.entities.list_sections()` - Get all sections
- `tools.entities.get_tags(section_id)` - Get tags in a section

## Installation

1. Copy this directory to your VS Write extensions folder
2. Load the extension through the Extensions panel
3. The tools will be available to the AI agent

## Use Cases

- Identify characters that need more screen time
- Find over-mentioned entities that might be redundant
- Generate project analytics for planning
- Balance entity representation across sections
