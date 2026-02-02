import { z } from 'zod';
import type { Entity, Section } from './schemas';

/**
 * File format schemas for YAML and Markdown frontmatter validation.
 * These schemas define the structure of data as it appears in files on disk.
 */

// ==================== Project YAML Schema ====================

export const ProjectYamlSchema = z.object({
  version: z.string().default('1.0.0'),
  schema_version: z.string().default('1.0'),
  metadata: z.object({
    id: z.string().uuid(),
    name: z.string().min(1),
    author: z.string().optional(),
    created_at: z.string().datetime(),
    modified_at: z.string().datetime(),
    synopsis: z.string().optional()
  }),
  settings: z.object({
    default_section_alignment: z.enum(['left', 'center', 'right']).default('left')
  }).optional()
});

export type ProjectYamlData = z.infer<typeof ProjectYamlSchema>;

// ==================== Entity YAML Schema ====================

export const EntityFileSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  type: z.enum(['fact', 'rule', 'concept', 'relationship', 'event', 'custom']),
  created_at: z.string().datetime(),
  modified_at: z.string().datetime(),
  description: z.string(),
  aliases: z.array(z.string()).default([]),
  metadata: z.record(z.unknown()).optional()
});

export type EntityFileData = z.infer<typeof EntityFileSchema>;

// ==================== Section Markdown Frontmatter Schema ====================

export const TagFrontmatterSchema = z.object({
  id: z.string().uuid(),
  entity_id: z.string().uuid(),
  from: z.number().int().min(0),
  to: z.number().int().min(0)
});

export const SectionFrontmatterSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1),
  order: z.number().int().min(0),
  created_at: z.string().datetime(),
  modified_at: z.string().datetime(),
  alignment: z.enum(['left', 'center', 'right']).default('left'),
  parent_id: z.string().uuid().nullable().optional(),
  collapsed: z.boolean().default(false),
  entity_ids: z.array(z.string().uuid()).default([]),
  tags: z.array(TagFrontmatterSchema).default([])
});

export type SectionFrontmatterData = z.infer<typeof SectionFrontmatterSchema>;

export interface SectionFileData {
  frontmatter: SectionFrontmatterData;
  content: string;
}

// ==================== Conversion Helpers ====================

/**
 * Convert Entity from in-memory format to file format
 */
export function entityToFileData(entity: Entity): EntityFileData {
  return {
    id: entity.id,
    name: entity.name,
    type: entity.type,
    created_at: new Date().toISOString(),
    modified_at: new Date().toISOString(),
    description: entity.description,
    aliases: entity.aliases,
    metadata: entity.metadata
  };
}

/**
 * Convert Entity from file format to in-memory format
 */
export function fileDataToEntity(data: EntityFileData): Entity {
  return {
    id: data.id,
    name: data.name,
    type: data.type,
    description: data.description,
    aliases: data.aliases,
    metadata: data.metadata || {}
  };
}

/**
 * Convert Section from in-memory format to file format
 */
export function sectionToFileData(section: Section): SectionFileData {
  return {
    frontmatter: {
      id: section.id,
      title: section.title,
      order: section.order,
      created_at: new Date().toISOString(),
      modified_at: new Date().toISOString(),
      alignment: section.alignment,
      parent_id: section.parentId || null,
      collapsed: section.collapsed,
      entity_ids: section.entityIds,
      tags: section.tags.map(tag => ({
        id: tag.id,
        entity_id: tag.entityId,
        from: tag.from,
        to: tag.to
      }))
    },
    content: section.content
  };
}

/**
 * Convert Section from file format to in-memory format
 */
export function fileDataToSection(data: SectionFileData): Section {
  return {
    id: data.frontmatter.id,
    title: data.frontmatter.title,
    order: data.frontmatter.order,
    content: data.content,
    alignment: data.frontmatter.alignment,
    parentId: data.frontmatter.parent_id || null,
    collapsed: data.frontmatter.collapsed,
    entityIds: data.frontmatter.entity_ids,
    tags: data.frontmatter.tags.map(tag => ({
      id: tag.id,
      entityId: tag.entity_id,
      from: tag.from,
      to: tag.to
    })),
    diagnostics: [] // Diagnostics are ephemeral, not stored in files
  };
}
