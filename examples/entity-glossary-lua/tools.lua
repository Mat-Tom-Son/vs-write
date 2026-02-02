-- Entity Glossary Tools
-- Generate glossaries and relationship maps from project entities

--- Generate a formatted glossary of entities
-- @param args table with optional 'entity_type' and 'format' fields
-- @return string formatted glossary
function entity_glossary(args)
    local entity_type = args.entity_type
    local format = args.format or "markdown"

    -- Get entities (filtered by type if specified)
    local entities
    if entity_type then
        local entities_json = tools.entities.list_by_type(entity_type)
        entities = json.decode(entities_json)
    else
        local entities_json = tools.entities.list_all()
        entities = json.decode(entities_json)
    end

    if entities == nil or #entities == 0 then
        if entity_type then
            return "No entities found of type: " .. entity_type
        else
            return "No entities found in the project"
        end
    end

    -- Group entities by type
    local by_type = {}
    for _, entity in ipairs(entities) do
        local t = entity.entity_type or "unknown"
        if not by_type[t] then
            by_type[t] = {}
        end
        table.insert(by_type[t], entity)
    end

    -- Format output based on requested format
    if format == "json" then
        return json.encode(by_type)
    elseif format == "plain" then
        return format_plain(by_type)
    else
        return format_markdown(by_type)
    end
end

--- Format entities as plain text
function format_plain(by_type)
    local lines = {}
    table.insert(lines, "ENTITY GLOSSARY")
    table.insert(lines, string.rep("=", 40))
    table.insert(lines, "")

    for type_name, entities in pairs(by_type) do
        table.insert(lines, string.upper(type_name) .. "S")
        table.insert(lines, string.rep("-", 20))

        for _, entity in ipairs(entities) do
            table.insert(lines, "  " .. entity.name)
            if entity.description then
                table.insert(lines, "    " .. entity.description)
            end
        end
        table.insert(lines, "")
    end

    return table.concat(lines, "\n")
end

--- Format entities as markdown
function format_markdown(by_type)
    local lines = {}
    table.insert(lines, "# Entity Glossary")
    table.insert(lines, "")

    for type_name, entities in pairs(by_type) do
        -- Capitalize type name
        local title = type_name:sub(1, 1):upper() .. type_name:sub(2) .. "s"
        table.insert(lines, "## " .. title)
        table.insert(lines, "")

        for _, entity in ipairs(entities) do
            table.insert(lines, "### " .. entity.name)
            if entity.description then
                table.insert(lines, "")
                table.insert(lines, entity.description)
            end
            if entity.aliases and #entity.aliases > 0 then
                table.insert(lines, "")
                table.insert(lines, "**Aliases:** " .. table.concat(entity.aliases, ", "))
            end
            table.insert(lines, "")
        end
    end

    return table.concat(lines, "\n")
end

--- Show relationships between entities and sections
-- @param args table with optional 'entity_id' and 'include_sections' fields
-- @return string formatted relationship information
function entity_relationships(args)
    local entity_id = args.entity_id
    local include_sections = args.include_sections
    if include_sections == nil then
        include_sections = true
    end

    local lines = {}

    if entity_id then
        -- Get relationships for a specific entity
        local rel_json = tools.entities.get_relationships(entity_id)
        local rel = json.decode(rel_json)

        if rel == nil or rel.entity == nil then
            return "Entity not found: " .. entity_id
        end

        table.insert(lines, "# Relationships for: " .. rel.entity.name)
        table.insert(lines, "")
        table.insert(lines, "**Type:** " .. (rel.entity.entity_type or "unknown"))

        if rel.entity.description then
            table.insert(lines, "")
            table.insert(lines, rel.entity.description)
        end

        if include_sections and rel.sections and #rel.sections > 0 then
            table.insert(lines, "")
            table.insert(lines, "## Appears In")
            table.insert(lines, "")
            for _, section in ipairs(rel.sections) do
                table.insert(lines, "- " .. section.title .. " (`" .. section.id .. "`)")
            end
        end
    else
        -- Get all entities and their relationships
        local entities_json = tools.entities.list_all()
        local entities = json.decode(entities_json)

        if entities == nil or #entities == 0 then
            return "No entities found in the project"
        end

        table.insert(lines, "# Entity Relationships")
        table.insert(lines, "")

        for _, entity in ipairs(entities) do
            local rel_json = tools.entities.get_relationships(entity.id)
            local rel = json.decode(rel_json)

            table.insert(lines, "## " .. entity.name)
            table.insert(lines, "**Type:** " .. (entity.entity_type or "unknown"))

            if include_sections and rel and rel.sections and #rel.sections > 0 then
                table.insert(lines, "")
                table.insert(lines, "**Sections:** " .. #rel.sections)
                for _, section in ipairs(rel.sections) do
                    table.insert(lines, "- " .. section.title)
                end
            end
            table.insert(lines, "")
        end
    end

    return table.concat(lines, "\n")
end
