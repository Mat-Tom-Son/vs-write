import { useState, useEffect, useCallback } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { ChevronRight, ChevronDown, File, Folder, FolderOpen, RefreshCw } from 'lucide-react';
import { readDir, exists, readTextFile } from '@tauri-apps/plugin-fs';
import { useStoryStore, type EditorTab } from '../../lib/store';

interface FileNode {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: FileNode[];
  isExpanded?: boolean;
}

interface FileTreeItemProps {
  node: FileNode;
  level: number;
  onToggle: (path: string) => void;
  onFileClick?: (path: string) => void;
  onContextMenu?: (event: ReactMouseEvent, node: FileNode) => void;
}

function FileTreeItem({ node, level, onToggle, onFileClick, onContextMenu }: FileTreeItemProps) {
  const handleClick = () => {
    if (node.isDirectory) {
      onToggle(node.path);
    } else if (onFileClick) {
      onFileClick(node.path);
    }
  };

  return (
    <div className="file-tree-item">
      <button
        className="file-tree-button"
        onClick={handleClick}
        style={{ paddingLeft: `${level * 12 + 8}px` }}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onContextMenu?.(event, node);
        }}
      >
        {node.isDirectory ? (
          <>
            {node.isExpanded ? (
              <ChevronDown className="file-tree-icon" size={16} />
            ) : (
              <ChevronRight className="file-tree-icon" size={16} />
            )}
            {node.isExpanded ? (
              <FolderOpen className="file-tree-icon" size={16} />
            ) : (
              <Folder className="file-tree-icon" size={16} />
            )}
          </>
        ) : (
          <>
            <span className="file-tree-icon-spacer" />
            <File className="file-tree-icon" size={16} />
          </>
        )}
        <span className="file-tree-name">{node.name}</span>
      </button>
      {node.isDirectory && node.isExpanded && node.children && (
        <div className="file-tree-children">
          {node.children.map((child) => (
            <FileTreeItem
              key={child.path}
              node={child}
              level={level + 1}
              onToggle={onToggle}
              onFileClick={onFileClick}
              onContextMenu={onContextMenu}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function FilesPanel() {
  const projectRoot = useStoryStore((state) => state.projectRoot);
  const openTab = useStoryStore((state) => state.openTab);
  const fileTreeVersion = useStoryStore((state) => state.fileTreeVersion);
  const [fileTree, setFileTree] = useState<FileNode[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const projectLabel = projectRoot?.split(/[/\\]/).pop() || 'Files';
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; node: FileNode } | null>(null);

  const loadDirectory = useCallback(async (path: string): Promise<FileNode[]> => {
    try {
      const dirExists = await exists(path);
      if (!dirExists) {
        return [];
      }

      const entries = await readDir(path);
      const nodes: FileNode[] = [];

      // Sort: directories first, then files, alphabetically within each group
      const sorted = entries.sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) {
          return a.isDirectory ? -1 : 1;
        }
        return (a.name || '').localeCompare(b.name || '');
      });

      for (const entry of sorted) {
        if (!entry.name) continue;

        // Skip hidden files and node_modules
        if (entry.name.startsWith('.') || entry.name === 'node_modules') {
          continue;
        }

        const fullPath = `${path}/${entry.name}`;
        nodes.push({
          name: entry.name,
          path: fullPath,
          isDirectory: entry.isDirectory || false,
          isExpanded: false,
          children: entry.isDirectory ? [] : undefined,
        });
      }

      return nodes;
    } catch (err) {
      console.error('Failed to read directory:', err);
      return [];
    }
  }, []);

  const loadFileTree = useCallback(async () => {
    if (!projectRoot) {
      setFileTree([]);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const nodes = await loadDirectory(projectRoot);
      setFileTree(nodes);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load files');
      console.error('Failed to load file tree:', err);
    } finally {
      setIsLoading(false);
    }
  }, [projectRoot, loadDirectory]);

  useEffect(() => {
    loadFileTree();
  }, [loadFileTree, fileTreeVersion]);

  useEffect(() => {
    const handleFocus = () => {
      loadFileTree();
    };

    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [loadFileTree]);

  useEffect(() => {
    if (!contextMenu) return;
    const handleClick = () => setContextMenu(null);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setContextMenu(null);
    };
    window.addEventListener('click', handleClick);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('click', handleClick);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [contextMenu]);

  const replaceNode = useCallback((nodes: FileNode[], path: string, updater: (node: FileNode) => FileNode): FileNode[] => {
    return nodes.map((node) => {
      if (node.path === path) {
        return updater(node);
      }
      if (node.children?.length) {
        return {
          ...node,
          children: replaceNode(node.children, path, updater),
        };
      }
      return node;
    });
  }, []);

  const toggleDirectory = useCallback(
    async (path: string) => {
      const updateNode = async (nodes: FileNode[]): Promise<FileNode[]> => {
        const updated: FileNode[] = [];

        for (const node of nodes) {
          if (node.path === path && node.isDirectory) {
            // Toggle this directory
            const isExpanded = !node.isExpanded;
            let children = node.children;

            // Load children if expanding for the first time
            if (isExpanded && (!children || children.length === 0)) {
              children = await loadDirectory(path);
            }

            updated.push({
              ...node,
              isExpanded,
              children,
            });
          } else if (node.children) {
            // Recursively update children
            updated.push({
              ...node,
              children: await updateNode(node.children),
            });
          } else {
            updated.push(node);
          }
        }

        return updated;
      };

      setFileTree(await updateNode(fileTree));
    },
    [fileTree, loadDirectory]
  );

  const handleFileClick = useCallback(
    async (path: string) => {
      if (!projectRoot) return;

      try {
        // Extract filename from path
        const fileName = path.split(/[/\\]/).pop() || path;

        // Read file content
        const content = await readTextFile(path);

        // Create a tab for this file
        const tab: EditorTab = {
          id: path, // Use path as unique ID
          title: fileName,
          path: path,
          type: 'file',
          content: content,
        };

        // Open the tab
        openTab(tab);
      } catch (err) {
        console.error('Failed to open file:', err);
        setError(err instanceof Error ? err.message : 'Failed to open file');
      }
    },
    [projectRoot, openTab]
  );

  const handleContextMenu = useCallback((event: ReactMouseEvent, node: FileNode) => {
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      node,
    });
  }, []);

  const handleOpenFromMenu = useCallback(async () => {
    if (!contextMenu) return;
    if (contextMenu.node.isDirectory) {
      await toggleDirectory(contextMenu.node.path);
    } else {
      await handleFileClick(contextMenu.node.path);
    }
    setContextMenu(null);
  }, [contextMenu, toggleDirectory, handleFileClick]);

  const handleCopyPath = useCallback(async () => {
    if (!contextMenu) return;
    try {
      if (!navigator.clipboard) {
        console.warn('Clipboard API not available');
      } else {
        await navigator.clipboard.writeText(contextMenu.node.path);
      }
    } catch (err) {
      console.error('Failed to copy path:', err);
    }
    setContextMenu(null);
  }, [contextMenu]);

  const handleRevealInExplorer = useCallback(async () => {
    if (!contextMenu) return;
    try {
      const targetPath = contextMenu.node.isDirectory
        ? contextMenu.node.path
        : contextMenu.node.path.replace(/[/\\][^/\\]+$/, '');
      const resolvedPath = targetPath || contextMenu.node.path;
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('reveal_path', { path: resolvedPath });
    } catch (err) {
      console.error('Failed to reveal file:', err);
    }
    setContextMenu(null);
  }, [contextMenu]);

  const handleRefreshTarget = useCallback(async () => {
    if (!contextMenu) return;
    if (contextMenu.node.isDirectory) {
      const children = await loadDirectory(contextMenu.node.path);
      setFileTree((prev) =>
        replaceNode(prev, contextMenu.node.path, (node) => ({
          ...node,
          isExpanded: true,
          children,
        }))
      );
    } else {
      await loadFileTree();
    }
    setContextMenu(null);
  }, [contextMenu, loadDirectory, loadFileTree, replaceNode]);

  const handleCollapseTarget = useCallback(() => {
    if (!contextMenu || !contextMenu.node.isDirectory) return;
    setFileTree((prev) =>
      replaceNode(prev, contextMenu.node.path, (node) => ({
        ...node,
        isExpanded: false,
      }))
    );
    setContextMenu(null);
  }, [contextMenu, replaceNode]);

  if (!projectRoot) {
    return (
      <div className="files-panel">
        <div className="panel-header">
          <h3>Files</h3>
        </div>
        <div className="empty-state">
          <p className="text-sm text-muted-foreground">No project opened</p>
        </div>
      </div>
    );
  }

  return (
    <div className="files-panel">
      <div className="panel-header files-panel-header">
        <div className="files-header-text">
          <h3>{projectLabel}</h3>
          <span className="files-header-subtitle">File explorer</span>
        </div>
        <button
          className="refresh-button subtle"
          onClick={loadFileTree}
          disabled={isLoading}
          title="Refresh file tree"
          aria-label="Refresh file tree"
        >
          <RefreshCw size={16} className={isLoading ? 'spinning' : ''} />
        </button>
      </div>

      {error && (
        <div className="error-message">
          <p className="text-sm text-red-500">{error}</p>
        </div>
      )}

      <div className="file-tree">
        {isLoading && fileTree.length === 0 ? (
          <div className="loading-state">
            <p className="text-sm text-muted-foreground">Loading files...</p>
          </div>
        ) : fileTree.length === 0 ? (
          <div className="empty-state">
            <p className="text-sm text-muted-foreground">No files found</p>
          </div>
        ) : (
          fileTree.map((node) => (
            <FileTreeItem
              key={node.path}
              node={node}
              level={0}
              onToggle={toggleDirectory}
              onFileClick={handleFileClick}
              onContextMenu={handleContextMenu}
            />
          ))
        )}
      </div>

      {contextMenu && (
        <div
          className="file-context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          role="menu"
        >
          <button onClick={() => void handleOpenFromMenu()}>
            {contextMenu.node.isDirectory ? 'Open Folder' : 'Open File'}
          </button>
          {contextMenu.node.isDirectory && (
            <button onClick={handleCollapseTarget}>
              {contextMenu.node.isExpanded ? 'Collapse Folder' : 'Collapse'}
            </button>
          )}
          <button onClick={() => void handleRefreshTarget()}>Refresh</button>
          <button onClick={() => void handleCopyPath()}>Copy Path</button>
          <button onClick={() => void handleRevealInExplorer()}>
            Reveal in Explorer
          </button>
        </div>
      )}
    </div>
  );
}
