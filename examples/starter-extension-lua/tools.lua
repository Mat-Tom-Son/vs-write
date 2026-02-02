-- =============================================================================
-- STARTER EXTENSION - TOOLS
-- =============================================================================
-- This file contains the tool implementations for your extension.
-- Each function listed in manifest.json should be defined here.
--
-- Available APIs:
--   tools.read_file(path)              - Read a file's contents
--   tools.write_file(path, content)    - Write content to a file
--   tools.append_file(path, content)   - Append content to a file
--   tools.delete_file(path)            - Delete a file
--   tools.glob(pattern, directory)     - Find files matching a pattern
--   tools.shell(command)               - Execute a shell command
--
--   tools.entities.get(id)             - Get an entity by ID
--   tools.entities.list_all()          - List all entities
--   tools.entities.list_by_type(type)  - List entities of a type
--   tools.entities.search(query)       - Search entities
--   tools.entities.create(entity)      - Create a new entity
--   tools.entities.update(id, updates) - Update an entity
--   tools.entities.delete(id)          - Delete an entity
--
--   tools.entities.get_section(id)     - Get a section by ID
--   tools.entities.list_sections()     - List all sections
--   tools.entities.get_tags(section)   - Get tags in a section
--   tools.entities.add_tag(...)        - Add a tag
--   tools.entities.remove_tag(...)     - Remove a tag
--   tools.entities.get_relationships(id) - Get entity relationships
--
--   json.encode(table)                 - Convert table to JSON string
--   json.decode(string)                - Parse JSON string to table
-- =============================================================================

--- A sample tool demonstrating basic functionality
-- @param args table with 'message' (required) and 'option' (optional)
-- @return string result
function my_tool(args)
    -- Get required parameter
    local message = args.message
    if not message then
        return "Error: 'message' parameter is required"
    end

    -- Get optional parameter with default
    local option = args.option or "option1"

    -- Process the message based on option
    local result
    if option == "option1" then
        result = "Processed (option1): " .. message
    elseif option == "option2" then
        result = "Processed (option2): " .. string.upper(message)
    elseif option == "option3" then
        result = "Processed (option3): " .. string.reverse(message)
    else
        result = "Unknown option: " .. option
    end

    return result
end

--- Get an overview of the project
-- Demonstrates using the Entity API
-- @param args table (no parameters required)
-- @return string formatted project overview
function list_project_info(args)
    local lines = {}

    -- Header
    table.insert(lines, "# Project Overview")
    table.insert(lines, "")

    -- Get entities
    local entities_json = tools.entities.list_all()
    local entities = json.decode(entities_json)
    local entity_count = entities and #entities or 0

    -- Get sections
    local sections_json = tools.entities.list_sections()
    local sections = json.decode(sections_json)
    local section_count = sections and #sections or 0

    -- Summary
    table.insert(lines, "## Summary")
    table.insert(lines, "")
    table.insert(lines, "- **Entities:** " .. entity_count)
    table.insert(lines, "- **Sections:** " .. section_count)
    table.insert(lines, "")

    -- Entity types breakdown
    if entities and #entities > 0 then
        local by_type = {}
        for _, entity in ipairs(entities) do
            local t = entity.entity_type or "unknown"
            by_type[t] = (by_type[t] or 0) + 1
        end

        table.insert(lines, "## Entity Types")
        table.insert(lines, "")
        for type_name, count in pairs(by_type) do
            table.insert(lines, "- " .. type_name .. ": " .. count)
        end
        table.insert(lines, "")
    end

    -- Section list
    if sections and #sections > 0 then
        table.insert(lines, "## Sections")
        table.insert(lines, "")
        for i, section in ipairs(sections) do
            local title = section.title or section.id
            table.insert(lines, i .. ". " .. title)
        end
        table.insert(lines, "")
    end

    return table.concat(lines, "\n")
end

-- =============================================================================
-- HELPER FUNCTIONS
-- =============================================================================
-- You can define helper functions that aren't exposed as tools

--- Count words in a string
-- @param text string
-- @return number word count
local function count_words(text)
    if not text or text == "" then
        return 0
    end
    local count = 0
    for _ in text:gmatch("%S+") do
        count = count + 1
    end
    return count
end

--- Truncate a string to a maximum length
-- @param text string
-- @param max_length number
-- @return string truncated text
local function truncate(text, max_length)
    if not text then return "" end
    if #text <= max_length then return text end
    return text:sub(1, max_length - 3) .. "..."
end
