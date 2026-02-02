-- Entity Glossary Extension for VS Write
-- Provides tools to work with entity YAML files

-- Helper: Parse YAML frontmatter from entity file
local function parse_entity_file(content)
    -- Simple YAML frontmatter parser
    -- Looks for --- delimited block at start
    local entity = {}

    local in_frontmatter = false
    local frontmatter_done = false
    local description_lines = {}

    for line in content:gmatch("[^\n]+") do
        if not frontmatter_done then
            if line == "---" then
                if not in_frontmatter then
                    in_frontmatter = true
                else
                    frontmatter_done = true
                end
            elseif in_frontmatter then
                -- Parse key: value pairs
                local key, value = line:match("^(%w+):%s*(.*)$")
                if key and value then
                    -- Remove quotes if present
                    value = value:gsub("^[\"'](.*)[\"\']$", "%1")
                    entity[key] = value
                end
            end
        else
            -- Content after frontmatter is description
            table.insert(description_lines, line)
        end
    end

    entity.description = table.concat(description_lines, "\n"):gsub("^%s*(.-)%s*$", "%1")
    return entity
end

-- Helper: Load all entities from entities/ directory
local function load_all_entities()
    local entities = {}

    -- Get list of entity files
    local files_json = tools.glob("entities/*.yaml")
    local files = json_decode(files_json)

    for _, file_path in ipairs(files) do
        local content = tools.read_file(file_path)
        local entity = parse_entity_file(content)
        entity.file = file_path
        table.insert(entities, entity)
    end

    return entities
end

-- Generate a markdown glossary from all entities
function generate_glossary(args)
    local format = args.format or "markdown"
    local sort_by = args.sort or "alpha"

    local entities = load_all_entities()

    if #entities == 0 then
        return "No entities found in the project."
    end

    -- Sort entities
    if sort_by == "alpha" then
        table.sort(entities, function(a, b)
            return (a.name or "") < (b.name or "")
        end)
    elseif sort_by == "type" then
        table.sort(entities, function(a, b)
            if a.type == b.type then
                return (a.name or "") < (b.name or "")
            end
            return (a.type or "") < (b.type or "")
        end)
    end

    -- Generate output
    local lines = {}

    if format == "markdown" then
        table.insert(lines, "# Entity Glossary")
        table.insert(lines, "")

        local current_type = nil
        for _, entity in ipairs(entities) do
            -- Add type header if sorting by type
            if sort_by == "type" and entity.type ~= current_type then
                current_type = entity.type
                table.insert(lines, "## " .. (current_type or "Unknown"))
                table.insert(lines, "")
            end

            table.insert(lines, "### " .. (entity.name or "Unnamed"))
            if entity.type and sort_by ~= "type" then
                table.insert(lines, "*Type: " .. entity.type .. "*")
            end
            table.insert(lines, "")
            if entity.description and entity.description ~= "" then
                table.insert(lines, entity.description)
            else
                table.insert(lines, "*No description*")
            end
            table.insert(lines, "")
        end
    else
        -- Plain text format
        for _, entity in ipairs(entities) do
            table.insert(lines, (entity.name or "Unnamed") .. " (" .. (entity.type or "unknown") .. ")")
            if entity.description and entity.description ~= "" then
                table.insert(lines, "  " .. entity.description:gsub("\n", "\n  "))
            end
            table.insert(lines, "")
        end
    end

    return table.concat(lines, "\n")
end

-- Count entities by type
function count_entities(args)
    local entities = load_all_entities()
    local counts = {}

    for _, entity in ipairs(entities) do
        local entity_type = entity.type or "unknown"
        counts[entity_type] = (counts[entity_type] or 0) + 1
    end

    local result = {
        total = #entities,
        by_type = counts
    }

    return result
end

-- Find an entity by name (case-insensitive partial match)
function find_entity(args)
    local search_name = (args.name or ""):lower()

    if search_name == "" then
        return { error = "Please provide a name to search for" }
    end

    local entities = load_all_entities()
    local matches = {}

    for _, entity in ipairs(entities) do
        local name = (entity.name or ""):lower()
        if name:find(search_name, 1, true) then
            table.insert(matches, {
                name = entity.name,
                type = entity.type,
                file = entity.file,
                description = entity.description
            })
        end
    end

    if #matches == 0 then
        return { found = false, message = "No entities found matching '" .. args.name .. "'" }
    end

    return { found = true, count = #matches, entities = matches }
end
