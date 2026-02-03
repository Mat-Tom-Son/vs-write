import Database from '@tauri-apps/plugin-sql';
import { mkdir } from '@tauri-apps/plugin-fs';
import type { Entity, Section, Diagnostic, Tag } from '../lib/schemas';

export interface ProjectYamlData {
  id: string;
  name: string;
  author?: string;
  synopsis?: string;
  created_at: string;
  modified_at: string;
  settings?: Record<string, unknown>;
}

export interface ChatConversation {
  id: string;
  title?: string;
  created_at: string;
  updated_at: string;
}

export interface ChatMessage {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  tool_calls?: Array<{
    id: string;
    type: string;
    function: {
      name: string;
      arguments: string;
    };
  }>;
  tool_results?: Array<{
    tool_call_id: string;
    output: string;
  }>;
  metadata?: Record<string, unknown>;
  created_at: string;
}

/**
 * DatabaseService manages SQLite operations for VS Write.
 *
 * The database serves as a cache/index layer where files are the source of truth.
 * All data can be rebuilt from the file system if the database is corrupted.
 */
export class DatabaseService {
  private db: Database;

  /**
   * Create and initialize a DatabaseService for a project.
   *
   * @param projectRoot - Absolute path to the project folder
   * @returns Initialized DatabaseService instance
   */
  static async create(projectRoot: string): Promise<DatabaseService> {
    const normalizedRoot = projectRoot.replace(/\\/g, '/');
    const dbDir = `${normalizedRoot}/.storyide`;
    await mkdir(dbDir, { recursive: true });
    const dbPath = `${dbDir}/index.db`;
    const db = await Database.load(`sqlite:${dbPath}`);
    const service = new DatabaseService(db);
    await service.initialize();
    return service;
  }

  private constructor(db: Database) {
    this.db = db;
  }

  /**
   * Initialize database schema.
   * Creates all tables, indexes, and triggers if they don't exist.
   */
  async initialize(): Promise<void> {
    // Schema version tracking
    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS schema_info (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      )
    `);

    // Project metadata (cached from project.yaml)
    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS project (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        author TEXT,
        synopsis TEXT,
        created_at TEXT NOT NULL,
        modified_at TEXT NOT NULL,
        settings_json TEXT
      )
    `);

    // Entities index
    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS entities (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        description TEXT,
        aliases_json TEXT,
        metadata_json TEXT,
        file_path TEXT NOT NULL,
        created_at TEXT,
        modified_at TEXT,
        file_hash TEXT
      )
    `);
    await this.db.execute(`CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(type)`);
    await this.db.execute(`CREATE INDEX IF NOT EXISTS idx_entities_name ON entities(name COLLATE NOCASE)`);

    // Sections index
    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS sections (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        "order" INTEGER NOT NULL,
        alignment TEXT DEFAULT 'left',
        parent_id TEXT,
        collapsed INTEGER DEFAULT 0,
        content TEXT,
        content_preview TEXT,
        word_count INTEGER,
        file_path TEXT NOT NULL,
        created_at TEXT,
        modified_at TEXT,
        file_hash TEXT,
        FOREIGN KEY (parent_id) REFERENCES sections(id) ON DELETE SET NULL
      )
    `);
    await this.db.execute(`CREATE INDEX IF NOT EXISTS idx_sections_order ON sections("order")`);
    await this.db.execute(`CREATE UNIQUE INDEX IF NOT EXISTS idx_sections_filepath ON sections(file_path)`);

    // Section-Entity relationships
    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS section_entities (
        section_id TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        PRIMARY KEY (section_id, entity_id),
        FOREIGN KEY (section_id) REFERENCES sections(id) ON DELETE CASCADE,
        FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE CASCADE
      )
    `);
    await this.db.execute(`CREATE INDEX IF NOT EXISTS idx_section_entities_entity ON section_entities(entity_id)`);

    // Entity tags (inline text ranges)
    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS entity_tags (
        id TEXT PRIMARY KEY,
        section_id TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        from_pos INTEGER NOT NULL,
        to_pos INTEGER NOT NULL,
        FOREIGN KEY (section_id) REFERENCES sections(id) ON DELETE CASCADE,
        FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE CASCADE
      )
    `);

    // Diagnostics (ephemeral - not persisted to files)
    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS diagnostics (
        id TEXT PRIMARY KEY,
        section_id TEXT NOT NULL,
        entity_id TEXT,
        severity TEXT NOT NULL,
        message TEXT NOT NULL,
        suggestion TEXT,
        from_pos INTEGER NOT NULL,
        to_pos INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (section_id) REFERENCES sections(id) ON DELETE CASCADE
      )
    `);
    await this.db.execute(`CREATE INDEX IF NOT EXISTS idx_diagnostics_section ON diagnostics(section_id)`);

    // Chat conversations
    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS chat_conversations (
        id TEXT PRIMARY KEY,
        title TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    await this.db.execute(`CREATE INDEX IF NOT EXISTS idx_chat_conversations_updated ON chat_conversations(updated_at DESC)`);

    // Chat messages
    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS chat_messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        tool_calls_json TEXT,
        tool_results_json TEXT,
        metadata_json TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (conversation_id) REFERENCES chat_conversations(id) ON DELETE CASCADE
      )
    `);
    await this.db.execute(`CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation ON chat_messages(conversation_id, created_at)`);
    await this.db.execute(`CREATE INDEX IF NOT EXISTS idx_chat_messages_created ON chat_messages(created_at)`);

    // Full-text search virtual table
    await this.db.execute(`
      CREATE VIRTUAL TABLE IF NOT EXISTS sections_fts USING fts5(
        title,
        content,
        content=sections,
        content_rowid=rowid
      )
    `);

    // Triggers to keep FTS in sync (check if they exist first)
    const triggers = await this.db.select<Array<{ name: string }>>(`
      SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'sections_fts_%'
    `);

    if (triggers.length === 0) {
      await this.db.execute(`
        CREATE TRIGGER sections_fts_insert AFTER INSERT ON sections BEGIN
          INSERT INTO sections_fts(rowid, title, content)
          VALUES (new.rowid, new.title, new.content);
        END
      `);

      await this.db.execute(`
        CREATE TRIGGER sections_fts_delete AFTER DELETE ON sections BEGIN
          DELETE FROM sections_fts WHERE rowid = old.rowid;
        END
      `);

      await this.db.execute(`
        CREATE TRIGGER sections_fts_update AFTER UPDATE ON sections BEGIN
          UPDATE sections_fts SET title = new.title, content = new.content
          WHERE rowid = new.rowid;
        END
      `);
    }

    // Record schema version
    const schemaVersion = 1;
    await this.db.execute(`
      INSERT OR IGNORE INTO schema_info (version, applied_at)
      VALUES (?, datetime('now'))
    `, [schemaVersion]);
  }

  // ==================== Project Operations ====================

  async upsertProject(project: ProjectYamlData): Promise<void> {
    await this.db.execute(`
      INSERT OR REPLACE INTO project (id, name, author, synopsis, created_at, modified_at, settings_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [
      project.id,
      project.name,
      project.author || null,
      project.synopsis || null,
      project.created_at,
      project.modified_at,
      JSON.stringify(project.settings || {})
    ]);
  }

  async getProject(): Promise<ProjectYamlData | null> {
    const rows = await this.db.select<Array<{
      id: string;
      name: string;
      author: string | null;
      synopsis: string | null;
      created_at: string;
      modified_at: string;
      settings_json: string;
    }>>(`SELECT * FROM project LIMIT 1`);

    if (rows.length === 0) return null;

    const row = rows[0];
    return {
      id: row.id,
      name: row.name,
      author: row.author || undefined,
      synopsis: row.synopsis || undefined,
      created_at: row.created_at,
      modified_at: row.modified_at,
      settings: JSON.parse(row.settings_json || '{}')
    };
  }

  // ==================== Entity Operations ====================

  async upsertEntity(entity: Entity, filePath: string, fileHash: string): Promise<void> {
    await this.db.execute(`
      INSERT OR REPLACE INTO entities
      (id, name, type, description, aliases_json, metadata_json, file_path, created_at, modified_at, file_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      entity.id,
      entity.name,
      entity.type,
      entity.description,
      JSON.stringify(entity.aliases),
      JSON.stringify(entity.metadata),
      filePath,
      new Date().toISOString(),
      new Date().toISOString(),
      fileHash
    ]);
  }

  async deleteEntity(id: string): Promise<void> {
    await this.db.execute(`DELETE FROM entities WHERE id = ?`, [id]);
  }

  async getAllEntities(): Promise<Entity[]> {
    const rows = await this.db.select<Array<{
      id: string;
      name: string;
      type: string;
      description: string;
      aliases_json: string;
      metadata_json: string;
    }>>(`SELECT id, name, type, description, aliases_json, metadata_json FROM entities`);

    return rows.map(row => ({
      id: row.id,
      name: row.name,
      type: row.type as Entity['type'],
      description: row.description,
      aliases: JSON.parse(row.aliases_json || '[]'),
      metadata: JSON.parse(row.metadata_json || '{}')
    }));
  }

  async getEntitiesByType(type: Entity['type']): Promise<Entity[]> {
    const rows = await this.db.select<Array<{
      id: string;
      name: string;
      type: string;
      description: string;
      aliases_json: string;
      metadata_json: string;
    }>>(`SELECT id, name, type, description, aliases_json, metadata_json FROM entities WHERE type = ?`, [type]);

    return rows.map(row => ({
      id: row.id,
      name: row.name,
      type: row.type as Entity['type'],
      description: row.description,
      aliases: JSON.parse(row.aliases_json || '[]'),
      metadata: JSON.parse(row.metadata_json || '{}')
    }));
  }

  // ==================== Section Operations ====================

  async upsertSection(section: Section, filePath: string, fileHash: string): Promise<void> {
    const wordCount = section.content.split(/\s+/).length;
    const contentPreview = section.content.slice(0, 200);

    await this.db.execute(`
      INSERT OR REPLACE INTO sections
      (id, title, "order", alignment, parent_id, collapsed, content, content_preview, word_count, file_path, created_at, modified_at, file_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      section.id,
      section.title,
      section.order,
      section.alignment,
      section.parentId || null,
      section.collapsed ? 1 : 0,
      section.content,
      contentPreview,
      wordCount,
      filePath,
      new Date().toISOString(),
      new Date().toISOString(),
      fileHash
    ]);
  }

  async deleteSection(id: string): Promise<void> {
    await this.db.execute(`DELETE FROM sections WHERE id = ?`, [id]);
  }

  async getAllSections(): Promise<Section[]> {
    const rows = await this.db.select<Array<{
      id: string;
      title: string;
      order: number;
      alignment: string;
      parent_id: string | null;
      collapsed: number;
      content: string;
    }>>(`SELECT id, title, "order", alignment, parent_id, collapsed, content FROM sections`);

    return Promise.all(rows.map(async (row) => {
      const entityIds = await this.getSectionEntityIds(row.id);
      const tags = await this.getSectionTags(row.id);

      return {
        id: row.id,
        title: row.title,
        order: row.order,
        content: row.content,
        alignment: row.alignment as 'left' | 'center' | 'right',
        parentId: row.parent_id || null,
        collapsed: row.collapsed === 1,
        entityIds,
        tags,
        diagnostics: []
      };
    }));
  }

  async getSectionsByOrder(): Promise<Section[]> {
    const sections = await this.getAllSections();
    return sections.sort((a, b) => a.order - b.order);
  }

  // ==================== Relationship Operations ====================

  async syncSectionEntities(sectionId: string, entityIds: string[]): Promise<void> {
    // Delete existing relationships
    await this.db.execute(`DELETE FROM section_entities WHERE section_id = ?`, [sectionId]);

    // Insert new relationships
    for (const entityId of entityIds) {
      await this.db.execute(`
        INSERT INTO section_entities (section_id, entity_id) VALUES (?, ?)
      `, [sectionId, entityId]);
    }
  }

  async getSectionEntityIds(sectionId: string): Promise<string[]> {
    const rows = await this.db.select<Array<{ entity_id: string }>>(`
      SELECT entity_id FROM section_entities WHERE section_id = ?
    `, [sectionId]);

    return rows.map(row => row.entity_id);
  }

  async syncEntityTags(sectionId: string, tags: Tag[]): Promise<void> {
    // Delete existing tags
    await this.db.execute(`DELETE FROM entity_tags WHERE section_id = ?`, [sectionId]);

    // Insert new tags
    for (const tag of tags) {
      await this.db.execute(`
        INSERT INTO entity_tags (id, section_id, entity_id, from_pos, to_pos)
        VALUES (?, ?, ?, ?, ?)
      `, [tag.id, sectionId, tag.entityId, tag.from, tag.to]);
    }
  }

  async getSectionTags(sectionId: string): Promise<Tag[]> {
    const rows = await this.db.select<Array<{
      id: string;
      entity_id: string;
      from_pos: number;
      to_pos: number;
    }>>(`SELECT id, entity_id, from_pos, to_pos FROM entity_tags WHERE section_id = ?`, [sectionId]);

    return rows.map(row => ({
      id: row.id,
      entityId: row.entity_id,
      from: row.from_pos,
      to: row.to_pos
    }));
  }

  // ==================== Diagnostics Operations ====================

  async upsertDiagnostics(sectionId: string, diagnostics: Diagnostic[]): Promise<void> {
    // Delete existing diagnostics for this section
    await this.db.execute(`DELETE FROM diagnostics WHERE section_id = ?`, [sectionId]);

    // Insert new diagnostics
    for (const diag of diagnostics) {
      await this.db.execute(`
        INSERT INTO diagnostics (id, section_id, entity_id, severity, message, suggestion, from_pos, to_pos, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        diag.id,
        diag.sectionId,
        diag.entityId || null,
        diag.severity,
        diag.message,
        diag.suggestion || null,
        diag.range.from,
        diag.range.to,
        new Date().toISOString()
      ]);
    }
  }

  async getDiagnostics(sectionId: string): Promise<Diagnostic[]> {
    const rows = await this.db.select<Array<{
      id: string;
      section_id: string;
      entity_id: string | null;
      severity: string;
      message: string;
      suggestion: string | null;
      from_pos: number;
      to_pos: number;
    }>>(`SELECT * FROM diagnostics WHERE section_id = ?`, [sectionId]);

    return rows.map(row => ({
      id: row.id,
      sectionId: row.section_id,
      entityId: row.entity_id || undefined,
      severity: row.severity as 'info' | 'warning' | 'critical',
      message: row.message,
      suggestion: row.suggestion || undefined,
      range: {
        from: row.from_pos,
        to: row.to_pos
      }
    }));
  }

  // ==================== Search Operations ====================

  async fullTextSearch(query: string): Promise<Section[]> {
    const rows = await this.db.select<Array<{
      id: string;
      title: string;
      order: number;
      alignment: string;
      parent_id: string | null;
      collapsed: number;
      content: string;
    }>>(`
      SELECT s.id, s.title, s."order", s.alignment, s.parent_id, s.collapsed, s.content
      FROM sections s
      JOIN sections_fts fts ON s.rowid = fts.rowid
      WHERE sections_fts MATCH ?
      ORDER BY rank
    `, [query]);

    return Promise.all(rows.map(async (row) => {
      const entityIds = await this.getSectionEntityIds(row.id);
      const tags = await this.getSectionTags(row.id);

      return {
        id: row.id,
        title: row.title,
        order: row.order,
        content: row.content,
        alignment: row.alignment as 'left' | 'center' | 'right',
        parentId: row.parent_id || null,
        collapsed: row.collapsed === 1,
        entityIds,
        tags,
        diagnostics: []
      };
    }));
  }

  // ==================== Rebuild Operations ====================

  /**
   * Rebuild the entire database index from file data.
   * Used when opening a project or recovering from corruption.
   */
  async rebuildIndex(files: {
    project: ProjectYamlData;
    entities: Entity[];
    sections: Section[];
  }): Promise<void> {
    // Clear existing data
    await this.db.execute(`DELETE FROM diagnostics`);
    await this.db.execute(`DELETE FROM entity_tags`);
    await this.db.execute(`DELETE FROM section_entities`);
    await this.db.execute(`DELETE FROM sections`);
    await this.db.execute(`DELETE FROM entities`);
    await this.db.execute(`DELETE FROM project`);

    // Insert project
    await this.upsertProject(files.project);

    // Insert entities (with dummy file paths and hashes for now)
    for (const entity of files.entities) {
      const filePath = `entities/${entity.name.toLowerCase().replace(/\s+/g, '-')}-${entity.id.slice(0, 8)}.yaml`;
      await this.upsertEntity(entity, filePath, 'dummy-hash');
    }

    // Insert sections
    for (const section of files.sections) {
      const filePath = `sections/${String(section.order).padStart(3, '0')}-${section.title.toLowerCase().replace(/\s+/g, '-').slice(0, 30)}-${section.id.slice(0, 8)}.md`;
      await this.upsertSection(section, filePath, 'dummy-hash');

      // Sync relationships
      await this.syncSectionEntities(section.id, section.entityIds);
      await this.syncEntityTags(section.id, section.tags);
    }
  }

  // ==================== Chat Operations ====================

  async createConversation(id: string, title?: string): Promise<ChatConversation> {
    const now = new Date().toISOString();
    await this.db.execute(`
      INSERT INTO chat_conversations (id, title, created_at, updated_at)
      VALUES (?, ?, ?, ?)
    `, [id, title || null, now, now]);

    return {
      id,
      title,
      created_at: now,
      updated_at: now
    };
  }

  async getConversation(id: string): Promise<ChatConversation | null> {
    const rows = await this.db.select<Array<{
      id: string;
      title: string | null;
      created_at: string;
      updated_at: string;
    }>>(`SELECT * FROM chat_conversations WHERE id = ?`, [id]);

    if (rows.length === 0) return null;

    const row = rows[0];
    return {
      id: row.id,
      title: row.title || undefined,
      created_at: row.created_at,
      updated_at: row.updated_at
    };
  }

  async getAllConversations(): Promise<ChatConversation[]> {
    const rows = await this.db.select<Array<{
      id: string;
      title: string | null;
      created_at: string;
      updated_at: string;
    }>>(`
      SELECT c.*
      FROM chat_conversations c
      WHERE EXISTS (
        SELECT 1 FROM chat_messages m WHERE m.conversation_id = c.id
      )
      ORDER BY c.updated_at DESC
    `);

    return rows.map(row => ({
      id: row.id,
      title: row.title || undefined,
      created_at: row.created_at,
      updated_at: row.updated_at
    }));
  }

  async updateConversation(id: string, updates: { title?: string; touchUpdatedAt?: boolean }): Promise<void> {
    const touchUpdated = updates.touchUpdatedAt ?? true;
    const now = new Date().toISOString();
    await this.db.execute(
      `
      UPDATE chat_conversations
      SET title = COALESCE(?, title), updated_at = COALESCE(?, updated_at)
      WHERE id = ?
    `,
      [updates.title || null, touchUpdated ? now : null, id],
    );
  }

  async deleteConversation(id: string): Promise<void> {
    await this.db.execute(`DELETE FROM chat_conversations WHERE id = ?`, [id]);
  }

  async addMessage(message: ChatMessage): Promise<void> {
    await this.db.execute(`
      INSERT INTO chat_messages
      (id, conversation_id, role, content, tool_calls_json, tool_results_json, metadata_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      message.id,
      message.conversation_id,
      message.role,
      message.content,
      message.tool_calls ? JSON.stringify(message.tool_calls) : null,
      message.tool_results ? JSON.stringify(message.tool_results) : null,
      message.metadata ? JSON.stringify(message.metadata) : null,
      message.created_at
    ]);

    // Update conversation's updated_at timestamp
    await this.db.execute(`
      UPDATE chat_conversations SET updated_at = ? WHERE id = ?
    `, [message.created_at, message.conversation_id]);
  }

  async getMessages(conversationId: string): Promise<ChatMessage[]> {
    const rows = await this.db.select<Array<{
      id: string;
      conversation_id: string;
      role: string;
      content: string;
      tool_calls_json: string | null;
      tool_results_json: string | null;
      metadata_json: string | null;
      created_at: string;
    }>>(`
      SELECT * FROM chat_messages
      WHERE conversation_id = ?
      ORDER BY created_at ASC
    `, [conversationId]);

    return rows.map(row => ({
      id: row.id,
      conversation_id: row.conversation_id,
      role: row.role as ChatMessage['role'],
      content: row.content,
      tool_calls: row.tool_calls_json ? JSON.parse(row.tool_calls_json) : undefined,
      tool_results: row.tool_results_json ? JSON.parse(row.tool_results_json) : undefined,
      metadata: row.metadata_json ? JSON.parse(row.metadata_json) : undefined,
      created_at: row.created_at
    }));
  }

  async deleteMessage(id: string): Promise<void> {
    await this.db.execute(`DELETE FROM chat_messages WHERE id = ?`, [id]);
  }

  async getFirstUserMessage(conversationId: string): Promise<string | null> {
    const rows = await this.db.select<Array<{ content: string }>>(
      `
        SELECT content
        FROM chat_messages
        WHERE conversation_id = ? AND role = 'user'
        ORDER BY created_at ASC
        LIMIT 1
      `,
      [conversationId],
    );

    if (rows.length === 0) return null;
    return rows[0].content;
  }

  async close(): Promise<void> {
    await this.db.close();
  }
}
