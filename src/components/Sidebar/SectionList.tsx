import { useMemo, useState, useCallback } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  DragOverlay,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useStoryStore, type EditorTab } from '../../lib/store';
import type { Section } from '../../lib/schemas';
import { ChevronRight, ChevronDown, GripVertical, X, CornerDownRight } from 'lucide-react';

interface SectionNode {
  section: Section;
  children: SectionNode[];
  depth: number;
}

function buildTree(sections: Section[]): SectionNode[] {
  const sorted = [...sections].sort((a, b) => a.order - b.order);
  const nodeMap = new Map<string, SectionNode>();
  const roots: SectionNode[] = [];

  // First pass: create all nodes
  for (const section of sorted) {
    nodeMap.set(section.id, { section, children: [], depth: 0 });
  }

  // Second pass: build tree structure
  for (const section of sorted) {
    const node = nodeMap.get(section.id)!;
    if (section.parentId && nodeMap.has(section.parentId)) {
      const parent = nodeMap.get(section.parentId)!;
      node.depth = parent.depth + 1;
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  // Third pass: recalculate depths for nested children
  function setDepths(nodes: SectionNode[], depth: number) {
    for (const node of nodes) {
      node.depth = depth;
      setDepths(node.children, depth + 1);
    }
  }
  setDepths(roots, 0);

  return roots;
}

function flattenTree(nodes: SectionNode[], collapsedIds: Set<string>): SectionNode[] {
  const result: SectionNode[] = [];
  function traverse(nodes: SectionNode[]) {
    for (const node of nodes) {
      result.push(node);
      if (!collapsedIds.has(node.section.id)) {
        traverse(node.children);
      }
    }
  }
  traverse(nodes);
  return result;
}

function SortableItem({
  node,
  isActive,
  hasChildren,
  isCollapsed,
  onToggleCollapse,
  onSetParent,
  onUnsetParent,
}: {
  node: SectionNode;
  isActive: boolean;
  hasChildren: boolean;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  onSetParent: (parentId: string) => void;
  onUnsetParent: () => void;
}) {
  const { section, depth } = node;
  const openTab = useStoryStore((s) => s.openTab);
  const deleteSection = useStoryStore((s) => s.deleteSection);
  const sections = useStoryStore((s) => s.project.sections);
  const [showParentMenu, setShowParentMenu] = useState(false);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: section.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const diagnosticCount = section.diagnostics.length;
  const hasCritical = section.diagnostics.some((d) => d.severity === 'critical');

  const handleClick = () => {
    const tab: EditorTab = {
      id: `section-${section.id}`,
      title: section.title,
      path: '',
      type: 'section',
      sectionId: section.id,
    };
    openTab(tab);
  };

  // Get potential parent sections (exclude self and descendants)
  const getDescendantIds = useCallback(
    (id: string, acc: Set<string> = new Set()): Set<string> => {
      acc.add(id);
      for (const s of sections) {
        if (s.parentId === id && !acc.has(s.id)) {
          getDescendantIds(s.id, acc);
        }
      }
      return acc;
    },
    [sections]
  );

  const descendantIds = useMemo(() => getDescendantIds(section.id), [getDescendantIds, section.id]);
  const potentialParents = useMemo(
    () => sections.filter((s) => !descendantIds.has(s.id)),
    [sections, descendantIds]
  );

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`section-item ${isActive ? 'active' : ''}`}
      data-depth={depth}
    >
      <div className="section-item-content" style={{ paddingLeft: `${depth * 16 + 4}px` }}>
        {/* Collapse toggle */}
        <button
          className="collapse-toggle"
          onClick={(e) => {
            e.stopPropagation();
            onToggleCollapse();
          }}
          style={{ visibility: hasChildren ? 'visible' : 'hidden' }}
        >
          {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        </button>

        {/* Drag handle */}
        <span className="drag-handle" {...attributes} {...listeners}>
          <GripVertical size={14} />
        </span>

        {/* Title */}
        <span className="section-title" onClick={handleClick}>
          {section.title}
        </span>

        {/* Diagnostic badge */}
        {diagnosticCount > 0 && (
          <span className={`diagnostic-badge ${hasCritical ? 'critical' : 'warning'}`}>
            {diagnosticCount}
          </span>
        )}

        {/* Parent indicator */}
        {section.parentId && (
          <button
            className="parent-indicator"
            onClick={(e) => {
              e.stopPropagation();
              onUnsetParent();
            }}
            title="Remove from parent (make top-level)"
          >
            <CornerDownRight size={12} />
          </button>
        )}

        {/* Set parent button */}
        <div className="parent-menu-container">
          <button
            className="set-parent-btn"
            onClick={(e) => {
              e.stopPropagation();
              setShowParentMenu(!showParentMenu);
            }}
            title="Set parent section"
          >
            ↳
          </button>
          {showParentMenu && (
            <div className="parent-menu">
              <div className="parent-menu-header">Move under:</div>
              {section.parentId && (
                <button
                  className="parent-menu-item"
                  onClick={(e) => {
                    e.stopPropagation();
                    onUnsetParent();
                    setShowParentMenu(false);
                  }}
                >
                  (Top level)
                </button>
              )}
              {potentialParents.map((p) => (
                <button
                  key={p.id}
                  className={`parent-menu-item ${p.id === section.parentId ? 'current' : ''}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSetParent(p.id);
                    setShowParentMenu(false);
                  }}
                >
                  {p.title}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Delete button */}
        <button
          className="delete-btn"
          onClick={(e) => {
            e.stopPropagation();
            if (confirm(`Delete "${section.title}"?`)) deleteSection(section.id);
          }}
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}

export function SectionList() {
  const activeSectionId = useStoryStore((s) => s.activeSectionId);
  const reorderSections = useStoryStore((s) => s.reorderSections);
  const addSection = useStoryStore((s) => s.addSection);
  const setSectionParent = useStoryStore((s) => s.setSectionParent);
  const toggleSectionCollapsed = useStoryStore((s) => s.toggleSectionCollapsed);
  const sectionsState = useStoryStore((s) => s.project.sections);

  const [isAdding, setIsAdding] = useState(false);
  const [newTitle, setNewTitle] = useState('');

  // Build collapsed set from section state
  const collapsedIds = useMemo(
    () => new Set(sectionsState.filter((s) => s.collapsed).map((s) => s.id)),
    [sectionsState]
  );

  // Build tree and flatten for display
  const tree = useMemo(() => buildTree(sectionsState), [sectionsState]);
  const flatNodes = useMemo(() => flattenTree(tree, collapsedIds), [tree, collapsedIds]);

  // Check which sections have children
  const hasChildrenMap = useMemo(() => {
    const map = new Map<string, boolean>();
    for (const section of sectionsState) {
      if (section.parentId) {
        map.set(section.parentId, true);
      }
    }
    return map;
  }, [sectionsState]);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = flatNodes.findIndex((n) => n.section.id === active.id);
      const newIndex = flatNodes.findIndex((n) => n.section.id === over.id);
      const reordered = arrayMove(flatNodes, oldIndex, newIndex);
      reorderSections(reordered.map((n) => n.section.id));
    }
  };

  const handleAdd = () => {
    if (newTitle.trim()) {
      addSection(newTitle.trim());
      setNewTitle('');
      setIsAdding(false);
    }
  };

  return (
    <div className="section-list">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext
          items={flatNodes.map((n) => n.section.id)}
          strategy={verticalListSortingStrategy}
        >
          {flatNodes.map((node) => (
            <SortableItem
              key={node.section.id}
              node={node}
              isActive={node.section.id === activeSectionId}
              hasChildren={hasChildrenMap.get(node.section.id) || false}
              isCollapsed={collapsedIds.has(node.section.id)}
              onToggleCollapse={() => toggleSectionCollapsed(node.section.id)}
              onSetParent={(parentId) => setSectionParent(node.section.id, parentId)}
              onUnsetParent={() => setSectionParent(node.section.id, null)}
            />
          ))}
        </SortableContext>
      </DndContext>

      {isAdding ? (
        <div className="add-section-form">
          <input
            type="text"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            placeholder="Section title..."
            autoFocus
          />
          <button onClick={handleAdd}>Add</button>
          <button onClick={() => setIsAdding(false)}>Cancel</button>
        </div>
      ) : (
        <button className="add-section-btn" onClick={() => setIsAdding(true)}>
          + Add Section
        </button>
      )}
    </div>
  );
}
