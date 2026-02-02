"""Starter Extension hooks."""

from typing import Any, Dict


def on_project_open(ctx, arguments: Dict[str, Any]) -> str:
    project = arguments.get("project", {})
    name = project.get("name", "Untitled Project")
    return f"Starter Extension active for {name}."
