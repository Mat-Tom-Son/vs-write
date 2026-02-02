"""
Hello Extension - Python tool implementations
"""

from typing import Dict, Any


def say_hello(ctx, arguments: Dict[str, Any]) -> str:
    """Say hello with an optional name.

    Args:
        ctx: ExtensionContext with runtime access
        arguments: Dict containing optional 'name' parameter

    Returns:
        Greeting message as string
    """
    name = arguments.get("name", "World")

    # You can access extension settings
    # last_activated = ctx.settings.get('lastActivated', 'never')

    return f"Hello, {name}! This message is from the hello-extension tool."


def count_files(ctx, arguments: Dict[str, Any]) -> str:
    """Count files matching a glob pattern.

    Args:
        ctx: ExtensionContext with runtime access
        arguments: Dict containing 'pattern' parameter

    Returns:
        Count message as string
    """
    pattern = arguments.get("pattern", "*")

    # Use the extension context to access built-in tools
    # This demonstrates how extensions can leverage existing functionality
    try:
        files = ctx.glob(pattern, ".")
        count = len(files)

        if count == 0:
            return f"No files found matching pattern: {pattern}"
        elif count == 1:
            return f"Found 1 file matching pattern: {pattern}\n\nFile: {files[0]}"
        else:
            file_list = "\n".join(f"  - {f}" for f in files[:10])
            if count > 10:
                file_list += f"\n  ... and {count - 10} more"

            return f"Found {count} files matching pattern: {pattern}\n\nFiles:\n{file_list}"

    except Exception as e:
        return f"ERROR: Failed to count files: {e}"
