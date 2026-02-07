# Contributing to VS Write

Thank you for your interest in contributing to VS Write! This guide will help you get started.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Development Setup](#development-setup)
- [Project Structure](#project-structure)
- [Development Workflow](#development-workflow)
- [Pull Request Process](#pull-request-process)
- [Code Style](#code-style)
- [Testing](#testing)
- [Documentation](#documentation)

## Code of Conduct

Please read and follow our [Code of Conduct](CODE_OF_CONDUCT.md). We are committed to providing a welcoming and inclusive environment for all contributors.

## Development Setup

### Prerequisites

- **Node.js** 18+ and npm 9+
- **Rust** 1.77+ (install via [rustup](https://rustup.rs/))

The repository includes `rust-toolchain.toml`, which ensures required Rust components (`rustfmt`, `clippy`) are available.

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/your-org/vs-write.git
   cd vs-write
   ```

2. **Install frontend dependencies**
   ```bash
   npm install
   ```

3. **Run in development mode**
   ```bash
   npm run tauri:dev
   ```

This will start:
- Vite dev server for hot-reloading
- Tauri application with the Rust backend

### Quick Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Web-only development (limited features) |
| `npm run tauri:dev` | Full desktop app development |
| `npm run build` | Build web assets |
| `npm run tauri:build` | Build production desktop app |
| `npm run lint` | Run ESLint |
| `npm run rust:fmt` | Format Rust code |
| `npm run rust:test` | Run Rust tests |
| `npm run rust:clippy` | Run Rust lints |
| `npx tsc --noEmit` | TypeScript type checking |

## Project Structure

```
vs-write/
├── src/                    # React frontend
│   ├── components/         # UI components
│   ├── services/           # Business logic (ProjectService, etc.)
│   ├── lib/               # Utilities, schemas, store
│   └── hooks/             # React hooks
├── src-tauri/             # Tauri/Rust backend
│   ├── src/
│   │   ├── agent/         # Native Rust agent
│   │   │   ├── core.rs    # Agent loop
│   │   │   ├── llm.rs     # LLM providers
│   │   │   ├── tools.rs   # Tool implementations
│   │   │   └── lua_*.rs   # Lua extension system
│   │   └── lib.rs         # Tauri app entry
│   └── Cargo.toml
├── examples/              # Extension examples
└── docs/                  # Documentation
```

## Development Workflow

### 1. Create a Branch

```bash
git checkout -b feature/your-feature-name
# or
git checkout -b fix/issue-description
```

### 2. Make Changes

- Follow the [code style](#code-style) guidelines
- Write tests for new functionality
- Update documentation as needed

### 3. Test Your Changes

```bash
# Frontend type checking
npx tsc --noEmit

# Lint
npm run lint

# Rust formatting + tests + linting
npm run rust:fmt
npm run rust:test
npm run rust:clippy
```

### 4. Commit Your Changes

We use conventional commits:

```bash
git commit -m "feat: add dark mode toggle"
git commit -m "fix: resolve file watcher memory leak"
git commit -m "docs: update extension development guide"
```

Prefixes:
- `feat:` New feature
- `fix:` Bug fix
- `docs:` Documentation
- `refactor:` Code refactoring
- `test:` Adding tests
- `chore:` Maintenance

### 5. Submit a Pull Request

Push your branch and create a PR. Fill out the template with:
- Description of changes
- Related issue (if any)
- Screenshots (for UI changes)
- Testing performed

## Pull Request Process

1. **Review Required** - All PRs require at least one approval
2. **CI Must Pass** - Linting, type checking, and tests
3. **No Conflicts** - Rebase on main if needed
4. **Documentation** - Update docs for user-facing changes

## Code Style

### TypeScript/React

- Use **ESLint** configuration (run `npm run lint`)
- Prefer functional components with hooks
- Use TypeScript strict mode
- Use Zod for runtime validation

### Rust

- Use **rustfmt** (run `npm run rust:fmt` or `cargo fmt`)
- Follow Rust naming conventions
- Add doc comments for public APIs
- Handle errors explicitly (no `unwrap()` in production code)

## Testing

### Frontend

```bash
# Run frontend tests
npm test
```

### Rust

```bash
npm run rust:test
```

## Documentation

- Update README.md for user-facing features
- Add/update docs in `docs/` for detailed guides
- Add JSDoc comments for exported functions
- Add Rust doc comments (`///`) for public APIs

## Areas for Contribution

We especially welcome contributions in these areas:

- **Frontend tests** - Unit and integration tests
- **Documentation** - User guides, tutorials
- **Accessibility** - ARIA labels, keyboard navigation
- **Performance** - Profiling and optimization
- **Extensions** - Example Lua extensions
- **Bug fixes** - See issues labeled `good first issue`

## Questions?

- Open a [Discussion](https://github.com/your-org/vs-write/discussions)
- Join our community chat
- Read the [documentation](docs/)

Thank you for contributing!
