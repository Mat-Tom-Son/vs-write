import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Entity, Section, Tag } from '../lib/schemas';
import { EntityAPIService } from './EntityAPIService';

const makeEntity = (overrides: Partial<Entity> = {}): Entity => ({
  id: '11111111-1111-1111-1111-111111111111',
  name: 'Alice',
  type: 'character',
  description: 'Primary character.',
  aliases: ['Al'],
  metadata: {},
  ...overrides,
});

const makeSection = (overrides: Partial<Section> = {}): Section => ({
  id: '22222222-2222-2222-2222-222222222222',
  title: 'Opening',
  order: 1,
  content: 'Hello world',
  tags: [],
  alignment: 'left',
  entityIds: [],
  diagnostics: [],
  parentId: null,
  collapsed: false,
  ...overrides,
});

describe('EntityAPIService', () => {
  const projectRoot = '/tmp/project';
  let fileService: {
    writeEntity: ReturnType<typeof vi.fn>;
    deleteEntity: ReturnType<typeof vi.fn>;
    listEntityFiles: ReturnType<typeof vi.fn>;
    writeSection: ReturnType<typeof vi.fn>;
  };
  let dbService: {
    getAllEntities: ReturnType<typeof vi.fn>;
    getEntitiesByType: ReturnType<typeof vi.fn>;
    upsertEntity: ReturnType<typeof vi.fn>;
    deleteEntity: ReturnType<typeof vi.fn>;
    getAllSections: ReturnType<typeof vi.fn>;
    syncSectionEntities: ReturnType<typeof vi.fn>;
    syncEntityTags: ReturnType<typeof vi.fn>;
    upsertSection: ReturnType<typeof vi.fn>;
    getSectionTags: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    fileService = {
      writeEntity: vi.fn(),
      deleteEntity: vi.fn(),
      listEntityFiles: vi.fn(),
      writeSection: vi.fn(),
    };
    dbService = {
      getAllEntities: vi.fn(),
      getEntitiesByType: vi.fn(),
      upsertEntity: vi.fn(),
      deleteEntity: vi.fn(),
      getAllSections: vi.fn(),
      syncSectionEntities: vi.fn(),
      syncEntityTags: vi.fn(),
      upsertSection: vi.fn(),
      getSectionTags: vi.fn(),
    };
  });

  const buildService = () => {
    const service = new EntityAPIService(
      fileService as unknown as any,
      dbService as unknown as any,
      projectRoot
    );
    (service as unknown as { computeFileHash: (path: string) => Promise<string> }).computeFileHash =
      vi.fn().mockResolvedValue('hash');
    return service;
  };

  it('returns entity by id', async () => {
    const entity = makeEntity();
    dbService.getAllEntities.mockResolvedValue([entity]);
    const service = buildService();

    const result = await service.getById(entity.id);

    expect(result).toEqual(entity);
  });

  it('searches across name, description, and aliases', async () => {
    const alice = makeEntity();
    const bob = makeEntity({
      id: '33333333-3333-3333-3333-333333333333',
      name: 'Bob',
      description: 'Secondary character.',
      aliases: ['Bobby'],
    });
    dbService.getAllEntities.mockResolvedValue([alice, bob]);
    const service = buildService();

    const byAlias = await service.search('bobb');
    const byDescription = await service.search('secondary');

    expect(byAlias).toEqual([bob]);
    expect(byDescription).toEqual([bob]);
  });

  it('creates entities and notifies listeners', async () => {
    const entity = makeEntity();
    dbService.getAllEntities.mockResolvedValue([]);
    fileService.writeEntity.mockResolvedValue('entities/alice-11111111.yaml');
    const service = buildService();
    const listener = vi.fn();
    service.onEntityChanged(listener);

    await service.create(entity);

    expect(fileService.writeEntity).toHaveBeenCalledWith(entity);
    expect(dbService.upsertEntity).toHaveBeenCalledWith(entity, 'entities/alice-11111111.yaml', 'hash');
    expect(listener).toHaveBeenCalledWith({ type: 'create', entity });
  });

  it('updates entities and notifies listeners', async () => {
    const entity = makeEntity();
    const updated = { ...entity, name: 'Alice Updated' };
    dbService.getAllEntities.mockResolvedValue([entity]);
    fileService.listEntityFiles.mockResolvedValue(['entities/alice-11111111.yaml']);
    fileService.writeEntity.mockResolvedValue('entities/alice-updated-11111111.yaml');
    const service = buildService();
    const listener = vi.fn();
    service.onEntityChanged(listener);

    const result = await service.update(entity.id, { name: 'Alice Updated' });

    expect(result).toEqual(updated);
    expect(dbService.upsertEntity).toHaveBeenCalledWith(updated, 'entities/alice-updated-11111111.yaml', 'hash');
    expect(fileService.deleteEntity).toHaveBeenCalledWith('entities/alice-11111111.yaml');
    expect(listener).toHaveBeenCalledWith({ type: 'update', entity: updated });
  });

  it('adds tags with clamped bounds and syncs persistence', async () => {
    const entity = makeEntity();
    const section = makeSection({ content: 'Hello' });
    dbService.getAllEntities.mockResolvedValue([entity]);
    dbService.getAllSections.mockResolvedValue([section]);
    fileService.writeSection.mockResolvedValue('sections/001-opening-22222222.md');
    const service = buildService();
    const tagsListener = vi.fn();
    service.onTagsUpdated(tagsListener);

    const tag = await service.addTag(section.id, entity.id, -10, 999);

    expect(tag.entityId).toBe(entity.id);
    expect(tag.from).toBe(0);
    expect(tag.to).toBe(section.content.length);
    expect(fileService.writeSection).toHaveBeenCalled();
    expect(dbService.syncSectionEntities).toHaveBeenCalledWith(section.id, [entity.id]);
    expect(dbService.syncEntityTags).toHaveBeenCalledWith(
      section.id,
      expect.arrayContaining([expect.objectContaining({ entityId: entity.id })])
    );
    expect(tagsListener).toHaveBeenCalledWith({
      sectionId: section.id,
      tags: expect.any(Array),
    });
  });

  it('removes tags and updates entity links', async () => {
    const entity = makeEntity();
    const tag: Tag = {
      id: '44444444-4444-4444-4444-444444444444',
      entityId: entity.id,
      from: 0,
      to: 5,
    };
    const section = makeSection({
      tags: [tag],
      entityIds: [entity.id],
    });
    dbService.getAllSections.mockResolvedValue([section]);
    fileService.writeSection.mockResolvedValue('sections/001-opening-22222222.md');
    const service = buildService();

    await service.removeTag(section.id, tag.id);

    expect(dbService.syncSectionEntities).toHaveBeenCalledWith(section.id, []);
    expect(dbService.syncEntityTags).toHaveBeenCalledWith(section.id, []);
  });

  it('returns entities in requested order', async () => {
    const one = makeEntity();
    const two = makeEntity({
      id: '55555555-5555-5555-5555-555555555555',
      name: 'Two',
    });
    dbService.getAllEntities.mockResolvedValue([one, two]);
    const service = buildService();

    const result = await service.getEntitiesByIds([two.id, one.id]);

    expect(result).toEqual([two, one]);
  });

  it('returns tags by section', async () => {
    const tags: Tag[] = [
      { id: '66666666-6666-6666-6666-666666666666', entityId: makeEntity().id, from: 1, to: 2 },
    ];
    dbService.getSectionTags.mockResolvedValue(tags);
    const service = buildService();

    const result = await service.getTagsBySection('section-id');

    expect(result).toEqual(tags);
  });
});
