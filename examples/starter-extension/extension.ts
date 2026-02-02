import { defineExtension } from '../../src/lib/extension-api';

export default defineExtension({
  id: 'starter-extension',
  name: 'Starter Extension',
  version: '0.1.0',
  permissions: {
    entityApi: {
      read: true,
      tags: true,
    },
    settings: true,
  },
  components: {
    panels: [
      {
        id: 'starter-panel',
        title: 'Starter Panel',
        icon: 'Sparkles',
        location: 'sidebar',
        component: () => import('./panel'),
      },
    ],
  },
  lifecycle: {
    onProjectOpen: true,
  },
  settings: {
    schema: {
      type: 'object',
      properties: {
        logLevel: {
          type: 'string',
          default: 'info',
          enum: ['debug', 'info', 'warn', 'error'],
        },
      },
    },
  },
});
