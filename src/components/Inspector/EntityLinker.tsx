import { useMemo } from 'react';
import { useStoryStore } from '../../lib/store';
import type { EntityType, Section } from '../../lib/schemas';

interface Props {
  sectionId: string;
}

export function EntityLinker({ sectionId }: Props) {
  const project = useStoryStore((s) => s.project);
  const addTag = useStoryStore((s) => s.addTag);
  const removeTag = useStoryStore((s) => s.removeTag);
  const selectionRange = useStoryStore((s) => s.selectionRange);

  const section = project.sections.find((s) => s.id === sectionId);

  const grouped = project.entities.reduce((acc, entity) => {
    if (!acc[entity.type]) acc[entity.type] = [];
    acc[entity.type].push(entity);
    return acc;
  }, {} as Record<EntityType, typeof project.entities>);

  const tagsByEntity = useMemo(() => {
    if (!section) return {};
    const map: Record<string, Section['tags']> = {};
    section.tags.forEach((t) => {
      if (!map[t.entityId]) map[t.entityId] = [];
      map[t.entityId].push(t);
    });
    return map;
  }, [section]);

  const sectionText = section?.content ?? '';
  const hasSelection = Boolean(selectionRange && selectionRange.from !== selectionRange.to);
  const selectionLength = hasSelection && selectionRange ? selectionRange.to - selectionRange.from : 0;
  const selectionPreview =
    hasSelection && selectionRange ? formatSnippet(sectionText, selectionRange.from, selectionRange.to) : null;

  const handleTagSelection = (entityId: string) => {
    if (!selectionRange || !hasSelection) return;
    addTag(sectionId, entityId, selectionRange.from, selectionRange.to);
  };

  if (!section) return null;

  if (project.entities.length === 0) {
    return (
      <div className="entity-linker empty">
        <p>No entities defined yet.</p>
        <p className="hint">Create characters, locations, or rules in the left sidebar to tag them here.</p>
      </div>
    );
  }

  return (
    <div className="entity-linker">
      <p className="linker-hint">
        Highlight text in the editor, then tag it to an entity. The Agent uses tags to track continuity.
      </p>
      <div className="entity-selection">
        {hasSelection && selectionPreview ? (
          <>
            <div className="entity-selection-meta">
              {selectionLength} {selectionLength === 1 ? 'character' : 'characters'} selected
            </div>
            <code className="entity-selection-snippet">{selectionPreview}</code>
          </>
        ) : (
          <p className="entity-selection-empty">Select a passage in the section to enable tagging.</p>
        )}
      </div>

      {Object.entries(grouped).map(([type, entities]) => (
        <div key={type} className="entity-group">
          <h4 className="group-header">{type}s</h4>
          {entities.map((entity) => {
            const entityTags = tagsByEntity[entity.id] || [];
            return (
              <div key={entity.id} className="entity-tag-block">
                <div className="entity-tag-header">
                  <span className="entity-label">{entity.name}</span>
                  <div className="entity-tag-actions">
                    <button
                      onClick={() => handleTagSelection(entity.id)}
                      disabled={!hasSelection}
                      title={hasSelection ? 'Tag selected text' : 'Select text in the editor to enable tagging'}
                    >
                      Tag selection
                    </button>
                  </div>
                </div>
                {entityTags.length === 0 && <p className="empty-hint">No tags yet</p>}
                {entityTags.map((tag) => (
                  <div key={tag.id} className="tag-row">
                    <code className="tag-snippet">
                      {formatSnippet(sectionText, tag.from, tag.to)}
                    </code>
                    <button className="remove-tag-btn" onClick={() => removeTag(sectionId, tag.id)}>
                      ×
                    </button>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function formatSnippet(text: string, from: number, to: number): string {
  const slice = text.slice(from, to).trim();
  if (!slice) return '(empty)';
  return slice.length > 80 ? `${slice.slice(0, 77)}...` : slice;
}
