import { open, save } from '@tauri-apps/plugin-dialog';
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
import type { Project } from './schemas';
import { ProjectSchema } from './schemas';

const FILE_EXTENSION = 'story';
const FILE_FILTERS = [{ name: 'Story Project', extensions: [FILE_EXTENSION] }];

export interface FileResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  path?: string;
}

let currentFilePath: string | null = null;

export function getCurrentFilePath(): string | null {
  return currentFilePath;
}

export function setCurrentFilePath(path: string | null): void {
  currentFilePath = path;
}

export async function openProject(): Promise<FileResult<Project>> {
  try {
    const path = await open({
      multiple: false,
      filters: FILE_FILTERS,
    });

    if (!path || Array.isArray(path)) {
      return { success: false, error: 'No file selected' };
    }

    const content = await readTextFile(path);
    const json = JSON.parse(content);
    const result = ProjectSchema.safeParse(json);

    if (!result.success) {
      return { success: false, error: `Invalid project file: ${result.error.message}` };
    }

    currentFilePath = path;
    return { success: true, data: result.data, path };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to open file',
    };
  }
}

export async function saveProject(project: Project, saveAs = false): Promise<FileResult<void>> {
  try {
    let path = currentFilePath;

    if (!path || saveAs) {
      const selected = await save({
        filters: FILE_FILTERS,
        defaultPath: `${project.name}.${FILE_EXTENSION}`,
      });

      if (!selected) {
        return { success: false, error: 'Save cancelled' };
      }
      path = selected;
    }

    const projectToSave: Project = {
      ...project,
      meta: {
        ...project.meta,
        modifiedAt: new Date().toISOString(),
      },
    };

    const content = JSON.stringify(projectToSave, null, 2);
    await writeTextFile(path, content);
    currentFilePath = path;
    return { success: true, path };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to save file',
    };
  }
}

// Auto-save to temp location (crash recovery)
export async function autoSave(project: Project): Promise<void> {
  try {
    const { appDataDir } = await import('@tauri-apps/api/path');
    const dir = await appDataDir();
    const tempPath = `${dir}/autosave_${project.id}.json`;
    await writeTextFile(tempPath, JSON.stringify(project));
  } catch {
    console.warn('Autosave failed');
  }
}

// Check for recovered files on startup
export async function checkForRecovery(): Promise<Project | null> {
  try {
    const { appDataDir, join } = await import('@tauri-apps/api/path');
    const { readDir, remove } = await import('@tauri-apps/plugin-fs');

    const dir = await appDataDir();
    const entries = await readDir(dir);
    const autosaves = entries.filter(
      (e) => e.name?.startsWith('autosave_') && e.name?.endsWith('.json'),
    );
    if (autosaves.length === 0) return null;

    const latest = autosaves[0];
    if (!latest.name) return null;

    const path = await join(dir, latest.name);
    const content = await readTextFile(path);
    const project = ProjectSchema.parse(JSON.parse(content));

    await remove(path);
    return project;
  } catch {
    return null;
  }
}
