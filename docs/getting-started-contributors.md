# Getting Started for Contributors

Set up your development environment for VS Write.

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Node.js | 18+ | [nodejs.org](https://nodejs.org) |
| Rust | 1.77+ | [rustup.rs](https://rustup.rs) |
| Python | 3.11+ | [python.org](https://python.org) |

## Setup

### 1. Clone and Install

```bash
git clone https://github.com/your-org/vs-write.git
cd vs-write
npm install
```

### 2. Python Backend

```bash
cd open-agent
pip install -e .
cd ..
```

### 3. Run Development Mode

```bash
npm run tauri:dev
```

This starts:
- Vite dev server (hot reload)
- Tauri app (Rust)
- Python agent (auto-started)

## Commands

| Command | Description |
|---------|-------------|
| `npm run tauri:dev` | Full app development |
| `npm run dev` | Web-only (limited) |
| `npm run build` | Build web assets |
| `npm run tauri:build` | Production build |
| `npm run lint` | ESLint |
| `npx tsc --noEmit` | Type check |
| `cargo test` | Rust tests (in src-tauri/) |
| `pytest` | Python tests (in open-agent/) |

## Project Structure

```
vs-write/
├── src/                 # React frontend
│   ├── components/      # UI components
│   ├── services/        # ProjectService, etc.
│   └── lib/            # Store, schemas, utils
├── src-tauri/          # Rust/Tauri
│   └── src/agent/      # Native agent
├── open-agent/         # Python backend
└── examples/           # Extension examples
```

## Key Files

| File | Purpose |
|------|---------|
| `src/lib/store.ts` | Zustand state |
| `src/services/ProjectService.ts` | File I/O orchestration |
| `src-tauri/src/agent/llm.rs` | LLM providers |
| `src-tauri/src/agent/tools.rs` | Agent tools |
| `open-agent/src/local_agent/agent.py` | Python agent |

## Making Changes

### Frontend (React/TypeScript)

```bash
# Edit src/ files
# Hot reload in browser

# Type check
npx tsc --noEmit

# Lint
npm run lint
```

### Rust (Tauri)

```bash
cd src-tauri

# Edit src/ files
# App restarts automatically

# Test
cargo test

# Format
cargo fmt
```

### Python (Backend)

```bash
cd open-agent

# Edit src/local_agent/ files
# Restart app to see changes

# Test
pytest tests/ -v
```

## Common Tasks

### Add a Tauri Command

1. Add function in `src-tauri/src/lib.rs` or separate module
2. Register in `invoke_handler![]`
3. Call from frontend: `await invoke('command_name', { args })`

### Add a Tool to Rust Agent

1. Add schema in `src-tauri/src/agent/tools.rs`
2. Add dispatch case
3. Implement handler function

### Add a Frontend Component

1. Create in `src/components/`
2. Use Zustand store via hooks
3. Follow existing patterns

## Troubleshooting

**App won't start?**
- Check Rust is installed: `rustc --version`
- Check Node: `node --version`
- Try `npm install` again

**Python errors?**
- Check Python 3.11+: `python --version`
- Reinstall: `cd open-agent && pip install -e .`

**Type errors?**
- Run `npx tsc --noEmit` to see all errors
- Check imports and types

## Next Steps

- Read [CONTRIBUTING.md](../CONTRIBUTING.md)
- Browse open issues
- Check `examples/` for extension patterns
- Ask questions in Discussions
