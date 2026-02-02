import { useEffect, useRef, useMemo, useState } from 'react';
import { EditorSelection, EditorState, StateEffect, StateField } from '@codemirror/state';
import { EditorView, Decoration, type DecorationSet, keymap, placeholder } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, undo, redo } from '@codemirror/commands';
import { searchKeymap, openSearchPanel } from '@codemirror/search';
import {
  Bold,
  Italic,
  Heading1,
  List,
  Quote,
  Strikethrough,
  Code2,
  AlignLeft,
  AlignCenter,
  AlignRight,
  RotateCcw,
  RotateCw,
  Tag,
  WrapText,
  Hash,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { markdown } from '@codemirror/lang-markdown';
import { lineNumbers } from '@codemirror/view';
import type { Section, Diagnostic } from '../../lib/schemas';
import { useStoryStore } from '../../lib/store';
import { useAppSettings } from '../../lib/app-settings';

interface Props {
  section: Section;
}

// Diagnostic decorations
const setDiagnosticsEffect = StateEffect.define<Diagnostic[]>();
const diagnosticField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(decorations, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setDiagnosticsEffect)) {
        const decos = effect.value
          .filter((d) => d.range.from !== d.range.to)
          .map((d) => {
            const className = `diagnostic-${d.severity}`;
            return Decoration.mark({
              class: className,
              attributes: { title: d.message },
            }).range(d.range.from, Math.min(d.range.to, tr.state.doc.length));
          });
        return Decoration.set(decos, true);
      }
    }
    return decorations.map(tr.changes);
  },
  provide: (f) => EditorView.decorations.from(f),
});

// Tag decorations
const setTagsEffect = StateEffect.define<Section['tags']>();
const tagField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(decorations, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setTagsEffect)) {
        const decos = effect.value.map((t) =>
          Decoration.mark({ class: 'entity-tagged' }).range(
            t.from,
            Math.min(t.to, tr.state.doc.length),
          ),
        );
        return Decoration.set(decos, true);
      }
    }
    return decorations.map(tr.changes);
  },
  provide: (f) => EditorView.decorations.from(f),
});

// Dynamic theme based on user settings
const createTheme = (fontFamily: string, fontSize: number, lineHeight: number, pageWidth: 'narrow' | 'comfortable' | 'wide' | 'full' = 'comfortable') => {
  const widthMap = {
    narrow: '680px',
    comfortable: '900px',
    wide: '1200px',
    full: '100%',
  };

  const paddingMap = {
    narrow: '32px 40px',
    comfortable: '32px 64px',
    wide: '32px 80px',
    full: '32px 48px',
  };

  return EditorView.theme({
    '&': {
      height: '100%',
      fontSize: `${fontSize}px`,
      backgroundColor: 'transparent',
      color: '#e5e5e5',
    },
    '.cm-scroller': {
      fontFamily,
    },
    '.cm-content': {
      padding: paddingMap[pageWidth],
      maxWidth: widthMap[pageWidth],
      minWidth: widthMap[pageWidth],
      margin: '0 auto',
      lineHeight: String(lineHeight),
      minHeight: '100%',
      caretColor: '#4ec9b0',
    },
    '.cm-line': {
      padding: '2px 0',
    },
    '&.cm-focused': {
      outline: 'none',
    },
    '&.cm-focused .cm-scroller': {
      boxShadow: '0 0 0 2px rgba(0, 122, 204, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.05), 0 2px 8px rgba(0, 0, 0, 0.3), 0 8px 24px rgba(0, 0, 0, 0.2)',
    },
    '.cm-selectionBackground': {
      background: '#264f78 !important',
    },
    '.cm-placeholder': {
      color: '#808080',
      fontStyle: 'normal',
      fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    },
    '.cm-cursor': {
      borderLeftColor: '#4ec9b0',
    },
    '.diagnostic-info': {
      textDecoration: 'underline wavy #3794ff',
      textUnderlineOffset: '3px',
    },
    '.diagnostic-warning': {
      textDecoration: 'underline wavy #cca700',
      textUnderlineOffset: '3px',
    },
    '.diagnostic-critical': {
      textDecoration: 'underline wavy #f14c4c',
      textUnderlineOffset: '3px',
    },
    '.cm-header-1': { fontSize: '1.5em', fontWeight: 'bold' },
    '.cm-header-2': { fontSize: '1.3em', fontWeight: 'bold' },
    '.cm-emphasis': { fontStyle: 'italic' },
    '.cm-strong': { fontWeight: 'bold' },
    '.entity-tagged': {
      backgroundColor: 'rgba(78, 201, 176, 0.18)',
      borderBottom: '1px solid rgba(78, 201, 176, 0.8)',
    },
  });
};

const formattingKeymap = [
  {
    key: 'Mod-b',
    run: (view: EditorView) => {
      wrapSelection(view, '**');
      return true;
    },
  },
  {
    key: 'Mod-i',
    run: (view: EditorView) => {
      wrapSelection(view, '*');
      return true;
    },
  },
  { key: 'Mod-z', run: undo },
  { key: 'Mod-Shift-z', run: redo },
];

function wrapSelection(view: EditorView, wrapper: string) {
  const { state } = view;
  const change = state.changeByRange((range) => {
    const { from, to } = range;
    const selected = state.sliceDoc(from, to) || 'text';
    const insert = `${wrapper}${selected}${wrapper}`;
    return {
      changes: { from, to, insert },
      range: EditorSelection.range(from + wrapper.length, from + wrapper.length + selected.length),
    };
  });
  view.dispatch(change);
  view.focus();
}

function toggleLinePrefix(view: EditorView, prefix: string) {
  const { state } = view;
  const ranges = state.selection.ranges;
  const changes = [];
  for (const range of ranges) {
    const fromLine = state.doc.lineAt(range.from);
    const toLine = state.doc.lineAt(range.to);
    for (let lineNo = fromLine.number; lineNo <= toLine.number; lineNo++) {
      const line = state.doc.line(lineNo);
      const lineText = line.text;
      const hasPrefix = lineText.startsWith(prefix);
      const from = line.from;
      const to = hasPrefix ? from + prefix.length : from;
      const insert = hasPrefix ? '' : prefix;
      changes.push({ from, to, insert });
    }
  }
  if (changes.length === 0) return;
  view.dispatch({ changes });
  view.focus();
}

export function SectionEditor({ section }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const updateSectionContent = useStoryStore((s) => s.updateSectionContent);
  const updateSectionTitle = useStoryStore((s) => s.updateSectionTitle);
  const setSelectionRange = useStoryStore((s) => s.setSelectionRange);
  const selectionRange = useStoryStore((s) => s.selectionRange);
  const setSectionAlignment = useStoryStore((s) => s.setSectionAlignment);
  const addTag = useStoryStore((s) => s.addTag);
  const removeTag = useStoryStore((s) => s.removeTag);
  const entities = useStoryStore((s) => s.project.entities);
  const [showEntityMenu, setShowEntityMenu] = useState(false);
  // Fixed page width for consistent writing experience
  const pageWidth = 'comfortable' as const;

  // Editor settings
  const editorSettings = useAppSettings((s) => s.settings.editor);
  const updateEditorSettings = useAppSettings((s) => s.updateEditorSettings);

  // Create theme based on settings
  const theme = useMemo(
    () => createTheme(editorSettings.fontFamily, editorSettings.fontSize, editorSettings.lineHeight, pageWidth),
    [editorSettings.fontFamily, editorSettings.fontSize, editorSettings.lineHeight, pageWidth]
  );

  // Build extensions based on current settings
  const extensions = useMemo(() => {
    const exts = [
      history(),
      keymap.of([...formattingKeymap, ...defaultKeymap, ...historyKeymap, ...searchKeymap]),
      markdown(),
      diagnosticField,
      tagField,
      theme,
      placeholder('Start writing here...'),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          updateSectionContent(section.id, update.state.doc.toString());
        }
        if (update.selectionSet) {
          const sel = update.state.selection.main;
          setSelectionRange({ from: sel.from, to: sel.to });
        }
      }),
    ];

    // Conditionally add line numbers
    if (editorSettings.showLineNumbers) {
      exts.push(lineNumbers());
    }

    // Conditionally add word wrap
    if (editorSettings.wordWrap) {
      exts.push(EditorView.lineWrapping);
    }

    return exts;
  }, [section.id, updateSectionContent, setSelectionRange, theme, editorSettings.showLineNumbers, editorSettings.wordWrap]);

  // Initial setup (create once per section)
  useEffect(() => {
    if (!containerRef.current) return;

    const state = EditorState.create({
      doc: section.content,
      extensions,
    });

    const view = new EditorView({ state, parent: containerRef.current });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
      setSelectionRange(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section.id]);

  // Reconfigure editor when extensions change (without destroying it)
  useEffect(() => {
    if (viewRef.current && section.id) {
      viewRef.current.dispatch({
        effects: StateEffect.reconfigure.of(extensions),
      });
    }
  }, [extensions, section.id]);

  // Sync diagnostics decorations
  useEffect(() => {
    if (viewRef.current) {
      viewRef.current.dispatch({
        effects: setDiagnosticsEffect.of(section.diagnostics),
      });
    }
  }, [section.diagnostics]);

  // Sync tag decorations
  useEffect(() => {
    if (viewRef.current) {
      viewRef.current.dispatch({
        effects: setTagsEffect.of(section.tags),
      });
    }
  }, [section.tags]);

  // Sync content when replaced externally (e.g., load project)
  useEffect(() => {
    if (viewRef.current) {
      const currentDoc = viewRef.current.state.doc.toString();
      if (currentDoc !== section.content) {
        viewRef.current.dispatch({
          changes: { from: 0, to: currentDoc.length, insert: section.content },
        });
      }
    }
  }, [section.content]);

  const { wordCount, charCount, readingMinutes } = useMemo(() => {
    const text = section.content.replace(/\s+/g, ' ').trim();
    const words = text ? text.split(' ').length : 0;
    const chars = text.length;
    const minutes = words === 0 ? 0 : Math.max(1, Math.round(words / 250));
    return { wordCount: words, charCount: chars, readingMinutes: minutes };
  }, [section.content]);

  const hasSelection = selectionRange && selectionRange.from !== selectionRange.to;

  const handleTagEntity = (entityId: string) => {
    if (!selectionRange || selectionRange.from === selectionRange.to) return;
    addTag(section.id, entityId, selectionRange.from, selectionRange.to);
    setShowEntityMenu(false);
  };

  // Get tags at current selection
  const tagsAtSelection = useMemo(() => {
    if (!selectionRange) return [];
    return section.tags.filter(
      (tag) =>
        tag.from <= selectionRange.from &&
        tag.to >= selectionRange.to &&
        selectionRange.from !== selectionRange.to
    );
  }, [section.tags, selectionRange]);

  // Close menu when clicking outside
  useEffect(() => {
    if (!showEntityMenu) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.entity-tag-menu') && !target.closest('button[title*="Tag"]')) {
        setShowEntityMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showEntityMenu]);

  return (
    <div className="section-editor">
      <div className="section-header">
        <input
          type="text"
          value={section.title}
          onChange={(e) => updateSectionTitle(section.id, e.target.value)}
          className="section-title-input"
        />
        <span className="word-count">
          {wordCount} words · {charCount} chars · ~{readingMinutes} min
        </span>
      </div>
      <div className={`editor-shell editor-align-${section.alignment}`}>
        <div className="editor-toolbar">
          <button
            type="button"
            onClick={() => {
              if (viewRef.current) wrapSelection(viewRef.current, '**');
            }}
            title="Bold (Ctrl/Cmd+B)"
          >
            <Bold size={14} />
          </button>
          <button
            type="button"
            onClick={() => {
              if (viewRef.current) wrapSelection(viewRef.current, '*');
            }}
            title="Italic (Ctrl/Cmd+I)"
          >
            <Italic size={14} />
          </button>
          <button
            type="button"
            onClick={() => {
              if (viewRef.current) toggleLinePrefix(viewRef.current, '# ');
            }}
            title="Heading 1"
          >
            <Heading1 size={14} />
          </button>
          <button
            type="button"
            onClick={() => {
              if (viewRef.current) toggleLinePrefix(viewRef.current, '- ');
            }}
            title="Unordered list"
          >
            <List size={14} />
          </button>
          <button
            type="button"
            onClick={() => {
              if (viewRef.current) openSearchPanel(viewRef.current);
            }}
            title="Search (Ctrl/Cmd+F)"
          >
            /
          </button>
          <div className="toolbar-separator" />
          <div style={{ position: 'relative' }}>
            <button
              type="button"
              onClick={() => setShowEntityMenu(!showEntityMenu)}
              disabled={!hasSelection}
              className={hasSelection && tagsAtSelection.length > 0 ? 'is-active' : undefined}
              title={hasSelection ? 'Tag entity' : 'Select text to tag'}
            >
              <Tag size={14} />
            </button>
            {showEntityMenu && hasSelection && (
              <div className="entity-tag-menu">
                <div className="entity-tag-menu-header">Tag selected text as:</div>
                <div className="entity-tag-menu-list">
                  {entities.length > 0 ? (
                    entities.map((entity) => (
                      <button
                        key={entity.id}
                        type="button"
                        className="entity-tag-menu-item"
                        onClick={() => handleTagEntity(entity.id)}
                      >
                        {entity.name}
                      </button>
                    ))
                  ) : (
                    <div className="entity-tag-menu-empty">No entities yet</div>
                  )}
                </div>
                {tagsAtSelection.length > 0 && (
                  <>
                    <div className="entity-tag-menu-divider" />
                    <div className="entity-tag-menu-header">Current tags:</div>
                    <div className="entity-tag-menu-list">
                      {tagsAtSelection.map((tag) => {
                        const entity = entities.find((e) => e.id === tag.entityId);
                        return (
                          <button
                            key={tag.id}
                            type="button"
                            className="entity-tag-menu-item remove"
                            onClick={() => removeTag(section.id, tag.id)}
                          >
                            {entity?.name || 'Unknown'} ×
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
          <div className="toolbar-spacer" />
          <div className="toolbar-separator" />
          <button
            type="button"
            className={section.alignment === 'left' ? 'is-active' : undefined}
            onClick={() => setSectionAlignment(section.id, 'left')}
            title="Align left"
          >
            <AlignLeft size={14} />
          </button>
          <button
            type="button"
            className={section.alignment === 'center' ? 'is-active' : undefined}
            onClick={() => setSectionAlignment(section.id, 'center')}
            title="Align center"
          >
            <AlignCenter size={14} />
          </button>
          <button
            type="button"
            className={section.alignment === 'right' ? 'is-active' : undefined}
            onClick={() => setSectionAlignment(section.id, 'right')}
            title="Align right"
          >
            <AlignRight size={14} />
          </button>
          <div className="toolbar-separator" />
          <button
            type="button"
            className={editorSettings.wordWrap ? 'is-active' : undefined}
            onClick={() => updateEditorSettings({ wordWrap: !editorSettings.wordWrap })}
            title="Toggle word wrap"
          >
            <WrapText size={14} />
          </button>
          <button
            type="button"
            className={editorSettings.showLineNumbers ? 'is-active' : undefined}
            onClick={() => updateEditorSettings({ showLineNumbers: !editorSettings.showLineNumbers })}
            title="Toggle line numbers"
          >
            <Hash size={14} />
          </button>
          <div className="toolbar-separator" />
          <button
            type="button"
            onClick={() => updateEditorSettings({ fontSize: Math.max(10, editorSettings.fontSize - 1) })}
            title="Decrease font size"
          >
            <ZoomOut size={14} />
          </button>
          <button
            type="button"
            onClick={() => updateEditorSettings({ fontSize: Math.min(32, editorSettings.fontSize + 1) })}
            title="Increase font size"
          >
            <ZoomIn size={14} />
          </button>
          <div className="toolbar-separator" />
          <button
            type="button"
            onClick={() => {
              if (viewRef.current) toggleLinePrefix(viewRef.current, '> ');
            }}
            title="Blockquote"
          >
            <Quote size={14} />
          </button>
          <button
            type="button"
            onClick={() => {
              if (viewRef.current) wrapSelection(viewRef.current, '~~');
            }}
            title="Strikethrough"
          >
            <Strikethrough size={14} />
          </button>
          <button
            type="button"
            onClick={() => {
              if (viewRef.current) wrapSelection(viewRef.current, '`');
            }}
            title="Inline code"
          >
            <Code2 size={14} />
          </button>
          <div className="toolbar-separator" />
          <button
            type="button"
            onClick={() => {
              if (viewRef.current) undo(viewRef.current);
            }}
            title="Undo (Ctrl/Cmd+Z)"
          >
            <RotateCcw size={14} />
          </button>
          <button
            type="button"
            onClick={() => {
              if (viewRef.current) redo(viewRef.current);
            }}
            title="Redo (Ctrl/Cmd+Shift+Z)"
          >
            <RotateCw size={14} />
          </button>
        </div>
        <div ref={containerRef} className="editor-container" />
      </div>
    </div>
  );
}