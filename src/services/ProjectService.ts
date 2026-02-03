import { FileService } from './FileService';
import { DatabaseService } from './DatabaseService';
import { EntityAPIService } from './EntityAPIService';
import type { Project, Entity, Section, Diagnostic } from '../lib/schemas';
import { createProject } from '../lib/schemas';
import { xxhash32 } from 'hash-wasm';

/**
 * ProjectService orchestrates FileService and DatabaseService to provide
 * a unified interface for project operations.
 *
 * Key responsibilities:
 * - Project lifecycle (open/create/save/close)
 * - Coordinate file I/O and database sync
 * - Dirty tracking for unsaved changes
 * - File watching for external changes
 */
export class ProjectService {
  private fileService: FileService;
  private dbService: DatabaseService;
  private projectRoot: string;
  private _isDirty: boolean = false;
  private _project: Project | null = null;
  private entityApiService: EntityAPIService | null = null;

  // Track which entities/sections have been modified in memory
  private dirtyEntities = new Set<string>();
  private dirtySections = new Set<string>();
  private dirtyProject = false;

  // Track original content hashes for change detection (like VS Code)
  private originalHashes = new Map<string, string>();

  // Track recently written files to ignore file watcher events
  private recentlyWrittenFiles = new Set<string>();

  // Track active timers for cleanup on close
  private activeTimers = new Set<ReturnType<typeof setTimeout>>();

  private constructor(
    fileService: FileService,
    dbService: DatabaseService,
    projectRoot: string
  ) {
    this.fileService = fileService;
    this.dbService = dbService;
    this.projectRoot = projectRoot;
  }

  /**
   * Open an existing project from a folder
   */
  static async open(projectRoot: string): Promise<ProjectService> {
    // Normalize path separators to forward slashes (works on all platforms with Tauri)
    const normalizedRoot = projectRoot.replace(/\\/g, '/').replace(/\/+$/, '');

    if (!(await FileService.isValidProject(normalizedRoot))) {
      throw new Error(
        `No project.yaml found in "${normalizedRoot}". Select the project folder (the one containing project.yaml).`,
      );
    }
    const fileService = new FileService(normalizedRoot);
    const dbService = await DatabaseService.create(normalizedRoot);

    const service = new ProjectService(fileService, dbService, normalizedRoot);
    await service.load();
    return service;
  }

  /**
   * Create a new project in a folder
   */
  static async create(projectRoot: string, projectName: string): Promise<ProjectService> {
    try {
      // Normalize path separators to forward slashes (works on all platforms with Tauri)
      const normalizedRoot = projectRoot.replace(/\\/g, '/').replace(/\/+$/, '');
      console.log('[ProjectService] Creating project:', { projectRoot: normalizedRoot, projectName });

      // Create folder structure
      console.log('[ProjectService] Creating folder structure...');
      await FileService.createProjectStructure(normalizedRoot);
      console.log('[ProjectService] Folder structure created');

      // Create initial project.yaml
      const project = createProject(projectName);
      const fileService = new FileService(normalizedRoot);

      console.log('[ProjectService] Writing project.yaml...');
      await fileService.writeProjectYaml({
        version: '1.0.0',
        schema_version: '1.0',
        metadata: {
          id: project.id,
          name: project.name,
          created_at: project.meta.createdAt,
          modified_at: project.meta.modifiedAt,
          author: project.meta.author,
          synopsis: project.meta.synopsis
        },
        settings: project.settings
      });
      console.log('[ProjectService] project.yaml written');

      if (!(await FileService.isValidProject(normalizedRoot))) {
        throw new Error(`Project creation failed: project.yaml was not written to "${normalizedRoot}".`);
      }

      // Initialize database
      console.log('[ProjectService] Initializing database...');
      const dbService = await DatabaseService.create(normalizedRoot);
      console.log('[ProjectService] Database initialized');

      // Create service and load
      console.log('[ProjectService] Loading project...');
      const service = new ProjectService(fileService, dbService, normalizedRoot);
      await service.load();
      console.log('[ProjectService] Project loaded successfully');

      return service;
    } catch (error) {
      console.error('[ProjectService] Error during project creation:', error);
      console.error('[ProjectService] Error details:', {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        type: typeof error,
        error
      });
      throw error;
    }
  }

  /**
   * Load project data from files into memory and rebuild database index
   */
  async load(): Promise<Project> {
    // Read all files
    const files = await this.fileService.readAllProject();

    // Rebuild database index (convert file format to DB format)
    await this.dbService.rebuildIndex({
      project: {
        id: files.project.metadata.id,
        name: files.project.metadata.name,
        created_at: files.project.metadata.created_at,
        modified_at: files.project.metadata.modified_at,
        author: files.project.metadata.author,
        synopsis: files.project.metadata.synopsis
      },
      entities: files.entities,
      sections: files.sections
    });

    // Assemble project object
    this._project = {
      id: files.project.metadata.id,
      name: files.project.metadata.name,
      version: files.project.version,
      meta: {
        createdAt: files.project.metadata.created_at,
        modifiedAt: files.project.metadata.modified_at,
        author: files.project.metadata.author,
        synopsis: files.project.metadata.synopsis
      },
      settings: files.project.settings || { default_section_alignment: 'left' },
      entities: files.entities,
      sections: files.sections.sort((a, b) => a.order - b.order)
    };

    // Store original content hashes for change detection
    this.originalHashes.clear();

    // Hash project metadata
    const projectHash = await this.computeProjectHash();
    this.originalHashes.set('project', projectHash);

    // Hash all entities
    for (const entity of this._project.entities) {
      const hash = await this.computeEntityHash(entity);
      this.originalHashes.set(`entity:${entity.id}`, hash);
    }

    // Hash all sections
    for (const section of this._project.sections) {
      const hash = await this.computeContentHash(section);
      this.originalHashes.set(`section:${section.id}`, hash);
    }

    this._isDirty = false;
    return this._project;
  }

  /**
   * Get the current project (must call load() first)
   */
  getProject(): Project {
    if (!this._project) {
      throw new Error('Project not loaded. Call load() first.');
    }
    return this._project;
  }

  /**
   * Save all changes to disk and sync database
   * Errors are collected and reported at the end, successful saves are preserved
   */
  async save(): Promise<void> {
    if (!this._project) {
      throw new Error('Project not loaded.');
    }

    const errors: Array<{ type: string; id: string; error: Error }> = [];

    // Update modified timestamp
    this._project.meta.modifiedAt = new Date().toISOString();

    // Save project.yaml if dirty (only if content actually changed)
    if (this.dirtyProject) {
      try {
        const currentHash = await this.computeProjectHash();
        const originalHash = this.originalHashes.get('project');

        // Only write if content changed from original
        if (currentHash !== originalHash) {
          await this.fileService.writeProjectYaml({
            version: this._project.version,
            schema_version: '1.0',
            metadata: {
              id: this._project.id,
              name: this._project.name,
              created_at: this._project.meta.createdAt,
              modified_at: this._project.meta.modifiedAt,
              author: this._project.meta.author,
              synopsis: this._project.meta.synopsis
            },
            settings: this._project.settings
          });

          // Track project.yaml as recently written
          this.markFileAsWritten('project.yaml');

          // Update original hash
          this.originalHashes.set('project', currentHash);
        }

        // Always update database (cheap operation)
        await this.dbService.upsertProject({
          id: this._project.id,
          name: this._project.name,
          created_at: this._project.meta.createdAt,
          modified_at: this._project.meta.modifiedAt,
          author: this._project.meta.author,
          synopsis: this._project.meta.synopsis
        });

        this.dirtyProject = false;
      } catch (error) {
        errors.push({
          type: 'project',
          id: 'project.yaml',
          error: error instanceof Error ? error : new Error(String(error))
        });
      }
    }

    // Save dirty entities in parallel (only if content actually changed)
    const savedEntities = new Set<string>();
    const entitySavePromises = Array.from(this.dirtyEntities).map(async (entityId) => {
      try {
        const entity = this._project!.entities.find(e => e.id === entityId);
        if (entity) {
          const currentHash = await this.computeEntityHash(entity);
          const originalHash = this.originalHashes.get(`entity:${entityId}`);

          // Only write if content changed from original
          if (currentHash !== originalHash) {
            const filePath = await this.fileService.writeEntity(entity);
            const fileHash = await this.computeFileHash(filePath);
            await this.dbService.upsertEntity(entity, filePath, fileHash);

            // Track entity file as recently written
            this.markFileAsWritten(filePath);

            // Update original hash
            this.originalHashes.set(`entity:${entityId}`, currentHash);
          }
          savedEntities.add(entityId);
        }
      } catch (error) {
        errors.push({
          type: 'entity',
          id: entityId,
          error: error instanceof Error ? error : new Error(String(error))
        });
      }
    });
    await Promise.all(entitySavePromises);
    // Only clear entities that saved successfully
    savedEntities.forEach(id => this.dirtyEntities.delete(id));

    // Save dirty sections in parallel (only if content actually changed)
    const savedSections = new Set<string>();
    const sectionSavePromises = Array.from(this.dirtySections).map(async (sectionId) => {
      try {
        const section = this._project!.sections.find(s => s.id === sectionId);
        if (section) {
          // Compute hash of current content
          const currentHash = await this.computeContentHash(section);
          const originalHash = this.originalHashes.get(`section:${sectionId}`);

          // Only write if content changed from original
          if (currentHash !== originalHash) {
            const filePath = await this.fileService.writeSection(section);
            const fileHash = await this.computeFileHash(filePath);
            await this.dbService.upsertSection(section, filePath, fileHash);

            // Track this file as recently written
            this.markFileAsWritten(filePath);

            // Update original hash
            this.originalHashes.set(`section:${sectionId}`, currentHash);
          }

          // Always sync relationships (they're in DB only)
          await this.dbService.syncSectionEntities(section.id, section.entityIds);
          await this.dbService.syncEntityTags(section.id, section.tags);

          savedSections.add(sectionId);
        }
      } catch (error) {
        errors.push({
          type: 'section',
          id: sectionId,
          error: error instanceof Error ? error : new Error(String(error))
        });
      }
    });
    await Promise.all(sectionSavePromises);
    // Only clear sections that saved successfully
    savedSections.forEach(id => this.dirtySections.delete(id));

    // Report errors if any occurred
    if (errors.length > 0) {
      const errorMessage = errors.map(e =>
        `${e.type} ${e.id}: ${e.error.message}`
      ).join('\n');
      throw new Error(`Save failed for ${errors.length} item(s):\n${errorMessage}`);
    }

    this._isDirty = false;
  }

  // ==================== Entity Operations ====================

  async createEntity(entity: Entity): Promise<void> {
    if (!this._project) throw new Error('Project not loaded.');

    this._project.entities.push(entity);

    // Store original hash for new entity
    const hash = await this.computeEntityHash(entity);
    this.originalHashes.set(`entity:${entity.id}`, hash);

    this.dirtyEntities.add(entity.id);
    this.markDirty();
  }

  async updateEntity(id: string, updates: Partial<Entity>): Promise<void> {
    if (!this._project) throw new Error('Project not loaded.');

    const entity = this._project.entities.find(e => e.id === id);
    if (!entity) throw new Error(`Entity ${id} not found`);

    Object.assign(entity, updates);
    this.dirtyEntities.add(id);
    this.markDirty();
  }

  async deleteEntity(id: string): Promise<void> {
    if (!this._project) throw new Error('Project not loaded.');

    const index = this._project.entities.findIndex(e => e.id === id);
    if (index === -1) throw new Error(`Entity ${id} not found`);

    // Remove from memory
    this._project.entities.splice(index, 1);

    // Delete file
    const entityFiles = await this.fileService.listEntityFiles();
    const entityFile = entityFiles.find(f => f.includes(id.slice(0, 8)));
    if (entityFile) {
      await this.fileService.deleteEntity(entityFile);
    }

    // Delete from database
    await this.dbService.deleteEntity(id);

    this.dirtyEntities.delete(id);
    this.markDirty();
  }

  // ==================== Section Operations ====================

  async createSection(section: Section): Promise<void> {
    if (!this._project) throw new Error('Project not loaded.');

    this._project.sections.push(section);
    this._project.sections.sort((a, b) => a.order - b.order);

    // Store original hash for new section
    const hash = await this.computeContentHash(section);
    this.originalHashes.set(`section:${section.id}`, hash);

    this.dirtySections.add(section.id);
    this.markDirty();
  }

  async updateSection(id: string, updates: Partial<Section>): Promise<void> {
    if (!this._project) throw new Error('Project not loaded.');

    const section = this._project.sections.find(s => s.id === id);
    if (!section) throw new Error(`Section ${id} not found`);

    Object.assign(section, updates);

    // Re-sort if order changed
    if ('order' in updates) {
      this._project.sections.sort((a, b) => a.order - b.order);
    }

    this.dirtySections.add(id);
    this.markDirty();
  }

  async deleteSection(id: string): Promise<void> {
    if (!this._project) throw new Error('Project not loaded.');

    const index = this._project.sections.findIndex(s => s.id === id);
    if (index === -1) throw new Error(`Section ${id} not found`);

    // Remove from memory
    this._project.sections.splice(index, 1);

    // Delete file
    const sectionFiles = await this.fileService.listSectionFiles();
    const sectionFile = sectionFiles.find(f => f.includes(id.slice(0, 8)));
    if (sectionFile) {
      await this.fileService.deleteSection(sectionFile);
    }

    // Delete from database
    await this.dbService.deleteSection(id);

    // Remove hash tracking
    this.originalHashes.delete(`section:${id}`);
    this.dirtySections.delete(id);
    this.markDirty();
  }

  // ==================== Diagnostics (DB-only) ====================

  async updateDiagnostics(sectionId: string, diagnostics: Diagnostic[]): Promise<void> {
    await this.dbService.upsertDiagnostics(sectionId, diagnostics);

    // Update in-memory section
    if (this._project) {
      const section = this._project.sections.find(s => s.id === sectionId);
      if (section) {
        section.diagnostics = diagnostics;
      }
    }
  }

  async getDiagnostics(sectionId: string): Promise<Diagnostic[]> {
    return await this.dbService.getDiagnostics(sectionId);
  }

  // ==================== File Watching ====================

  /**
   * Start watching project files for external changes
   * Returns a function to stop watching
   */
  async startFileWatcher(onChange: (path: string) => void): Promise<() => void> {
    // Import watch from Tauri FS plugin
    const { watch } = await import('@tauri-apps/plugin-fs');

    // Watch project.yaml
    const unwatchProject = await watch(
      `${this.projectRoot}/project.yaml`,
      (event) => {
        // Trigger on any change
        if (event.paths && event.paths.length > 0) {
          onChange(event.paths[0]);
        }
      }
    );

    // Watch entities directory
    const unwatchEntities = await watch(
      `${this.projectRoot}/entities`,
      (event) => {
        // Trigger on any change
        if (event.paths && event.paths.length > 0) {
          onChange(event.paths[0]);
        }
      },
      { recursive: true }
    );

    // Watch sections directory
    const unwatchSections = await watch(
      `${this.projectRoot}/sections`,
      (event) => {
        // Trigger on any change
        if (event.paths && event.paths.length > 0) {
          onChange(event.paths[0]);
        }
      },
      { recursive: true }
    );

    // Return cleanup function
    return () => {
      unwatchProject();
      unwatchEntities();
      unwatchSections();
    };
  }

  // ==================== Dirty Tracking ====================

  markDirty(): void {
    this._isDirty = true;
  }

  isDirty(): boolean {
    return this._isDirty;
  }

  markProjectDirty(): void {
    this.dirtyProject = true;
    this.markDirty();
  }

  // ==================== Utilities ====================

  /**
   * Compute hash of file content for change detection
   */
  private async computeFileHash(relativeFilePath: string): Promise<string> {
    const fullPath = `${this.projectRoot}/${relativeFilePath}`;
    const { readTextFile } = await import('@tauri-apps/plugin-fs');
    const content = await readTextFile(fullPath);
    return await xxhash32(content);
  }

  /**
   * Compute hash of in-memory section content (for detecting real changes)
   */
  private async computeContentHash(section: Section): Promise<string> {
    // Hash the actual content that gets written to the file
    const content = JSON.stringify({
      title: section.title,
      content: section.content,
      order: section.order,
      alignment: section.alignment,
      entityIds: section.entityIds,
      tags: section.tags,
    });
    return await xxhash32(content);
  }

  /**
   * Compute hash of in-memory entity content (for detecting real changes)
   */
  private async computeEntityHash(entity: Entity): Promise<string> {
    // Hash the actual content that gets written to the file
    const content = JSON.stringify({
      id: entity.id,
      name: entity.name,
      type: entity.type,
      description: entity.description,
      aliases: entity.aliases,
      metadata: entity.metadata,
    });
    return await xxhash32(content);
  }

  /**
   * Compute hash of project metadata (for detecting real changes)
   */
  private async computeProjectHash(): Promise<string> {
    if (!this._project) return '';
    const content = JSON.stringify({
      id: this._project.id,
      name: this._project.name,
      version: this._project.version,
      author: this._project.meta.author,
      synopsis: this._project.meta.synopsis,
    });
    return await xxhash32(content);
  }

  /**
   * Mark a file as recently written (to ignore file watcher events).
   * This should be called before or immediately after writing a file,
   * including from external sources like the agent.
   *
   * @param filePath - Can be relative (e.g., "sections/foo.md") or absolute path
   */
  markFileAsWritten(filePath: string): void {
    // Handle both relative and absolute paths
    const fullPath = filePath.startsWith(this.projectRoot)
      ? filePath
      : `${this.projectRoot}/${filePath}`;

    // Normalize to forward slashes before storing
    const normalizedPath = fullPath.replace(/\\/g, '/');
    this.recentlyWrittenFiles.add(normalizedPath);

    // Clear after 5 seconds (Windows file system events can be delayed)
    const timer = setTimeout(() => {
      this.recentlyWrittenFiles.delete(normalizedPath);
      this.activeTimers.delete(timer);
    }, 5000);

    // Track timer for cleanup on close
    this.activeTimers.add(timer);
  }

  /**
   * Check if a file was recently written by us (to ignore file watcher events)
   */
  wasRecentlyWritten(filePath: string): boolean {
    // Normalize the incoming path too
    const normalizedPath = filePath.replace(/\\/g, '/');
    return this.recentlyWrittenFiles.has(normalizedPath);
  }

  /**
   * Get the project root path
   */
  getProjectRoot(): string {
    return this.projectRoot;
  }

  /**
   * Get the database service for direct database operations (e.g., chat messages)
   */
  getDatabaseService(): DatabaseService {
    return this.dbService;
  }

  /**
   * Get the EntityAPIService for this project.
   */
  getEntityAPIService(): EntityAPIService {
    if (!this.entityApiService) {
      this.entityApiService = new EntityAPIService(this.fileService, this.dbService, this.projectRoot);
    }
    return this.entityApiService;
  }

  /**
   * Close the project and cleanup resources
   */
  async close(): Promise<void> {
    // Clear all active timers to prevent memory leaks
    this.activeTimers.forEach(timer => clearTimeout(timer));
    this.activeTimers.clear();
    this.recentlyWrittenFiles.clear();

    await this.dbService.close();
  }
}
