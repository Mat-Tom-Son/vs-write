import { z } from 'zod';
import type { Entity, Section, Diagnostic } from '../lib/schemas';
import { DiagnosticSchema, createId } from '../lib/schemas';
import type { NarrativeContext } from '../lib/store';
import { PromptResolver } from '../lib/prompt-resolver';

// Provider interface
export interface LLMProvider {
  complete(prompt: string, options?: LLMOptions): Promise<string>;
}

export interface LLMOptions {
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
}

// Agent response schemas
const AgentDiagnosticSchema = z.object({
  severity: z.enum(['info', 'warning', 'critical']),
  message: z.string(),
  suggestion: z.string().optional(),
  textSnippet: z.string().optional(),
});

const AgentResponseSchema = z.object({
  diagnostics: z.array(AgentDiagnosticSchema),
  summary: z.string().optional(),
});

export class AgentService {
  private provider: LLMProvider;
  private promptResolver: PromptResolver;

  constructor(provider: LLMProvider, promptResolver: PromptResolver) {
    this.provider = provider;
    this.promptResolver = promptResolver;
  }

  async checkConsistency(entity: Entity, currentSection: Section, history: Section[]): Promise<Diagnostic[]> {
    const prompt = this.buildConsistencyPrompt(entity, currentSection, history);
    try {
      const response = await this.provider.complete(prompt, { temperature: 0.2, jsonMode: true });
      return this.parseResponse(response, currentSection);
    } catch (err) {
      console.error('Agent consistency check failed:', err);
      return [];
    }
  }

  async analyzeEntity(context: NarrativeContext): Promise<{
    traits: string[];
    arc: string;
    inconsistencies: string[];
  }> {
    // Get template from prompt resolver
    const template = this.promptResolver.getNarrativeAnalysisPrompt();

    // Build context and interpolate
    const promptContext = this.promptResolver.buildNarrativeAnalysisContext(
      context.entity,
      context.fullText
    );
    const prompt = this.promptResolver.interpolate(template, promptContext);

    const response = await this.provider.complete(prompt, { temperature: 0.3, jsonMode: true });
    return JSON.parse(response);
  }

  private buildConsistencyPrompt(entity: Entity, current: Section, history: Section[]): string {
    // Get template from prompt resolver
    const template = this.promptResolver.getConsistencyCheckingPrompt();

    // Truncate history sections
    const truncatedHistory = history.map(s => ({
      ...s,
      content: this.truncate(s.content, 500)
    }));

    // Build context and interpolate
    const promptContext = this.promptResolver.buildConsistencyCheckingContext(
      entity,
      current,
      truncatedHistory
    );
    return this.promptResolver.interpolate(template, promptContext);
  }

  private parseResponse(raw: string, section: Section): Diagnostic[] {
    try {
      const cleaned = raw.replace(/`json\n?|\n?`/g, '').trim();
      const parsed = AgentResponseSchema.parse(JSON.parse(cleaned));

      return parsed.diagnostics.map((d) => {
        const range = this.findRange(section.content, d.textSnippet);

        return DiagnosticSchema.parse({
          id: createId(),
          sectionId: section.id,
          range,
          severity: d.severity,
          message: d.message,
          suggestion: d.suggestion,
        });
      });
    } catch (err) {
      console.error('Failed to parse agent response:', err, raw);
      return [];
    }
  }

  private findRange(content: string, snippet?: string): { from: number; to: number } {
    if (!snippet) return { from: 0, to: 0 };

    const idx = content.indexOf(snippet);
    if (idx === -1) {
      const words = snippet.split(' ').slice(0, 4).join(' ');
      const fuzzyIdx = content.indexOf(words);
      if (fuzzyIdx !== -1) {
        return { from: fuzzyIdx, to: fuzzyIdx + words.length + 20 };
      }
      return { from: 0, to: 0 };
    }

    return { from: idx, to: idx + snippet.length };
  }

  private truncate(text: string, maxLen: number): string {
    if (text.length <= maxLen) return text;
    return `${text.slice(0, maxLen)}...`;
  }
}

// Provider implementations
export class OpenAIProvider implements LLMProvider {
  private apiKey: string;
  private baseUrl: string;
  private model: string;

  constructor(apiKey: string, baseUrl = 'https://api.openai.com/v1', model = 'gpt-5-mini') {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.model = model;
  }

  private normalizeContent(content: unknown): string {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content
        .map((part) => {
          if (part && typeof part === 'object' && 'text' in part) {
            const text = (part as { text?: unknown }).text;
            return typeof text === 'string' ? text : '';
          }
          return '';
        })
        .join('');
    }
    return '';
  }

  async complete(prompt: string, options?: LLMOptions): Promise<string> {
    const baseModel = this.model.split('/').pop() ?? this.model;
    const body: Record<string, unknown> = {
      model: this.model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: options?.maxTokens ?? 2000,
      response_format: options?.jsonMode ? { type: 'json_object' } : undefined,
    };

    if (!baseModel.startsWith('gpt-5')) {
      body.temperature = options?.temperature ?? 0.7;
    }

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) throw new Error(`LLM request failed: ${res.status}`);
    const data = await res.json();
    return this.normalizeContent(data?.choices?.[0]?.message?.content);
  }
}

export class ClaudeProvider implements LLMProvider {
  private apiKey: string;
  private model: string;

  constructor(apiKey: string, model = 'claude-3-5-sonnet-20241022') {
    this.apiKey = apiKey;
    this.model = model;
  }

  async complete(prompt: string, options?: LLMOptions): Promise<string> {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: options?.maxTokens ?? 2000,
        temperature: options?.temperature ?? 0.7,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!res.ok) throw new Error(`Claude request failed: ${res.status}`);
    const data = await res.json();
    return data.content[0].text;
  }
}

export class OllamaProvider implements LLMProvider {
  private model: string;
  private baseUrl: string;

  constructor(model = 'llama3.2', baseUrl = 'http://localhost:11434') {
    this.model = model;
    this.baseUrl = baseUrl;
  }

  async complete(prompt: string, options?: LLMOptions): Promise<string> {
    const res = await fetch(`${this.baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        prompt,
        stream: false,
        options: {
          temperature: options?.temperature ?? 0.7,
        },
      }),
    });

    if (!res.ok) throw new Error(`Ollama request failed: ${res.status}`);
    const data = await res.json();
    return data.response;
  }
}
