import { useState } from 'react';
import { confirm as confirmDialog, message, open } from '@tauri-apps/plugin-dialog';
import { useStoryStore } from '../lib/store';
import { modifierKeyLabel } from '../lib/platform';
import { formatError } from '../lib/errors';
import './MenuBar.css';

export interface MenuBarProps {
  onNewProject?: () => void;
  onOpenSettings?: () => void;
}

export function MenuBar({ onNewProject, onOpenSettings }: MenuBarProps) {
  const [activeMenu, setActiveMenu] = useState<string | null>(null);
  const modKey = modifierKeyLabel();
  const projectRoot = useStoryStore((s) => s.projectRoot);
  const isDirty = useStoryStore((s) => s.isDirty);
  const openProject = useStoryStore((s) => s.openProject);
  const saveProject = useStoryStore((s) => s.saveProject);
  const closeProject = useStoryStore((s) => s.closeProject);

  const handleNewProject = async () => {
    setActiveMenu(null);
    onNewProject?.();
  };

  const handleOpenProject = async () => {
    setActiveMenu(null);

    const folderPath = await open({
      directory: true,
      multiple: false,
      recursive: true,
      title: 'Open VS Write Project',
    });

    if (folderPath && typeof folderPath === 'string') {
      try {
        await openProject(folderPath);
      } catch (error) {
        console.error('Failed to open project:', error);
        await message(`Failed to open project: ${formatError(error)}`, { kind: 'error' });
      }
    }
  };

  const handleSave = async () => {
    setActiveMenu(null);

    if (!projectRoot) {
      await message('No project open.', { kind: 'warning' });
      return;
    }

    try {
      await saveProject();
    } catch (error) {
      console.error('Failed to save project:', error);
      await message(`Failed to save project: ${formatError(error)}`, { kind: 'error' });
    }
  };

  const handleClose = async () => {
    setActiveMenu(null);

    if (isDirty) {
      const shouldSave = await confirmDialog('Save changes before closing?', {
        kind: 'warning',
        okLabel: 'Save',
        cancelLabel: "Don't Save",
      });
      if (shouldSave) {
        await handleSave();
      }
    }

    await closeProject();
  };

  const handleSettings = () => {
    setActiveMenu(null);
    if (!projectRoot) return;
    onOpenSettings?.();
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
                <span className="shortcut">{modKey}+N</span>
              </button>
              <button onClick={handleOpenProject}>
                <span>Open Project</span>
                <span className="shortcut">{modKey}+O</span>
              </button>
              <div className="menu-divider" />
              <button onClick={handleSave} disabled={!projectRoot}>
                <span>Save</span>
                <span className="shortcut">{modKey}+S</span>
              </button>
              <div className="menu-divider" />
              <button onClick={handleSettings} disabled={!projectRoot}>
                <span>Settings</span>
                <span className="shortcut">{modKey}+,</span>
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
                <span className="shortcut">{modKey}+Z</span>
              </button>
              <button disabled>
                <span>Redo</span>
                <span className="shortcut">{modKey}+Y</span>
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
                void message('VS Write v0.1.0\n\nA folder-based writing environment.');
              }}>
                <span>About</span>
              </button>
            </div>
          )}
        </div>
      </nav>
    </>
  );
}
