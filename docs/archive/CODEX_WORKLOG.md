# Codex Work Log

Purpose: capture all changes made during this assistant session so far, in one place.

## Entity API (TypeScript)
- `src/services/EntityAPIService.ts`: new entity API layer with read, write, batch, tag, and listener operations.
- `src/services/EntityAPIService.test.ts`: tests for Entity API read/write, tags, listeners, and edge cases (Vitest).
- `src/services/ProjectService.ts`: added getter to expose the Entity API instance.

## Extension API and permissions
- `src/lib/extension-api.ts`: added Entity API types and `permissions.entityApi` granularity (read/write/tags).
- `src/services/ExtensionService.ts`: injected `entityApi` into extension context with permission gating.
- `examples/hello-extension/manifest.json`: added `entityApi.read` to permissions.

## Python backend: entity tools + API support
- `open-agent/src/local_agent/entity_api.py`: new entity API for YAML/frontmatter parsing, entity CRUD, tag edits, and relationships.
- `open-agent/src/local_agent/agent.py`: new `entity_*` tools exposed to extensions, plus workspace root plumbing.
- `open-agent/src/local_agent/extension_context.py`: entity API methods added with permission checks.
- `open-agent/src/local_agent/extension_manager.py`: extension path tracking and entity API dispatch support.
- `open-agent/src/local_agent/http_service.py`: `/workspace` endpoint added to set workspace root.
- `open-agent/src/local_agent/api.py`: `AgentService.set_workspace_root` and forwarding to agent.
- `open-agent/src/local_agent/runtime.py`: runtime setter for workspace root.
- `open-agent/pyproject.toml`: added `pyyaml` dependency.
- `open-agent/README.md`: documented `/workspace` and entity tools.

## Python tests follow-up
- `open-agent/src/local_agent/extension_manager.py`: normalize `workspace_root` to a `Path` in `__init__` to fix Windows test failures where a string path was passed.

## Workspace root handshake
- `src-tauri/src/lib.rs`: new Tauri command `set_workspace_root`.
- `src/services/AgentClient.ts`: added `setWorkspaceRoot` RPC.
- `src/lib/store.ts`: call `setWorkspaceRoot` on project open/create.

## Bundled extensions (examples + packages)
- `examples/entity-glossary/`: new extension that emits a Markdown glossary from entities.
- `examples/tag-manager/`: new extension with add/remove tag tools and a tag overview.
- `examples/section-outline/`: new extension that generates an outline from section files.
- `examples/entity-stats/`: new extension that summarizes entity counts by type.
- `examples/starter-extension/`: rebuilt template with updated manifest, tools, hooks, plus UI panel/settings stubs in `extension.ts` and `panel.tsx`.
- `marketplace/extensions/*.vsext`: packaged bundles for all bundled extensions.
- `marketplace/extensions/marketplace.json`: added bundled entries and sizes for new extensions.
- `marketplace/README.md`: documented bundled extensions and packaging script.
- `README.md`: referenced the new starter extension template.

## Bundled auto-install on startup
- `src/services/ExtensionService.ts`: `ensureBundledExtensions` reads `marketplace.json`, compares versions, and installs/upgrades bundles on launch.
- `src/lib/store.ts`: calls `ensureBundledExtensions` before loading global extensions.

## Extensions marketplace visibility fixes
- `src/services/ExtensionService.ts`: load marketplace index from Tauri resource directory and fix base path handling for Windows.
- `src/components/Sidebar/ExtensionsPanel.tsx`: load marketplace from Tauri resource directory and use `exists` for `.vsext` lookup.
- `src-tauri/tauri.conf.json`: bundle `marketplace/extensions/*` as app resources.
- `src-tauri/capabilities/default.json`: allow read/exists for `$RESOURCE/**` so the UI can access bundled marketplace assets.
- `src/services/ExtensionService.ts`: add dev fallback paths based on `executableDir` so marketplace is discoverable in Tauri dev.
- `src/components/Sidebar/ExtensionsPanel.tsx`: add dev fallback paths based on `executableDir` for marketplace and `.vsext` lookup.
- `src-tauri/src/lib.rs`: add `get_app_cwd` command for dev path resolution.
- `src/services/ExtensionService.ts`: add marketplace fallback paths based on app CWD and log tried paths when not found.
- `src/components/Sidebar/ExtensionsPanel.tsx`: add marketplace fallback paths based on app CWD, log tried paths, and add "Open Extensions Folder" button with real path display.

## Extension backend connectivity fixes
- `src/services/ExtensionService.ts`: route backend HTTP calls through `http://localhost` via a shared base URL helper.
- `src/components/Sidebar/ChatPanel.tsx`: align WebSocket URL to `ws://localhost` for backend status updates.
- `open-agent/src/local_agent/http_service.py`: add CORS middleware for localhost/127.0.0.1/tauri origins.

## Packaging + tests
- `scripts/package-extensions.cjs`: script to build `.vsext` bundles from `examples/`.
- `src/services/BundledExtensions.test.ts`: verifies bundled `.vsext` manifests match `marketplace.json` IDs and versions.
- `package.json` and `package-lock.json`: added `fflate` as a dev dependency (used by packaging and tests).

## Tests and commands executed
- `npm test -- EntityAPIService.test.ts`
- `npm test -- ExtensionService.test.ts`
- `node scripts/package-extensions.cjs`
- `npm test -- BundledExtensions.test.ts`
- `npm test`
- `python3 -m pytest open-agent/tests` (failed: pytest capture FileNotFoundError; collected 0 items)
- `python3 -m unittest discover -s open-agent/tests` (failed: `local_agent` not on path)
- `PYTHONPATH=open-agent/src python3 -m unittest discover -s open-agent/tests` (failed: missing `openai` dependency)
- `python3 -m pip install -e open-agent` (blocked: externally managed environment)
- `python3 -m venv /tmp/open-agent-venv` (failed: missing `python3-venv`)

## Notes
- Python package install was attempted earlier but failed due to missing Python/venv in this environment.
- Bundled extension archive permissions were adjusted to standard file perms after packaging.
