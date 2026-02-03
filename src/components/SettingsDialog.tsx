import { useState, useEffect } from 'react';
import { Eye, EyeOff, AlertCircle } from 'lucide-react';
import { useStoryStore } from '../lib/store';
import { useAppSettings } from '../lib/app-settings';
import { PromptEditor } from './PromptEditor';
import { ToolCard } from './Sidebar/ToolCard';
import { TOOL_REGISTRY } from '../lib/tool-registry';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type TabType = 'project' | 'editor' | 'app' | 'tools' | 'maintenance';

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const [activeTab, setActiveTab] = useState<TabType>('project');

  // Project settings
  const project = useStoryStore((state) => state.project);
  const updateProjectSettings = useStoryStore((state) => state.updateProjectSettings);
  const saveProject = useStoryStore((state) => state.saveProject);
  const [defaultAlignment, setDefaultAlignment] = useState<'left' | 'center' | 'right'>('left');

  // App settings
  const appSettings = useAppSettings((state) => state.settings);
  const updateLLMSettings = useAppSettings((state) => state.updateLLMSettings);
  const updateOpenAISettings = useAppSettings((state) => state.updateOpenAISettings);
  const updateAnthropicSettings = useAppSettings((state) => state.updateAnthropicSettings);
  const updateOllamaSettings = useAppSettings((state) => state.updateOllamaSettings);
  const updateOpenRouterSettings = useAppSettings((state) => state.updateOpenRouterSettings);
  const updateEditorSettings = useAppSettings((state) => state.updateEditorSettings);
  const updateSystemPromptSettings = useAppSettings((state) => state.updateSystemPromptSettings);
  const updateMaintenanceSettings = useAppSettings((state) => state.updateMaintenanceSettings);

  // LLM settings state
  const [provider, setProvider] = useState<'openai' | 'claude' | 'ollama' | 'openrouter'>('openai');
  const [openaiApiKey, setOpenaiApiKey] = useState('');
  const [openaiBaseUrl, setOpenaiBaseUrl] = useState('');
  const [openaiModel, setOpenaiModel] = useState('');
  const [anthropicApiKey, setAnthropicApiKey] = useState('');
  const [anthropicModel, setAnthropicModel] = useState('');
  const [ollamaBaseUrl, setOllamaBaseUrl] = useState('');
  const [ollamaModel, setOllamaModel] = useState('');
  const [openrouterApiKey, setOpenrouterApiKey] = useState('');
  const [openrouterModel, setOpenrouterModel] = useState('');

  const [showOpenAIKey, setShowOpenAIKey] = useState(false);
  const [showAnthropicKey, setShowAnthropicKey] = useState(false);
  const [showOpenRouterKey, setShowOpenRouterKey] = useState(false);

  // Editor settings state
  const [fontFamily, setFontFamily] = useState('');
  const [fontSize, setFontSize] = useState(16);
  const [lineHeight, setLineHeight] = useState(1.6);
  const [showLineNumbers, setShowLineNumbers] = useState(false);
  const [wordWrap, setWordWrap] = useState(true);

  // System prompt settings state
  const [narrativeAnalysisPrompt, setNarrativeAnalysisPrompt] = useState('');
  const [consistencyCheckingPrompt, setConsistencyCheckingPrompt] = useState('');
  const [agentSystemPrompt, setAgentSystemPrompt] = useState('');

  // Maintenance settings state
  const [disableRipgrepFallback, setDisableRipgrepFallback] = useState(false);
  const [extensionSafeMode, setExtensionSafeMode] = useState(false);
  const [toolApprovalMode, setToolApprovalMode] = useState<
    'auto_approve' | 'approve_dangerous' | 'approve_writes' | 'approve_all' | 'dry_run'
  >('approve_dangerous');

  // Project override flags (not implemented yet, will always save to app settings)
  const [saveNarrativeAsProject, setSaveNarrativeAsProject] = useState(false);
  const [saveConsistencyAsProject, setSaveConsistencyAsProject] = useState(false);
  const [saveAgentAsProject, setSaveAgentAsProject] = useState(false);

  // Sync local state when dialog opens
  useEffect(() => {
    if (!open) return;

    /* eslint-disable react-hooks/set-state-in-effect */
    // Project settings
    setDefaultAlignment(project.settings?.default_section_alignment || 'left');

    // LLM settings
    setProvider(appSettings.llm.provider);
    setOpenaiApiKey(appSettings.llm.openai.apiKey);
    setOpenaiBaseUrl(appSettings.llm.openai.baseUrl);
    setOpenaiModel(appSettings.llm.openai.model);
    setAnthropicApiKey(appSettings.llm.anthropic.apiKey);
    setAnthropicModel(appSettings.llm.anthropic.model);
    setOllamaBaseUrl(appSettings.llm.ollama.baseUrl);
    setOllamaModel(appSettings.llm.ollama.model);
    setOpenrouterApiKey(appSettings.llm.openrouter?.apiKey || '');
    setOpenrouterModel(appSettings.llm.openrouter?.model || 'openai/gpt-4o-mini');

    // Editor settings
    setFontFamily(appSettings.editor.fontFamily);
    setFontSize(appSettings.editor.fontSize);
    setLineHeight(appSettings.editor.lineHeight);
    setShowLineNumbers(appSettings.editor.showLineNumbers);
    setWordWrap(appSettings.editor.wordWrap);

    // System prompts
    setNarrativeAnalysisPrompt(appSettings.systemPrompts.narrativeAnalysis);
    setConsistencyCheckingPrompt(appSettings.systemPrompts.consistencyChecking);
    setAgentSystemPrompt(appSettings.systemPrompts.agentSystemPrompt);

    // Maintenance settings
    setDisableRipgrepFallback(appSettings.maintenance?.disableRipgrepFallback ?? false);
    setExtensionSafeMode(appSettings.maintenance?.extensionSafeMode ?? false);
    setToolApprovalMode(appSettings.maintenance?.toolApprovalMode ?? 'approve_dangerous');
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open, project.settings, appSettings, activeTab]);


  const handleSave = async () => {
    if (activeTab === 'project') {
      // Save project settings
      updateProjectSettings({
        default_section_alignment: defaultAlignment,
      });
      await saveProject();
    } else if (activeTab === 'editor') {
      // Save editor settings (automatically persisted to localStorage)
      updateEditorSettings({
        fontFamily,
        fontSize,
        lineHeight,
        showLineNumbers,
        wordWrap,
      });
    } else if (activeTab === 'maintenance') {
      updateMaintenanceSettings({
        disableRipgrepFallback,
        extensionSafeMode,
        toolApprovalMode,
      });
    } else {
      // Save LLM and system prompt settings (automatically persisted to localStorage)
      updateLLMSettings({ provider });
      updateOpenAISettings({
        apiKey: openaiApiKey,
        baseUrl: openaiBaseUrl,
        model: openaiModel,
      });
      updateAnthropicSettings({
        apiKey: anthropicApiKey,
        model: anthropicModel,
      });
      updateOllamaSettings({
        baseUrl: ollamaBaseUrl,
        model: ollamaModel,
      });
      updateOpenRouterSettings({
        apiKey: openrouterApiKey,
        model: openrouterModel,
      });
      updateSystemPromptSettings({
        narrativeAnalysis: narrativeAnalysisPrompt,
        consistencyChecking: consistencyCheckingPrompt,
        agentSystemPrompt: agentSystemPrompt,
      });
    }

    onOpenChange(false);
  };

  const handleCancel = () => {
    // Reset to original values
    if (project.settings) {
      setDefaultAlignment(project.settings.default_section_alignment);
    }
    setProvider(appSettings.llm.provider);
    setOpenaiApiKey(appSettings.llm.openai.apiKey);
    setOpenaiBaseUrl(appSettings.llm.openai.baseUrl);
    setOpenaiModel(appSettings.llm.openai.model);
    setAnthropicApiKey(appSettings.llm.anthropic.apiKey);
    setAnthropicModel(appSettings.llm.anthropic.model);
    setOllamaBaseUrl(appSettings.llm.ollama.baseUrl);
    setOllamaModel(appSettings.llm.ollama.model);
    setOpenrouterApiKey(appSettings.llm.openrouter?.apiKey || '');
    setOpenrouterModel(appSettings.llm.openrouter?.model || 'openai/gpt-4o-mini');
    setFontFamily(appSettings.editor.fontFamily);
    setFontSize(appSettings.editor.fontSize);
    setLineHeight(appSettings.editor.lineHeight);
    setShowLineNumbers(appSettings.editor.showLineNumbers);
    setWordWrap(appSettings.editor.wordWrap);
    setNarrativeAnalysisPrompt(appSettings.systemPrompts.narrativeAnalysis);
    setConsistencyCheckingPrompt(appSettings.systemPrompts.consistencyChecking);
    setAgentSystemPrompt(appSettings.systemPrompts.agentSystemPrompt);
    setDisableRipgrepFallback(appSettings.maintenance?.disableRipgrepFallback ?? false);
    setExtensionSafeMode(appSettings.maintenance?.extensionSafeMode ?? false);
    setToolApprovalMode(appSettings.maintenance?.toolApprovalMode ?? 'approve_dangerous');

    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[650px] p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-6 pt-6 pb-4">
          <DialogTitle className="text-xl">Settings</DialogTitle>
          <DialogDescription>
            Manage project and application settings
          </DialogDescription>
        </DialogHeader>

        {/* Tabs */}
        <div className="flex gap-1 px-6 border-b border-border bg-muted/30">
          <button
            onClick={() => setActiveTab('project')}
            className={`px-4 py-3 text-sm font-medium transition-all whitespace-nowrap border-b-2 -mb-px ${activeTab === 'project'
              ? 'border-primary text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
          >
            Project
          </button>
          <button
            onClick={() => setActiveTab('editor')}
            className={`px-4 py-3 text-sm font-medium transition-all whitespace-nowrap border-b-2 -mb-px ${activeTab === 'editor'
              ? 'border-primary text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
          >
            Editor
          </button>
          <button
            onClick={() => setActiveTab('app')}
            className={`px-4 py-3 text-sm font-medium transition-all whitespace-nowrap border-b-2 -mb-px ${activeTab === 'app'
              ? 'border-primary text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
          >
            AI / LLM
          </button>
          <button
            onClick={() => setActiveTab('tools')}
            className={`px-4 py-3 text-sm font-medium transition-all whitespace-nowrap border-b-2 -mb-px ${activeTab === 'tools'
              ? 'border-primary text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
          >
            Tools
          </button>
          <button
            onClick={() => setActiveTab('maintenance')}
            className={`px-4 py-3 text-sm font-medium transition-all whitespace-nowrap border-b-2 -mb-px ${activeTab === 'maintenance'
              ? 'border-primary text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
          >
            Maintenance
          </button>
        </div>

        {/* Tab Content - Fixed height container */}
        <div className="h-[450px] overflow-y-auto px-6 py-5">
          {activeTab === 'project' && (
            <div className="space-y-6">
              <div className="space-y-2">
                <label htmlFor="default-alignment" className="text-sm font-medium">
                  Default Section Alignment
                </label>
                <select
                  id="default-alignment"
                  value={defaultAlignment}
                  onChange={(e) => setDefaultAlignment(e.target.value as 'left' | 'center' | 'right')}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value="left">Left</option>
                  <option value="center">Center</option>
                  <option value="right">Right</option>
                </select>
                <p className="text-xs text-muted-foreground">
                  Default text alignment for new sections
                </p>
              </div>
            </div>
          )}

          {activeTab === 'editor' && (
            <div className="space-y-6">
              {/* Font Family */}
              <div className="space-y-2">
                <label htmlFor="font-family" className="text-sm font-medium">
                  Font Family
                </label>
                <select
                  id="font-family"
                  value={fontFamily}
                  onChange={(e) => setFontFamily(e.target.value)}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif">System Default</option>
                  <option value="'Georgia', 'Times New Roman', serif">Serif (Georgia)</option>
                  <option value="'Courier New', 'Courier', monospace">Monospace (Courier)</option>
                  <option value="'Monaco', 'Menlo', 'Ubuntu Mono', monospace">Monaco</option>
                  <option value="'Fira Code', 'Consolas', monospace">Fira Code</option>
                  <option value="'JetBrains Mono', monospace">JetBrains Mono</option>
                </select>
                <p className="text-xs text-muted-foreground">
                  Choose the font for your editor
                </p>
              </div>

              {/* Font Size */}
              <div className="space-y-2">
                <label htmlFor="font-size" className="text-sm font-medium">
                  Font Size: {fontSize}px
                </label>
                <input
                  id="font-size"
                  type="range"
                  min="12"
                  max="24"
                  step="1"
                  value={fontSize}
                  onChange={(e) => setFontSize(Number(e.target.value))}
                  className="w-full"
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>12px</span>
                  <span>18px</span>
                  <span>24px</span>
                </div>
              </div>

              {/* Line Height */}
              <div className="space-y-2">
                <label htmlFor="line-height" className="text-sm font-medium">
                  Line Height: {lineHeight.toFixed(1)}
                </label>
                <input
                  id="line-height"
                  type="range"
                  min="1.2"
                  max="2.0"
                  step="0.1"
                  value={lineHeight}
                  onChange={(e) => setLineHeight(Number(e.target.value))}
                  className="w-full"
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Tight (1.2)</span>
                  <span>Normal (1.6)</span>
                  <span>Loose (2.0)</span>
                </div>
              </div>

              {/* Show Line Numbers */}
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <label htmlFor="show-line-numbers" className="text-sm font-medium">
                    Show Line Numbers
                  </label>
                  <p className="text-xs text-muted-foreground">
                    Display line numbers in the editor gutter
                  </p>
                </div>
                <input
                  id="show-line-numbers"
                  type="checkbox"
                  checked={showLineNumbers}
                  onChange={(e) => setShowLineNumbers(e.target.checked)}
                  className="h-4 w-4"
                />
              </div>

              {/* Word Wrap */}
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <label htmlFor="word-wrap" className="text-sm font-medium">
                    Word Wrap
                  </label>
                  <p className="text-xs text-muted-foreground">
                    Wrap long lines instead of scrolling horizontally
                  </p>
                </div>
                <input
                  id="word-wrap"
                  type="checkbox"
                  checked={wordWrap}
                  onChange={(e) => setWordWrap(e.target.checked)}
                  className="h-4 w-4"
                />
              </div>

              {/* Preview */}
              <div className="rounded-md border border-border p-4" style={{
                fontFamily,
                fontSize: `${fontSize}px`,
                lineHeight,
              }}>
                <p className="text-muted-foreground text-xs mb-2">Preview:</p>
                <p>The quick brown fox jumps over the lazy dog. This is how your editor text will appear with the current settings.</p>
              </div>
            </div>
          )}

          {activeTab === 'app' && (
            <div className="space-y-6">
              {/* Provider Selection */}
              <div className="space-y-2">
                <label htmlFor="provider" className="text-sm font-medium">
                  LLM Provider
                </label>
                <select
                  id="provider"
                  value={provider}
                  onChange={(e) => setProvider(e.target.value as 'openai' | 'claude' | 'ollama' | 'openrouter')}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value="openai">OpenAI</option>
                  <option value="claude">Anthropic Claude</option>
                  <option value="openrouter">OpenRouter</option>
                  <option value="ollama">Ollama (Local)</option>
                </select>
                <p className="text-xs text-muted-foreground">
                  {provider === 'openai' && 'Direct connection to OpenAI API'}
                  {provider === 'claude' && 'Direct connection to Anthropic API'}
                  {provider === 'openrouter' && 'Access 100+ models through OpenRouter'}
                  {provider === 'ollama' && 'Run models locally with Ollama'}
                </p>
              </div>

              {/* OpenAI Settings */}
              {provider === 'openai' && (
                <div className="space-y-3 p-4 rounded-lg border border-border bg-card">
                  <div className="space-y-2">
                    <label htmlFor="openai-key" className="text-sm font-medium">
                      API Key
                    </label>
                    <div className="relative">
                      <Input
                        id="openai-key"
                        type={showOpenAIKey ? 'text' : 'password'}
                        value={openaiApiKey}
                        onChange={(e) => setOpenaiApiKey(e.target.value)}
                        placeholder="sk-..."
                        className="pr-10"
                      />
                      <button
                        type="button"
                        onClick={() => setShowOpenAIKey(!showOpenAIKey)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        {showOpenAIKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label htmlFor="openai-model" className="text-sm font-medium">
                      Model
                    </label>
                    <select
                      id="openai-model"
                      value={openaiModel}
                      onChange={(e) => setOpenaiModel(e.target.value)}
                      className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    >
                      <optgroup label="GPT-5.2 (Latest)">
                        <option value="gpt-5.2">GPT-5.2 Thinking</option>
                        <option value="gpt-5.2-chat-latest">GPT-5.2 Instant (Chat)</option>
                        <option value="gpt-5.2-pro" disabled>GPT-5.2 Pro (Responses API only)</option>
                        <option value="gpt-5.2-codex" disabled>GPT-5.2 Codex (API access coming soon)</option>
                      </optgroup>
                      <optgroup label="GPT-5 (Legacy)">
                        <option value="gpt-5">GPT-5</option>
                        <option value="gpt-5-mini">GPT-5 Mini (Fast & Cheap)</option>
                        <option value="gpt-5-nano">GPT-5 Nano (Fastest & Cheapest)</option>
                      </optgroup>
                      <optgroup label="Reasoning (o-series)">
                        <option value="o4-mini">o4-mini</option>
                        <option value="o3">o3</option>
                        <option value="o1">o1</option>
                        <option value="o1-mini">o1-mini</option>
                      </optgroup>
                      <optgroup label="GPT-4.1">
                        <option value="gpt-4.1">GPT-4.1</option>
                        <option value="gpt-4.1-mini">GPT-4.1 Mini</option>
                        <option value="gpt-4.1-nano">GPT-4.1 Nano</option>
                      </optgroup>
                      <optgroup label="GPT-4o (Legacy)">
                        <option value="gpt-4o">GPT-4o</option>
                        <option value="gpt-4o-mini">GPT-4o Mini</option>
                      </optgroup>
                    </select>
                  </div>
                </div>
              )}

              {/* Anthropic Settings */}
              {provider === 'claude' && (
                <div className="space-y-3 p-4 rounded-lg border border-border bg-card">
                  <div className="space-y-2">
                    <label htmlFor="anthropic-key" className="text-sm font-medium">
                      API Key
                    </label>
                    <div className="relative">
                      <Input
                        id="anthropic-key"
                        type={showAnthropicKey ? 'text' : 'password'}
                        value={anthropicApiKey}
                        onChange={(e) => setAnthropicApiKey(e.target.value)}
                        placeholder="sk-ant-..."
                        className="pr-10"
                      />
                      <button
                        type="button"
                        onClick={() => setShowAnthropicKey(!showAnthropicKey)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        {showAnthropicKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label htmlFor="anthropic-model" className="text-sm font-medium">
                      Model
                    </label>
                    <select
                      id="anthropic-model"
                      value={anthropicModel}
                      onChange={(e) => setAnthropicModel(e.target.value)}
                      className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    >
                      <option value="claude-sonnet-4-20250514">Claude Sonnet 4 (Latest)</option>
                      <option value="claude-3-5-sonnet-20241022">Claude 3.5 Sonnet</option>
                      <option value="claude-3-5-haiku-20241022">Claude 3.5 Haiku (Fast)</option>
                      <option value="claude-3-opus-20240229">Claude 3 Opus</option>
                    </select>
                  </div>
                </div>
              )}

              {/* OpenRouter Settings */}
              {provider === 'openrouter' && (
                <div className="space-y-3 p-4 rounded-lg border border-border bg-card">
                  <div className="space-y-2">
                    <label htmlFor="openrouter-key" className="text-sm font-medium">
                      API Key
                    </label>
                    <div className="relative">
                      <Input
                        id="openrouter-key"
                        type={showOpenRouterKey ? 'text' : 'password'}
                        value={openrouterApiKey}
                        onChange={(e) => setOpenrouterApiKey(e.target.value)}
                        placeholder="sk-or-..."
                        className="pr-10"
                      />
                      <button
                        type="button"
                        onClick={() => setShowOpenRouterKey(!showOpenRouterKey)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        {showOpenRouterKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Get your key at <a href="https://openrouter.ai/keys" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">openrouter.ai/keys</a>
                    </p>
                  </div>

                  <div className="space-y-2">
                    <label htmlFor="openrouter-model" className="text-sm font-medium">
                      Model
                    </label>
                    <select
                      id="openrouter-model"
                      value={openrouterModel}
                      onChange={(e) => setOpenrouterModel(e.target.value)}
                      className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    >
                      <optgroup label="OpenAI">
                        <option value="openai/gpt-4o">GPT-4o</option>
                        <option value="openai/gpt-4o-mini">GPT-4o Mini</option>
                      </optgroup>
                      <optgroup label="Anthropic">
                        <option value="anthropic/claude-sonnet-4">Claude Sonnet 4</option>
                        <option value="anthropic/claude-3.5-sonnet">Claude 3.5 Sonnet</option>
                        <option value="anthropic/claude-3.5-haiku">Claude 3.5 Haiku</option>
                      </optgroup>
                      <optgroup label="Google">
                        <option value="google/gemini-2.0-flash-001">Gemini 2.0 Flash</option>
                        <option value="google/gemini-pro-1.5">Gemini Pro 1.5</option>
                      </optgroup>
                      <optgroup label="Meta">
                        <option value="meta-llama/llama-3.3-70b-instruct">Llama 3.3 70B</option>
                        <option value="meta-llama/llama-3.1-8b-instruct">Llama 3.1 8B</option>
                      </optgroup>
                      <optgroup label="Mistral">
                        <option value="mistralai/mistral-large-2411">Mistral Large</option>
                        <option value="mistralai/mistral-small-2409">Mistral Small</option>
                      </optgroup>
                      <optgroup label="DeepSeek">
                        <option value="deepseek/deepseek-chat">DeepSeek Chat</option>
                        <option value="deepseek/deepseek-r1">DeepSeek R1</option>
                      </optgroup>
                    </select>
                    <p className="text-xs text-muted-foreground">
                      Or enter a custom model ID from <a href="https://openrouter.ai/models" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">openrouter.ai/models</a>
                    </p>
                  </div>
                </div>
              )}

              {/* Ollama Settings */}
              {provider === 'ollama' && (
                <div className="space-y-3 p-4 rounded-lg border border-border bg-card">
                  <div className="space-y-2">
                    <label htmlFor="ollama-base-url" className="text-sm font-medium">
                      Base URL
                    </label>
                    <Input
                      id="ollama-base-url"
                      type="text"
                      value={ollamaBaseUrl}
                      onChange={(e) => setOllamaBaseUrl(e.target.value)}
                      placeholder="http://localhost:11434"
                    />
                  </div>

                  <div className="space-y-2">
                    <label htmlFor="ollama-model" className="text-sm font-medium">
                      Model
                    </label>
                    <Input
                      id="ollama-model"
                      type="text"
                      value={ollamaModel}
                      onChange={(e) => setOllamaModel(e.target.value)}
                      placeholder="llama3.2"
                    />
                    <p className="text-xs text-muted-foreground">
                      Enter any model you have pulled with `ollama pull`
                    </p>
                  </div>

                  <div className="rounded-md bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 p-3 text-xs">
                    <p className="font-medium mb-1">Note: Limited tool support</p>
                    <p>Ollama models may not support tool calling reliably. Some agent features may not work as expected.</p>
                  </div>
                </div>
              )}

              <div className="rounded-md bg-muted p-3 text-xs text-muted-foreground">
                <p className="font-medium mb-1">Security Note:</p>
                <p>API keys are stored in your browser's localStorage. They are not included in project files and won't be shared when you share your project.</p>
              </div>

              {/* System Prompts Section */}
              <div className="space-y-4 pt-4 border-t border-border">
                <div className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
                  <p className="font-medium mb-1">System Prompts</p>
                  <p>Customize the AI prompts used for narrative analysis, consistency checking, and agent interactions. Use template variables like {'{{entity.name}}'} to dynamically insert context.</p>
                </div>

                <PromptEditor
                  label="Narrative Analysis Prompt"
                  description="Used when analyzing an entity's narrative presence and character arc"
                  value={narrativeAnalysisPrompt}
                  defaultValue={appSettings.systemPrompts.narrativeAnalysis}
                  templateVariables={[
                    '{{entity.name}}',
                    '{{entity.type}}',
                    '{{entity.description}}',
                    '{{fullText}}',
                  ]}
                  onChange={setNarrativeAnalysisPrompt}
                  onReset={() => setNarrativeAnalysisPrompt(appSettings.systemPrompts.narrativeAnalysis)}
                  saveAsProjectOverride={saveNarrativeAsProject}
                  onToggleProjectOverride={setSaveNarrativeAsProject}
                />

                <PromptEditor
                  label="Consistency Checking Prompt"
                  description="Used when checking for narrative inconsistencies and contradictions"
                  value={consistencyCheckingPrompt}
                  defaultValue={appSettings.systemPrompts.consistencyChecking}
                  templateVariables={[
                    '{{entity.name}}',
                    '{{entity.type}}',
                    '{{entity.description}}',
                    '{{entity.aliases}}',
                    '{{historyText}}',
                    '{{current.title}}',
                    '{{current.content}}',
                  ]}
                  onChange={setConsistencyCheckingPrompt}
                  onReset={() => setConsistencyCheckingPrompt(appSettings.systemPrompts.consistencyChecking)}
                  saveAsProjectOverride={saveConsistencyAsProject}
                  onToggleProjectOverride={setSaveConsistencyAsProject}
                />

                <PromptEditor
                  label="Agent System Prompt"
                  description="The base system prompt for the chat agent that helps with writing tasks"
                  value={agentSystemPrompt}
                  defaultValue={appSettings.systemPrompts.agentSystemPrompt}
                  templateVariables={[
                    'No template variables - this is a static system prompt',
                  ]}
                  onChange={setAgentSystemPrompt}
                  onReset={() => setAgentSystemPrompt(appSettings.systemPrompts.agentSystemPrompt)}
                  saveAsProjectOverride={saveAgentAsProject}
                  onToggleProjectOverride={setSaveAgentAsProject}
                />

                <div className="rounded-md bg-muted p-3 text-xs text-muted-foreground">
                  <p className="font-medium mb-1">Note:</p>
                  <p>Prompts are saved globally by default. Project override functionality will be available in a future update.</p>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'tools' && (
            <div className="space-y-4">
              <div className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground mb-4">
                <p className="font-medium mb-1">Available Tools</p>
                <p>The AI agent has access to these tools when you chat with it. Reference them in your prompts to help the agent understand what you want.</p>
              </div>

              <div className="space-y-2">
                {TOOL_REGISTRY.map((tool) => (
                  <ToolCard key={tool.name} tool={tool} />
                ))}
              </div>

              <div className="rounded-md bg-muted p-3 text-xs text-muted-foreground">
                <p className="font-medium mb-1">How to use:</p>
                <p>Simply describe what you want in natural language in the chat. The AI will automatically choose and use the appropriate tools to help you.</p>
              </div>
            </div>
          )}

          {activeTab === 'maintenance' && (
            <div className="space-y-6">
              {/* Ripgrep Safety */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <label htmlFor="disable-ripgrep" className="text-sm font-medium">
                      Disable Ripgrep Fallback
                    </label>
                    <p className="text-xs text-muted-foreground">
                      Prevent the agent from using a slow, pure-Python search if <code>rg</code> (ripgrep) is missing.
                    </p>
                  </div>
                  <input
                    id="disable-ripgrep"
                    type="checkbox"
                    checked={disableRipgrepFallback}
                    onChange={(e) => setDisableRipgrepFallback(e.target.checked)}
                    className="h-4 w-4"
                  />
                </div>
                <div className="bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 p-3 rounded-md text-xs mt-2">
                  <p className="font-medium flex items-center gap-1 mb-1">
                    <AlertCircle className="w-3 h-3" /> Performance Warning
                  </p>
                  <p>
                    If Ripgrep is not installed on your system, the "grep" tool will fall back to reading every file in your workspace into memory to search.
                    This is extremely slow for large projects and can cause the agent to hang.
                    <br /><br />
                    <strong>Recommendation:</strong> Enable this setting (check the box) if you have a large project and haven't installed `ripgrep`.
                  </p>
                </div>
              </div>

              <div className="border-t border-border my-4" />

              {/* Tool Approval Mode */}
              <div className="space-y-2">
                <div className="space-y-0.5">
                  <label htmlFor="tool-approval-mode" className="text-sm font-medium">
                    Tool Approval Mode
                  </label>
                  <p className="text-xs text-muted-foreground">
                    Controls when the AI must ask before executing tools (especially <code>run_shell</code> and <code>delete_file</code>).
                  </p>
                </div>
                <select
                  id="tool-approval-mode"
                  value={toolApprovalMode}
                  onChange={(e) => setToolApprovalMode(e.target.value as typeof toolApprovalMode)}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value="approve_dangerous">Approve dangerous tools (recommended)</option>
                  <option value="approve_writes">Approve writes + dangerous tools</option>
                  <option value="approve_all">Approve every tool call</option>
                  <option value="auto_approve">Auto-approve (unsafe)</option>
                  <option value="dry_run">Dry-run (never execute)</option>
                </select>
              </div>

              <div className="border-t border-border my-4" />

              {/* Extension Safe Mode */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <label htmlFor="extension-safe-mode" className="text-sm font-medium">
                      Extension Safe Mode
                    </label>
                    <p className="text-xs text-muted-foreground">
                      Disable all extensions on startup. Useful for troubleshooting if an extension causes issues.
                    </p>
                  </div>
                  <input
                    id="extension-safe-mode"
                    type="checkbox"
                    checked={extensionSafeMode}
                    onChange={(e) => setExtensionSafeMode(e.target.checked)}
                    className="h-4 w-4"
                  />
                </div>
                {extensionSafeMode && (
                  <div className="bg-orange-500/10 text-orange-600 dark:text-orange-400 p-3 rounded-md text-xs mt-2">
                    <p className="font-medium flex items-center gap-1 mb-1">
                      <AlertCircle className="w-3 h-3" /> Safe Mode Enabled
                    </p>
                    <p>
                      Extensions will not load on the next startup. AI agent tools provided by extensions will be unavailable.
                      <br /><br />
                      <strong>To re-enable:</strong> Uncheck this box and restart the application.
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="px-6 py-4 border-t border-border bg-muted/30">
          <Button variant="outline" onClick={handleCancel}>
            Cancel
          </Button>
          <Button onClick={handleSave}>
            Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
