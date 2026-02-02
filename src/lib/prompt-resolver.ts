import type { SystemPromptSettings } from './app-settings';
import type { ProjectSettings, Entity, Section } from './schemas';

/**
 * Resolves system prompts with three-layer hierarchy:
 * Project-level > App-level > Defaults
 *
 * Also handles template variable interpolation for dynamic prompt generation.
 */
export class PromptResolver {
  private appSettings: SystemPromptSettings;
  private projectSettings?: ProjectSettings;

  constructor(
    appSettings: SystemPromptSettings,
    projectSettings?: ProjectSettings
  ) {
    this.appSettings = appSettings;
    this.projectSettings = projectSettings;
  }

  /**
   * Get the narrative analysis prompt with hierarchy resolution
   */
  getNarrativeAnalysisPrompt(): string {
    return this.projectSettings?.systemPrompts?.narrativeAnalysis
      || this.appSettings.narrativeAnalysis;
  }

  /**
   * Get the consistency checking prompt with hierarchy resolution
   */
  getConsistencyCheckingPrompt(): string {
    return this.projectSettings?.systemPrompts?.consistencyChecking
      || this.appSettings.consistencyChecking;
  }

  /**
   * Get the agent system prompt with hierarchy resolution
   */
  getAgentSystemPrompt(): string {
    return this.projectSettings?.systemPrompts?.agentSystemPrompt
      || this.appSettings.agentSystemPrompt;
  }

  /**
   * Interpolate template variables in a prompt string
   *
   * Supports:
   * - {{variable}} - Simple variable
   * - {{object.property}} - Nested property access
   * - {{array}} - Arrays are converted to comma-separated lists
   */
  interpolate(template: string, context: Record<string, unknown>): string {
    return template.replace(/\{\{([^}]+)\}\}/g, (_match, path) => {
      const trimmedPath = path.trim();
      const value = this.resolvePath(trimmedPath, context);

      if (value === undefined || value === null) {
        return ''; // Return empty string for missing values
      }

      if (Array.isArray(value)) {
        return value.join(', ');
      }

      return String(value);
    });
  }

  /**
   * Build context object for narrative analysis
   */
  buildNarrativeAnalysisContext(entity: Entity, fullText: string): Record<string, unknown> {
    return {
      entity: {
        name: entity.name,
        type: entity.type,
        description: entity.description,
        aliases: entity.aliases || [],
      },
      fullText,
    };
  }

  /**
   * Build context object for consistency checking
   */
  buildConsistencyCheckingContext(
    entity: Entity,
    current: Section,
    history: Section[]
  ): Record<string, unknown> {
    const historyText = history.length > 0
      ? history.map((s) => `### ${s.title}\n${s.content.slice(0, 500)}`).join('\n\n')
      : '(No prior appearances)';

    return {
      entity: {
        name: entity.name,
        type: entity.type,
        description: entity.description,
        aliases: entity.aliases || [],
      },
      current: {
        title: current.title,
        content: current.content,
      },
      historyText,
    };
  }

  /**
   * Build context with entity tag information
   */
  buildEntityTagContext(
    entity: Entity,
    sections: Section[]
  ): Record<string, unknown> {
    // Extract tags for this entity from all sections
    const taggedSnippets = sections.flatMap(section =>
      section.tags
        .filter(tag => tag.entityId === entity.id)
        .map(tag => ({
          section: section.title,
          text: section.content.slice(tag.from, tag.to),
        }))
    );

    const tagCount = taggedSnippets.length;

    // Format tagged snippets for display
    const formattedSnippets = taggedSnippets
      .map(({ section, text }) => `[${section}] "${text}"`)
      .join('\n');

    return {
      entity: {
        name: entity.name,
        type: entity.type,
        description: entity.description,
        aliases: entity.aliases || [],
        tags: taggedSnippets,
      },
      tagCount,
      taggedSnippets: formattedSnippets,
    };
  }

  /**
   * Build context object for agent system prompt
   * Includes project metadata, entity/section summaries, and file structure
   */
  buildAgentContext(
    project: {
      name: string;
      synopsis?: string;
      entities: Entity[];
      sections: Section[];
    },
    projectRoot: string
  ): Record<string, unknown> {
    // Group entities by type
    const entityGroups = new Map<string, string[]>();
    for (const entity of project.entities) {
      const names = entityGroups.get(entity.type) || [];
      names.push(entity.name);
      entityGroups.set(entity.type, names);
    }

    // Format entity summary
    const entitySummary = Array.from(entityGroups.entries())
      .map(([type, names]) => `- ${type}: ${names.join(', ')}`)
      .join('\n');

    // Format section list (in order)
    const sortedSections = [...project.sections].sort((a, b) => a.order - b.order);
    const sectionList = sortedSections
      .map((s, i) => `${i + 1}. ${s.title}`)
      .join('\n');

    // Build file paths for sections (matching FileService.generateSectionFilename)
    // Format: [order]-[slug]-[short-id].md (e.g., 001-chapter-1-xyz78910.md)
    const slugify = (text: string) => text.toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').trim();

    const sectionFiles = sortedSections
      .map(s => `sections/${String(s.order).padStart(3, '0')}-${slugify(s.title).slice(0, 30)}-${s.id.slice(0, 8)}.md`)
      .join('\n');

    // Build file paths for entities (matching FileService.generateEntityFilename)
    // Format: [slug]-[short-id].yaml (e.g., john-doe-abc12345.yaml)
    const entityFiles = project.entities
      .map(e => `entities/${slugify(e.name)}-${e.id.slice(0, 8)}.yaml`)
      .join('\n');

    return {
      project: {
        name: project.name,
        synopsis: project.synopsis || '(No synopsis)',
        root: projectRoot,
      },
      entityCount: project.entities.length,
      sectionCount: project.sections.length,
      entitySummary: entitySummary || '(No entities defined)',
      sectionList: sectionList || '(No sections)',
      sectionFiles,
      entityFiles,
      fileStructure: `${projectRoot}/
├── project.yaml
├── sections/
${sortedSections.map((s, i) => `│   └── ${String(i).padStart(3, '0')}-${s.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${s.id.slice(0, 8)}.md`).join('\n') || '│   (empty)'}
└── entities/
${project.entities.map(e => `    └── ${e.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${e.id.slice(0, 8)}.yaml`).join('\n') || '    (empty)'}`,
    };
  }

  /**
   * Resolve a dot-notation path in an object
   * e.g., "entity.name" -> context.entity.name
   */
  private resolvePath(path: string, context: Record<string, unknown>): unknown {
    const parts = path.split('.');
    let current: unknown = context;

    for (const part of parts) {
      if (current === undefined || current === null) {
        return undefined;
      }
      if (typeof current === 'object' && current !== null) {
        current = (current as Record<string, unknown>)[part];
      } else {
        return undefined;
      }
    }

    return current;
  }
}
