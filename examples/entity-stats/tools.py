"""Entity Stats extension tools."""

from typing import Any, Dict


ENTITY_TYPES = ["character", "location", "concept", "item", "rule", "custom"]


def entity_stats(ctx, arguments: Dict[str, Any]) -> str:
    counts = {}
    total = 0
    for entity_type in ENTITY_TYPES:
        entities = ctx.list_entities_by_type(entity_type)
        count = len(entities)
        counts[entity_type] = count
        total += count

    lines = [f"- {etype}: {count}" for etype, count in counts.items()]
    lines.append(f"\nTotal: {total}")
    return "\n".join(lines)
