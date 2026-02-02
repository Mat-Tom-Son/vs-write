# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in VS Write, please report it responsibly:

1. **Do not** open a public GitHub issue
2. Email security concerns to: [security@vswrite.app] (or use GitHub's private security reporting)
3. Include:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

We will respond within 48 hours and work with you to address the issue.

## Extension Security

VS Write supports Lua extensions that can execute code. Here's what you should know:

### Sandboxing

Lua extensions run in a sandboxed environment with:
- **No direct filesystem access** outside workspace
- **No network access** (unless explicitly granted)
- **No system command execution** without permission
- **Timeout limits** on execution

### Permissions System

Extensions must declare required permissions in `manifest.json`:

| Permission | Grants |
|------------|--------|
| `file_read` | Read files in workspace |
| `file_write` | Write files in workspace |
| `entity_read` | Read entities and sections |
| `entity_write` | Modify entities and tags |

### Best Practices for Extension Users

1. **Review permissions** before loading extensions
2. **Only load extensions** from trusted sources
3. **Check the source code** if available
4. **Report suspicious extensions** to maintainers

### Best Practices for Extension Developers

1. **Request minimal permissions** - only what you need
2. **Validate all inputs** - never trust user data
3. **Avoid storing sensitive data** - no API keys in extensions
4. **Document what your extension does** - be transparent

## Supported Versions

| Version | Supported |
|---------|-----------|
| 1.x.x   | Yes       |
| < 1.0   | No        |

## Security Features

- **File access scoping** - Extensions can only access workspace files
- **Lua sandbox** - Restricted Lua environment
- **No eval** - No dynamic code execution from user input
- **Input validation** - Zod schemas for all user input
