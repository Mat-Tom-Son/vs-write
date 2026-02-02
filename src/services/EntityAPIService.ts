import type { Entity, Section, Tag } from '../lib/schemas';
import { EntitySchema, SectionSchema, createId } from '../lib/schemas';
import { FileService } from './FileService';
import { DatabaseService } from './DatabaseService';
import { xxhash32 } from 'hash-wasm';

export type EntityChangeEvent = {
  type: 'create' | 'update' | 'delete';
  entity: Entity;
};

export type SectionChangeEvent = {
  type: 'tags_updated';
  section: Section;
};

export type TagsUpdatedEvent = {
  sectionId: string;
  tags: Tag[];
};

export type EntityRelationships = {
  entity: Entity;
  sections: Section[];
};

type EntityChangeHandler = (event: EntityChangeEvent) => void;
type SectionChangeHandler = (event: SectionChangeEvent) => void;
type TagsUpdatedHandler = (event: TagsUpdatedEvent) => void;

/**
 * EntityAPIService provides a stable contract for reading and writing
 * entities, sections, and tags without exposing storage internals.
 */
export class EntityAPIService {
  private fileService: FileService;
  private dbService: DatabaseService;
  private projectRoot: string;

  private entityListeners = new Set<EntityChangeHandler>();
  private sectionListeners = new Set<SectionChangeHandler>();
  private tagListeners = new Set<TagsUpdatedHandler>();

  constructor(fileService: FileService, dbService: DatabaseService, projectRoot: string) {
    this.fileService = fileService;
    this.dbService = dbService;
    this.projectRoot = projectRoot;
  }

  static async create(projectRoot: string): Promise<EntityAPIService> {
    const fileService = new FileService(projectRoot);
    const dbService = await DatabaseService.create(projectRoot);
    return new EntityAPIService(fileService, dbService, projectRoot);
  }

  onEntityChanged(handler: EntityChangeHandler): () => void {
    this.entityListeners.add(handler);
    return () => this.entityListeners.delete(handler);
  }

  onSectionChanged(handler: SectionChangeHandler): () => void {
    this.sectionListeners.add(handler);
    return () => this.sectionListeners.delete(handler);
  }

  onTagsUpdated(handler: TagsUpdatedHandler): () => void {
    this.tagListeners.add(handler);
    return () => this.tagListeners.delete(handler);
  }

  async getById(id: string): Promise<Entity | null> {
    const entities = await this.dbService.getAllEntities();
    return entities.find((entity) => entity.id === id) ?? null;
  }

  async listByType(type: Entity['type']): Promise<Entity[]> {
    return await this.dbService.getEntitiesByType(type);
  }

  async getEntitiesByIds(ids: string[]): Promise<Entity[]> {
    if (ids.length === 0) return [];
    const entities = await this.dbService.getAllEntities();
    const byId = new Map(entities.map((entity) => [entity.id, entity]));
    return ids.map((id) => byId.get(id)).filter((entity): entity is Entity => !!entity);
  }

  async search(query: string): Promise<Entity[]> {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return [];

    const entities = await this.dbService.getAllEntities();
    return entities.filter((entity) => {
      const name = entity.name.toLowerCase();
      const description = entity.description.toLowerCase();
      const aliases = entity.aliases.map((alias) => alias.toLowerCase());
      return (
        name.includes(trimmed) ||
        description.includes(trimmed) ||
        aliases.some((alias) => alias.includes(trimmed))
      );
    });
  }

  async getRelationships(entityId: string): Promise<EntityRelationships> {
    const entity = await this.getById(entityId);
    if (!entity) {
      throw new Error(`Entity ${entityId} not found`);
    }

    const sections = await this.dbService.getAllSections();
    const relatedSections = sections
      .filter((section) => section.entityIds.includes(entityId) || section.tags.some((tag) => tag.entityId === entityId))
      .sort((a, b) => a.order - b.order);

    return { entity, sections: relatedSections };
  }

  async getTagsBySection(sectionId: string): Promise<Tag[]> {
    return await this.dbService.getSectionTags(sectionId);
  }

  async create(entity: Entity): Promise<Entity> {
    const parsed = EntitySchema.parse(entity);
    const existing = await this.getById(parsed.id);
    if (existing) {
      throw new Error(`Entity ${parsed.id} already exists`);
    }

    const filePath = await this.fileService.writeEntity(parsed);
    const fileHash = await this.computeFileHash(filePath);
    await this.dbService.upsertEntity(parsed, filePath, fileHash);

    this.emitEntityChange({ type: 'create', entity: parsed });
    return parsed;
  }

  async update(id: string, updates: Partial<Entity>): Promise<Entity> {
    const current = await this.getById(id);
    if (!current) {
      throw new Error(`Entity ${id} not found`);
    }

    const merged = EntitySchema.parse({ ...current, ...updates, id });
    const previousFiles = await this.findEntityFiles(id);
    const filePath = await this.fileService.writeEntity(merged);
    const fileHash = await this.computeFileHash(filePath);
    await this.dbService.upsertEntity(merged, filePath, fileHash);

    for (const previousFile of previousFiles) {
      if (previousFile !== filePath) {
        await this.fileService.deleteEntity(previousFile);
      }
    }

    this.emitEntityChange({ type: 'update', entity: merged });
    return merged;
  }

  async delete(id: string): Promise<void> {
    const entity = await this.getById(id);
    if (!entity) {
      throw new Error(`Entity ${id} not found`);
    }

    const filesToDelete = await this.findEntityFiles(id);
    for (const filePath of filesToDelete) {
      await this.fileService.deleteEntity(filePath);
    }

    await this.dbService.deleteEntity(id);

    const sections = await this.dbService.getAllSections();
    const affectedSections = sections.filter(
      (section) => section.entityIds.includes(id) || section.tags.some((tag) => tag.entityId === id)
    );

    for (const section of affectedSections) {
      const nextTags = section.tags.filter((tag) => tag.entityId !== id);
      const nextEntityIds = section.entityIds.filter((entityId) => entityId !== id);
      const updatedSection = SectionSchema.parse({
        ...section,
        tags: nextTags,
        entityIds: nextEntityIds,
      });

      await this.persistSectionUpdate(updatedSection);
      this.emitSectionChange({ type: 'tags_updated', section: updatedSection });
      this.emitTagsUpdated({ sectionId: updatedSection.id, tags: updatedSection.tags });
    }

    this.emitEntityChange({ type: 'delete', entity });
  }

  async addTag(sectionId: string, entityId: string, from: number, to: number): Promise<Tag> {
    const section = await this.getSectionById(sectionId);
    const entity = await this.getById(entityId);
    if (!entity) {
      throw new Error(`Entity ${entityId} not found`);
    }

    const { clampedFrom, clampedTo } = this.clampTagRange(section, from, to);
    const nextTag: Tag = {
      id: createId(),
      entityId,
      from: clampedFrom,
      to: clampedTo,
    };

    const nextTags = [...section.tags, nextTag];
    const nextEntityIds = section.entityIds.includes(entityId)
      ? section.entityIds
      : [...section.entityIds, entityId];

    const updatedSection = SectionSchema.parse({
      ...section,
      tags: nextTags,
      entityIds: nextEntityIds,
    });

    await this.persistSectionUpdate(updatedSection);
    this.emitSectionChange({ type: 'tags_updated', section: updatedSection });
    this.emitTagsUpdated({ sectionId, tags: updatedSection.tags });

    return nextTag;
  }

  async removeTag(sectionId: string, tagId: string): Promise<void> {
    const section = await this.getSectionById(sectionId);
    const tag = section.tags.find((existing) => existing.id === tagId);
    if (!tag) {
      throw new Error(`Tag ${tagId} not found`);
    }

    const nextTags = section.tags.filter((existing) => existing.id !== tagId);
    const stillLinked = nextTags.some((existing) => existing.entityId === tag.entityId);
    const nextEntityIds = stillLinked
      ? section.entityIds
      : section.entityIds.filter((entityId) => entityId !== tag.entityId);

    const updatedSection = SectionSchema.parse({
      ...section,
      tags: nextTags,
      entityIds: nextEntityIds,
    });

    await this.persistSectionUpdate(updatedSection);
    this.emitSectionChange({ type: 'tags_updated', section: updatedSection });
    this.emitTagsUpdated({ sectionId, tags: updatedSection.tags });
  }

  private async getSectionById(id: string): Promise<Section> {
    const sections = await this.dbService.getAllSections();
    const section = sections.find((entry) => entry.id === id);
    if (!section) {
      throw new Error(`Section ${id} not found`);
    }
    return section;
  }

  private clampTagRange(section: Section, from: number, to: number): { clampedFrom: number; clampedTo: number } {
    const max = section.content.length;
    const clampedFrom = Math.max(0, Math.min(from, max));
    const clampedTo = Math.max(clampedFrom, Math.min(to, max));
    return { clampedFrom, clampedTo };
  }

  private async persistSectionUpdate(section: Section): Promise<void> {
    const filePath = await this.fileService.writeSection(section);
    const fileHash = await this.computeFileHash(filePath);
    await this.dbService.upsertSection(section, filePath, fileHash);
    await this.dbService.syncSectionEntities(section.id, section.entityIds);
    await this.dbService.syncEntityTags(section.id, section.tags);
  }

  private emitEntityChange(event: EntityChangeEvent): void {
    this.entityListeners.forEach((handler) => handler(event));
  }

  private emitSectionChange(event: SectionChangeEvent): void {
    this.sectionListeners.forEach((handler) => handler(event));
  }

  private emitTagsUpdated(event: TagsUpdatedEvent): void {
    this.tagListeners.forEach((handler) => handler(event));
  }

  private async findEntityFiles(entityId: string): Promise<string[]> {
    const shortId = entityId.slice(0, 8);
    const entityFiles = await this.fileService.listEntityFiles();
    return entityFiles.filter((filePath) => filePath.includes(`-${shortId}.yaml`));
  }

  private async computeFileHash(relativeFilePath: string): Promise<string> {
    const fullPath = `${this.projectRoot}/${relativeFilePath}`;
    const { readTextFile } = await import('@tauri-apps/plugin-fs');
    const content = await readTextFile(fullPath);
    return await xxhash32(content);
  }
}
