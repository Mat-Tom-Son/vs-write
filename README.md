# VS Write

VS Write is for writers and researchers who want plain-file projects, strong structure, and an in-app AI assistant that can operate on the project safely.

VS Write is a Tauri desktop app with a native Rust AI agent.

This README is dev-forward: it is written for contributors who want to run, debug, and ship changes quickly.

![VS Write Welcome Screen](docs/images/welcome.png)

## Quick Start (Contributors)

### Prerequisites

- Node.js 18+
- npm 9+
- Rust via [rustup](https://rustup.rs/)

This repo includes `rust-toolchain.toml`, so `rustfmt` and `clippy` are auto-provisioned by rustup.

### Run the App

```bash
git clone https://github.com/Mat-Tom-Son/vs-write.git
cd vs-write
npm install
npm run tauri:dev
```

### Configure LLM Access

In the app, open Settings and choose one provider:

- OpenAI
- Claude (Anthropic)
- OpenRouter
- Ollama (local, no API key)

## Platform Notes and Gotchas

- First Rust command on a fresh machine may take longer while rustup downloads toolchain components.
- Tauri builds require native system prerequisites by OS. If build fails early, check the official Tauri prerequisites for your platform: [v2.tauri.app/start/prerequisites](https://v2.tauri.app/start/prerequisites/).
- `npm run dev` is web-only and intentionally limited; use `npm run tauri:dev` for full app behavior and agent runtime.
- `npm run rust:clippy` currently reports warnings in the codebase; this is expected today and does not block runtime.

## Command Reference

| Command | Purpose |
| --- | --- |
| `npm run tauri:dev` | Full desktop dev loop |
| `npm run dev` | Web-only UI loop (limited native features) |
| `npm run build` | Web build |
| `npm run tauri:build` | Desktop production build |
| `npm run test` | Frontend tests (Vitest) |
| `npm run lint` | ESLint |
| `npm run rust:fmt` | Format Rust (`cargo fmt`) |
| `npm run rust:test` | Rust tests |
| `npm run rust:clippy` | Rust lints |

## Architecture at a Glance

VS Write combines:

- React + TypeScript frontend
- Tauri (Rust) backend with IPC commands
- Native Rust agent runtime (multi-provider LLM + tool calling)
- File-first project model (Markdown + YAML as source of truth)
- SQLite index/cache layer for fast lookups and chat history
- Lua extension system

```text
React UI (src/)
  -> Tauri invoke/event bridge
Rust command layer (src-tauri/src/agent_commands.rs, src-tauri/src/lib.rs)
  -> Agent core + tools + providers (src-tauri/src/agent/)
  -> Filesystem + SQLite + extension/signature services
```

### Core Code Map

| Area | Start Here |
| --- | --- |
| App shell and layout | `src/App.tsx` |
| Global state and project lifecycle | `src/lib/store.ts` |
| App settings and provider config | `src/lib/app-settings.ts` |
| Project orchestration (files + DB + dirty tracking) | `src/services/ProjectService.ts` |
| File I/O layer | `src/services/FileService.ts` |
| SQLite schema and queries | `src/services/DatabaseService.ts` |
| Agent chat UI | `src/components/Sidebar/NativeAgentPanel.tsx` |
| Tauri command registration | `src-tauri/src/lib.rs` |
| Agent IPC and run orchestration | `src-tauri/src/agent_commands.rs` |
| Agent loop | `src-tauri/src/agent/core.rs` |
| LLM provider adapters | `src-tauri/src/agent/llm.rs` |
| Built-in agent tools and path safety | `src-tauri/src/agent/tools.rs` |
| Lua extension loading/execution | `src-tauri/src/agent/lua_extensions.rs`, `src-tauri/src/agent/lua_runtime.rs` |
| Extension package/signature verification | `src-tauri/src/extensions.rs` |

## Data Model and Storage

Projects are file-first. SQLite is an index/cache and can be rebuilt from files.

```text
my-project/
  project.yaml
  entities/
    *.yaml
  sections/
    *.md
  .storyide/
    index.db
```

- Source of truth: files on disk
- Indexed/cache layer: `index.db`
- Chat conversations/messages: SQLite tables `chat_conversations` and `chat_messages`
- `.storyide` is a legacy internal folder name kept for compatibility; it is not a product positioning statement

## Agent Runtime (Native Rust)

The agent stack is in `src-tauri/src/agent/`.

The runtime uses a tool-calling loop: the LLM receives project/user context, decides when to call tools, consumes tool results, and iterates until a final response is produced.

- Providers: OpenAI, Claude, OpenRouter, Ollama
- Built-in tools: `read_file`, `write_file`, `append_file`, `delete_file`, `list_dir`, `glob`, `grep`, `run_shell`
- Tool approval modes: `auto_approve`, `approve_dangerous`, `approve_writes`, `approve_all`, `dry_run`
- Session/audit support and health checks are built-in

Key command endpoints:

- `run_native_agent`
- `respond_tool_approval`
- `cancel_agent_task`
- `run_agent_health_check`

## Extension System

The current in-app extension runtime is Lua-based and wired through the native Rust extension registry.

Mental model: extensions are Lua scripts that register tools and lifecycle hooks; those hooks/tools execute inside the same native agent environment and interact through the same guarded APIs and permission model used by core features.

- Example Lua extensions: `examples/*-lua/`
- Built-in marketplace content: `marketplace/extensions/`
- Auto-load path at runtime: app data `extensions/` directory (see `src/services/NativeExtensionService.ts`)

Packaging/signing helpers:

- `scripts/generate-keypair.cjs`
- `scripts/sign-extension.cjs`
- `scripts/package-extensions.cjs`

## Testing and Quality

Run these before opening a PR:

```bash
npm run test
npm run rust:test
npm run rust:fmt
npm run rust:clippy
```

Optional local checks:

```bash
npm run lint
npx tsc --noEmit
```

## Security Boundaries

- Workspace path enforcement for agent tools
- Sensitive file blocking and symlink checks in tool layer
- Tool-risk-based approval workflow before execution
- Extension signature verification and trusted publisher checks

Details:

- `SECURITY.md`
- `docs/extension-signing.md`

## Stable vs In Flux

### Stable

- File-first project structure (`project.yaml`, `entities/*.yaml`, `sections/*.md`)
- Core project open/save flows
- Native Rust agent chat loop with multi-provider support
- Built-in tool execution and approval modes
- Lua extension loading and execution paths

### In Flux

- UX polish and interaction details in sidebar/panels
- Extension ecosystem docs and example consistency (legacy manifests still present)
- Lint/clippy hygiene and codebase-wide cleanup
- Packaging/distribution workflows beyond local/dev channels

## Where Help Is Needed

If you want to contribute quickly, high-leverage areas include:

- Frontend reliability and UX polish in project/chat flows
- Test coverage for app and service layers
- Clippy/lint cleanup with behavior-preserving refactors
- Extension developer experience and docs alignment
- Security hardening and audit/reporting ergonomics

Check the repository issue tracker for labeled onboarding tasks (for example `good first issue`) and then follow `CONTRIBUTING.md`.

## Documentation

- `CONTRIBUTING.md`
- `docs/extension-development.md`
- `docs/extension-signing.md`
- `SECURITY.md`

## License

MIT. See `LICENSE`.
