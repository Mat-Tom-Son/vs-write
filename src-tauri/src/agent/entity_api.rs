//! Entity API for Lua extensions.
//!
//! This module provides read/write access to entities and sections for Lua extensions.
//! It reads from and writes to the same YAML/Markdown formats used by the frontend.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

// ============================================================================
// Entity Types (matching frontend schemas)
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum EntityType {
    Fact,
    Rule,
    Concept,
    Relationship,
    Event,
    Custom,
}

impl Default for EntityType {
    fn default() -> Self {
        EntityType::Custom
    }
}

/// Entity as stored in YAML files (entities/*.yaml)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EntityFile {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub entity_type: EntityType,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub aliases: Vec<String>,
    #[serde(default)]
    pub created_at: Option<String>,
    #[serde(default)]
    pub modified_at: Option<String>,
    #[serde(default)]
    pub metadata: Option<HashMap<String, serde_json::Value>>,
}

/// Entity for Lua API (camelCase for JSON)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Entity {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub entity_type: String,
    pub description: String,
    pub aliases: Vec<String>,
    #[serde(default)]
    pub metadata: HashMap<String, serde_json::Value>,
}

impl From<EntityFile> for Entity {
    fn from(ef: EntityFile) -> Self {
        Entity {
            id: ef.id,
            name: ef.name,
            entity_type: format!("{:?}", ef.entity_type).to_lowercase(),
            description: ef.description,
            aliases: ef.aliases,
            metadata: ef.metadata.unwrap_or_default(),
        }
    }
}

impl From<Entity> for EntityFile {
    fn from(e: Entity) -> Self {
        let entity_type = match e.entity_type.as_str() {
            "fact" => EntityType::Fact,
            "rule" => EntityType::Rule,
            "concept" => EntityType::Concept,
            "relationship" => EntityType::Relationship,
            "event" => EntityType::Event,
            _ => EntityType::Custom,
        };
        let now = chrono_now();
        EntityFile {
            id: e.id,
            name: e.name,
            entity_type,
            description: e.description,
            aliases: e.aliases,
            created_at: Some(now.clone()),
            modified_at: Some(now),
            metadata: if e.metadata.is_empty() {
                None
            } else {
                Some(e.metadata)
            },
        }
    }
}

// ============================================================================
// Tag Types
// ============================================================================

/// Tag as stored in section frontmatter
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TagFile {
    pub id: String,
    pub entity_id: String,
    pub from: i64,
    pub to: i64,
}

/// Tag for Lua API
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Tag {
    pub id: String,
    pub entity_id: String,
    pub from: i64,
    pub to: i64,
}

impl From<TagFile> for Tag {
    fn from(tf: TagFile) -> Self {
        Tag {
            id: tf.id,
            entity_id: tf.entity_id,
            from: tf.from,
            to: tf.to,
        }
    }
}

impl From<Tag> for TagFile {
    fn from(t: Tag) -> Self {
        TagFile {
            id: t.id,
            entity_id: t.entity_id,
            from: t.from,
            to: t.to,
        }
    }
}

// ============================================================================
// Section Types
// ============================================================================

/// Section frontmatter as stored in markdown files
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SectionFrontmatter {
    pub id: String,
    pub title: String,
    pub order: i64,
    #[serde(default)]
    pub alignment: Option<String>,
    #[serde(default)]
    pub parent_id: Option<String>,
    #[serde(default)]
    pub collapsed: Option<bool>,
    #[serde(default)]
    pub entity_ids: Vec<String>,
    #[serde(default)]
    pub tags: Vec<TagFile>,
    #[serde(default)]
    pub created_at: Option<String>,
    #[serde(default)]
    pub modified_at: Option<String>,
}

/// Section for Lua API
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Section {
    pub id: String,
    pub title: String,
    pub order: i64,
    pub content: String,
    pub alignment: String,
    pub parent_id: Option<String>,
    pub collapsed: bool,
    pub entity_ids: Vec<String>,
    pub tags: Vec<Tag>,
}

// ============================================================================
// Entity Relationships
// ============================================================================

/// Relationships for an entity
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EntityRelationships {
    pub entity: Option<Entity>,
    pub sections: Vec<Section>,
}

// ============================================================================
// EntityStore Implementation
// ============================================================================

/// Store for reading/writing entities and sections within a workspace
pub struct EntityStore {
    workspace: PathBuf,
}

impl EntityStore {
    /// Create a new EntityStore for the given workspace
    pub fn new(workspace: &Path) -> Self {
        EntityStore {
            workspace: workspace.to_path_buf(),
        }
    }

    // ========================================================================
    // Entity Operations
    // ========================================================================

    /// Get an entity by ID
    pub fn get_entity(&self, entity_id: &str) -> Result<Option<Entity>, String> {
        let entities_dir = self.workspace.join("entities");
        if !entities_dir.exists() {
            return Ok(None);
        }

        // Search through all entity files
        for entry in fs::read_dir(&entities_dir)
            .map_err(|e| format!("Failed to read entities directory: {}", e))?
        {
            let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
            let path = entry.path();

            if path.extension().map(|e| e == "yaml" || e == "yml").unwrap_or(false) {
                if let Ok(entity) = self.read_entity_file(&path) {
                    if entity.id == entity_id {
                        return Ok(Some(entity.into()));
                    }
                }
            }
        }

        Ok(None)
    }

    /// List entities by type
    pub fn list_by_type(&self, entity_type: &str) -> Result<Vec<Entity>, String> {
        let entities_dir = self.workspace.join("entities");
        if !entities_dir.exists() {
            return Ok(Vec::new());
        }

        let mut results = Vec::new();

        for entry in fs::read_dir(&entities_dir)
            .map_err(|e| format!("Failed to read entities directory: {}", e))?
        {
            let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
            let path = entry.path();

            if path.extension().map(|e| e == "yaml" || e == "yml").unwrap_or(false) {
                if let Ok(entity) = self.read_entity_file(&path) {
                    let type_str = format!("{:?}", entity.entity_type).to_lowercase();
                    if type_str == entity_type.to_lowercase() {
                        results.push(entity.into());
                    }
                }
            }
        }

        Ok(results)
    }

    /// List all entities
    pub fn list_all(&self) -> Result<Vec<Entity>, String> {
        let entities_dir = self.workspace.join("entities");
        if !entities_dir.exists() {
            return Ok(Vec::new());
        }

        let mut results = Vec::new();

        for entry in fs::read_dir(&entities_dir)
            .map_err(|e| format!("Failed to read entities directory: {}", e))?
        {
            let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
            let path = entry.path();

            if path.extension().map(|e| e == "yaml" || e == "yml").unwrap_or(false) {
                if let Ok(entity) = self.read_entity_file(&path) {
                    results.push(entity.into());
                }
            }
        }

        Ok(results)
    }

    /// Search entities by name or description
    pub fn search(&self, query: &str) -> Result<Vec<Entity>, String> {
        let all = self.list_all()?;
        let query_lower = query.to_lowercase();

        let results: Vec<Entity> = all
            .into_iter()
            .filter(|e| {
                e.name.to_lowercase().contains(&query_lower)
                    || e.description.to_lowercase().contains(&query_lower)
                    || e.aliases.iter().any(|a| a.to_lowercase().contains(&query_lower))
            })
            .collect();

        Ok(results)
    }

    /// Create a new entity
    #[allow(dead_code)]
    pub fn create_entity(&self, entity: Entity) -> Result<Entity, String> {
        let entities_dir = self.workspace.join("entities");
        if !entities_dir.exists() {
            fs::create_dir_all(&entities_dir)
                .map_err(|e| format!("Failed to create entities directory: {}", e))?;
        }

        // Generate filename from name (sanitized)
        let filename = sanitize_filename(&entity.name);
        let path = entities_dir.join(format!("{}.yaml", filename));

        // Check if entity with this ID already exists
        if self.get_entity(&entity.id)?.is_some() {
            return Err(format!("Entity with ID {} already exists", entity.id));
        }

        let entity_file: EntityFile = entity.clone().into();
        let yaml = serde_yaml::to_string(&entity_file)
            .map_err(|e| format!("Failed to serialize entity: {}", e))?;

        fs::write(&path, yaml).map_err(|e| format!("Failed to write entity file: {}", e))?;

        Ok(entity)
    }

    /// Update an existing entity
    #[allow(dead_code)]
    pub fn update_entity(&self, entity_id: &str, updates: serde_json::Value) -> Result<Entity, String> {
        let existing = self
            .get_entity(entity_id)?
            .ok_or_else(|| format!("Entity {} not found", entity_id))?;

        // Find the file path
        let file_path = self.find_entity_file(entity_id)?;

        // Merge updates
        let mut entity_json = serde_json::to_value(&existing)
            .map_err(|e| format!("Failed to serialize entity: {}", e))?;

        if let (Some(obj), Some(updates_obj)) = (entity_json.as_object_mut(), updates.as_object()) {
            for (key, value) in updates_obj {
                obj.insert(key.clone(), value.clone());
            }
        }

        let updated: Entity = serde_json::from_value(entity_json)
            .map_err(|e| format!("Failed to deserialize updated entity: {}", e))?;

        let entity_file: EntityFile = updated.clone().into();
        let yaml = serde_yaml::to_string(&entity_file)
            .map_err(|e| format!("Failed to serialize entity: {}", e))?;

        fs::write(&file_path, yaml).map_err(|e| format!("Failed to write entity file: {}", e))?;

        Ok(updated)
    }

    /// Delete an entity
    #[allow(dead_code)]
    pub fn delete_entity(&self, entity_id: &str) -> Result<bool, String> {
        match self.find_entity_file(entity_id) {
            Ok(path) => {
                fs::remove_file(&path).map_err(|e| format!("Failed to delete entity file: {}", e))?;
                Ok(true)
            }
            Err(_) => Ok(false),
        }
    }

    // ========================================================================
    // Tag Operations
    // ========================================================================

    /// Add a tag to a section
    pub fn add_tag(
        &self,
        section_id: &str,
        entity_id: &str,
        from: i64,
        to: i64,
    ) -> Result<Tag, String> {
        let (path, mut frontmatter, content) = self.read_section(section_id)?;

        let tag = Tag {
            id: uuid::Uuid::new_v4().to_string(),
            entity_id: entity_id.to_string(),
            from,
            to,
        };

        frontmatter.tags.push(tag.clone().into());
        frontmatter.modified_at = Some(chrono_now());

        self.write_section(&path, &frontmatter, &content)?;

        Ok(tag)
    }

    /// Remove a tag from a section
    pub fn remove_tag(&self, section_id: &str, tag_id: &str) -> Result<bool, String> {
        let (path, mut frontmatter, content) = self.read_section(section_id)?;

        let original_len = frontmatter.tags.len();
        frontmatter.tags.retain(|t| t.id != tag_id);

        if frontmatter.tags.len() == original_len {
            return Ok(false);
        }

        frontmatter.modified_at = Some(chrono_now());
        self.write_section(&path, &frontmatter, &content)?;

        Ok(true)
    }

    /// Get all tags for a section
    pub fn get_tags(&self, section_id: &str) -> Result<Vec<Tag>, String> {
        let (_, frontmatter, _) = self.read_section(section_id)?;
        Ok(frontmatter.tags.into_iter().map(|t| t.into()).collect())
    }

    // ========================================================================
    // Relationship Operations
    // ========================================================================

    /// Get entity with all sections that reference it
    pub fn get_relationships(&self, entity_id: &str) -> Result<EntityRelationships, String> {
        let entity = self.get_entity(entity_id)?;

        let sections = self.list_all_sections()?;
        let related_sections: Vec<Section> = sections
            .into_iter()
            .filter(|s| {
                s.entity_ids.contains(&entity_id.to_string())
                    || s.tags.iter().any(|t| t.entity_id == entity_id)
            })
            .collect();

        Ok(EntityRelationships {
            entity,
            sections: related_sections,
        })
    }

    // ========================================================================
    // Section Operations
    // ========================================================================

    /// Get a section by ID
    pub fn get_section(&self, section_id: &str) -> Result<Option<Section>, String> {
        let sections_dir = self.workspace.join("sections");
        if !sections_dir.exists() {
            return Ok(None);
        }

        for entry in fs::read_dir(&sections_dir)
            .map_err(|e| format!("Failed to read sections directory: {}", e))?
        {
            let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
            let path = entry.path();

            if path.extension().map(|e| e == "md").unwrap_or(false) {
                if let Ok((frontmatter, content)) = self.parse_section_file(&path) {
                    if frontmatter.id == section_id {
                        return Ok(Some(self.frontmatter_to_section(frontmatter, content)));
                    }
                }
            }
        }

        Ok(None)
    }

    /// List all sections
    pub fn list_all_sections(&self) -> Result<Vec<Section>, String> {
        let sections_dir = self.workspace.join("sections");
        if !sections_dir.exists() {
            return Ok(Vec::new());
        }

        let mut results = Vec::new();

        for entry in fs::read_dir(&sections_dir)
            .map_err(|e| format!("Failed to read sections directory: {}", e))?
        {
            let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
            let path = entry.path();

            if path.extension().map(|e| e == "md").unwrap_or(false) {
                if let Ok((frontmatter, content)) = self.parse_section_file(&path) {
                    results.push(self.frontmatter_to_section(frontmatter, content));
                }
            }
        }

        // Sort by order
        results.sort_by_key(|s| s.order);

        Ok(results)
    }

    // ========================================================================
    // Private Helpers
    // ========================================================================

    fn read_entity_file(&self, path: &Path) -> Result<EntityFile, String> {
        let content =
            fs::read_to_string(path).map_err(|e| format!("Failed to read entity file: {}", e))?;
        serde_yaml::from_str(&content).map_err(|e| format!("Failed to parse entity YAML: {}", e))
    }

    #[allow(dead_code)]
    fn find_entity_file(&self, entity_id: &str) -> Result<PathBuf, String> {
        let entities_dir = self.workspace.join("entities");
        if !entities_dir.exists() {
            return Err(format!("Entity {} not found", entity_id));
        }

        for entry in fs::read_dir(&entities_dir)
            .map_err(|e| format!("Failed to read entities directory: {}", e))?
        {
            let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
            let path = entry.path();

            if path.extension().map(|e| e == "yaml" || e == "yml").unwrap_or(false) {
                if let Ok(entity) = self.read_entity_file(&path) {
                    if entity.id == entity_id {
                        return Ok(path);
                    }
                }
            }
        }

        Err(format!("Entity {} not found", entity_id))
    }

    fn read_section(&self, section_id: &str) -> Result<(PathBuf, SectionFrontmatter, String), String> {
        let sections_dir = self.workspace.join("sections");
        if !sections_dir.exists() {
            return Err(format!("Section {} not found", section_id));
        }

        for entry in fs::read_dir(&sections_dir)
            .map_err(|e| format!("Failed to read sections directory: {}", e))?
        {
            let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
            let path = entry.path();

            if path.extension().map(|e| e == "md").unwrap_or(false) {
                if let Ok((frontmatter, content)) = self.parse_section_file(&path) {
                    if frontmatter.id == section_id {
                        return Ok((path, frontmatter, content));
                    }
                }
            }
        }

        Err(format!("Section {} not found", section_id))
    }

    fn parse_section_file(&self, path: &Path) -> Result<(SectionFrontmatter, String), String> {
        let content =
            fs::read_to_string(path).map_err(|e| format!("Failed to read section file: {}", e))?;

        // Parse YAML frontmatter (between --- markers)
        if !content.starts_with("---") {
            return Err("Section file missing frontmatter".to_string());
        }

        let parts: Vec<&str> = content.splitn(3, "---").collect();
        if parts.len() < 3 {
            return Err("Invalid frontmatter format".to_string());
        }

        let yaml_str = parts[1].trim();
        let markdown_content = parts[2].trim().to_string();

        let frontmatter: SectionFrontmatter = serde_yaml::from_str(yaml_str)
            .map_err(|e| format!("Failed to parse section frontmatter: {}", e))?;

        Ok((frontmatter, markdown_content))
    }

    fn write_section(
        &self,
        path: &Path,
        frontmatter: &SectionFrontmatter,
        content: &str,
    ) -> Result<(), String> {
        let yaml = serde_yaml::to_string(frontmatter)
            .map_err(|e| format!("Failed to serialize frontmatter: {}", e))?;

        let file_content = format!("---\n{}---\n{}", yaml, content);
        fs::write(path, file_content).map_err(|e| format!("Failed to write section file: {}", e))
    }

    fn frontmatter_to_section(&self, fm: SectionFrontmatter, content: String) -> Section {
        Section {
            id: fm.id,
            title: fm.title,
            order: fm.order,
            content,
            alignment: fm.alignment.unwrap_or_else(|| "left".to_string()),
            parent_id: fm.parent_id,
            collapsed: fm.collapsed.unwrap_or(false),
            entity_ids: fm.entity_ids,
            tags: fm.tags.into_iter().map(|t| t.into()).collect(),
        }
    }
}

// ============================================================================
// Utilities
// ============================================================================

fn sanitize_filename(name: &str) -> String {
    name.chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' || c == '_' {
                c
            } else if c.is_whitespace() {
                '-'
            } else {
                '_'
            }
        })
        .collect::<String>()
        .to_lowercase()
}

fn chrono_now() -> String {
    // Generate ISO 8601 timestamp
    let now = std::time::SystemTime::now();
    let since_epoch = now
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();

    // Convert to seconds and format as ISO 8601
    let secs = since_epoch.as_secs();
    let millis = since_epoch.subsec_millis();

    // Calculate date/time components (simplified, UTC only)
    let days_since_epoch = secs / 86400;
    let time_of_day = secs % 86400;
    let hours = time_of_day / 3600;
    let minutes = (time_of_day % 3600) / 60;
    let seconds = time_of_day % 60;

    // Calculate year, month, day from days since epoch (1970-01-01)
    let mut days = days_since_epoch as i64;
    let mut year = 1970i32;

    loop {
        let days_in_year = if is_leap_year(year) { 366 } else { 365 };
        if days < days_in_year {
            break;
        }
        days -= days_in_year;
        year += 1;
    }

    let mut month = 1u32;
    let days_in_months = if is_leap_year(year) {
        [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    } else {
        [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    };

    for days_in_month in days_in_months {
        if days < days_in_month as i64 {
            break;
        }
        days -= days_in_month as i64;
        month += 1;
    }

    let day = days + 1;

    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z",
        year, month, day, hours, minutes, seconds, millis
    )
}

fn is_leap_year(year: i32) -> bool {
    (year % 4 == 0 && year % 100 != 0) || (year % 400 == 0)
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    fn setup_test_workspace() -> TempDir {
        let dir = TempDir::new().unwrap();

        // Create entities directory
        fs::create_dir(dir.path().join("entities")).unwrap();

        // Create a test entity
        let entity_yaml = r#"
id: "550e8400-e29b-41d4-a716-446655440000"
name: "Magic requires sacrifice"
type: fact
description: "Established in chapter 1"
aliases:
  - "sacrifice rule"
"#;
        fs::write(
            dir.path().join("entities").join("alice.yaml"),
            entity_yaml,
        )
        .unwrap();

        // Create sections directory
        fs::create_dir(dir.path().join("sections")).unwrap();

        // Create a test section
        let section_md = r#"---
id: "660e8400-e29b-41d4-a716-446655440001"
title: "Chapter 1"
order: 1
entity_ids:
  - "550e8400-e29b-41d4-a716-446655440000"
tags:
  - id: "770e8400-e29b-41d4-a716-446655440002"
    entity_id: "550e8400-e29b-41d4-a716-446655440000"
    from: 0
    to: 5
---
The wizard explained that magic requires sacrifice."#;
        fs::write(
            dir.path().join("sections").join("001-chapter-1.md"),
            section_md,
        )
        .unwrap();

        dir
    }

    #[test]
    fn test_get_entity() {
        let dir = setup_test_workspace();
        let store = EntityStore::new(dir.path());

        let entity = store
            .get_entity("550e8400-e29b-41d4-a716-446655440000")
            .unwrap();
        assert!(entity.is_some());

        let entity = entity.unwrap();
        assert_eq!(entity.name, "Magic requires sacrifice");
        assert_eq!(entity.entity_type, "fact");
    }

    #[test]
    fn test_list_by_type() {
        let dir = setup_test_workspace();
        let store = EntityStore::new(dir.path());

        let facts = store.list_by_type("fact").unwrap();
        assert_eq!(facts.len(), 1);
        assert_eq!(facts[0].name, "Magic requires sacrifice");

        let events = store.list_by_type("event").unwrap();
        assert_eq!(events.len(), 0);
    }

    #[test]
    fn test_search_entities() {
        let dir = setup_test_workspace();
        let store = EntityStore::new(dir.path());

        let results = store.search("magic").unwrap();
        assert_eq!(results.len(), 1);

        let results = store.search("chapter 1").unwrap();
        assert_eq!(results.len(), 1);

        let results = store.search("nonexistent").unwrap();
        assert_eq!(results.len(), 0);
    }

    #[test]
    fn test_get_section() {
        let dir = setup_test_workspace();
        let store = EntityStore::new(dir.path());

        let section = store
            .get_section("660e8400-e29b-41d4-a716-446655440001")
            .unwrap();
        assert!(section.is_some());

        let section = section.unwrap();
        assert_eq!(section.title, "Chapter 1");
        assert!(section.content.contains("sacrifice"));
    }

    #[test]
    fn test_get_tags() {
        let dir = setup_test_workspace();
        let store = EntityStore::new(dir.path());

        let tags = store
            .get_tags("660e8400-e29b-41d4-a716-446655440001")
            .unwrap();
        assert_eq!(tags.len(), 1);
        assert_eq!(tags[0].entity_id, "550e8400-e29b-41d4-a716-446655440000");
    }

    #[test]
    fn test_get_relationships() {
        let dir = setup_test_workspace();
        let store = EntityStore::new(dir.path());

        let rels = store
            .get_relationships("550e8400-e29b-41d4-a716-446655440000")
            .unwrap();
        assert!(rels.entity.is_some());
        assert_eq!(rels.sections.len(), 1);
    }

    #[test]
    fn test_create_entity() {
        let dir = setup_test_workspace();
        let store = EntityStore::new(dir.path());

        let entity = Entity {
            id: uuid::Uuid::new_v4().to_string(),
            name: "Fire burns".to_string(),
            entity_type: "fact".to_string(),
            description: "A basic physical rule".to_string(),
            aliases: vec!["combustion".to_string()],
            metadata: HashMap::new(),
        };

        let created = store.create_entity(entity.clone()).unwrap();
        assert_eq!(created.name, "Fire burns");

        // Verify it was saved
        let loaded = store.get_entity(&created.id).unwrap();
        assert!(loaded.is_some());
        assert_eq!(loaded.unwrap().name, "Fire burns");
    }
}
