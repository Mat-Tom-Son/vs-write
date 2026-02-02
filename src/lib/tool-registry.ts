/**
 * Tool Registry - Comprehensive metadata for all agentic AI tools
 *
 * Provides tool definitions, parameters, examples, and documentation
 * to help users understand what the AI agent can do.
 */

export type ToolCategory = 'file' | 'search' | 'execution' | 'navigation';

export interface ToolParameter {
  name: string;
  type: 'string' | 'integer' | 'boolean';
  description: string;
  required: boolean;
  default?: string | number | boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  category: ToolCategory;
  icon: string; // lucide-react icon name
  parameters: ToolParameter[];
  examples: string[];
  documentation: string;
  tips?: string[];
}

export const TOOL_REGISTRY: ToolDefinition[] = [
  {
    name: 'read_file',
    description: 'Read content from files (text, markdown, scripts, etc.)',
    category: 'file',
    icon: 'FileText',
    parameters: [
      {
        name: 'path',
        type: 'string',
        description: 'Path to the file to read',
        required: true,
      },
      {
        name: 'offset',
        type: 'integer',
        description: 'Starting line number (1-indexed)',
        required: false,
        default: 1,
      },
      {
        name: 'limit',
        type: 'integer',
        description: 'Maximum number of lines to read',
        required: false,
        default: 4000,
      },
    ],
    examples: [
      'Show me the first chapter',
      'Read the character file for Alice',
      'What\'s in the outline document?',
      'Show me lines 50-100 of chapter 3',
    ],
    documentation: 'Reads text files with optional line range control. Supports all text-based formats including markdown, plain text, scripts, and more. Use offset and limit to read specific sections of large files.',
    tips: [
      'For large files, use offset and limit to read specific sections',
      'The agent can read multiple files in one response',
    ],
  },
  {
    name: 'write_file',
    description: 'Create new files or overwrite existing ones',
    category: 'file',
    icon: 'FilePlus',
    parameters: [
      {
        name: 'path',
        type: 'string',
        description: 'Path where the file should be written',
        required: true,
      },
      {
        name: 'content',
        type: 'string',
        description: 'Content to write to the file',
        required: true,
      },
      {
        name: 'force',
        type: 'boolean',
        description: 'Must be true to overwrite existing files',
        required: false,
        default: false,
      },
    ],
    examples: [
      'Create a new character profile for Bob',
      'Write an outline for the next chapter',
      'Create a notes file for worldbuilding ideas',
      'Update the character file (requires force=true)',
    ],
    documentation: 'Creates new files or overwrites existing ones. For safety, attempting to write to an existing file without force=true will fail. The agent will typically ask for confirmation before overwriting.',
    tips: [
      'The agent asks for confirmation before overwriting existing files',
      'Use append_file if you want to add to existing content',
    ],
  },
  {
    name: 'append_file',
    description: 'Add content to the end of existing files',
    category: 'file',
    icon: 'FileEdit',
    parameters: [
      {
        name: 'path',
        type: 'string',
        description: 'Path to the file to append to',
        required: true,
      },
      {
        name: 'content',
        type: 'string',
        description: 'Content to append to the file',
        required: true,
      },
    ],
    examples: [
      'Add a new scene to chapter 5',
      'Append these notes to my research file',
      'Add this character trait to Alice\'s profile',
      'Add a new entry to my writing journal',
    ],
    documentation: 'Appends content to the end of existing files. If the file doesn\'t exist, it will be created. This is safer than write_file for adding to existing content since it won\'t overwrite.',
    tips: [
      'Creates the file if it doesn\'t exist',
      'Safer than write_file for adding to existing content',
    ],
  },
  {
    name: 'list_dir',
    description: 'Browse folder contents and directory structure',
    category: 'navigation',
    icon: 'FolderOpen',
    parameters: [
      {
        name: 'path',
        type: 'string',
        description: 'Path to the directory to list (defaults to project root)',
        required: false,
        default: '.',
      },
    ],
    examples: [
      'What files are in my project?',
      'Show me the contents of the characters folder',
      'List all directories in my workspace',
      'What\'s in the chapters directory?',
    ],
    documentation: 'Lists all files and directories at the specified path. Returns both files and subdirectories. Useful for exploring project structure and discovering what files exist.',
    tips: [
      'Use this first to understand your project structure',
      'Returns both files and subdirectories',
    ],
  },
  {
    name: 'glob',
    description: 'Find files matching a pattern (e.g., "*.md", "chapters/*.txt")',
    category: 'search',
    icon: 'Search',
    parameters: [
      {
        name: 'pattern',
        type: 'string',
        description: 'Glob pattern to match files (e.g., "*.md", "**/*.txt")',
        required: true,
      },
      {
        name: 'path',
        type: 'string',
        description: 'Starting directory for the search',
        required: false,
        default: '.',
      },
    ],
    examples: [
      'Find all markdown files',
      'List all .txt files in the chapters folder',
      'Find all character files',
      'Show me all draft files',
    ],
    documentation: 'Searches for files matching glob patterns. Supports wildcards: * matches any characters, ** matches directories recursively. Very useful for finding files by type or naming convention.',
    tips: [
      'Use * to match any characters: "chapter*.md"',
      'Use ** for recursive search: "**/*.txt" finds all .txt files',
      'Combine patterns: "draft_*.md" finds draft files',
    ],
  },
  {
    name: 'grep',
    description: 'Search file contents for text or patterns',
    category: 'search',
    icon: 'SearchCode',
    parameters: [
      {
        name: 'pattern',
        type: 'string',
        description: 'Text or pattern to search for',
        required: true,
      },
      {
        name: 'path',
        type: 'string',
        description: 'Directory or file to search in',
        required: false,
        default: '.',
      },
    ],
    examples: [
      'Find mentions of Alice in all files',
      'Search for "magic system" in my notes',
      'Where did I mention the sword?',
      'Find all TODO comments in the project',
    ],
    documentation: 'Searches file contents for text patterns. Returns matching lines with their file locations. Extremely useful for finding references to characters, plot points, or specific text across your entire project.',
    tips: [
      'Case-sensitive by default',
      'Returns the matching line and file location',
      'Great for finding character mentions or plot points',
    ],
  },
  {
    name: 'run_shell',
    description: 'Execute shell commands (git, file operations, etc.)',
    category: 'execution',
    icon: 'Terminal',
    parameters: [
      {
        name: 'command',
        type: 'string',
        description: 'Shell command to execute',
        required: true,
      },
      {
        name: 'timeout',
        type: 'integer',
        description: 'Maximum execution time in seconds',
        required: false,
        default: 30,
      },
      {
        name: 'workdir',
        type: 'string',
        description: 'Working directory for the command',
        required: false,
      },
    ],
    examples: [
      'Run git status to see changes',
      'Create a backup of my drafts folder',
      'Count the number of words in all chapters',
      'Commit my latest changes to git',
    ],
    documentation: 'Executes shell commands within the workspace. Useful for git operations, file management, running scripts, and other command-line tasks. Commands are sandboxed to the workspace for safety.',
    tips: [
      'All commands run within your workspace (safe sandbox)',
      'Great for git operations and automation',
      'Use timeout for long-running commands',
    ],
  },
  {
    name: 'run_python',
    description: 'Run Python scripts for data processing or analysis',
    category: 'execution',
    icon: 'Code',
    parameters: [
      {
        name: 'code',
        type: 'string',
        description: 'Python code to execute',
        required: true,
      },
      {
        name: 'timeout',
        type: 'integer',
        description: 'Maximum execution time in seconds',
        required: false,
        default: 30,
      },
    ],
    examples: [
      'Count words across all chapters',
      'Analyze character appearances in scenes',
      'Calculate reading time for each chapter',
      'Generate statistics about my writing',
    ],
    documentation: 'Executes Python code for data analysis, processing, and calculations. Runs in a scratch directory with access to common libraries. Perfect for generating statistics, analyzing text, or processing data.',
    tips: [
      'Useful for text analysis and statistics',
      'Has access to common Python libraries',
      'Runs in an isolated environment for safety',
    ],
  },
];

/**
 * Get tool by name
 */
export function getToolByName(name: string): ToolDefinition | undefined {
  return TOOL_REGISTRY.find(tool => tool.name === name);
}

/**
 * Get tools by category
 */
export function getToolsByCategory(category: ToolCategory): ToolDefinition[] {
  return TOOL_REGISTRY.filter(tool => tool.category === category);
}

/**
 * Search tools by keyword (searches name, description, examples)
 */
export function searchTools(query: string): ToolDefinition[] {
  const lowerQuery = query.toLowerCase();
  return TOOL_REGISTRY.filter(tool =>
    tool.name.toLowerCase().includes(lowerQuery) ||
    tool.description.toLowerCase().includes(lowerQuery) ||
    tool.examples.some(ex => ex.toLowerCase().includes(lowerQuery)) ||
    tool.documentation.toLowerCase().includes(lowerQuery)
  );
}

/**
 * Get all available categories
 */
export function getCategories(): ToolCategory[] {
  return ['file', 'search', 'execution', 'navigation'];
}

/**
 * Get category display name
 */
export function getCategoryDisplayName(category: ToolCategory): string {
  const names: Record<ToolCategory, string> = {
    file: 'File Operations',
    search: 'Search & Discovery',
    execution: 'Code Execution',
    navigation: 'Navigation & Browsing',
  };
  return names[category];
}

/**
 * Get category icon
 */
export function getCategoryIcon(category: ToolCategory): string {
  const icons: Record<ToolCategory, string> = {
    file: 'Files',
    search: 'Search',
    execution: 'Play',
    navigation: 'Compass',
  };
  return icons[category];
}
