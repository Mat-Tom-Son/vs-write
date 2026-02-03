import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { subscribeWithSelector } from 'zustand/middleware';
import type { Project, Section, Entity, Diagnostic } from './schemas';
import { createProject, createSection, createEntity, createId } from './schemas';
import { ProjectService } from '../services/ProjectService';
import { NativeExtensionService } from '../services/NativeExtensionService';
import { useAppSettings } from './app-settings';

// Narrative context assembled for the agent
export interface NarrativeContext {
  entity: Entity;
  chronologicalSections: Section[];
  fullText: string;
}

// Tab for the editor
export interface EditorTab {
  id: string;
  title: string;
  path: string;
  type: 'section' | 'file';
  isDirty?: boolean;
  content?: string; // For file tabs
  sectionId?: string; // For section tabs
}

interface StoryState {
  project: Project;
  projectService: ProjectService | null;
  projectRoot: string | null;
  activeSectionId: string | null;
  isDirty: boolean;
  selectionRange: { from: number; to: number } | null;
  dirtySections: Record<string, true>;
  dirtyEntities: Record<string, true>;
  dirtyProject: boolean;
  fileTreeVersion: number;
  openTabs: EditorTab[];
  activeTabId: string | null;
  activeSection: () => Section | null;
  getSectionsByOrder: () => Section[];
  getEntitiesByType: (type: Entity['type']) => Entity[];
}

interface StoryActions {
  // Project lifecycle
  createNewProject: (projectRoot: string, name: string) => Promise<void>;
  openProject: (projectRoot: string) => Promise<void>;
  saveProject: () => Promise<void>;
  closeProject: () => Promise<void>;
  markClean: () => void;
  updateProjectSettings: (settings: Partial<Project['settings']>) => void;
  // Extensions
  initializeExtensions: () => Promise<void>;
  // Tabs
  openTab: (tab: EditorTab) => void;
  closeTab: (tabId: string) => void;
  setActiveTab: (tabId: string) => void;
  // Sections
  setActiveSection: (id: string | null) => void;
  addSection: (title: string, afterId?: string, parentId?: string | null) => string;
  updateSectionContent: (id: string, content: string) => void;
  updateSectionTitle: (id: string, title: string) => void;
  deleteSection: (id: string) => void;
  reorderSections: (ids: string[]) => void;
  setSectionAlignment: (id: string, alignment: Section['alignment']) => void;
  setSectionParent: (id: string, parentId: string | null) => void;
  toggleSectionCollapsed: (id: string) => void;
  // Entities
  addEntity: (name: string, type: Entity['type']) => string;
  updateEntity: (id: string, updates: Partial<Entity>) => void;
  deleteEntity: (id: string) => void;
  // Linking
  linkEntity: (sectionId: string, entityId: string) => void;
  unlinkEntity: (sectionId: string, entityId: string) => void;
  addTag: (sectionId: string, entityId: string, from: number, to: number) => void;
  removeTag: (sectionId: string, tagId: string) => void;
  setSelectionRange: (range: { from: number; to: number } | null) => void;
  // Diagnostics
  setDiagnostics: (sectionId: string, diagnostics: Diagnostic[]) => Promise<void>;
  clearDiagnostics: (sectionId: string) => Promise<void>;
  // Agent context builder
  getNarrativeContext: (entityId: string) => NarrativeContext | null;
  notifyFileChange: () => void;
}

type StoryStore = StoryState & StoryActions;

type ProjectServiceInternal = {
  _project: Project;
  dirtyEntities: Set<string>;
  dirtySections: Set<string>;
  dirtyProject: boolean;
};

export const useStoryStore = create<StoryStore>()(
  subscribeWithSelector(
    immer((set, get) => ({
      // Start with empty project - will be populated when user opens/creates one
      project: createProject('No Project'),
      projectService: null,
      projectRoot: null,
      activeSectionId: null,
      isDirty: false,
      selectionRange: null,
      dirtySections: {},
      dirtyEntities: {},
      dirtyProject: false,
      fileTreeVersion: 0,
      openTabs: [],
      activeTabId: null,

      // Computed
      activeSection: () => {
        const { project, activeSectionId } = get();
        return project.sections.find((s) => s.id === activeSectionId) ?? null;
      },

      getSectionsByOrder: () => {
        return [...get().project.sections].sort((a, b) => a.order - b.order);
      },

      getEntitiesByType: (type) => {
        return get().project.entities.filter((e) => e.type === type);
      },

      // Project lifecycle
      createNewProject: async (projectRoot, name) => {
        const service = await ProjectService.create(projectRoot, name);
        const project = service.getProject();
        set((state) => {
          state.projectService = service;
          state.projectRoot = projectRoot;
          state.project = project;
          state.activeSectionId = project.sections[0]?.id ?? null;
          state.isDirty = false;
          state.selectionRange = null;
          state.dirtySections = {};
          state.dirtyEntities = {};
          state.dirtyProject = false;
          state.fileTreeVersion = 0;
        });
      },

      openProject: async (projectRoot) => {
        const service = await ProjectService.open(projectRoot);
        const project = service.getProject();

        // Trigger native Lua extension hooks
        try {
          console.log('[Store] Triggering on_project_open hook for native Lua extensions');
          await NativeExtensionService.executeHookAll('on_project_open', { project }, projectRoot);
        } catch (error) {
          console.error('[Store] Native extension on_project_open hook failed:', error);
        }

        set((state) => {
          state.projectService = service;
          state.projectRoot = projectRoot;
          state.project = project;
          state.activeSectionId = project.sections[0]?.id ?? null;
          state.isDirty = false;
          state.selectionRange = null;
          state.dirtySections = {};
          state.dirtyEntities = {};
          state.dirtyProject = false;
        });
      },

      saveProject: async () => {
        const { projectService, dirtySections } = get();
        if (!projectService) return;

        // Sync in-memory project to service before save
        // Create a deep copy to avoid Immer's readonly freeze
        const currentProject = JSON.parse(JSON.stringify(get().project));
        // Access private property using type assertion (needed for sync)
        const internalService = projectService as unknown as ProjectServiceInternal;
        internalService._project = currentProject;

        // Mark all entities and sections as dirty so they get written to disk
        currentProject.entities.forEach((entity: Entity) => internalService.dirtyEntities.add(entity.id));
        currentProject.sections.forEach((section: Section) => internalService.dirtySections.add(section.id));
        internalService.dirtyProject = true;

        // Track which sections were dirty before save for hook
        const savedSectionIds = Object.keys(dirtySections);

        await projectService.save();

        // Trigger native Lua extension hooks for saved sections
        const projectRoot = get().projectRoot;
        if (projectRoot && savedSectionIds.length > 0) {
          const sectionsToNotify = currentProject.sections.filter(
            (s: Section) => savedSectionIds.includes(s.id)
          );
          for (const section of sectionsToNotify) {
            NativeExtensionService.executeHookAll('on_section_save', { section }, projectRoot).catch((error) => {
              console.error('[Store] Native extension on_section_save hook failed:', error);
            });
          }
        }

        set((state) => {
          state.isDirty = false;
          state.dirtySections = {};
          state.dirtyEntities = {};
          state.dirtyProject = false;
        });
      },

      closeProject: async () => {
        const { projectService } = get();

        // Trigger native Lua extension hooks
        const projectRoot = get().projectRoot;
        if (projectRoot) {
          try {
            console.log('[Store] Triggering on_project_close hook for native Lua extensions');
            await NativeExtensionService.executeHookAll('on_project_close', {}, projectRoot);
          } catch (error) {
            console.error('[Store] Native extension on_project_close hook failed:', error);
          }
        }

        // Close project service
        if (projectService) {
          await projectService.close();
        }

        // Note: Extensions remain loaded globally and don't need to be unloaded
        // They will be available for the next project opened

        set((state) => {
          state.projectService = null;
          state.projectRoot = null;
          state.project = createProject('Untitled Project');
          state.activeSectionId = null;
          state.isDirty = false;
          state.selectionRange = null;
          state.dirtySections = {};
          state.dirtyEntities = {};
          state.dirtyProject = false;
          state.fileTreeVersion = 0;
        });
      },

      markClean: () =>
        set((state) => {
          state.isDirty = false;
          state.dirtySections = {};
          state.dirtyEntities = {};
          state.dirtyProject = false;
        }),

      updateProjectSettings: (settings) => {
        set((state) => {
          Object.assign(state.project.settings, settings);
          state.isDirty = true;
          state.dirtyProject = true;
        });
      },

      // Tabs
      openTab: (tab) => {
        set((state) => {
          // Check if tab already exists
          const existingTab = state.openTabs.find((t) => t.id === tab.id);
          if (!existingTab) {
            state.openTabs.push(tab);
          }
          state.activeTabId = tab.id;

          // If it's a section tab, also set it as active section
          if (tab.type === 'section' && tab.sectionId) {
            state.activeSectionId = tab.sectionId;
          }
        });
      },

      closeTab: (tabId) => {
        set((state) => {
          const tabIndex = state.openTabs.findIndex((t) => t.id === tabId);
          if (tabIndex === -1) return;

          state.openTabs = state.openTabs.filter((t) => t.id !== tabId);

          // If closing active tab, switch to another tab
          if (state.activeTabId === tabId) {
            if (state.openTabs.length > 0) {
              // Try to activate the tab that was next to it
              const newActiveTab = state.openTabs[Math.min(tabIndex, state.openTabs.length - 1)];
              state.activeTabId = newActiveTab.id;

              // Update active section if it's a section tab
              if (newActiveTab.type === 'section' && newActiveTab.sectionId) {
                state.activeSectionId = newActiveTab.sectionId;
              }
            } else {
              state.activeTabId = null;
              state.activeSectionId = null;
            }
          }
        });
      },

      setActiveTab: (tabId) => {
        set((state) => {
          const tab = state.openTabs.find((t) => t.id === tabId);
          if (!tab) return;

          state.activeTabId = tabId;

          // If it's a section tab, also set it as active section
          if (tab.type === 'section' && tab.sectionId) {
            state.activeSectionId = tab.sectionId;
          }
        });
      },

      // Sections
      setActiveSection: (id) => set((state) => void (state.activeSectionId = id)),
      setSelectionRange: (range) => set((state) => void (state.selectionRange = range)),

      addSection: (title, afterId, parentId = null) => {
        const id = createId();
        set((state) => {
          const sections = state.project.sections;
          let order = sections.length;

          if (afterId) {
            const afterIdx = sections.findIndex((s) => s.id === afterId);
            if (afterIdx !== -1) {
              order = sections[afterIdx].order + 1;
              sections.forEach((s) => {
                if (s.order >= order) s.order += 1;
              });
            }
          }

          sections.push(createSection({ id, title, order, parentId }));
          state.activeSectionId = id;
          state.isDirty = true;
          state.dirtySections[id] = true;
        });
        return id;
      },

      updateSectionContent: (id, content) => {
        set((state) => {
          const sec = state.project.sections.find((s) => s.id === id);
          if (sec) {
            sec.content = content;
            state.project.meta.modifiedAt = new Date().toISOString();
            state.isDirty = true;
            state.dirtySections[id] = true;
          }
        });
      },

      updateSectionTitle: (id, title) => {
        set((state) => {
          const sec = state.project.sections.find((s) => s.id === id);
          if (sec) {
            sec.title = title;
            state.isDirty = true;
            state.dirtySections[id] = true;
          }
        });
      },

      deleteSection: (id) => {
        // Get section before deletion for hook context
        const sectionToDelete = get().project.sections.find((s) => s.id === id);
        const projectRoot = get().projectRoot;

        set((state) => {
          state.project.sections = state.project.sections.filter((s) => s.id !== id);
          if (state.activeSectionId === id) {
            state.activeSectionId = state.project.sections[0]?.id ?? null;
          }
          state.isDirty = true;
          state.dirtySections[id] = true;
        });

        // Trigger native extension hook (async, non-blocking)
        if (projectRoot && sectionToDelete) {
          NativeExtensionService.executeHookAll('on_section_save', { section: sectionToDelete, deleted: true }, projectRoot).catch((error) => {
            console.error('[Store] Native extension on_section_save hook failed:', error);
          });
        }
      },

      reorderSections: (ids) => {
        set((state) => {
          ids.forEach((id, idx) => {
            const sec = state.project.sections.find((s) => s.id === id);
            if (sec) {
              sec.order = idx;
              state.dirtySections[id] = true;
            }
          });
          state.isDirty = true;
        });
      },

      setSectionAlignment: (id, alignment) => {
        set((state) => {
          const sec = state.project.sections.find((s) => s.id === id);
          if (sec) {
            sec.alignment = alignment;
            state.isDirty = true;
            state.dirtySections[id] = true;
          }
        });
      },

      setSectionParent: (id, parentId) => {
        set((state) => {
          const sec = state.project.sections.find((s) => s.id === id);
          if (sec) {
            // Prevent circular references
            if (parentId) {
              let checkId: string | null = parentId;
              while (checkId) {
                if (checkId === id) {
                  console.warn('[Store] Cannot set circular parent reference');
                  return;
                }
                const parent = state.project.sections.find((s) => s.id === checkId);
                checkId = parent?.parentId ?? null;
              }
            }
            sec.parentId = parentId;
            state.isDirty = true;
            state.dirtySections[id] = true;
          }
        });
      },

      toggleSectionCollapsed: (id) => {
        set((state) => {
          const sec = state.project.sections.find((s) => s.id === id);
          if (sec) {
            sec.collapsed = !sec.collapsed;
            state.isDirty = true;
            state.dirtySections[id] = true;
          }
        });
      },

      // Entities
      addEntity: (name, type) => {
        const id = createId();
        const newEntity = createEntity({ id, name, type });

        set((state) => {
          state.project.entities.push(newEntity);
          state.isDirty = true;
          state.dirtyEntities[id] = true;
        });

        // Trigger native extension hook (async, non-blocking)
        const projectRoot = get().projectRoot;
        if (projectRoot) {
          NativeExtensionService.executeHookAll('on_entity_change', { entity: newEntity }, projectRoot).catch((error) => {
            console.error('[Store] Native extension on_entity_change hook failed:', error);
          });
        }

        return id;
      },

      updateEntity: (id, updates) => {
        let updatedEntity: Entity | undefined;

        set((state) => {
          const ent = state.project.entities.find((e) => e.id === id);
          if (ent) {
            Object.assign(ent, updates);
            updatedEntity = { ...ent }; // Copy for hook
          }
          state.isDirty = true;
          state.dirtyEntities[id] = true;
        });

        // Trigger native Lua extension hooks
        const projectRoot = get().projectRoot;
        if (projectRoot && updatedEntity) {
          NativeExtensionService.executeHookAll('on_entity_change', { entity: updatedEntity }, projectRoot).catch((error) => {
            console.error('[Store] Native extension on_entity_change hook failed:', error);
          });
        }
      },

      deleteEntity: (id) => {
        // Get entity before deletion for hook
        const entityToDelete = get().project.entities.find((e) => e.id === id);
        const projectRoot = get().projectRoot;

        set((state) => {
          state.project.entities = state.project.entities.filter((e) => e.id !== id);
          state.project.sections.forEach((s) => {
            s.entityIds = s.entityIds.filter((eid) => eid !== id);
            state.dirtySections[s.id] = true;
          });
          state.isDirty = true;
          state.dirtyEntities[id] = true;
        });

        // Trigger native extension hook (async, non-blocking)
        if (projectRoot && entityToDelete) {
          NativeExtensionService.executeHookAll('on_entity_change', { entity: entityToDelete, deleted: true }, projectRoot).catch((error) => {
            console.error('[Store] Native extension on_entity_change hook failed:', error);
          });
        }
      },

      // Linking
      linkEntity: (sectionId, entityId) => {
        set((state) => {
          const sec = state.project.sections.find((s) => s.id === sectionId);
          if (sec && !sec.entityIds.includes(entityId)) {
            sec.entityIds.push(entityId);
            state.isDirty = true;
            state.dirtySections[sectionId] = true;
          }
        });
      },

      unlinkEntity: (sectionId, entityId) => {
        set((state) => {
          const sec = state.project.sections.find((s) => s.id === sectionId);
          if (sec) {
            sec.entityIds = sec.entityIds.filter((id) => id !== entityId);
            state.isDirty = true;
            state.dirtySections[sectionId] = true;
          }
        });
      },

      addTag: (sectionId, entityId, from, to) => {
        set((state) => {
          const sec = state.project.sections.find((s) => s.id === sectionId);
          if (!sec) return;
          const clampedFrom = Math.max(0, Math.min(from, sec.content.length));
          const clampedTo = Math.max(clampedFrom, Math.min(to, sec.content.length));
          if (clampedFrom === clampedTo) return;
          sec.tags.push({ id: createId(), entityId, from: clampedFrom, to: clampedTo });
          if (!sec.entityIds.includes(entityId)) sec.entityIds.push(entityId);
          state.isDirty = true;
          state.dirtySections[sectionId] = true;
        });
      },

      removeTag: (sectionId, tagId) => {
        set((state) => {
          const sec = state.project.sections.find((s) => s.id === sectionId);
          if (!sec) return;
          const tag = sec.tags.find((t) => t.id === tagId);
          sec.tags = sec.tags.filter((t) => t.id !== tagId);
          if (tag) {
            const stillUsed = sec.tags.some((t) => t.entityId === tag.entityId);
            if (!stillUsed) {
              sec.entityIds = sec.entityIds.filter((id) => id !== tag.entityId);
            }
          }
          state.isDirty = true;
          state.dirtySections[sectionId] = true;
        });
      },

      // Diagnostics (stored in DB only, not files)
      setDiagnostics: async (sectionId, diagnostics) => {
        const { projectService } = get();
        if (projectService) {
          await projectService.updateDiagnostics(sectionId, diagnostics);
        }
        set((state) => {
          const sec = state.project.sections.find((s) => s.id === sectionId);
          if (sec) sec.diagnostics = diagnostics;
        });
      },

      clearDiagnostics: async (sectionId) => {
        const { projectService } = get();
        if (projectService) {
          await projectService.updateDiagnostics(sectionId, []);
        }
        set((state) => {
          const sec = state.project.sections.find((s) => s.id === sectionId);
          if (sec) sec.diagnostics = [];
        });
      },

      // Agent context builder
      getNarrativeContext: (entityId) => {
        const { project } = get();
        const entity = project.entities.find((e) => e.id === entityId);
        if (!entity) return null;

        const chronologicalSections = project.sections
          .filter((s) => s.entityIds.includes(entityId))
          .sort((a, b) => a.order - b.order);

        const fullText = chronologicalSections
          .map((s) => `[${s.title}]\n${s.content}`)
          .join('\n\n---\n\n');

        return { entity, chronologicalSections, fullText };
      },

      notifyFileChange: () =>
        set((state) => {
          state.fileTreeVersion += 1;
        }),

      // Extensions lifecycle - native Lua extensions are managed via Tauri commands
      initializeExtensions: async () => {
        // Check for safe mode
        const safeMode = useAppSettings.getState().settings.maintenance.extensionSafeMode;
        if (safeMode) {
          console.log('[Store] Safe mode enabled - skipping extension initialization');
          return;
        }

        console.log('[Store] Initializing native Lua extensions');

        try {
          // Install bundled Lua extensions (if any) into app data directory.
          const installedIds = await NativeExtensionService.installBundledLuaExtensions();
          if (installedIds.length > 0) {
            console.log(`[Store] Installed/updated bundled extensions: ${installedIds.join(', ')}`);
          }

          // Auto-load extensions from the extensions directory
          const loadedIds = await NativeExtensionService.autoLoadExtensions();
          console.log(`[Store] Auto-loaded ${loadedIds.length} extension(s)`);
        } catch (error) {
          console.error('[Store] Extension initialization failed:', error);
        }
      },
    })),
  ),
);

// Subscribe to changes (can be used for custom hooks)
export function subscribeToChanges(callback: (isDirty: boolean) => void) {
  return useStoryStore.subscribe(
    (state) => state.isDirty,
    callback
  );
}
