import { z } from 'zod';

// Primitive enums
export const EntityTypeSchema = z.enum(['fact', 'rule', 'concept', 'relationship', 'event', 'custom']);
export type EntityType = z.infer<typeof EntityTypeSchema>;

export const DiagnosticSeveritySchema = z.enum(['info', 'warning', 'critical']);
export type DiagnosticSeverity = z.infer<typeof DiagnosticSeveritySchema>;

// Diagnostic (linter output)
export const DiagnosticSchema = z.object({
  id: z.string().uuid(),
  sectionId: z.string().uuid(),
  entityId: z.string().uuid().optional(),
  range: z.object({
    from: z.number().int().nonnegative(),
    to: z.number().int().nonnegative(),
  }),
  severity: DiagnosticSeveritySchema,
  message: z.string(),
  suggestion: z.string().optional(),
});
export type Diagnostic = z.infer<typeof DiagnosticSchema>;

// Tag (inline entity reference)
export const TagSchema = z.object({
  id: z.string().uuid(),
  entityId: z.string().uuid(),
  from: z.number().int().nonnegative(),
  to: z.number().int().nonnegative(),
});
export type Tag = z.infer<typeof TagSchema>;

// Entity definition (constraints)
export const EntitySchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  type: EntityTypeSchema,
  description: z.string(),
  aliases: z.array(z.string()).default([]),
  // Extensible metadata for type-specific constraints
  metadata: z
    .object({
      customLabel: z.string().optional(),
    })
    .catchall(z.unknown())
    .default({}),
});
export type Entity = z.infer<typeof EntitySchema>;

// Section (narrative unit)
export const SectionSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1),
  order: z.number().int().nonnegative(),
  content: z.string().default(''),
  tags: z.array(TagSchema).default([]),
  alignment: z.enum(['left', 'center', 'right']).default('left'),
  entityIds: z.array(z.string().uuid()).default([]),
  diagnostics: z.array(DiagnosticSchema).default([]),
  parentId: z.string().uuid().nullable().default(null),
  collapsed: z.boolean().default(false),
});
export type Section = z.infer<typeof SectionSchema>;

// Project container
export const ProjectMetaSchema = z.object({
  createdAt: z.string().datetime(),
  modifiedAt: z.string().datetime(),
  author: z.string().optional(),
  synopsis: z.string().optional(),
});

export const ProjectSettingsSchema = z.object({
  default_section_alignment: z.enum(['left', 'center', 'right']).default('left'),
  systemPrompts: z.object({
    narrativeAnalysis: z.string().optional(),
    consistencyChecking: z.string().optional(),
    agentSystemPrompt: z.string().optional(),
  }).optional(),
});
export type ProjectSettings = z.infer<typeof ProjectSettingsSchema>;

export const ProjectSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  version: z.string().default('0.1.0'),
  meta: ProjectMetaSchema,
  settings: ProjectSettingsSchema.default({ default_section_alignment: 'left' }),
  entities: z.array(EntitySchema),
  sections: z.array(SectionSchema),
});
export type Project = z.infer<typeof ProjectSchema>;

// Factories
export function createId(): string {
  return crypto.randomUUID();
}

export function createEntity(partial: Partial<Entity> & Pick<Entity, 'name' | 'type'>): Entity {
  return EntitySchema.parse({
    id: createId(),
    description: '',
    aliases: [],
    metadata: {},
    ...partial,
  });
}

export function createSection(partial: Partial<Section> & Pick<Section, 'title' | 'order'>): Section {
  return SectionSchema.parse({
    id: createId(),
    content: '',
    entityIds: [],
    diagnostics: [],
    parentId: null,
    collapsed: false,
    ...partial,
  });
}

export function createProject(name: string): Project {
  const now = new Date().toISOString();
  return ProjectSchema.parse({
    id: createId(),
    name,
    version: '0.1.0',
    meta: { createdAt: now, modifiedAt: now },
    settings: { default_section_alignment: 'left' },
    entities: [],
    sections: [], // Start with empty project
  });
}
