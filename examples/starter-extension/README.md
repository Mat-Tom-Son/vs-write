# Starter Extension

Template extension that demonstrates:
- Entity API usage
- Tag helpers
- Lifecycle hooks
- UI panel stub and settings schema

## Permissions
- `entityApi.read`
- `entityApi.tags`
- `settings`

## Tools
- `list_entities` (list entities by type)
- `tag_range` (add a tag to a section)

## Hooks
- `onProjectOpen` (logs a simple message)

## UI Panel
`panel.tsx` and `extension.ts` include a sample sidebar panel definition. The current runtime loads `manifest.json` only, so treat these as a forward-looking template.

## Example Prompt
```
Use list_entities for character entities.
```
