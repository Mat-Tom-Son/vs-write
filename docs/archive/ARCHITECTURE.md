# VS Write Architecture Guide

This document explains VS Write's architecture, communication patterns, and how to extend the system.

## Overview

VS Write is a desktop writing application with three main layers:

```
┌─────────────────────────────────────────────────────────────┐
│                    Frontend (React/TypeScript)               │
│  Components → Services → State (Zustand)                     │
└─────────────────────────────┬───────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              │               │               │
              ▼               ▼               ▼
        Tauri invoke    WebSocket      Direct API
         (Rust)        (Python)        (External LLMs)
              │               │               │
              │               ▼               │
              │    ┌─────────────────┐        │
              └───►│  Python Agent   │◄───────┘
                   │  (localhost)    │
                   └─────────────────┘
```

## Communication Patterns

### When to Use Each Method

| Method | Use Case | Files Involved |
|--------|----------|----------------|
| **Tauri `invoke()`** | Backend state, system operations, bridging to Python HTTP | `lib.rs`, component using invoke |
| **WebSocket** | Streaming agent chat with real-time tool call events | `AgentWebSocketService.ts`, `ChatPanel.tsx` |
| **Direct `fetch()`** | External APIs (OpenAI, Anthropic) | `AgentService.ts` |

### ❌ Never Do This

```typescript
// WRONG: Direct fetch to Python backend causes CORS errors
fetch('http://localhost:8000/some-endpoint')
```

### ✅ Correct Patterns

```typescript
// Pattern 1: Tauri invoke for quick operations
import { invoke } from '@tauri-apps/api/core';
const result = await invoke<ResultType>('command_name', { args });

// Pattern 2: WebSocket for streaming agent chat
const ws = new AgentWebSocketService();
ws.sendMessage({ task: "...", system_prompt: "..." });
ws.onMessage((msg) => { /* handle real-time events */ });

// Pattern 3: External APIs (these have CORS headers)
await fetch('https://api.openai.com/v1/...', { ... });
```

---

## Layer Details

### Frontend (`story-ide/src/`)

| Directory | Purpose |
|-----------|---------|
| `components/` | React UI components |
| `services/` | Communication layer (WebSocket, LLM providers) |
| `lib/` | State management, schemas, utilities |

**Key Files:**
- `lib/store.ts` - Zustand state management
- `lib/app-settings.ts` - Persistent settings (localStorage)
- `services/AgentWebSocketService.ts` - Real-time agent communication
- `services/AgentService.ts` - LLM provider adapters

### Tauri Bridge (`story-ide/src-tauri/`)

The Rust layer that bridges Frontend ↔ Python:

| Command | Purpose |
|---------|---------|
| `reveal_path` | Open file in system explorer |
| `get_backend_status` | Check Python server health |
| `restart_backend` | Restart Python agent server |
| `get_scratch_stats` | Get temp file stats (calls Python) |
| `clear_scratch` | Clear temp files (calls Python) |

**Adding a new Tauri command:**
```rust
// lib.rs
#[tauri::command]
async fn my_command(state: State<'_, SharedServerState>) -> Result<T, String> {
    // Implementation
}

// Register in invoke_handler
.invoke_handler(tauri::generate_handler![..., my_command])
```

### Python Agent (`story-ide/open-agent/`)

| File | Purpose |
|------|---------|
| `runtime.py` | Low-level file/shell operations |
| `agent.py` | Tool-calling loop with OpenAI |
| `api.py` | AgentService facade |
| `http_service.py` | FastAPI endpoints + WebSocket |

---

## Adding Agent Tools

Adding a new tool currently requires changes in multiple files:

### Step 1: Python Runtime (`runtime.py`)

Add the implementation:
```python
def my_tool(self, param: str) -> str:
    """My tool documentation."""
    # Implementation here
    return result
```

### Step 2: Python Schema (`agent.py`)

Add to `tool_schema()`:
```python
{
    "type": "function",
    "function": {
        "name": "my_tool",
        "description": "What the tool does",
        "parameters": {
            "type": "object",
            "properties": {
                "param": {"type": "string"}
            },
            "required": ["param"]
        }
    }
}
```

### Step 3: Python Dispatch (`agent.py`)

Add to `_dispatch_tool()`:
```python
if name == "my_tool":
    return self.runtime.my_tool(arguments["param"])
```

### Step 4: TypeScript Registry (`lib/tool-registry.ts`)

Add UI documentation:
```typescript
{
  name: 'my_tool',
  description: 'What the tool does',
  category: 'file',  // file | search | execution | navigation
  icon: 'IconName',
  parameters: [...],
  examples: ['Example usage'],
  documentation: 'Detailed docs',
}
```

### Step 5: AgentService (if exposing via HTTP)

If the tool needs a dedicated HTTP endpoint, add to:
- `api.py` - Service method
- `http_service.py` - FastAPI route
- `lib.rs` - Tauri command (if frontend needs direct access)

---

## Architecture Principles

1. **Files are source of truth** - project.yaml, entities/*.yaml, sections/*.md
2. **Frontend never calls Python HTTP directly** - always via Tauri or WebSocket
3. **Agent tools are sandboxed** - all operations stay within workspace_root
4. **Settings persist in localStorage** - not in project files

---

## Future: Extension System

The current architecture requires editing 5+ files to add a tool. A future plugin system could enable single-file tool definitions:

```python
# tools/my_tool.py
@register_tool
class MyTool:
    name = "my_tool"
    schema = {...}  # OpenAI format
    
    def execute(self, runtime, args):
        return runtime.do_something(args)
```

See `implementation_plan.md` for the full extension system design.
