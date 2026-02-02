# VS Write

A desktop editor with entity tracking and AI-powered consistency checking. Built for writers, researchers, and content creators who want to manage complex documents without losing track of key concepts, claims, and narrative details.

## What It Does

VS Write treats your content as structured data. You write in sections (scenes, chapters, papers), define entities (characters, claims, rules, concepts), and tag references inline. The editor tracks relationships and uses LLMs to catch inconsistencies as you write.

This is a working desktop application, not a prototype.

## Tech Stack

**Frontend**
- React 19 + TypeScript
- Vite 7 (build tooling)
- CodeMirror 6 (editor)
- Zustand + Immer (state)
- Zod (validation)
- Tailwind CSS (styling)

**Desktop Runtime**
- Tauri 2 (Rust-based native wrapper)
- Native Rust agent (in-process, no separate backend)
- SQLite (via tauri-plugin-sql)
- File system access (via tauri-plugin-fs)

**AI Integration**
- OpenAI API
- Anthropic Claude API
- Ollama (local models)
- OpenRouter (model aggregator)

## Features

### Project Management
- Create and open projects from directories
- Auto-save with hash-based change detection (only writes modified files)
- File watcher detects external changes and prompts reload
- Dirty state tracking with keyboard shortcuts (Ctrl+S, Ctrl+O, Ctrl+N)

### Entity System
- Six entity types: `character`, `location`, `concept`, `item`, `rule`, `custom`
- Custom type labels for domain-specific entities
- Entity descriptions serve as "DNA" for AI consistency checks
- Alias support for alternative names
- Persisted as YAML files in `entities/` directory

### Section Editor
- CodeMirror-based Markdown editor with syntax highlighting
- Multi-tab interface for editing multiple sections or files
- Drag-and-drop section reordering
- Section alignment options (left, center, right)
- Formatting toolbar (bold, italic, headings, lists)
- Word count tracking per section

### Entity Linking
- Tag inline text ranges to specific entities
- Many-to-many relationships between sections and entities
- Visual highlighting of tagged text in editor
- Quick entity browser in inspector panel
- Tag snippets show context (80-char preview)

### Consistency Checking
- LLM-powered diagnostics using OpenAI, Claude, Ollama, or OpenRouter
- Analyzes entity "DNA" (description) against narrative history
- Flags contradictions with severity levels (info, warning, critical)
- Shows suggestions and highlights relevant text
- Checks all entities linked to current section

### Data Persistence
- File system as source of truth
- SQLite database as index/cache layer
- Sections stored as Markdown with YAML frontmatter
- Entities stored as individual YAML files
- Project metadata in `project.yaml`

### Search & Indexing
- Full-text search via SQLite FTS5 virtual tables
- Automatic index rebuilds on project load
- Relationship tracking (section-entity links)
- Content previews and word counts cached in database

### Extension System

VS Write supports extensions via Lua scripts (recommended) or Python modules (legacy).

**What Works Now:**
- **Global Extensions**: Installed once, available across all projects
- **Marketplace Browser**: Install extensions from built-in local marketplace
- **Custom AI Tools**: Lua-based tools that extend the AI agent's capabilities
- **Lifecycle Hooks**: Full support - onActivate, onDeactivate, onProjectOpen, onProjectClose, onSectionSave, onSectionDelete, onEntityChange
- **Permission System**: Enforced for settings, tools, filesystem, entityApi
- **Extension Settings**: Persistent localStorage storage with JSON Schema-driven settings UI
- **Entity API**: Full read/write access to entities, sections, and tags (with permission checking)
- **Manifest Validation**: Comprehensive Zod schemas validate extension manifests

**What's Planned:**
- **UI Components**: Custom sidebar panels and file type viewers
- **LLM Provider Access**: Allow extensions to use the AI agent
- **Extension Dependencies**: Version constraints and dependency resolution
- **Online Marketplace**: Remote repository, search, updates, ratings

#### Installing Extensions
1. Click the **Extensions** icon (puzzle piece) in the activity bar
2. Browse the **Marketplace** tab for available extensions
3. Click **Install** or use **Install from File** to add `.vsext` packages
4. Extensions are stored globally in your app data directory

#### Creating Extensions
Extensions are packaged as `.vsext` files (ZIP archives) containing:
- `manifest.json` - Metadata and configuration
- `tools.lua` - Lua tool implementations (recommended)
- `hooks.lua` - Lifecycle hook handlers (optional)
- Optional components, assets, and documentation

See `examples/hello-extension-lua/` for a working Lua reference, or `examples/starter-extension-lua/` for a more complete template.

#### Entity API (Extensions)
Extensions can use the Entity API to read/write entities, sections, and tags without touching storage directly.

Add permissions in `manifest.json`:
```json
{
  "permissions": {
    "entityApi": {
      "read": true,
      "write": true,
      "tags": true
    }
  }
}
```

Access via `context.entityApi`:
- `getById`, `listByType`, `search`, `getRelationships`
- `create`, `update`, `delete`
- `addTag`, `removeTag`
- `getEntitiesByIds`, `getTagsBySection`

#### Extension Limitations
- **Extensions require app restart** - No hot reload support
- **No dependency checking** - Cannot enforce extension version constraints
- **No signature verification** - Extensions are trusted

**For Extension Developers:**
- Prefer Lua over Python for new extensions
- Test your extension with `npm run tauri:dev` to verify tools appear in the AI agent chat
- See `examples/hello-extension-lua/` for a working reference

## Architecture

### Service Layer
The application uses a three-tier service architecture:

**ProjectService** (orchestration)
- Coordinates FileService and DatabaseService
- Manages dirty tracking and change detection
- Implements file watching for external changes
- Exposes project lifecycle methods (create, open, save, close)

**FileService** (I/O layer)
- Handles all file system operations
- Reads/writes YAML entities and Markdown sections
- Manages project directory structure
- Validates file formats using Zod schemas

**DatabaseService** (index layer)
- SQLite cache for fast queries
- Full-text search indexing
- Relationship tracking (many-to-many section/entity links)
- Tag position storage for inline references
- Conversation and message history for chat

**AgentService** (AI integration)
- Native Rust implementation running in-process
- Four provider implementations: OpenAI, Claude, Ollama, OpenRouter
- Tool-calling agent with file operations and shell access
- Consistency checking and entity analysis

### Chat Agent
The sidebar includes an AI chat agent with:
- **Real-time streaming**: Tool calls appear as they execute, not after completion
- **Tauri IPC communication**: Native Rust agent communicates via invoke/event system
- **Project context injection**: Agent receives full project awareness on each message:
  - Project name and synopsis
  - All sections by title and order
  - All entities grouped by type
  - File structure with paths
- **Custom system prompts**: Three-layer hierarchy (project -> app -> default)
- **Template variables**: `{{project.name}}`, `{{entitySummary}}`, `{{sectionList}}`, etc.
- **Built-in tools**: read_file, write_file, delete_file, append_file, list_dir, glob, grep, run_shell
- **Conversation persistence**: Chat history stored in SQLite

### Data Flow
1. User edits content in Zustand store (in-memory)
2. Store marks changed entities/sections as dirty
3. On save, ProjectService computes content hashes (xxhash32)
4. FileService writes only modified files to disk
5. DatabaseService updates index entries with new hashes
6. File watcher ignores self-written files (5-second debounce)

### State Management
Zustand store with Immer middleware for immutable updates. Explicit separation of state and actions. Subscription system for external components (file watcher callbacks, diagnostics updates).

### Schema Validation
All data validated with Zod on serialization/deserialization. Separate schemas for in-memory format and file format. Extensible metadata fields using `catchall(z.unknown())` for custom data.

## Extensibility

### Current Extension Points
- **LLMProvider interface**: Four built-in providers (OpenAI, Claude, Ollama, OpenRouter)
- **Lua extension system**: Add custom tools and lifecycle hooks
- **Extensible metadata**: Entity and section schemas accept arbitrary metadata fields
- **Service interfaces**: FileService, DatabaseService, AgentService can be wrapped or extended

### Design Patterns Supporting Extensions
- Strategy pattern (LLMProvider implementations)
- Event-driven pattern (Tauri IPC events)
- Dependency injection (services passed to ProjectService)
- Layered architecture (clear boundaries between file, database, and orchestration)
- Factory functions (createEntity, createSection)

## Getting Started

### Prerequisites
- Node.js 18+ (for development)
- Rust toolchain (for Tauri desktop builds)

### Installation
```bash
cd story-ide
npm install
```

### Development (Browser Preview)
```bash
npm run dev
```
Opens Vite dev server at http://localhost:5173

### Development (Desktop App)
```bash
npm run tauri:dev
```
Launches Tauri shell pointing at Vite dev server. Hot reload works for both frontend and Rust changes.

### Production Build
```bash
npm run tauri:build
```
Creates desktop bundle in `src-tauri/target/release/bundle/`. Platform-specific formats (.exe on Windows, .app on macOS, .AppImage on Linux).

### Configuration

**Settings UI (Recommended)**

Open Settings from the gear icon in the sidebar to configure:
- LLM provider (OpenAI, Claude, Ollama, or OpenRouter)
- API keys
- Model selection
- Temperature and other parameters

Settings are stored in localStorage and persist across sessions.

**Environment Variables (Fallback)**

Create `.env` in the project root for default values:

```env
VITE_LLM_PROVIDER=ollama   # or "openai", "claude", "openrouter"
VITE_OPENAI_API_KEY=sk-...
VITE_OPENAI_BASE_URL=https://api.openai.com/v1
VITE_OPENAI_MODEL=gpt-4o-mini
VITE_ANTHROPIC_API_KEY=sk-ant-...
VITE_OLLAMA_MODEL=llama3.2
VITE_OPENROUTER_API_KEY=sk-or-...
```

For local models via LM Studio or similar:
```env
VITE_LLM_PROVIDER=openai
VITE_OPENAI_BASE_URL=http://localhost:1234/v1
VITE_OPENAI_MODEL=your-local-model-id
```

## Project Structure

### Directory Layout
```
project-root/
  project.yaml              # Project metadata
  entities/
    john-doe-abc12.yaml     # Entity definitions
    central-station-xyz78.yaml
  sections/
    001-chapter-1-def34.md  # Markdown with YAML frontmatter
    002-chapter-2-ghi56.md
  .storyide/
    index.db                # SQLite cache/index
```

### File Formats

**project.yaml**
```yaml
id: uuid
name: string
version: string (semver)
meta:
  createdAt: ISO8601
  modifiedAt: ISO8601
  author?: string
  synopsis?: string
```

**entities/[slug]-[id].yaml**
```yaml
id: uuid
name: string
type: character|location|concept|item|rule|custom
description: string
aliases: [string]
metadata:
  customLabel?: string
  # extensible: any additional fields
```

**sections/[order]-[slug]-[id].md**
```markdown
---
id: uuid
title: string
order: number
tags:
  - id: uuid
    entityId: uuid
    from: number
    to: number
entityIds: [uuid]
alignment: left|center|right
parentId?: uuid
collapsed: boolean
---

# Section content in Markdown

Your narrative text here...
```

### Database Schema (SQLite)
Tables for indexing and relationships:
- `project`: Metadata cache
- `entities`: Entity index with file paths and hashes
- `sections`: Section index with word count and preview
- `section_entities`: Many-to-many relationships
- `entity_tags`: Inline tag positions
- `diagnostics`: Linter output (ephemeral, not in files)
- `chat_conversations`: Chat session tracking
- `chat_messages`: Message history with tool calls
- `sections_fts`: Full-text search virtual table
- `schema_info`: Database version tracking

## Roadmap

### Distribution
- Packaged .exe and .msi installers for Windows
- .dmg for macOS
- .AppImage/.deb for Linux
- Auto-update mechanism via Tauri updater

### Enhanced AI Integration
- Conversation management UI improvements
- Custom prompt templates
- Fine-tuned models for narrative analysis

### Export & Publishing
- PDF export with formatting
- EPUB generation
- HTML static site generation
- Manuscript formatting (Shunn standard, screenplay formats)

### Extension System
- UI component extensions (custom panels, viewers)
- Online marketplace with search and ratings
- Extension dependency resolution

## Development Notes

### Key Dependencies
- `@tauri-apps/api`: IPC bridge to Rust backend
- `@tauri-apps/plugin-fs`: File system access with permissions
- `@tauri-apps/plugin-sql`: SQLite database driver
- `@codemirror/view`: Editor framework
- `zustand`: State management with middleware support
- `zod`: Runtime type validation
- `hash-wasm`: Fast content hashing (xxhash32)
- `js-yaml`: YAML parsing and serialization
- `gray-matter`: Markdown frontmatter parsing

### Key Source Files
| File | Purpose |
|------|---------|
| `src/lib/store.ts` | Global Zustand store - all app state |
| `src/services/ProjectService.ts` | Orchestrates file I/O and database sync |
| `src/lib/schemas.ts` | Zod schemas for in-memory data structures |
| `src/lib/schemas-file.ts` | Zod schemas for file formats |
| `src/lib/prompt-resolver.ts` | 3-layer prompt hierarchy with templates |
| `src/lib/app-settings.ts` | App-level settings (localStorage) |
| `src/components/Sidebar/NativeAgentPanel.tsx` | Chat UI with Tauri IPC |
| `src-tauri/src/agent_commands.rs` | Tauri commands for agent |
| `src-tauri/src/agent/tools.rs` | Built-in tool implementations |
| `src-tauri/src/lib.rs` | Tauri app setup |

### Tauri Capabilities
Enabled in `src-tauri/capabilities/default.json`:
- File system read/write (scoped to project directory)
- SQLite database access
- File dialog for open/save operations
- Window management

### Build Targets
- Browser: Standard web app via Vite (limited features)
- Desktop: Native app via Tauri (Rust + WebView)
- Both share the same TypeScript codebase
- Tauri-specific features gracefully degrade in browser mode

## License

MIT License - see LICENSE file for details.

## Contributing

Contributions are welcome! Please read our contributing guidelines before submitting pull requests.

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request
