import { useEffect, useMemo, useState } from 'react';
import { open, message } from '@tauri-apps/plugin-dialog';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { formatError } from '@/lib/errors';

function slugifyProjectName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  return slug.length > 0 ? slug.slice(0, 64) : 'untitled-project';
}

export interface NewProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (projectRoot: string, projectName: string) => Promise<void>;
}

export function NewProjectDialog({ open: isOpen, onOpenChange, onCreate }: NewProjectDialogProps) {
  const [projectName, setProjectName] = useState('');
  const [parentFolder, setParentFolder] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  useEffect(() => {
    if (isOpen) return;
    setProjectName('');
    setParentFolder(null);
    setIsCreating(false);
  }, [isOpen]);

  const projectSlug = useMemo(() => slugifyProjectName(projectName), [projectName]);
  const projectPath = useMemo(() => {
    if (!parentFolder) return null;
    const normalizedParent = parentFolder.replace(/\\/g, '/').replace(/\/+$/, '');
    return `${normalizedParent}/${projectSlug}`;
  }, [parentFolder, projectSlug]);

  const chooseParentFolder = async () => {
    try {
      const folderPath = await open({
        directory: true,
        multiple: false,
        recursive: true,
        title: 'Select parent folder for new project',
      });
      if (folderPath && typeof folderPath === 'string') {
        setParentFolder(folderPath);
      }
    } catch (error) {
      console.error('Failed to select folder:', error);
      await message(
        `Failed to select folder: ${formatError(error)}`,
        { kind: 'error' },
      );
    }
  };

  const createProject = async () => {
    const name = projectName.trim();
    if (!name) {
      await message('Enter a project name.', { kind: 'warning' });
      return;
    }
    if (!projectPath) {
      await message('Select a parent folder.', { kind: 'warning' });
      return;
    }

    setIsCreating(true);
    try {
      await onCreate(projectPath, name);
      onOpenChange(false);
    } catch (error) {
      console.error('Failed to create project:', error);
      await message(
        `Failed to create project: ${formatError(error)}`,
        { kind: 'error' },
      );
      setIsCreating(false);
    }
  };

  const canCreate = projectName.trim().length > 0 && !!projectPath && !isCreating;

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>New Project</DialogTitle>
          <DialogDescription>Create a new VS Write project folder.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="new-project-name" className="text-sm font-medium">
              Project name
            </label>
            <Input
              id="new-project-name"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              placeholder="My New Project"
              autoFocus
              disabled={isCreating}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && canCreate) {
                  e.preventDefault();
                  createProject();
                }
              }}
            />
            <p className="text-xs text-muted-foreground">
              Folder name: <span className="font-mono">{projectSlug}</span>
            </p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <label className="text-sm font-medium">Parent folder</label>
              <Button type="button" variant="outline" onClick={chooseParentFolder} disabled={isCreating}>
                Choose…
              </Button>
            </div>
            <Input value={parentFolder ?? ''} readOnly placeholder="No folder selected" />
            {projectPath && (
              <p className="text-xs text-muted-foreground">
                Project path: <span className="font-mono">{projectPath}</span>
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={isCreating}>
            Cancel
          </Button>
          <Button type="button" onClick={createProject} disabled={!canCreate}>
            {isCreating ? 'Creating…' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
