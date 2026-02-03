import { useMemo, useState } from 'react';
import { confirm as confirmDialog } from '@tauri-apps/plugin-dialog';
import { useStoryStore } from '../../lib/store';
import type { Entity, EntityType } from '../../lib/schemas';
import { EntityLinker } from '../Inspector/EntityLinker';

const PRESET_TYPES: EntityType[] = ['fact', 'rule', 'concept', 'relationship', 'event'];
const typeLabel = (type: EntityType, customLabel?: string) =>
  type === 'custom' ? customLabel || 'Custom' : `${type[0].toUpperCase()}${type.slice(1)}`;

function EntityItem({ entity, isSelected, onSelect }: { entity: Entity; isSelected: boolean; onSelect: () => void }) {
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(entity.name);
  const [editDesc, setEditDesc] = useState(entity.description);
  const [editType, setEditType] = useState<EntityType>(entity.type);
  const [editCustom, setEditCustom] = useState(entity.metadata.customLabel ?? '');
  const { updateEntity, deleteEntity } = useStoryStore();

  const typeText = typeLabel(entity.type, entity.metadata.customLabel);

  const handleSave = () => {
    updateEntity(entity.id, {
      name: editName,
      description: editDesc,
      type: editType,
      metadata: { ...entity.metadata, customLabel: editType === 'custom' ? editCustom || 'Custom' : undefined },
    });
    setIsEditing(false);
  };

  if (isEditing) {
    return (
      <div className="entity-edit-form">
        <input
          type="text"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            placeholder="Name"
          />
          <label className="field-label">Type</label>
          <select value={editType} onChange={(e) => setEditType(e.target.value as EntityType)}>
            {PRESET_TYPES.map((type) => (
              <option key={type} value={type}>
                {typeLabel(type)}
              </option>
            ))}
            <option value="custom">Custom type</option>
          </select>
          {editType === 'custom' && (
          <input
            type="text"
            value={editCustom}
            onChange={(e) => setEditCustom(e.target.value)}
            placeholder="Custom type label (e.g., Faction, Magic System)"
          />
        )}
        <label className="field-label">Description</label>
        <textarea
          value={editDesc}
          onChange={(e) => setEditDesc(e.target.value)}
          placeholder="Evidence, context, or details"
          rows={3}
        />
        <div className="entity-edit-actions">
          <button onClick={handleSave}>Save</button>
          <button onClick={() => setIsEditing(false)}>Cancel</button>
        </div>
      </div>
    );
  }

  return (
    <div className={`entity-item ${isSelected ? 'selected' : ''}`} onClick={onSelect}>
      <div className="entity-info">
        <span className="entity-name">{entity.name}</span>
        <span className="entity-type-badge">{typeText}</span>
        {entity.description && (
          <span className="entity-desc">
            {entity.description.length > 50
              ? `${entity.description.slice(0, 50)}...`
              : entity.description}
          </span>
        )}
      </div>
      <div className="entity-actions">
        <button
          className="entity-action-btn"
          onClick={(e) => {
            e.stopPropagation();
            setIsEditing(true);
          }}
          title="Edit entity"
        >
          Edit
        </button>
        <button
          className="entity-action-btn"
          onClick={async (e) => {
            e.stopPropagation();
            const confirmed = await confirmDialog(`Delete "${entity.name}"?`, {
              kind: 'warning',
              okLabel: 'Delete',
              cancelLabel: 'Cancel',
            });
            if (confirmed) {
              deleteEntity(entity.id);
            }
          }}
          title="Delete"
        >
          Delete
        </button>
      </div>
    </div>
  );
}

export function EntityPanel() {
  const { project, addEntity, openTab } = useStoryStore();
  const activeSection = useStoryStore((s) => s.activeSection());
  const [isAdding, setIsAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<EntityType>('fact');
  const [customTypeLabel, setCustomTypeLabel] = useState('');
  const [filter, setFilter] = useState<EntityType | 'all'>('all');
  const [search, setSearch] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);

  const filteredEntities = useMemo(() => {
    const byType =
      filter === 'all' ? project.entities : project.entities.filter((e) => e.type === filter);
    if (!search.trim()) return byType;
    const q = search.trim().toLowerCase();
    return byType.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        e.description.toLowerCase().includes(q) ||
        (e.metadata.customLabel || '').toLowerCase().includes(q),
    );
  }, [filter, project.entities, search]);

  const handleAdd = () => {
    if (newName.trim()) {
      const id = addEntity(newName.trim(), newType);
      if (newType === 'custom') {
        // push custom label into metadata
        useStoryStore.getState().updateEntity(id, {
          metadata: { ...(project.entities.find((e) => e.id === id)?.metadata ?? {}), customLabel: customTypeLabel || 'Custom' },
        });
      }
      setNewName('');
      setCustomTypeLabel('');
      setIsAdding(false);
    }
  };

  const selectedEntity = selectedEntityId ? project.entities.find((e) => e.id === selectedEntityId) : null;

  // Get sections where the selected entity appears
  const entitySections = useMemo(() => {
    if (!selectedEntityId) return [];
    return project.sections
      .filter((s) => s.entityIds.includes(selectedEntityId))
      .sort((a, b) => a.order - b.order);
  }, [selectedEntityId, project.sections]);

  return (
    <div className="entity-panel-container">
      <div className="entity-list-section">
        <div className="entity-filter-toggle">
          <button onClick={() => setShowFilters((v) => !v)}>
            {showFilters ? 'Hide Filters' : 'Show Filters'}
          </button>
        </div>

        {activeSection && (
          <div className="entity-linker-panel">
            <div className="entity-linker-panel-header">
              <h4>Tag "{activeSection.title}"</h4>
              <span className="entity-linker-panel-subtext">Selection tools update live as you highlight text</span>
            </div>
            <EntityLinker sectionId={activeSection.id} />
          </div>
        )}
        {showFilters && (
          <div className="entity-filters">
            <label className="filter-label">Type</label>
            <select value={filter} onChange={(e) => setFilter(e.target.value as EntityType | 'all')}>
              <option value="all">All types</option>
              {PRESET_TYPES.map((type) => (
                <option key={type} value={type}>
                  {typeLabel(type)}
                </option>
              ))}
              <option value="custom">Custom</option>
            </select>
            <label className="filter-label">Search</label>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search entities..."
              className="entity-search"
            />
          </div>
        )}

        <div className="entity-list">
          {filteredEntities.map((entity) => (
            <EntityItem
              key={entity.id}
              entity={entity}
              isSelected={selectedEntityId === entity.id}
              onSelect={() => setSelectedEntityId(entity.id)}
            />
          ))}
          {filteredEntities.length === 0 && (
            <p className="empty-hint">No {filter === 'all' ? 'entities' : `${filter}s`} yet</p>
          )}
        </div>

        {isAdding ? (
          <div className="add-entity-form">
            <select value={newType} onChange={(e) => setNewType(e.target.value as EntityType)}>
              {PRESET_TYPES.map((type) => (
                <option key={type} value={type}>
                  {typeLabel(type)}
                </option>
              ))}
              <option value="custom">Custom type</option>
            </select>
            {newType === 'custom' && (
              <input
                type="text"
                value={customTypeLabel}
                onChange={(e) => setCustomTypeLabel(e.target.value)}
                placeholder="Custom type label"
                autoFocus
              />
            )}
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
              placeholder="Name or statement..."
              autoFocus
            />
            <button onClick={handleAdd}>Add</button>
            <button onClick={() => setIsAdding(false)}>×</button>
          </div>
        ) : (
          <button className="add-entity-btn" onClick={() => setIsAdding(true)}>
            + Add Entity
          </button>
        )}
      </div>

      {selectedEntity && (
        <div className="entity-detail-section">
          <div className="entity-detail-header">
            <h4>{selectedEntity.name}</h4>
            <button
              className="close-detail-btn"
              onClick={() => setSelectedEntityId(null)}
              title="Close details"
            >
              ×
            </button>
          </div>

          <div className="entity-detail-content">
            <div className="detail-group">
              <label className="detail-label">Type</label>
              <span className="entity-type-badge">
                {typeLabel(selectedEntity.type, selectedEntity.metadata.customLabel)}
              </span>
            </div>

            {selectedEntity.description && (
              <div className="detail-group">
                <label className="detail-label">Description</label>
                <p className="detail-text">{selectedEntity.description}</p>
              </div>
            )}

            {selectedEntity.aliases.length > 0 && (
              <div className="detail-group">
                <label className="detail-label">Aliases</label>
                <p className="detail-text">{selectedEntity.aliases.join(', ')}</p>
              </div>
            )}

            <div className="detail-group">
              <label className="detail-label">Appears In</label>
              {entitySections.length > 0 ? (
                <div className="section-links">
                  {entitySections.map((section) => (
                    <button
                      key={section.id}
                      className="section-link-btn"
                      onClick={() => {
                        openTab({
                          id: `section-${section.id}`,
                          title: section.title,
                          path: '',
                          type: 'section',
                          sectionId: section.id,
                        });
                      }}
                    >
                      {section.title}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="detail-text muted">Not linked to any sections yet</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
