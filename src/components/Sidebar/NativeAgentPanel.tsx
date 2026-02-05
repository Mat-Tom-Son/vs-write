import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Send, Bot, User, Terminal, AlertCircle, ChevronDown, ChevronRight, MessageSquare, Plus, Cpu, Copy, Check, ArrowDown } from 'lucide-react';
import * as LucideIcons from 'lucide-react';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';
import { ScrollArea } from '../ui/scroll-area';
import { Avatar, AvatarFallback } from '../ui/avatar';
import { Card } from '../ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '../ui/dropdown-menu';
import { useStoryStore } from '../../lib/store';
import { useAppSettings } from '../../lib/app-settings';
import { PromptResolver } from '../../lib/prompt-resolver';
import { getToolByName } from '../../lib/tool-registry';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { confirm as confirmDialog } from '@tauri-apps/plugin-dialog';
import type { ChatMessage, ChatConversation } from '../../services/DatabaseService';
import { ChatMarkdown } from '../Chat/ChatMarkdown';

/**
 * Event types emitted by the native Rust agent
 * These match the AgentEvent enum in src-tauri/src/agent/types.rs
 */
interface AgentEvent {
  type:
    | 'start'
    | 'tool_call_start'
    | 'tool_call_complete'
    | 'tool_approval_required'
    | 'tool_skipped'
    | 'text_chunk'
    | 'complete'
    | 'error'
    | 'cancelled';
  task?: string;
  approval_id?: string;
  name?: string;
  args?: Record<string, unknown>;
  risk?: 'low' | 'medium' | 'high';
  reason?: string;
  result?: string;
  success?: boolean;
  truncated?: boolean;
  response?: string;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  error?: string;
  run_id?: string;
}

/**
 * Configuration for the native agent
 * Must match InputConfig in src-tauri/src/agent_commands.rs
 */
interface AgentConfig {
  provider: 'openai' | 'claude' | 'ollama' | 'openrouter';
  api_key: string;
  model: string;
  temperature: number;
  max_tokens: number;
  max_iterations: number;
  base_url?: string;
  approval_mode?: 'auto_approve' | 'approve_dangerous' | 'approve_writes' | 'approve_all' | 'dry_run';
}

/**
 * Tool call event for display in timeline
 */
interface ToolCallEvent {
  name: string;
  args: Record<string, unknown>;
  result: string;
  success: boolean;
}

interface DisplayMessage extends ChatMessage {
  toolCalls?: ToolCallEvent[];
  isLoading?: boolean;
}

interface ToolExecutionMessage {
  id: string;
  type: 'tool_execution';
  conversation_id: string;
  toolCalls: ToolCallEvent[];
  created_at: string;
}

type TimelineItem = DisplayMessage | ToolExecutionMessage;

function CopyIconButton({ text, variant }: { text: string; variant: 'user' | 'assistant' }) {
  const [copied, setCopied] = useState(false);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      // noop
    }
  };

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={onCopy}
      className={
        variant === 'user'
          ? 'h-7 w-7 text-primary-foreground/80 hover:bg-primary-foreground/15 hover:text-primary-foreground'
          : 'h-7 w-7 text-muted-foreground hover:text-foreground'
      }
      aria-label="Copy message"
      title="Copy message"
    >
      {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
    </Button>
  );
}

/**
 * NativeAgentPanel - Chat interface for the native Rust-based AI agent
 *
 * This component provides a chat UI that communicates with a native Rust agent
 * via Tauri's invoke/event system, rather than through a WebSocket to Python.
 */
export function NativeAgentPanel() {
  const projectRoot = useStoryStore(state => state.projectRoot);
  const projectService = useStoryStore(state => state.projectService);
  const project = useStoryStore(state => state.project);
  const appSettings = useAppSettings(state => state.settings);

  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [currentConversationId, setCurrentConversationId] = useState<string>(() => `native-conv-${Date.now()}`);
  const [agentStatus, setAgentStatus] = useState<'idle' | 'running' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [unseenCount, setUnseenCount] = useState(0);

  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const refreshVersion = useRef(0);
  const messageIdCounter = useRef(0);
  const timelineLengthRef = useRef(0);

  // Track processed run_ids to prevent duplicate event handling
  const processedRunIds = useRef<Set<string>>(new Set());

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    scrollRef.current?.scrollIntoView({ behavior });
  }, []);

  // Ref to hold stable reference to conversation ID for event handler
  const currentConversationIdRef = useRef(currentConversationId);
  currentConversationIdRef.current = currentConversationId;

  // Ref to hold stable reference to projectService for event handler
  const projectServiceRef = useRef(projectService);
  projectServiceRef.current = projectService;

  // Generate a unique message ID
  const generateMessageId = useCallback(() => {
    messageIdCounter.current += 1;
    return `msg-${Date.now()}-${messageIdCounter.current}`;
  }, []);

  // Create prompt resolver for agent system prompt
  const promptResolver = useMemo(() => {
    return new PromptResolver(appSettings.systemPrompts, project.settings);
  }, [appSettings.systemPrompts, project.settings]);

  // Check if API key is configured
  const hasApiKey = useMemo(() => {
    const provider = appSettings.llm.provider;
    switch (provider) {
      case 'openai':
        return !!appSettings.llm.openai.apiKey;
      case 'claude':
        return !!appSettings.llm.anthropic.apiKey;
      case 'openrouter':
        return !!appSettings.llm.openrouter?.apiKey;
      case 'ollama':
        return true; // Ollama doesn't need an API key
      default:
        return false;
    }
  }, [appSettings.llm]);

  const deriveTitle = useCallback((text: string) => {
    const normalized = text.trim().replace(/\s+/g, ' ');
    const snippet = normalized.slice(0, 60);
    if (!snippet) return 'Conversation';
    return normalized.length > 60 ? `${snippet}...` : snippet;
  }, []);

  const refreshConversations = useCallback(async () => {
    if (!projectService) return;

    const requestId = ++refreshVersion.current;
    try {
      const db = projectService.getDatabaseService();
      const allConversations = await db.getAllConversations();

      // Filter to only native agent conversations (prefixed with "native-conv-")
      const nativeConversations = allConversations.filter(c => c.id.startsWith('native-conv-'));

      const withTitles = await Promise.all(
        nativeConversations.map(async (conv) => {
          if (conv.title) return conv;

          const firstUserMessage = await db.getFirstUserMessage(conv.id);
          if (!firstUserMessage) return conv;

          const title = deriveTitle(firstUserMessage);
          await db.updateConversation(conv.id, { title, touchUpdatedAt: false });
          return { ...conv, title };
        })
      );

      // Ignore stale refreshes
      if (requestId !== refreshVersion.current) return;

      const sorted = [...withTitles].sort(
        (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
      );
      setConversations(sorted);
    } catch (error) {
      console.error('Failed to load conversations:', error);
    }
  }, [deriveTitle, projectService]);

  // Helper to save a message to the database
  const saveMessageToDb = useCallback(async (message: DisplayMessage) => {
    if (!projectService) return;

    try {
      const db = projectService.getDatabaseService();
      await db.addMessage({
        id: message.id,
        conversation_id: message.conversation_id,
        role: message.role,
        content: message.content,
        created_at: message.created_at
      });
      await refreshConversations();
    } catch (error) {
      console.error('Failed to save message:', error);
    }
  }, [projectService, refreshConversations]);

  // Ref to hold stable reference to saveMessageToDb for event handler
  const saveMessageToDbRef = useRef(saveMessageToDb);
  saveMessageToDbRef.current = saveMessageToDb;

  const ensureConversationExists = useCallback(async (firstMessageContent: string) => {
    if (!projectService) return;

    const db = projectService.getDatabaseService();
    const existing = await db.getConversation(currentConversationId);
    const title = deriveTitle(firstMessageContent);

    if (!existing) {
      await db.createConversation(currentConversationId, title);
      await refreshConversations();
    } else if (!existing.title) {
      await db.updateConversation(currentConversationId, { title, touchUpdatedAt: false });
      await refreshConversations();
    }
  }, [currentConversationId, deriveTitle, projectService, refreshConversations]);

  // Listen for agent events from Tauri
  // Uses refs to avoid re-registering the listener when callbacks change
  useEffect(() => {
    let unlisten: UnlistenFn | null = null;

    const setupListener = async () => {
      unlisten = await listen<AgentEvent>('native-agent-event', (event) => {
        const agentEvent = event.payload;
        console.log('Native agent event:', agentEvent);

        // Deduplicate 'complete' and 'error' events using run_id
        if ((agentEvent.type === 'complete' || agentEvent.type === 'error') && agentEvent.run_id) {
          if (processedRunIds.current.has(agentEvent.run_id)) {
            console.log(`Skipping duplicate ${agentEvent.type} event for run_id: ${agentEvent.run_id}`);
            return;
          }
          processedRunIds.current.add(agentEvent.run_id);

          // Clean up old run_ids to prevent memory leak (keep last 100)
          if (processedRunIds.current.size > 100) {
            const entries = Array.from(processedRunIds.current);
            processedRunIds.current = new Set(entries.slice(-50));
          }
        }

        // Use refs for values that may change
        const convId = currentConversationIdRef.current;

        switch (agentEvent.type) {
          case 'start':
            setAgentStatus('running');
            setIsLoading(true);
            break;

          case 'tool_call_start':
            // Mark files as recently written BEFORE the tool executes
            // This prevents the file watcher from triggering before tool_call_complete arrives
            if (agentEvent.name) {
              const fileWriteTools = ['write_file', 'append_file', 'delete_file'];
              if (fileWriteTools.includes(agentEvent.name) && agentEvent.args?.path) {
                const ps = projectServiceRef.current;
                if (ps) {
                  const filePath = agentEvent.args.path as string;
                  ps.markFileAsWritten(filePath);
                  console.log(`[Agent] Pre-marked file as recently written: ${filePath}`);
                }
              }
            }
            // Create a pending tool call entry to show "running..." state
            if (agentEvent.name) {
              const pendingToolCall: ToolCallEvent = {
                name: agentEvent.name,
                args: (agentEvent.args as Record<string, unknown>) || {},
                result: '', // Empty until complete
                success: true // Assume success until we know otherwise
              };

              setTimeline(prev => {
                const updated = [...prev];
                const lastItem = updated[updated.length - 1];

                if (lastItem && 'type' in lastItem && lastItem.type === 'tool_execution') {
                  // Add to existing tool execution message
                  lastItem.toolCalls.push(pendingToolCall);
                } else {
                  // Create new tool execution message
                  const toolExecMsg: ToolExecutionMessage = {
                    id: `tool-exec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                    type: 'tool_execution',
                    conversation_id: convId,
                    toolCalls: [pendingToolCall],
                    created_at: new Date().toISOString()
                  };
                  updated.push(toolExecMsg);
                }
                return updated;
              });
            }
            break;

          case 'tool_call_complete': {
            const toolName = agentEvent.name;
            if (!toolName) break;

            const toolArgs = (agentEvent.args as Record<string, unknown>) || {};
            const toolResult = agentEvent.result || '';
            const toolSuccess = agentEvent.success ?? true;

            // Mark files as recently written when agent file-writing tools complete
            // This prevents the file watcher from triggering a reload prompt
            const fileWriteTools = ['write_file', 'append_file', 'delete_file'];
            const pathArg = (toolArgs as { path?: unknown }).path;
            if (fileWriteTools.includes(toolName) && typeof pathArg === 'string') {
              const ps = projectServiceRef.current;
              if (ps) {
                ps.markFileAsWritten(pathArg);
                console.log(`[Agent] Marked file as recently written: ${pathArg}`);
              }
            }

            setTimeline(prev => {
              const updated = [...prev];
              const lastItem = updated[updated.length - 1];

              if (lastItem && 'type' in lastItem && lastItem.type === 'tool_execution') {
                // Find the pending tool call (one with empty result) and update it
                const pendingIndex = lastItem.toolCalls.findIndex(
                  tc => tc.name === toolName && tc.result === ''
                );

                if (pendingIndex !== -1) {
                  // Update the pending entry with the result
                  lastItem.toolCalls[pendingIndex] = {
                    name: toolName,
                    args: toolArgs,
                    result: toolResult,
                    success: toolSuccess
                  };
                } else {
                  // No pending entry found, add as new (fallback)
                  lastItem.toolCalls.push({
                    name: toolName,
                    args: toolArgs,
                    result: toolResult,
                    success: toolSuccess
                  });
                }
              } else {
                // No tool execution message exists, create one (shouldn't happen normally)
                const toolExecMsg: ToolExecutionMessage = {
                  id: `tool-exec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                  type: 'tool_execution',
                  conversation_id: convId,
                  toolCalls: [{
                    name: toolName,
                    args: toolArgs,
                    result: toolResult,
                    success: toolSuccess
                  }],
                  created_at: new Date().toISOString()
                };
                updated.push(toolExecMsg);
              }
              return updated;
            });
            break;
          }

          case 'tool_approval_required': {
            const approvalId = agentEvent.approval_id;
            const toolName = agentEvent.name;

            if (!approvalId || !toolName) break;

            const args = agentEvent.args || {};
            const risk = agentEvent.risk || 'medium';
            const argsText = JSON.stringify(args, null, 2);
            const truncatedArgs = argsText.length > 2000 ? `${argsText.slice(0, 2000)}\n…(truncated)` : argsText;

            void (async () => {
              try {
                const approved = await confirmDialog(
                  `Allow the agent to execute tool "${toolName}"?\n\nRisk: ${risk}\n\nArgs:\n${truncatedArgs}`,
                  { kind: 'warning', okLabel: 'Allow', cancelLabel: 'Deny' },
                );

                await invoke('respond_tool_approval', { approvalId, approved });
              } catch (error) {
                console.error('Failed to handle tool approval:', error);
                // Best-effort: deny if we couldn't prompt.
                try {
                  await invoke('respond_tool_approval', { approvalId, approved: false });
                } catch (invokeError) {
                  console.error('Failed to send tool approval denial:', invokeError);
                }
              }
            })();
            break;
          }

          case 'complete':
            setIsLoading(false);
            setAgentStatus('idle');
            if (agentEvent.response) {
              const assistantMessage: DisplayMessage = {
                id: generateMessageId(),
                conversation_id: convId,
                role: 'assistant',
                content: agentEvent.response,
                created_at: new Date().toISOString()
              };
              setTimeline(prev => {
                const updated = prev.filter(item => !('isLoading' in item && item.isLoading));
                updated.push(assistantMessage);
                return updated;
              });
              saveMessageToDbRef.current(assistantMessage);
            }
            break;

          case 'error':
            setIsLoading(false);
            setAgentStatus('error');
            setErrorMessage(agentEvent.error || 'An unknown error occurred');
            setTimeline(prev => [...prev.filter(item => !('isLoading' in item && item.isLoading)), {
              id: generateMessageId(),
              conversation_id: convId,
              role: 'assistant',
              content: `Error: ${agentEvent.error || 'An unknown error occurred'}`,
              created_at: new Date().toISOString()
            }]);
            break;
        }
      });
    };

    setupListener();

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, [generateMessageId]); // Only re-register if generateMessageId changes (it shouldn't)

  // Track whether the user is near the bottom of the scroll viewport
  useEffect(() => {
    const root = scrollAreaRef.current;
    const sentinel = scrollRef.current;
    if (!root || !sentinel) return;

    const viewport = root.querySelector('[data-radix-scroll-area-viewport]') as HTMLElement | null;
    if (!viewport) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        const atBottom = !!entry?.isIntersecting;
        setIsAtBottom(atBottom);
        if (atBottom) setUnseenCount(0);
      },
      { root: viewport, threshold: 0, rootMargin: '0px 0px 200px 0px' }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  // Auto-scroll only when the user is already near the bottom
  useEffect(() => {
    const prevLen = timelineLengthRef.current;
    const currLen = timeline.length;
    timelineLengthRef.current = currLen;

    if (currLen < prevLen) {
      setUnseenCount(0);
      return;
    }

    if (currLen > prevLen) {
      if (isAtBottom) {
        scrollToBottom('smooth');
      } else {
        setUnseenCount((c) => c + (currLen - prevLen));
      }
    }
  }, [timeline.length, isAtBottom, scrollToBottom]);

  // Load all conversations
  useEffect(() => {
    refreshConversations();
  }, [refreshConversations]);

  // Load messages for current conversation
  useEffect(() => {
    const loadMessages = async () => {
      if (!projectService) return;

      try {
        const db = projectService.getDatabaseService();
        const conversation = await db.getConversation(currentConversationId);

        // Load messages for this conversation
        const loadedMessages = await db.getMessages(currentConversationId);
        setTimeline(loadedMessages);

        if (conversation && !conversation.title) {
          const firstUserMessage = loadedMessages.find(msg => msg.role === 'user');
          if (firstUserMessage) {
            const title = deriveTitle(firstUserMessage.content);
            await db.updateConversation(currentConversationId, { title, touchUpdatedAt: false });
            refreshConversations();
          }
        }
      } catch (error) {
        console.error('Failed to load messages:', error);
      }
    };

    loadMessages();
  }, [projectService, currentConversationId, deriveTitle, refreshConversations]);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    // Check for API key
    if (!hasApiKey) {
      setErrorMessage('Please configure your API key in Settings before using the agent.');
      return;
    }

    const userMessage: DisplayMessage = {
      id: generateMessageId(),
      conversation_id: currentConversationId,
      role: 'user',
      content: input,
      created_at: new Date().toISOString()
    };

    try {
      await ensureConversationExists(input);
    } catch (error) {
      console.error('Failed to create conversation:', error);
      return;
    }

    // Build conversation history from timeline (only actual messages, not tool executions)
    const conversationHistory = timeline
      .filter(item => !('type' in item && item.type === 'tool_execution'))
      .map(item => {
        const msg = item as DisplayMessage;
        return {
          role: msg.role,
          content: msg.content
        };
      });

    // Add current user message to history
    conversationHistory.push({
      role: 'user',
      content: input
    });

    // Add user message to timeline
    setTimeline(prev => [...prev, userMessage]);

    // Persist user message to database
    saveMessageToDb(userMessage);

    // Add loading indicator
    const loadingMessage: DisplayMessage = {
      id: `${generateMessageId()}-loading`,
      conversation_id: currentConversationId,
      role: 'assistant',
      content: '',
      created_at: new Date().toISOString(),
      isLoading: true
    };
    setTimeline(prev => [...prev, loadingMessage]);
    setUnseenCount(0);
    requestAnimationFrame(() => scrollToBottom('smooth'));

    // Clear any previous error
    setErrorMessage(null);
    setIsLoading(true);
    setAgentStatus('running');

    try {
      // Build project context for prompt interpolation
      const agentContext = promptResolver.buildAgentContext(
        {
          name: project.name,
          synopsis: project.meta.synopsis,
          entities: project.entities,
          sections: project.sections,
        },
        projectRoot || ''
      );

      // Get and interpolate the system prompt with project context
      const templatePrompt = promptResolver.getAgentSystemPrompt();
      const systemPrompt = promptResolver.interpolate(templatePrompt, agentContext);

      // Build config from app settings
      const provider = appSettings.llm.provider;
      let config: AgentConfig;

      switch (provider) {
        case 'openai': {
          // Only use custom baseUrl if it's not a localhost URL (likely leftover from local LLM testing)
          const customBaseUrl = appSettings.llm.openai.baseUrl;
          const isLocalhost = customBaseUrl?.includes('localhost') || customBaseUrl?.includes('127.0.0.1');
          config = {
            provider: 'openai',
            api_key: appSettings.llm.openai.apiKey,
            model: appSettings.llm.openai.model || 'gpt-5-mini',
            temperature: 0.7,
            max_tokens: 4096,
            max_iterations: 8,
            base_url: (customBaseUrl && !isLocalhost) ? customBaseUrl : undefined,
          };
          break;
        }
        case 'claude':
          config = {
            provider: 'claude',
            api_key: appSettings.llm.anthropic.apiKey,
            model: appSettings.llm.anthropic.model || 'claude-3-5-sonnet-20241022',
            temperature: 0.7,
            max_tokens: 4096,
            max_iterations: 8,
          };
          break;
        case 'ollama':
          config = {
            provider: 'ollama',
            api_key: '', // Ollama doesn't need an API key
            model: appSettings.llm.ollama.model || 'llama3.2',
            temperature: 0.7,
            max_tokens: 4096,
            max_iterations: 8,
            base_url: appSettings.llm.ollama.baseUrl || 'http://localhost:11434',
          };
          break;
        case 'openrouter':
          config = {
            provider: 'openrouter',
            api_key: appSettings.llm.openrouter?.apiKey || '',
            model: appSettings.llm.openrouter?.model || 'openai/gpt-4o-mini',
            temperature: 0.7,
            max_tokens: 4096,
            max_iterations: 8,
          };
          break;
        default:
          throw new Error(`Unsupported provider: ${provider}`);
      }

      // Call the native agent via Tauri invoke
      await invoke('run_native_agent', {
        task: input,
        systemPrompt: systemPrompt,
        workspace: projectRoot,
        messages: conversationHistory,
        config: {
          ...config,
          approval_mode: appSettings.maintenance?.toolApprovalMode ?? 'approve_dangerous',
        },
      });

      setInput('');
    } catch (error) {
      console.error('Failed to send message:', error);
      setIsLoading(false);
      setAgentStatus('error');
      setErrorMessage(error instanceof Error ? error.message : 'Failed to communicate with the agent');

      // Remove loading indicator and show error
      setTimeline(prev => [...prev.filter(item => !('isLoading' in item && item.isLoading)), {
        id: generateMessageId(),
        conversation_id: currentConversationId,
        role: 'assistant',
        content: `Error: ${error instanceof Error ? error.message : 'Failed to communicate with the agent'}`,
        created_at: new Date().toISOString()
      }]);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleNewConversation = () => {
    const newConvId = `native-conv-${Date.now()}`;
    setCurrentConversationId(newConvId);
    setTimeline([]);
    setInput('');
    setErrorMessage(null);
  };

  const handleSwitchConversation = (convId: string) => {
    setCurrentConversationId(convId);
    setInput('');
    setErrorMessage(null);
  };

  // Show message if no project is open
  if (!projectRoot) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-6 text-center">
        <AlertCircle className="w-12 h-12 text-muted-foreground mb-4" />
        <p className="text-sm text-muted-foreground">
          Please open a project to use the native agent
        </p>
      </div>
    );
  }

  // Show warning if no API key is configured
  if (!hasApiKey) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-6 text-center">
        <AlertCircle className="w-12 h-12 text-yellow-500 mb-4" />
        <p className="text-sm text-muted-foreground mb-2">
          API key not configured
        </p>
        <p className="text-xs text-muted-foreground">
          Please configure your {
            appSettings.llm.provider === 'claude' ? 'Anthropic' :
            appSettings.llm.provider === 'openai' ? 'OpenAI' :
            appSettings.llm.provider === 'openrouter' ? 'OpenRouter' : 'LLM'
          } API key in Settings to use the native agent.
        </p>
      </div>
    );
  }

  return (
    <div className="chat-panel flex flex-col h-full min-h-0 dark">
      {/* Header */}
      <div className="p-4 border-b border-border">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold">Native Agent</h2>
          <div className="flex items-center gap-2">
            {agentStatus === 'running' ? (
              <>
                <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                <span className="text-xs text-blue-500">Running...</span>
              </>
            ) : agentStatus === 'error' ? (
              <>
                <div className="w-2 h-2 rounded-full bg-red-500" />
                <span className="text-xs text-red-500">Error</span>
              </>
            ) : (
              <>
                <div className="w-2 h-2 rounded-full bg-green-500" />
                <span className="text-xs text-muted-foreground">Ready</span>
              </>
            )}
            <Cpu className="w-4 h-4 text-muted-foreground ml-1" />
          </div>
        </div>

	        {/* Conversation selector */}
	        <div className="flex items-center gap-2 min-w-0">
	          <DropdownMenu onOpenChange={(open) => open && refreshConversations()}>
	            <DropdownMenuTrigger asChild>
	              <Button variant="outline" size="sm" className="flex-1 justify-between min-w-0">
	                <div className="flex items-center gap-2 min-w-0">
	                  <MessageSquare className="w-4 h-4 shrink-0" />
	                  <span className="text-xs truncate min-w-0">
	                    {conversations.find(c => c.id === currentConversationId)?.title || 'Current Chat'}
	                  </span>
	                </div>
	                <ChevronDown className="w-4 h-4 ml-2 shrink-0" />
	              </Button>
	            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-[280px]">
              <DropdownMenuLabel>Conversations</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {conversations.map(conv => (
                <DropdownMenuItem
                  key={conv.id}
                  onClick={() => handleSwitchConversation(conv.id)}
                  className="cursor-pointer"
                >
                  <MessageSquare className="w-4 h-4 mr-2" />
                  <span className="truncate">
                    {conv.title || 'Untitled chat'}
                  </span>
                </DropdownMenuItem>
              ))}
              {conversations.length === 0 && (
                <div className="px-2 py-1.5 text-xs text-muted-foreground">
                  No conversations yet
                </div>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          <Button variant="outline" size="sm" onClick={handleNewConversation}>
            <Plus className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Error banner */}
      {errorMessage && (
        <div className="px-4 py-2 bg-red-500/10 border-b border-red-500/20">
          <p className="text-xs text-red-500">{errorMessage}</p>
        </div>
      )}

      {/* Messages */}
      <div className="relative flex-1 min-h-0">
        <ScrollArea ref={scrollAreaRef} className="h-full min-h-0 p-4">
          <div className="space-y-4">
          {timeline.map((item) => {
            // Render tool execution messages
            if ('type' in item && item.type === 'tool_execution') {
	              return (
	                <div key={item.id} className="flex gap-3 justify-start min-w-0">
	                  <Avatar className="w-8 h-8">
	                    <AvatarFallback className="bg-muted">
	                      <Terminal className="w-4 h-4" />
	                    </AvatarFallback>
	                  </Avatar>
	
		                  <div className="flex flex-col gap-1 max-w-[min(80%,calc(100%-44px))] w-full min-w-0">
	                    <div className="text-xs text-muted-foreground mb-1">
	                      Working...
	                    </div>
	                    {item.toolCalls.map((toolCall, idx) => {
                      // Get tool metadata from registry
                      const toolDef = getToolByName(toolCall.name);
                      const ToolIcon = toolDef
                        ? ((LucideIcons as unknown as Record<string, typeof Terminal>)[toolDef.icon] || Terminal)
                        : Terminal;

                      return (
                        <Collapsible key={`${item.id}-tool-${idx}-${toolCall.name}`}>
                          <Card className="bg-muted/50 overflow-hidden">
                            <CollapsibleTrigger className="w-full p-2 hover:bg-muted/70 transition-colors">
	                              <div className="flex items-center gap-2 text-xs min-w-0">
	                                <ChevronRight className="w-3 h-3 shrink-0 transition-transform [[data-state=open]>&]:rotate-90" />
	                                <ToolIcon className="w-3 h-3 shrink-0 text-primary" />
	                                <div className="flex items-center gap-1 min-w-0 flex-1">
	                                  <span className="font-medium truncate">{toolCall.name}</span>
	                                  {toolDef && (
	                                    <span className="text-muted-foreground text-[10px] hidden sm:inline truncate">
	                                      - {toolDef.description}
	                                    </span>
	                                  )}
	                                  {Object.keys(toolCall.args).length > 0 && !toolDef && (
	                                    <span className="text-muted-foreground truncate">
	                                      ({Object.entries(toolCall.args).map(([k, v]) =>
	                                        `${k}: ${typeof v === 'string' ? v.substring(0, 20) : v}`
	                                      ).join(', ')})
	                                    </span>
	                                  )}
	                                </div>
	                                <span className={`ml-auto shrink-0 text-xs ${toolCall.result === '' ? 'text-blue-500' : toolCall.success ? 'text-green-600' : 'text-red-600'}`}>
	                                  {toolCall.result === '' ? '⋯' : toolCall.success ? '✓' : '✗'}
	                                </span>
	                              </div>
	                            </CollapsibleTrigger>
                            <CollapsibleContent>
                              <div className="p-2 pt-0 text-xs text-muted-foreground space-y-2">
                                {Object.keys(toolCall.args).length > 0 && (
                                  <div>
                                    <div className="font-semibold mb-1">Arguments:</div>
                                    <div className="font-mono bg-background/50 p-2 rounded text-xs overflow-auto">
                                      {JSON.stringify(toolCall.args, null, 2)}
                                    </div>
                                  </div>
                                )}
                                {toolCall.result === '' ? (
                                  <div className="text-blue-500 italic">Running...</div>
                                ) : (
                                  <div>
                                    <div className="font-semibold mb-1">Result:</div>
                                    <div className="font-mono bg-background/50 p-2 rounded text-xs overflow-auto max-h-40">
                                      {toolCall.result}
                                    </div>
                                  </div>
                                )}
                              </div>
                            </CollapsibleContent>
                          </Card>
                        </Collapsible>
                      );
                    })}
                  </div>
                </div>
              );
            }

            // Render regular messages
            const message = item as DisplayMessage;
	            return (
	              <div key={message.id} className={`flex gap-3 min-w-0 ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
	                {message.role === 'assistant' && (
	                  <Avatar className="w-8 h-8">
	                    <AvatarFallback className="bg-primary text-primary-foreground">
	                      <Bot className="w-4 h-4" />
	                    </AvatarFallback>
	                  </Avatar>
	                )}
	
		                <div className={`flex flex-col gap-2 max-w-[min(80%,calc(100%-44px))] min-w-0 ${message.role === 'user' ? 'items-end' : 'items-start'}`}>
	                  <Card className={`relative group p-3 min-w-0 ${message.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-card'}`}>
	                    {!message.isLoading && message.content && (
	                      <div className="absolute right-1 top-1 opacity-0 group-hover:opacity-100 transition-opacity">
	                        <CopyIconButton text={message.content} variant={message.role === 'user' ? 'user' : 'assistant'} />
	                      </div>
	                    )}
                    {message.isLoading ? (
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-current animate-bounce" style={{ animationDelay: '0ms' }} />
                        <div className="w-2 h-2 rounded-full bg-current animate-bounce" style={{ animationDelay: '150ms' }} />
                        <div className="w-2 h-2 rounded-full bg-current animate-bounce" style={{ animationDelay: '300ms' }} />
                      </div>
                    ) : (
                      <ChatMarkdown content={message.content} variant={message.role === 'user' ? 'user' : 'assistant'} />
                    )}
                  </Card>
                </div>

                {message.role === 'user' && (
                  <Avatar className="w-8 h-8">
                    <AvatarFallback className="bg-secondary">
                      <User className="w-4 h-4" />
                    </AvatarFallback>
                  </Avatar>
                )}
              </div>
            );
          })}
          <div ref={scrollRef} />
          </div>
        </ScrollArea>

        {!isAtBottom && (
          <div className="absolute bottom-4 right-4">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                setUnseenCount(0);
                scrollToBottom('smooth');
              }}
              className="shadow"
            >
              <ArrowDown className="w-4 h-4" />
              {unseenCount > 0 ? `New messages (${unseenCount})` : 'Jump to bottom'}
            </Button>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="p-4 border-t border-border">
        <div className="flex gap-2 items-end">
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyPress}
            placeholder={isLoading ? "Agent is working..." : "Message native agent..."}
            disabled={isLoading}
            className="flex-1 min-h-[60px] max-h-[200px] resize-none"
            rows={2}
          />
          <Button
            onClick={handleSend}
            disabled={isLoading || !input.trim()}
            size="icon"
            className="h-[60px] w-12"
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
