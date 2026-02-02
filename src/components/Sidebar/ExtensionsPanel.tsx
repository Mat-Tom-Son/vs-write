import { useState, useEffect, useCallback } from 'react';
import { Puzzle, CheckCircle, Download, Trash2, RefreshCw, FolderOpen } from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { NativeExtensionService, type LoadedExtension } from '../../services/NativeExtensionService';

export function ExtensionsPanel() {
  const [extensions, setExtensions] = useState<LoadedExtension[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [extensionsDir, setExtensionsDir] = useState<string | null>(null);

  // Refresh extensions list
  const refreshExtensions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await NativeExtensionService.refreshLoadedExtensions();
      setExtensions(NativeExtensionService.getLoadedExtensions());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load extensions');
    } finally {
      setLoading(false);
    }
  }, []);

  // Load extensions on mount
  useEffect(() => {
    refreshExtensions();
  }, [refreshExtensions]);

  // Get extensions directory
  useEffect(() => {
    const getExtensionsDir = async () => {
      try {
        const dir = await NativeExtensionService.getExtensionsDirectory();
        setExtensionsDir(dir);
      } catch (err) {
        console.error('Failed to get extensions directory:', err);
      }
    };
    getExtensionsDir();
  }, []);

  // Load extension from folder
  const handleLoadExtension = async () => {
    try {
      const selected = await open({
        title: 'Select Extension Folder',
        directory: true,
        multiple: false,
      });

      if (!selected || typeof selected !== 'string') return;

      setLoading(true);
      setError(null);

      await NativeExtensionService.loadExtension(selected);
      await refreshExtensions();

      alert('Extension loaded successfully!');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load extension');
      alert(`Failed to load extension: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  };

  // Unload extension
  const handleUnloadExtension = async (extensionId: string) => {
    const confirmed = confirm(`Are you sure you want to unload "${extensionId}"?`);
    if (!confirmed) return;

    try {
      setLoading(true);
      await NativeExtensionService.unloadExtension(extensionId);
      await refreshExtensions();
    } catch (err) {
      alert(`Failed to unload extension: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  };

  // Open extensions folder
  const handleOpenExtensionsDir = async () => {
    if (!extensionsDir) return;
    try {
      await invoke('reveal_path', { path: extensionsDir });
    } catch (err) {
      console.error('Failed to open extensions directory:', err);
    }
  };

  return (
    <div className="panel" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 8px', marginBottom: '8px' }}>
        <h3 style={{ margin: 0 }}>Lua Extensions</h3>
        <div style={{ display: 'flex', gap: '4px' }}>
          <button
            onClick={refreshExtensions}
            disabled={loading}
            style={{
              padding: '6px',
              backgroundColor: 'transparent',
              border: '1px solid #333',
              borderRadius: '4px',
              cursor: loading ? 'wait' : 'pointer',
            }}
            title="Refresh extensions"
          >
            <RefreshCw size={14} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
          </button>
          <button
            onClick={handleLoadExtension}
            disabled={loading}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 12px',
              fontSize: '12px',
              backgroundColor: '#2563eb',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: loading ? 'wait' : 'pointer',
              opacity: loading ? 0.6 : 1,
            }}
            title="Load extension from folder"
          >
            <Download size={14} />
            Load
          </button>
        </div>
      </div>

      {/* Error message */}
      {error && (
        <div style={{ padding: '8px', margin: '0 8px 8px', backgroundColor: '#7f1d1d', borderRadius: '4px', fontSize: '12px' }}>
          {error}
        </div>
      )}

      {/* Extensions list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
        {extensions.length === 0 ? (
          <div className="empty-state" style={{ padding: '24px', textAlign: 'center' }}>
            <Puzzle size={48} style={{ margin: '0 auto 16px', opacity: 0.3 }} />
            <p style={{ color: '#808080', fontSize: '14px', marginBottom: '8px' }}>
              No extensions loaded
            </p>
            <p style={{ color: '#606060', fontSize: '12px' }}>
              Click "Load" to load a Lua extension from a folder
            </p>
          </div>
        ) : (
          extensions.map((ext) => (
            <div
              key={ext.id}
              style={{
                padding: '12px',
                marginBottom: '8px',
                border: '1px solid #333',
                borderRadius: '4px',
                backgroundColor: '#1a1a1a',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                    <Puzzle size={16} />
                    <span style={{ fontWeight: 600, fontSize: '14px' }}>{ext.name}</span>
                    <CheckCircle size={14} style={{ color: '#4ade80' }} title="Active" />
                  </div>
                  <div style={{ fontSize: '12px', color: '#808080', marginBottom: '4px' }}>
                    v{ext.version} - {ext.toolCount} tool(s)
                  </div>
                  {ext.description && (
                    <div style={{ fontSize: '12px', color: '#a0a0a0', marginTop: '8px' }}>
                      {ext.description}
                    </div>
                  )}
                  {ext.hooks.length > 0 && (
                    <div style={{ fontSize: '11px', color: '#606060', marginTop: '8px' }}>
                      <strong>Hooks:</strong> {ext.hooks.join(', ')}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => handleUnloadExtension(ext.id)}
                  disabled={loading}
                  style={{
                    padding: '6px',
                    border: '1px solid #ef4444',
                    borderRadius: '4px',
                    backgroundColor: 'transparent',
                    color: '#ef4444',
                    cursor: loading ? 'wait' : 'pointer',
                  }}
                  title="Unload extension"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Footer */}
      <div style={{ padding: '8px', fontSize: '11px', color: '#606060', borderTop: '1px solid #333' }}>
        <p style={{ marginBottom: '8px' }}>
          Lua extensions are loaded from folders containing a manifest.json file.
        </p>
        {extensionsDir && (
          <button
            onClick={handleOpenExtensionsDir}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              padding: '4px 8px',
              fontSize: '11px',
              backgroundColor: '#2a2a2a',
              color: '#d0d0d0',
              border: '1px solid #3a3a3a',
              borderRadius: '4px',
              cursor: 'pointer',
            }}
          >
            <FolderOpen size={12} />
            Open Extensions Folder
          </button>
        )}
      </div>

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
