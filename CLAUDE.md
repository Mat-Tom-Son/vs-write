# VS Write - AI Agent Onboarding Guide

> **For AI coding assistants working on this codebase**

## What Is This?

VS Write is a **desktop editor for structured writing** with entity tracking and AI-powered consistency checking. Think of it as an IDE for writers, researchers, and content creators - not just a text editor.

**Key insight**: This treats writing as structured data, not just prose. Sections are like code files. Entities are like type definitions. Tags are like references.

## Tech Stack At A Glance

```
Frontend: React 19 + TypeScript + Vite 7 + CodeMirror 6 + Zustand + Tailwind
Desktop:  Tauri 2 (Rust) - wraps the web app as a native desktop app
Agent:    Native Rust agent with multi-provider LLM support (OpenAI, Claude, Ollama, OpenRouter)
Database: SQLite (via Tauri plugin) - cache/index layer, files are source of truth
```

## Critical Architecture Facts

### Files Are Source of Truth
The SQLite database is just a cache/index. Everything can be rebuilt from files:
- `project.yaml` - project metadata
- `entities/*.yaml` - entity definitions
- `sections/*.md` - content with YAML frontmatter

### Service Layer Pattern
```
ProjectService (orchestration)
    ├── FileService (file I/O)
    ├── DatabaseService (SQLite)
    └── AgentService (LLM integration)
```

### State Management
- **Zustand store** (`src/lib/store.ts`) holds all in-memory state
- **Immer middleware** for immutable updates
- Store has dirty tracking but ProjectService.save() does its own hash-based detection

### Native Agent Architecture
The AI agent runs natively in Rust within the Tauri process:
- **No separate backend process** - everything is in-process
- **Multi-provider support** - OpenAI, Claude, Ollama, OpenRouter
- **API keys from Settings UI** - stored in localStorage, passed via Tauri IPC
- **Tool calling** - file ops, shell execution, entity API
- **Lua extensions** - custom tools via extension system

```
Frontend (NativeAgentPanel.tsx)
    ↓ Tauri invoke + event listeners
agent_commands.rs (Tauri commands)
    ↓
agent/core.rs (tool-calling loop)
    ↓
agent/llm.rs (multi-provider HTTP client)
    ↓
agent/tools.rs (file ops, shell, entities)
```

## Key Files to Know

| File | Purpose |
|------|---------|
| `src/lib/store.ts` | Global Zustand store - all app state lives here |
| `src/services/ProjectService.ts` | Orchestrates file I/O and database sync |
| `src/lib/schemas.ts` | Zod schemas for in-memory data structures |
| `src/lib/schemas-file.ts` | Zod schemas for file formats |
| `src/lib/prompt-resolver.ts` | 3-layer prompt hierarchy with template interpolation |
| `src/lib/app-settings.ts` | App-level settings including API keys (persisted to localStorage) |
| `src/components/Sidebar/NativeAgentPanel.tsx` | Chat UI communicating with Rust agent via Tauri IPC |
| `src-tauri/src/agent_commands.rs` | Tauri commands exposing agent to frontend |
| `src-tauri/src/agent/core.rs` | Main agent tool-calling loop |
| `src-tauri/src/agent/llm.rs` | Multi-provider LLM client (OpenAI, Claude, Ollama, OpenRouter) |
| `src-tauri/src/agent/tools.rs` | Built-in tool implementations |
| `src-tauri/src/lib.rs` | Tauri app setup and state management |

## Common Gotchas

### 1. "Why isn't my change showing up?"
- Check if you edited the right layer. There are often parallel structures:
  - In-memory schema vs file schema
  - Store state vs service state
  - App settings vs project settings

### 2. "The agent doesn't know about the project"
- System prompt is built in `NativeAgentPanel.tsx` using `PromptResolver`
- Context includes project name, synopsis, entities, sections
- Check `prompt-resolver.ts` for template interpolation

### 3. "API key not working"
- Keys are stored in localStorage via `app-settings.ts`
- Frontend sends keys to Rust via Tauri invoke
- Check `appSettings.llm.[provider].apiKey` in Settings
- Environment variables serve as fallback only

### 4. "File watcher triggers on my own writes"
- `ProjectService.markFileAsWritten()` tracks recently-written files
- 5-second debounce window
- Check `wasRecentlyWritten()` before triggering reload

### 5. "Tauri plugin not working"
- Permissions in `src-tauri/capabilities/default.json`
- Each plugin needs explicit permission grants
- File access scoped to `$DESKTOP/**`, `$DOCUMENT/**`, `$HOME/**`

## Prompt System

Three-layer hierarchy (highest priority first):
1. **Project-level** - in `project.yaml` under `settings.systemPrompts`
2. **App-level** - in Settings dialog (localStorage)
3. **Default** - hardcoded in `app-settings.ts`

Template variables work with `{{variable}}` syntax:
- `{{project.name}}`, `{{project.synopsis}}`
- `{{entitySummary}}`, `{{sectionList}}`
- `{{entityCount}}`, `{{sectionCount}}`
- `{{fileStructure}}`

Context is built fresh on each message send in `NativeAgentPanel.tsx`.

## Testing

### Frontend
```bash
npm run dev          # Vite dev server (browser only)
npm run tauri:dev    # Full desktop app with agent
npx tsc --noEmit     # Type check
```

### Rust Agent
```bash
cd src-tauri
cargo test           # Run Rust tests
cargo clippy         # Lint
```

## Naming

The product is called **VS Write** (not "Story IDE" - that was the old name).
- Package name: `vs-write`
- Tauri identifier: `com.vswrite.app`

## What's Already Robust

These things work well - don't reinvent them:
- **Hash-based change detection** - only writes modified files
- **Parallel file writes** - `Promise.all()` in ProjectService
- **Error handling with partial save** - collects errors, saves what it can
- **Timer cleanup** - no memory leaks on project close
- **Multi-provider LLM support** - OpenAI, Claude, Ollama, OpenRouter with proper API handling
- **Session tracking** - agent runs tracked with audit logs
- **Extension system** - Lua-based extensions with lifecycle hooks

## What Needs Work

From the task list:
- Frontend unit tests (limited coverage)
- Getting started documentation
- React error boundaries

## Quick Commands

```bash
# Development
npm run tauri:dev        # Run desktop app
npm run dev              # Run web-only (limited features)

# Build
npm run tauri:build      # Production desktop build
npm run build            # Production web build

# Checks
npx tsc --noEmit         # TypeScript
npm run lint             # ESLint
cd src-tauri && cargo clippy  # Rust lint
```

## How to Add a New Feature

1. **Schema first** - Add to `schemas.ts` (in-memory) and `schemas-file.ts` (persistence)
2. **Store next** - Add state and actions to `store.ts`
3. **Services** - Update FileService/DatabaseService if persistence needed
4. **UI last** - Components consume store via hooks

For agent features:
1. Add tool schema to `src-tauri/src/agent/tools.rs`
2. Implement tool execution in `execute_tool()`
3. Update `get_tool_schemas()` to include new tool
4. Frontend automatically sees new tools via events

For Lua extension tools:
1. Create extension with `manifest.json`
2. Define tool in manifest with `luaScript` path
3. Implement in Lua file
4. Load via Settings > Extensions

---

*Last updated: January 30, 2026*
