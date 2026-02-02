import {
  readTextFile,
  writeTextFile,
  readDir,
  exists,
  mkdir
} from '@tauri-apps/plugin-fs';
import * as yaml from 'js-yaml';
import matter from 'gray-matter';
import type { Entity, Section } from '../lib/schemas';
import {
  ProjectYamlSchema,
  EntityFileSchema,
  SectionFrontmatterSchema,
  type ProjectYamlData,
  type EntityFileData,
  type SectionFileData,
  entityToFileData,
  fileDataToEntity,
  sectionToFileData,
  fileDataToSection
} from '../lib/schemas-file';

/**
 * FileService handles all file I/O operations for the folder-based project structure.
 *
 * Responsibilities:
 * - Read/write project.yaml
 * - Read/write entity YAML files
 * - Read/write section Markdown files with frontmatter
 * - Generate filenames based on conventions
 * - Directory scanning and validation
 */
export class FileService {
  private projectRoot: string;

  private async ensureDir(path: string) {
    const dirExists = await exists(path);
    if (!dirExists) {
      await mkdir(path, { recursive: true });
    }
  }

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
  }

  // ==================== Project Operations ====================

  /**
   * Read and parse project.yaml
   */
  async readProjectYaml(): Promise<ProjectYamlData> {
    const path = `${this.projectRoot}/project.yaml`;
    const content = await readTextFile(path);
    const data = yaml.load(content);
    return ProjectYamlSchema.parse(data);
  }

  /**
   * Write project.yaml
   */
  async writeProjectYaml(data: ProjectYamlData): Promise<void> {
    const path = `${this.projectRoot}/project.yaml`;
    const content = yaml.dump(data, {
      indent: 2,
      lineWidth: 120,
      noRefs: true
    });
    await writeTextFile(path, content);
  }

  // ==================== Entity Operations ====================

  /**
   * Read and parse an entity YAML file
   */
  async readEntity(filePath: string): Promise<EntityFileData> {
    const fullPath = `${this.projectRoot}/${filePath}`;
    const content = await readTextFile(fullPath);
    const data = yaml.load(content);
    return EntityFileSchema.parse(data);
  }

  /**
   * Write an entity to a YAML file
   * Returns the relative file path
   */
  async writeEntity(entity: Entity): Promise<string> {
    const filename = this.generateEntityFilename(entity);
    const filePath = `entities/${filename}`;
    const fullPath = `${this.projectRoot}/${filePath}`;
    await this.ensureDir(`${this.projectRoot}/entities`);

    const fileData = entityToFileData(entity);
    const content = yaml.dump(fileData, {
      indent: 2,
      lineWidth: 120,
      noRefs: true
    });

    await writeTextFile(fullPath, content);
    return filePath;
  }

  /**
   * Delete an entity file
   */
  async deleteEntity(filePath: string): Promise<void> {
    const fullPath = `${this.projectRoot}/${filePath}`;
    const { remove } = await import('@tauri-apps/plugin-fs');
    await remove(fullPath);
  }

  /**
   * List all entity YAML files
   */
  async listEntityFiles(): Promise<string[]> {
    const entitiesDir = `${this.projectRoot}/entities`;
    const dirExists = await exists(entitiesDir);

    if (!dirExists) {
      return [];
    }

    const entries = await readDir(entitiesDir);
    return entries
      .filter(entry => entry.isFile && entry.name.endsWith('.yaml'))
      .map(entry => `entities/${entry.name}`);
  }

  // ==================== Section Operations ====================

  /**
   * Read and parse a section Markdown file with frontmatter
   */
  async readSection(filePath: string): Promise<SectionFileData> {
    const fullPath = `${this.projectRoot}/${filePath}`;
    const content = await readTextFile(fullPath);

    const parsed = matter(content);
    const frontmatter = SectionFrontmatterSchema.parse(parsed.data);

    return {
      frontmatter,
      content: parsed.content
    };
  }

  /**
   * Write a section to a Markdown file with YAML frontmatter
   * Returns the relative file path
   */
  async writeSection(section: Section): Promise<string> {
    const filename = this.generateSectionFilename(section);
    const filePath = `sections/${filename}`;
    const fullPath = `${this.projectRoot}/${filePath}`;
    await this.ensureDir(`${this.projectRoot}/sections`);

    const fileData = sectionToFileData(section);

    // Use gray-matter to serialize frontmatter + content
    const content = matter.stringify(fileData.content, fileData.frontmatter);

    await writeTextFile(fullPath, content);
    return filePath;
  }

  /**
   * Delete a section file
   */
  async deleteSection(filePath: string): Promise<void> {
    const fullPath = `${this.projectRoot}/${filePath}`;
    const { remove } = await import('@tauri-apps/plugin-fs');
    await remove(fullPath);
  }

  /**
   * List all section Markdown files
   */
  async listSectionFiles(): Promise<string[]> {
    const sectionsDir = `${this.projectRoot}/sections`;
    const dirExists = await exists(sectionsDir);

    if (!dirExists) {
      return [];
    }

    const entries = await readDir(sectionsDir);
    return entries
      .filter(entry => entry.isFile && entry.name.endsWith('.md'))
      .map(entry => `sections/${entry.name}`);
  }

  // ==================== Filename Generation ====================

  /**
   * Generate filename for an entity
   * Format: [slug]-[short-id].yaml
   * Example: john-doe-abc12345.yaml
   */
  generateEntityFilename(entity: Entity): string {
    const slug = this.slugify(entity.name);
    const shortId = entity.id.slice(0, 8);
    return `${slug}-${shortId}.yaml`;
  }

  /**
   * Generate filename for a section
   * Format: [order]-[slug]-[short-id].md
   * Example: 001-chapter-1-xyz78910.md
   */
  generateSectionFilename(section: Section): string {
    const orderPadded = String(section.order).padStart(3, '0');
    const slug = this.slugify(section.title).slice(0, 30);
    const shortId = section.id.slice(0, 8);
    return `${orderPadded}-${slug}-${shortId}.md`;
  }

  /**
   * Convert a string to a URL-friendly slug
   */
  private slugify(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^\w\s-]/g, '') // Remove special chars
      .replace(/\s+/g, '-')     // Replace spaces with hyphens
      .replace(/-+/g, '-')      // Remove consecutive hyphens
      .trim();
  }

  // ==================== Bulk Operations ====================

  /**
   * Read all project files and return structured data
   */
  async readAllProject(): Promise<{
    project: ProjectYamlData;
    entities: Entity[];
    sections: Section[];
  }> {
    // Read project metadata
    const project = await this.readProjectYaml();

    // Read all entities
    const entityFiles = await this.listEntityFiles();
    const entities: Entity[] = [];
    for (const filePath of entityFiles) {
      const entityData = await this.readEntity(filePath);
      entities.push(fileDataToEntity(entityData));
    }

    // Read all sections
    const sectionFiles = await this.listSectionFiles();
    const sections: Section[] = [];
    for (const filePath of sectionFiles) {
      const sectionData = await this.readSection(filePath);
      sections.push(fileDataToSection(sectionData));
    }

    return { project, entities, sections };
  }

  // ==================== Project Initialization ====================

  /**
   * Create the folder structure for a new project
   */
  static async createProjectStructure(projectRoot: string): Promise<void> {
    // Create main directories (recursive creates parent dirs too)
    await mkdir(projectRoot, { recursive: true });
    await mkdir(`${projectRoot}/entities`, { recursive: true });
    await mkdir(`${projectRoot}/sections`, { recursive: true });
    await mkdir(`${projectRoot}/.storyide`, { recursive: true });
  }

  /**
   * Check if a folder is a valid VS Write project
   */
  static async isValidProject(projectRoot: string): Promise<boolean> {
    const projectYamlPath = `${projectRoot}/project.yaml`;
    return await exists(projectYamlPath);
  }
}
