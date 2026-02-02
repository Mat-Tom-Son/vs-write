"""Entity Glossary extension tools."""

from typing import Any, Dict, List


ENTITY_TYPES = ["character", "location", "concept", "item", "rule", "custom"]


def entity_glossary(ctx, arguments: Dict[str, Any]) -> str:
    types = arguments.get("types") or ENTITY_TYPES
    include_aliases = bool(arguments.get("include_aliases", False))

    sections: List[str] = []
    for entity_type in types:
        entities = ctx.list_entities_by_type(entity_type)
        if not entities:
            continue
        sections.append(f"## {entity_type.title()}")
        for entity in sorted(entities, key=lambda e: e.get("name", "")):
            line = f"- **{entity.get('name', 'Untitled')}**"
            description = entity.get("description") or ""
            if description:
                line += f": {description}"
            if include_aliases and entity.get("aliases"):
                aliases = ", ".join(entity.get("aliases", []))
                line += f" (aliases: {aliases})"
            sections.append(line)
        sections.append("")

    if not sections:
        return "No entities found for the selected types."

    return "\n".join(sections).strip()


def entity_relationships(ctx, arguments: Dict[str, Any]) -> str:
    entity_id = arguments.get("entity_id")
    if not entity_id:
        raise ValueError("entity_id is required")

    relationships = ctx.get_entity_relationships(entity_id)
    entity = relationships.get("entity", {}) or {}
    sections = relationships.get("sections", []) or []

    lines = [f"# {entity.get('name', 'Entity')}", f"Type: {entity.get('type', 'unknown')}", ""]
    if not sections:
        lines.append("No linked sections found.")
        return "\n".join(lines)

    lines.append("## Sections")
    for section in sections:
        order = section.get("order", 0)
        title = section.get("title", "Untitled")
        lines.append(f"- {order}. {title}")
    return "\n".join(lines)
