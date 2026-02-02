-- =============================================================================
-- STARTER EXTENSION - LIFECYCLE HOOKS
-- =============================================================================
-- This file contains lifecycle hook implementations.
-- Hooks are called by VS Write at specific points in the application lifecycle.
--
-- Available hooks (enable in manifest.json):
--   on_activate       - Extension loaded
--   on_deactivate     - Extension unloaded
--   on_project_open   - Project opened (receives project info)
--   on_project_close  - Project closed
--   on_section_save   - Section saved (receives section)
--   on_entity_change  - Entity created/updated/deleted (receives entity)
--
-- Hook functions receive an 'args' table and must return:
--   { success = true, result = "..." }   - Success
--   { success = false, error = "..." }   - Failure
-- =============================================================================

--- Called when the extension is loaded
-- @param args table (empty)
-- @return table { success, result/error }
function on_activate(args)
    -- Perform initialization here
    -- Example: load configuration, set up state, etc.

    return {
        success = true,
        result = "Extension activated successfully"
    }
end

--- Called when the extension is unloaded
-- @param args table (empty)
-- @return table { success, result/error }
function on_deactivate(args)
    -- Perform cleanup here
    -- Example: save state, release resources, etc.

    return {
        success = true,
        result = "Extension deactivated"
    }
end

--- Called when a project is opened
-- @param args table { project_path, project_name }
-- @return table { success, result/error }
function on_project_open(args)
    local project_path = args.project_path or "unknown"
    local project_name = args.project_name or "unknown"

    -- Example: Initialize project-specific state
    -- You could load project preferences, scan files, etc.

    return {
        success = true,
        result = "Project opened: " .. project_name
    }
end

-- =============================================================================
-- ADDITIONAL HOOKS (uncomment and enable in manifest.json to use)
-- =============================================================================

--[[
--- Called when a project is closed
-- @param args table (empty)
-- @return table { success, result/error }
function on_project_close(args)
    return {
        success = true,
        result = "Project closed"
    }
end

--- Called when a section is saved
-- @param args table { section_id, section_title, content }
-- @return table { success, result/error }
function on_section_save(args)
    local section_id = args.section_id
    local section_title = args.section_title
    -- local content = args.content  -- The full section content

    -- Example: Auto-tag entities, validate content, etc.

    return {
        success = true,
        result = "Section saved: " .. section_title
    }
end

--- Called when an entity is created, updated, or deleted
-- @param args table { entity_id, entity_name, entity_type, action }
-- @return table { success, result/error }
function on_entity_change(args)
    local entity_id = args.entity_id
    local entity_name = args.entity_name
    local action = args.action  -- "create", "update", or "delete"

    -- Example: Update indexes, notify other extensions, etc.

    return {
        success = true,
        result = "Entity " .. action .. ": " .. entity_name
    }
end
]]--
