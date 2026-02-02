"""Section Outline extension tools."""

from typing import Any, Dict, List, Tuple
import yaml


def _parse_frontmatter(text: str) -> Dict[str, Any]:
    if text.startswith("---"):
        parts = text.split("---", 2)
        if len(parts) >= 3:
            return yaml.safe_load(parts[1]) or {}
    return {}


def section_outline(ctx, arguments: Dict[str, Any]) -> str:
    pattern = arguments.get("pattern") or "sections/*.md"
    files = ctx.glob(pattern)
    if not files:
        return "No section files found."

    entries: List[Tuple[int, str]] = []
    for path in files:
        content = ctx.read_file(path)
        frontmatter = _parse_frontmatter(content)
        title = frontmatter.get("title") or path
        order = frontmatter.get("order")
        if order is None:
            # Try to parse from filename prefix (001-*)
            try:
                order = int(path.split("/")[-1].split("-")[0])
            except Exception:
                order = 0
        entries.append((int(order), title))

    entries.sort(key=lambda item: item[0])
    lines = [f"{order}. {title}" for order, title in entries]
    return "\n".join(lines)
