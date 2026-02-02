"""Tag Manager extension tools."""

from typing import Any, Dict, List


def add_entity_tag(ctx, arguments: Dict[str, Any]) -> str:
    section_id = arguments.get("section_id")
    entity_id = arguments.get("entity_id")
    start = arguments.get("from")
    end = arguments.get("to")
    if not section_id or not entity_id:
        raise ValueError("section_id and entity_id are required")
    if start is None or end is None:
        raise ValueError("from and to are required")

    tag = ctx.add_tag(section_id, entity_id, int(start), int(end))
    return f"Tag {tag.get('id')} added for entity {entity_id} in section {section_id}."


def remove_entity_tag(ctx, arguments: Dict[str, Any]) -> str:
    section_id = arguments.get("section_id")
    tag_id = arguments.get("tag_id")
    if not section_id or not tag_id:
        raise ValueError("section_id and tag_id are required")

    ctx.remove_tag(section_id, tag_id)
    return f"Tag {tag_id} removed from section {section_id}."


def tag_overview(ctx, arguments: Dict[str, Any]) -> str:
    section_id = arguments.get("section_id")
    if not section_id:
        raise ValueError("section_id is required")

    tags = ctx.get_tags_by_section(section_id)
    if not tags:
        return "No tags found for this section."

    lines: List[str] = []
    for tag in tags:
        entity = ctx.get_entity_by_id(tag.get("entityId"))
        name = entity.get("name") if entity else tag.get("entityId", "unknown")
        lines.append(f"- {name}: {tag.get('from')}..{tag.get('to')} (tag {tag.get('id')})")

    return "\n".join(lines)
