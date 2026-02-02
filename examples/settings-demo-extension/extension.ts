/**
 * Settings Demo Extension - Demonstrates all settings types
 *
 * This extension showcases the full capabilities of the extension settings system,
 * including all supported data types and UI controls.
 */

import { defineExtension } from '../../src/lib/extension-api';

export default defineExtension({
  id: 'settings-demo',
  name: 'Settings Demo',
  displayName: 'Settings Demo Extension',
  version: '1.0.0',
  author: 'VS Write Team',
  description: 'Demonstrates all extension settings types and features',
  categories: ['demo', 'development'],

  permissions: {
    settings: true,
    filesystem: 'project',
  },

  settings: {
    schema: {
      type: 'object',
      properties: {
        // String input
        apiKey: {
          type: 'string',
          description: 'API key for external service',
          default: '',
        },

        // String with enum (dropdown)
        theme: {
          type: 'string',
          description: 'Preferred theme',
          default: 'auto',
          enum: ['auto', 'light', 'dark', 'high-contrast'],
        },

        // Boolean (checkbox)
        enableNotifications: {
          type: 'boolean',
          description: 'Show notifications when tasks complete',
          default: true,
        },

        // Integer
        maxRetries: {
          type: 'integer',
          description: 'Maximum number of retry attempts',
          default: 3,
          minimum: 0,
          maximum: 10,
        },

        // Number (float)
        timeout: {
          type: 'number',
          description: 'Timeout in seconds',
          default: 30.0,
          minimum: 1.0,
          maximum: 300.0,
        },

        // Array (comma-separated)
        ignoredFiles: {
          type: 'array',
          description: 'Files to ignore (comma-separated patterns)',
          default: ['node_modules', '.git', 'dist'],
        },

        // Another boolean
        debugMode: {
          type: 'boolean',
          description: 'Enable debug logging',
          default: false,
        },

        // String enum
        logLevel: {
          type: 'string',
          description: 'Logging level',
          default: 'info',
          enum: ['debug', 'info', 'warn', 'error', 'none'],
        },
      },
    },
  },

  lifecycle: {
    onActivate: async (ctx) => {
      console.log('[SettingsDemo] Extension activated');

      // Demonstrate reading settings
      const apiKey = ctx.settings.get('apiKey', '');
      const theme = ctx.settings.get('theme', 'auto');
      const enableNotifications = ctx.settings.get('enableNotifications', true);
      const maxRetries = ctx.settings.get('maxRetries', 3);
      const timeout = ctx.settings.get('timeout', 30.0);
      const ignoredFiles = ctx.settings.get('ignoredFiles', []);
      const debugMode = ctx.settings.get('debugMode', false);
      const logLevel = ctx.settings.get('logLevel', 'info');

      console.log('[SettingsDemo] Current settings:', {
        apiKey: apiKey ? '***' : '(not set)',
        theme,
        enableNotifications,
        maxRetries,
        timeout,
        ignoredFiles,
        debugMode,
        logLevel,
      });

      if (enableNotifications) {
        ctx.ui.showNotification('Settings Demo Extension activated!', 'info');
      }
    },
  },
});
