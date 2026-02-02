"""Starter Extension tools."""

from typing import Any, Dict


def list_entities(ctx, arguments: Dict[str, Any]) -> str:
    entity_type = arguments.get("type")
    if not entity_type:
        raise ValueError("type is required")

    entities = ctx.list_entities_by_type(entity_type)
    if not entities:
        return f"No entities found for type '{entity_type}'."

    lines = [f"- {entity.get('name', 'Untitled')}" for entity in entities]
    return "\n".join(lines)


def tag_range(ctx, arguments: Dict[str, Any]) -> str:
    section_id = arguments.get("section_id")
    entity_id = arguments.get("entity_id")
    start = arguments.get("from")
    end = arguments.get("to")

    if not section_id or not entity_id:
        raise ValueError("section_id and entity_id are required")
    if start is None or end is None:
        raise ValueError("from and to are required")

    tag = ctx.add_tag(section_id, entity_id, int(start), int(end))
    return f"Tagged {entity_id} in {section_id} as {tag.get('from')}..{tag.get('to')}."
