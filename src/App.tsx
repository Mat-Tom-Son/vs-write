import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { useStoryStore } from './lib/store';
import { MenuBar } from './components/MenuBar';
import { WelcomeScreen } from './components/WelcomeScreen';
import { ActivityBar, type ActivityView } from './components/ActivityBar';
import { FilesPanel } from './components/Sidebar/FilesPanel';
import { SectionsPanel } from './components/Sidebar/SectionsPanel';
import { EntityPanel } from './components/Sidebar/EntityPanel';
import { NativeAgentPanel } from './components/Sidebar/NativeAgentPanel';
import { ExtensionsPanel } from './components/Sidebar/ExtensionsPanel';
import { SectionEditor } from './components/Editor/SectionEditor';
import { TabBar } from './components/Editor/TabBar';
import { FileViewer } from './components/Editor/FileViewer';
import './App.css';

export default function App() {
  const [activeView, setActiveView] = useState<ActivityView>('files');
  const project = useStoryStore((s) => s.project);
  const projectRoot = useStoryStore((s) => s.projectRoot);
  const projectService = useStoryStore((s) => s.projectService);
  const isDirty = useStoryStore((s) => s.isDirty);
  const activeSection = useStoryStore((s) => s.activeSection());
  const openTabs = useStoryStore((s) => s.openTabs);
  const activeTabId = useStoryStore((s) => s.activeTabId);
  const setActiveTab = useStoryStore((s) => s.setActiveTab);
  const closeTab = useStoryStore((s) => s.closeTab);
  const createNewProject = useStoryStore((s) => s.createNewProject);
  const openProject = useStoryStore((s) => s.openProject);
  const saveProject = useStoryStore((s) => s.saveProject);
  const unsavedSections = useStoryStore((s) => Object.keys(s.dirtySections).length);
  const unsavedEntities = useStoryStore((s) => Object.keys(s.dirtyEntities).length);
  const unsavedFiles = useStoryStore((s) => (s.dirtyProject ? 1 : 0));
  const initializeExtensions = useStoryStore((s) => s.initializeExtensions);
  const [leftSidebarWidth, setLeftSidebarWidth] = useState(280);

  const activeTab = openTabs.find((t) => t.id === activeTabId);

  const clampSidebarWidth = useCallback(
    (value: number) => Math.min(520, Math.max(220, value)),
    [],
  );

  const startResizing = useCallback(
    (startX: number) => {
      const startWidth = leftSidebarWidth;

      const handleMove = (event: MouseEvent) => {
        const delta = event.clientX - startX;
        const nextWidth = clampSidebarWidth(startWidth + delta);
        setLeftSidebarWidth(nextWidth);
      };

      const stopResizing = () => {
        window.removeEventListener('mousemove', handleMove);
        window.removeEventListener('mouseup', stopResizing);
      };

      window.addEventListener('mousemove', handleMove);
      window.addEventListener('mouseup', stopResizing);
    },
    [clampSidebarWidth, leftSidebarWidth],
  );

  const leftSidebarStyle: CSSProperties & { '--sidebar-padding': string } = {
    width: leftSidebarWidth,
    '--sidebar-padding': '16px', // Fixed padding for consistent look
  };

  // Keyboard shortcuts
  const handleKeyDown = useCallback(
    async (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;

      // Save project (Ctrl+S)
      if (mod && e.key === 's') {
        e.preventDefault();
        try {
          await saveProject();
        } catch (error) {
          console.error('Failed to save project:', error);
          alert('Failed to save project. See console for details.');
        }
      }

      // Open project (Ctrl+O)
      if (mod && e.key === 'o') {
        e.preventDefault();
        try {
          const folderPath = await open({
            directory: true,
            multiple: false,
            title: 'Open VS Write Project',
          });

          if (folderPath && typeof folderPath === 'string') {
            await openProject(folderPath);
          }
        } catch (error) {
          console.error('Failed to open project:', error);
          alert('Failed to open project. See console for details.');
        }
      }

      // New project (Ctrl+N)
      if (mod && e.key === 'n') {
        e.preventDefault();
        try {
          const projectName = prompt('Enter project name:');
          if (!projectName) return;

          const folderPath = await open({
            directory: true,
            multiple: false,
            title: 'Select parent folder for new project',
          });

          if (folderPath && typeof folderPath === 'string') {
            // Normalize path separators for the platform
            const separator = folderPath.includes('\\') ? '\\' : '/';
            const projectSlug = projectName.toLowerCase().replace(/\s+/g, '-');
            const projectPath = `${folderPath}${separator}${projectSlug}`;
            await createNewProject(projectPath, projectName);
          }
        } catch (error) {
          console.error('Failed to create project:', error);
          alert(`Failed to create project: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      }
    },
    [saveProject, openProject, createNewProject],
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Warn on unsaved changes
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isDirty]);

  // File watching for external changes
  useEffect(() => {
    if (!projectService) return;

    let unwatchFn: (() => void) | null = null;
    let lastSaveTime = 0;

    const setupWatcher = async () => {
      try {
        unwatchFn = await projectService.startFileWatcher(async (filePath) => {
          // Check if this file was recently written by us
          if (projectService.wasRecentlyWritten(filePath)) {
            return;
          }

          // Also ignore changes within 1 second of a save (backup safety)
          const timeSinceLastSave = Date.now() - lastSaveTime;
          if (timeSinceLastSave < 1000) {
            return;
          }
          useStoryStore.getState().notifyFileChange();

          const shouldReload = confirm(
            `File "${filePath}" was modified externally. Reload project? (Unsaved changes will be lost)`
          );

          if (shouldReload) {
            try {
              if (projectRoot) {
                await openProject(projectRoot);
              }
            } catch (error) {
              console.error('Failed to reload project:', error);
              alert('Failed to reload project. See console for details.');
            }
          }
        });
      } catch (error) {
        console.error('Failed to start file watcher:', error);
      }
    };

    setupWatcher();

    // Update lastSaveTime when isDirty changes from true to false (indicating a save)
    const unsubscribe = useStoryStore.subscribe(
      (state) => state.isDirty,
      (isDirty, prevIsDirty) => {
        if (prevIsDirty && !isDirty) {
          // Just saved
          lastSaveTime = Date.now();
        }
      }
    );

    return () => {
      if (unwatchFn) unwatchFn();
      unsubscribe();
    };
  }, [projectService, projectRoot, openProject]);

  // Initialize global extensions on app startup
  useEffect(() => {
    initializeExtensions().catch((error) => {
      console.error('Failed to initialize extensions:', error);
    });
  }, [initializeExtensions]);

  // Show welcome screen if no project is open
  if (!projectRoot) {
    return (
      <div className="app">
        <MenuBar />
        <WelcomeScreen />
      </div>
    );
  }

  return (
    <div className="app">
      <MenuBar />
      <header className="titlebar">
        <span className="project-name">
          {project.name}
          {isDirty && ' •'}
        </span>
        <span className="file-path">{projectRoot}</span>
      </header>

      <div className="main-layout">
        <ActivityBar
          activeView={activeView}
          onViewChange={setActiveView}
          badges={{
            files: unsavedFiles,
            sections: unsavedSections,
            entities: unsavedEntities,
            chat: 0,
          }}
        />

        <aside className="sidebar left" style={leftSidebarStyle}>
          {activeView === 'files' && <FilesPanel />}

          {activeView === 'sections' && <SectionsPanel />}

          {activeView === 'entities' && (
            <div className="panel">
              <h3>Entities</h3>
              <EntityPanel />
            </div>
          )}

          {activeView === 'chat' && <NativeAgentPanel />}

          {activeView === 'extensions' && <ExtensionsPanel />}
        </aside>

        <div
          className="sidebar-resizer"
          role="separator"
          aria-orientation="vertical"
          onMouseDown={(e) => startResizing(e.clientX)}
        />

        <main className="canvas">
          <TabBar
            tabs={openTabs}
            activeTabId={activeTabId}
            onTabClick={setActiveTab}
            onTabClose={closeTab}
          />

          {activeTab ? (
            <div className="tab-content">
              {activeTab.type === 'section' && activeSection ? (
                <SectionEditor section={activeSection} />
              ) : activeTab.type === 'file' && activeTab.content !== undefined ? (
                <FileViewer
                  content={activeTab.content}
                  fileName={activeTab.title}
                  path={activeTab.path}
                />
              ) : (
                <div className="empty-state">
                  <p>Unable to display this tab</p>
                </div>
              )}
            </div>
          ) : (
            <div className="empty-state">
              <p>No file or section opened</p>
              <p style={{ fontSize: '12px', color: '#808080', marginTop: '8px' }}>
                Open a file from the Files panel or a section from the Sections panel
              </p>
            </div>
          )}
        </main>
      </div>

      <footer className="statusbar">
        <span>{project.sections.length} sections</span>
        <span>{project.entities.length} entities</span>
        <span>{activeSection?.diagnostics.length || 0} issues</span>
      </footer>
    </div>
  );
}
