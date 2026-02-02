/**
 * Hello Extension - Simple JavaScript version (no TypeScript compilation needed)
 *
 * This version can be used directly without compiling TypeScript.
 * Just rename this to extension.js or copy its contents.
 */

// Define the extension manifest
const manifest = {
  id: 'hello-extension',
  name: 'Hello Extension',
  version: '1.0.0',
  author: 'VS Write Team',
  description: 'Simple test extension that adds a hello tool',

  permissions: {
    tools: ['read_file', 'glob'],
    filesystem: 'project',
    settings: true,
  },

  tools: [
    {
      name: 'say_hello',
      description: 'Say hello with an optional name parameter',
      category: 'custom',
      icon: 'Hand',
      pythonModule: './tools.py',
      pythonFunction: 'say_hello',
      schema: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Name to greet (optional)',
          },
        },
        required: [],
      },
      examples: [
        'Say hello to Alice',
        'Greet the user',
      ],
      documentation: 'Returns a greeting message. Optionally provide a name to personalize the greeting.',
    },
    {
      name: 'count_files',
      description: 'Count files in the project matching a pattern',
      category: 'custom',
      icon: 'FileText',
      pythonModule: './tools.py',
      pythonFunction: 'count_files',
      schema: {
        type: 'object',
        properties: {
          pattern: {
            type: 'string',
            description: 'Glob pattern (e.g., "*.md", "sections/*.txt")',
          },
        },
        required: ['pattern'],
      },
      examples: [
        'Count markdown files',
        'How many text files are in sections/?',
      ],
      documentation: 'Uses the glob tool to count files matching a pattern.',
    },
  ],

  lifecycle: {
    onActivate: async (ctx) => {
      console.log('[HelloExtension] Activated!');
      ctx.settings.set('lastActivated', new Date().toISOString());
    },

    onDeactivate: async (ctx) => {
      console.log('[HelloExtension] Deactivated');
    },

    onProjectOpen: async (ctx, project) => {
      console.log(`[HelloExtension] Project opened: ${project.name}`);
      ctx.settings.set('lastProject', project.name);
    },
  },
};

// Export for the extension system to load
// This works with the ExtensionService eval-based loader
manifest;
