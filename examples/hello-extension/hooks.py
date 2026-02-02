"""Lifecycle hooks for Hello Extension.

This module demonstrates how to implement Python lifecycle hooks
for VS Write extensions. Hooks allow extensions to react to
application events like project opening, section saving, etc.

Hook functions receive an ExtensionContext and a dict of arguments.
"""

from typing import Any, Dict
import logging

# Set up logging for debugging
logger = logging.getLogger(__name__)


def on_activate(ctx: Any, arguments: Dict[str, Any]) -> str:
    """Called when the extension is activated.

    Args:
        ctx: ExtensionContext with runtime access
        arguments: Empty dict for this hook

    Returns:
        Status message
    """
    logger.info("[HelloExtension] Activated!")
    return "Hello Extension activated successfully"


def on_deactivate(ctx: Any, arguments: Dict[str, Any]) -> str:
    """Called when the extension is deactivated.

    Args:
        ctx: ExtensionContext with runtime access
        arguments: Empty dict for this hook

    Returns:
        Status message
    """
    logger.info("[HelloExtension] Deactivated")
    return "Hello Extension deactivated"


def on_project_open(ctx: Any, arguments: Dict[str, Any]) -> str:
    """Called when a project is opened.

    Args:
        ctx: ExtensionContext with runtime access
        arguments: Dict containing 'project' with project data

    Returns:
        Status message
    """
    project = arguments.get("project", {})
    project_name = project.get("name", "Unknown")
    logger.info(f"[HelloExtension] Project opened: {project_name}")
    return f"Noted project open: {project_name}"


def on_project_close(ctx: Any, arguments: Dict[str, Any]) -> str:
    """Called when a project is closed.

    Args:
        ctx: ExtensionContext with runtime access
        arguments: Empty dict for this hook

    Returns:
        Status message
    """
    logger.info("[HelloExtension] Project closed")
    return "Project close acknowledged"


def on_section_save(ctx: Any, arguments: Dict[str, Any]) -> str:
    """Called after a section is saved.

    Args:
        ctx: ExtensionContext with runtime access
        arguments: Dict containing 'section' with section data

    Returns:
        Status message
    """
    section = arguments.get("section", {})
    section_title = section.get("title", "Unknown")
    content_length = len(section.get("content", ""))
    logger.info(f"[HelloExtension] Section saved: {section_title} ({content_length} chars)")
    return f"Tracked save: {section_title}"


def on_section_delete(ctx: Any, arguments: Dict[str, Any]) -> str:
    """Called after a section is deleted.

    Args:
        ctx: ExtensionContext with runtime access
        arguments: Dict containing 'sectionId'

    Returns:
        Status message
    """
    section_id = arguments.get("sectionId", "Unknown")
    logger.info(f"[HelloExtension] Section deleted: {section_id}")
    return f"Noted deletion: {section_id}"


def on_entity_change(ctx: Any, arguments: Dict[str, Any]) -> str:
    """Called when an entity is created, updated, or deleted.

    Args:
        ctx: ExtensionContext with runtime access
        arguments: Dict containing 'entity' with entity data

    Returns:
        Status message
    """
    entity = arguments.get("entity", {})
    entity_name = entity.get("name", "Unknown")
    entity_type = entity.get("type", "unknown")
    logger.info(f"[HelloExtension] Entity changed: {entity_name} ({entity_type})")
    return f"Tracked entity change: {entity_name}"
