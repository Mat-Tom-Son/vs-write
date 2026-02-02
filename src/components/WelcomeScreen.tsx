import { open } from '@tauri-apps/plugin-dialog';
import { useStoryStore } from '../lib/store';
import './WelcomeScreen.css';

export function WelcomeScreen() {
  const createNewProject = useStoryStore((s) => s.createNewProject);
  const openProject = useStoryStore((s) => s.openProject);

  const handleNewProject = async () => {
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

  return (
    <div className="welcome-screen">
      <div className="welcome-content">
        <h1>VS Write</h1>
        <p className="subtitle">Folder-based writing environment</p>

        <div className="welcome-actions">
          <button className="primary-button" onClick={handleNewProject}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M14 2H8.5L7.15 0.65C7.05 0.55 6.9 0.5 6.75 0.5H2C1.45 0.5 1 0.95 1 1.5V14.5C1 15.05 1.45 15.5 2 15.5H14C14.55 15.5 15 15.05 15 14.5V3C15 2.45 14.55 2 14 2ZM14 14.5H2V1.5H6.75L8.1 2.85C8.2 2.95 8.35 3 8.5 3H14V14.5Z"/>
              <path d="M8.5 6.5H7V8H5.5V9.5H7V11H8.5V9.5H10V8H8.5V6.5Z"/>
            </svg>
            New Project
          </button>

          <button className="secondary-button" onClick={handleOpenProject}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M14 2H8.5L7.15 0.65C7.05 0.55 6.9 0.5 6.75 0.5H2C1.45 0.5 1 0.95 1 1.5V14.5C1 15.05 1.45 15.5 2 15.5H14C14.55 15.5 15 15.05 15 14.5V3C15 2.45 14.55 2 14 2ZM14 14.5H2V1.5H6.75L8.1 2.85C8.2 2.95 8.35 3 8.5 3H14V14.5Z"/>
            </svg>
            Open Project
          </button>
        </div>

        <div className="welcome-info">
          <h3>Getting Started</h3>
          <ul>
            <li>Projects are stored as folders on your filesystem</li>
            <li>Each entity is a separate YAML file</li>
            <li>Each section is a Markdown file with frontmatter</li>
            <li>All changes are tracked in a local SQLite database</li>
          </ul>
        </div>

        <div className="welcome-shortcuts">
          <h3>Keyboard Shortcuts</h3>
          <div className="shortcut-list">
            <div>
              <kbd>Ctrl+N</kbd>
              <span>New Project</span>
            </div>
            <div>
              <kbd>Ctrl+O</kbd>
              <span>Open Project</span>
            </div>
            <div>
              <kbd>Ctrl+S</kbd>
              <span>Save</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
