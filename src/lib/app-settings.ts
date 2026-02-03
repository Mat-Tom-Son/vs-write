import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * App-level settings (global, not project-specific)
 * Stored in localStorage for persistence across sessions
 */

export interface LLMProviderSettings {
  provider: 'openai' | 'claude' | 'ollama' | 'openrouter';
  openai: {
    apiKey: string;
    baseUrl: string;
    model: string;
  };
  anthropic: {
    apiKey: string;
    model: string;
  };
  ollama: {
    baseUrl: string;
    model: string;
  };
  openrouter: {
    apiKey: string;
    model: string;
  };
}

export interface EditorSettings {
  fontFamily: string;
  fontSize: number; // in pixels
  lineHeight: number; // multiplier (e.g., 1.5)
  showLineNumbers: boolean;
  wordWrap: boolean;
}

export interface SystemPromptSettings {
  narrativeAnalysis: string;
  consistencyChecking: string;
  agentSystemPrompt: string;
}

export interface AppSettings {
  llm: LLMProviderSettings;
  editor: EditorSettings;
  systemPrompts: SystemPromptSettings;
  maintenance: MaintenanceSettings;
}

export interface MaintenanceSettings {
  disableRipgrepFallback: boolean;
  extensionSafeMode: boolean;
  toolApprovalMode: 'auto_approve' | 'approve_dangerous' | 'approve_writes' | 'approve_all' | 'dry_run';
}

interface AppSettingsState {
  settings: AppSettings;
  updateLLMSettings: (updates: Partial<LLMProviderSettings>) => void;
  updateOpenAISettings: (updates: Partial<LLMProviderSettings['openai']>) => void;
  updateAnthropicSettings: (updates: Partial<LLMProviderSettings['anthropic']>) => void;
  updateOllamaSettings: (updates: Partial<LLMProviderSettings['ollama']>) => void;
  updateOpenRouterSettings: (updates: Partial<LLMProviderSettings['openrouter']>) => void;
  updateEditorSettings: (updates: Partial<EditorSettings>) => void;
  updateSystemPromptSettings: (updates: Partial<SystemPromptSettings>) => void;
  updateMaintenanceSettings: (updates: Partial<MaintenanceSettings>) => void;
}

// Default settings from environment variables (for initial setup)
const getDefaultSettings = (): AppSettings => ({
  llm: {
    provider: (import.meta.env.VITE_LLM_PROVIDER as 'openai' | 'claude' | 'ollama') || 'openai',
    openai: {
      apiKey: import.meta.env.VITE_OPENAI_API_KEY || '',
      baseUrl: import.meta.env.VITE_OPENAI_BASE_URL || 'https://api.openai.com/v1',
      model: import.meta.env.VITE_OPENAI_MODEL || 'gpt-5-mini',
    },
    anthropic: {
      apiKey: import.meta.env.VITE_ANTHROPIC_API_KEY || '',
      model: import.meta.env.VITE_ANTHROPIC_MODEL || 'claude-3-5-sonnet-20241022',
    },
    ollama: {
      baseUrl: import.meta.env.VITE_OLLAMA_BASE_URL || 'http://localhost:11434',
      model: import.meta.env.VITE_OLLAMA_MODEL || 'llama3.2',
    },
    openrouter: {
      apiKey: import.meta.env.VITE_OPENROUTER_API_KEY || '',
      model: import.meta.env.VITE_OPENROUTER_MODEL || 'openai/gpt-4o-mini',
    },
  },
  editor: {
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    fontSize: 16,
    lineHeight: 1.6,
    showLineNumbers: false,
    wordWrap: true,
  },
  systemPrompts: {
    narrativeAnalysis: `ROLE: Narrative Analyst
ENTITY: {{entity.name}} ({{entity.type}})
DEFINITION: {{entity.description}}
COMPLETE APPEARANCE HISTORY:
{{fullText}}
TASK: Analyze this entity's narrative presence and return JSON:
{
  "traits": ["list", "of", "demonstrated", "traits"],
  "arc": "brief description of character development or changes",
  "inconsistencies": ["any", "contradictions", "found"]
}`,
    consistencyChecking: `ROLE: Narrative Consistency Linter
OUTPUT: JSON only, no markdown
ENTITY DNA:
- Name: {{entity.name}}
- Type: {{entity.type}}
- Definition: {{entity.description}}
- Aliases: {{entity.aliases}}
ESTABLISHED HISTORY:
{{historyText}}
CURRENT SECTION [{{current.title}}]:
{{current.content}}
INSTRUCTIONS:
1. Compare CURRENT SECTION against ENTITY DNA and ESTABLISHED HISTORY
2. Identify contradictions, impossibilities, or character breaks
3. Flag only genuine inconsistencies, not stylistic choices
4. For each issue, quote the problematic text snippet
RESPONSE FORMAT:
{
  "diagnostics": [
    {
      "severity": "warning" | "critical" | "info",
      "message": "Description of the inconsistency",
      "suggestion": "How to fix it (optional)",
      "textSnippet": "exact quote from current section"
    }
  ],
  "summary": "Overall consistency assessment"
}
If no issues found, return: {"diagnostics": [], "summary": "No inconsistencies detected."}`,
    agentSystemPrompt: `You are a helpful writing assistant embedded in VS Write.

PROJECT: {{project.name}}
SYNOPSIS: {{project.synopsis}}
LOCATION: {{project.root}}

SECTIONS ({{sectionCount}} total):
{{sectionList}}

ENTITIES ({{entityCount}} total):
{{entitySummary}}

CAPABILITIES:
- read_file: Read files (text, markdown, scripts, etc.)
- write_file: Create or overwrite files (requires force=true for existing files)
- append_file: Add content to existing files
- list_dir: Browse folder contents
- glob: Find files by pattern (e.g., "*.md", "chapters/*.txt")
- grep: Search file contents for text
- run_shell: Execute shell commands (git, file operations, etc.)

FILE STRUCTURE:
{{fileStructure}}

RULES:
- Work ONLY within the workspace root - never access external paths
- Prefer built-in tools (read_file/list_dir/glob/grep) over run_shell whenever possible
- If you must use run_shell, use POSIX-compatible commands (macOS/Linux) and avoid Windows-only commands
- You already know the project structure above - use it to read files directly
- Be respectful of existing content - confirm before overwriting
- Summarize large outputs; don't overwhelm the user
- Mention specific file paths and results clearly
- If something fails, explain what went wrong and suggest solutions
- Reference the entities and sections by name when discussing the project

RESPONSE STYLE:
- Be concise but friendly
- Focus on helping with writing tasks (organizing, editing, tracking, searching)
- When asked about story content, read the relevant files directly using the structure above
- Suggest helpful next steps when appropriate`,
  },
  maintenance: {
    disableRipgrepFallback: false,
    extensionSafeMode: false,
    toolApprovalMode: 'approve_dangerous',
  },
});

export const useAppSettings = create<AppSettingsState>()(
  persist(
    (set) => ({
      settings: getDefaultSettings(),

      updateLLMSettings: (updates) =>
        set((state) => ({
          settings: {
            ...state.settings,
            llm: { ...state.settings.llm, ...updates },
          },
        })),

      updateOpenAISettings: (updates) =>
        set((state) => ({
          settings: {
            ...state.settings,
            llm: {
              ...state.settings.llm,
              openai: { ...state.settings.llm.openai, ...updates },
            },
          },
        })),

      updateAnthropicSettings: (updates) =>
        set((state) => ({
          settings: {
            ...state.settings,
            llm: {
              ...state.settings.llm,
              anthropic: { ...state.settings.llm.anthropic, ...updates },
            },
          },
        })),

      updateOllamaSettings: (updates) =>
        set((state) => ({
          settings: {
            ...state.settings,
            llm: {
              ...state.settings.llm,
              ollama: { ...state.settings.llm.ollama, ...updates },
            },
          },
        })),

      updateOpenRouterSettings: (updates) =>
        set((state) => ({
          settings: {
            ...state.settings,
            llm: {
              ...state.settings.llm,
              openrouter: { ...state.settings.llm.openrouter, ...updates },
            },
          },
        })),

      updateEditorSettings: (updates) =>
        set((state) => ({
          settings: {
            ...state.settings,
            editor: { ...state.settings.editor, ...updates },
          },
        })),

      updateSystemPromptSettings: (updates) =>
        set((state) => ({
          settings: {
            ...state.settings,
            systemPrompts: { ...state.settings.systemPrompts, ...updates },
          },
        })),

      updateMaintenanceSettings: (updates) =>
        set((state) => ({
          settings: {
            ...state.settings,
            maintenance: { ...state.settings.maintenance, ...updates },
          },
        })),
    }),
    {
      name: 'story-ide-settings', // localStorage key
      version: 3, // Increment version for new settings
    }
  )
);
