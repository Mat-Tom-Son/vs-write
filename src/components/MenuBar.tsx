import { useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { useStoryStore } from '../lib/store';
import { SettingsDialog } from './SettingsDialog';
import './MenuBar.css';

export function MenuBar() {
  const [activeMenu, setActiveMenu] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const projectRoot = useStoryStore((s) => s.projectRoot);
  const isDirty = useStoryStore((s) => s.isDirty);
  const createNewProject = useStoryStore((s) => s.createNewProject);
  const openProject = useStoryStore((s) => s.openProject);
  const saveProject = useStoryStore((s) => s.saveProject);
  const closeProject = useStoryStore((s) => s.closeProject);

  const handleNewProject = async () => {
    setActiveMenu(null);

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

      try {
        await createNewProject(projectPath, projectName);
      } catch (error) {
        console.error('Failed to create project:', error);
        alert(`Failed to create project: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }
  };

  const handleOpenProject = async () => {
    setActiveMenu(null);

    const folderPath = await open({
      directory: true,
      multiple: false,
      title: 'Open VS Write Project',
    });

    if (folderPath && typeof folderPath === 'string') {
      try {
        await openProject(folderPath);
      } catch (error) {
        console.error('Failed to open project:', error);
        alert('Failed to open project. See console for details.');
      }
    }
  };

  const handleSave = async () => {
    setActiveMenu(null);

    if (!projectRoot) {
      alert('No project open');
      return;
    }

    try {
      await saveProject();
    } catch (error) {
      console.error('Failed to save project:', error);
      alert('Failed to save project. See console for details.');
    }
  };

  const handleClose = async () => {
    setActiveMenu(null);

    if (isDirty) {
      const shouldSave = confirm('Save changes before closing?');
      if (shouldSave) {
        await handleSave();
      }
    }

    await closeProject();
  };

  const handleSettings = () => {
    setActiveMenu(null);
    setSettingsOpen(true);
  };

  const toggleMenu = (menu: string) => {
    setActiveMenu(activeMenu === menu ? null : menu);
  };

  const closeMenus = () => {
    setActiveMenu(null);
  };

  return (
    <>
      {activeMenu && (
        <div className="menu-overlay" onClick={closeMenus} />
      )}
      <nav className="menu-bar">
        <div className="menu-item">
          <button
            className={activeMenu === 'file' ? 'active' : ''}
            onClick={() => toggleMenu('file')}
          >
            File
          </button>
          {activeMenu === 'file' && (
            <div className="menu-dropdown">
              <button onClick={handleNewProject}>
                <span>New Project</span>
                <span className="shortcut">Ctrl+N</span>
              </button>
              <button onClick={handleOpenProject}>
                <span>Open Project</span>
                <span className="shortcut">Ctrl+O</span>
              </button>
              <div className="menu-divider" />
              <button onClick={handleSave} disabled={!projectRoot}>
                <span>Save</span>
                <span className="shortcut">Ctrl+S</span>
              </button>
              <div className="menu-divider" />
              <button onClick={handleSettings} disabled={!projectRoot}>
                <span>Settings</span>
                <span className="shortcut">Ctrl+,</span>
              </button>
              <div className="menu-divider" />
              <button onClick={handleClose} disabled={!projectRoot}>
                <span>Close Project</span>
              </button>
            </div>
          )}
        </div>

        <div className="menu-item">
          <button
            className={activeMenu === 'edit' ? 'active' : ''}
            onClick={() => toggleMenu('edit')}
          >
            Edit
          </button>
          {activeMenu === 'edit' && (
            <div className="menu-dropdown">
              <button disabled>
                <span>Undo</span>
                <span className="shortcut">Ctrl+Z</span>
              </button>
              <button disabled>
                <span>Redo</span>
                <span className="shortcut">Ctrl+Y</span>
              </button>
            </div>
          )}
        </div>

        <div className="menu-item">
          <button
            className={activeMenu === 'help' ? 'active' : ''}
            onClick={() => toggleMenu('help')}
          >
            Help
          </button>
          {activeMenu === 'help' && (
            <div className="menu-dropdown">
              <button onClick={() => {
                closeMenus();
                alert('VS Write v0.1.0\n\nA folder-based writing environment.');
              }}>
                <span>About</span>
              </button>
            </div>
          )}
        </div>
      </nav>
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </>
  );
}
