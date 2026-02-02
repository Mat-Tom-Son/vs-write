import type { ExtensionPanelProps } from '../../src/lib/extension-api';

export default function StarterPanel({ context }: ExtensionPanelProps) {
  const projectName = context.project?.name || 'No Project';
  const logLevel = context.settings.get('logLevel', 'info');

  return (
    <div style={{ padding: 12, fontFamily: 'ui-sans-serif, system-ui' }}>
      <h3 style={{ marginBottom: 8 }}>Starter Panel</h3>
      <p style={{ margin: '4px 0' }}>Project: {projectName}</p>
      <p style={{ margin: '4px 0' }}>Log level: {logLevel}</p>
      <button
        style={{ marginTop: 8 }}
        onClick={() => context.ui.showNotification('Starter panel is live!', 'info')}
      >
        Test Notification
      </button>
    </div>
  );
}
