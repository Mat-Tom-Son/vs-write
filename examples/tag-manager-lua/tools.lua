-- Tag Manager Tools
-- Manage entity tags in sections

--- Add an entity tag to a section
-- @param args table with section_id, entity_id, from_pos, to_pos
-- @return string success message or error
function add_entity_tag(args)
    local section_id = args.section_id
    local entity_id = args.entity_id
    local from_pos = args.from_pos
    local to_pos = args.to_pos

    -- Validate required parameters
    if not section_id then
        return "Error: section_id is required"
    end
    if not entity_id then
        return "Error: entity_id is required"
    end
    if not from_pos or not to_pos then
        return "Error: from_pos and to_pos are required"
    end

    -- Verify the entity exists
    local entity_json = tools.entities.get(entity_id)
    local entity = json.decode(entity_json)
    if entity == nil then
        return "Error: Entity not found: " .. entity_id
    end

    -- Verify the section exists
    local section_json = tools.entities.get_section(section_id)
    local section = json.decode(section_json)
    if section == nil then
        return "Error: Section not found: " .. section_id
    end

    -- Add the tag
    local result_json = tools.entities.add_tag(section_id, entity_id, from_pos, to_pos)
    local result = json.decode(result_json)

    if result and result.id then
        return "Successfully added tag for '" .. entity.name .. "' in section '" .. section.title .. "' (tag ID: " .. result.id .. ")"
    else
        return "Error: Failed to add tag"
    end
end

--- Remove an entity tag from a section
-- @param args table with section_id, tag_id
-- @return string success message or error
function remove_entity_tag(args)
    local section_id = args.section_id
    local tag_id = args.tag_id

    -- Validate required parameters
    if not section_id then
        return "Error: section_id is required"
    end
    if not tag_id then
        return "Error: tag_id is required"
    end

    -- Remove the tag
    local result_json = tools.entities.remove_tag(section_id, tag_id)
    local result = json.decode(result_json)

    if result == true then
        return "Successfully removed tag " .. tag_id .. " from section " .. section_id
    else
        return "Error: Failed to remove tag. Tag may not exist."
    end
end

--- Get an overview of tags
-- @param args table with optional section_id and group_by
-- @return string formatted tag overview
function tag_overview(args)
    local section_id = args.section_id
    local group_by = args.group_by or "section"

    local lines = {}
    table.insert(lines, "# Tag Overview")
    table.insert(lines, "")

    if section_id then
        -- Get tags for a specific section
        local tags_json = tools.entities.get_tags(section_id)
        local tags = json.decode(tags_json)

        local section_json = tools.entities.get_section(section_id)
        local section = json.decode(section_json)

        if section == nil then
            return "Error: Section not found: " .. section_id
        end

        table.insert(lines, "## Section: " .. section.title)
        table.insert(lines, "")

        if tags == nil or #tags == 0 then
            table.insert(lines, "No tags in this section.")
        else
            table.insert(lines, "| Entity | Position | Tag ID |")
            table.insert(lines, "|--------|----------|--------|")
            for _, tag in ipairs(tags) do
                local entity_json = tools.entities.get(tag.entity_id)
                local entity = json.decode(entity_json)
                local entity_name = entity and entity.name or tag.entity_id
                local pos = tag.from_pos .. "-" .. tag.to_pos
                table.insert(lines, "| " .. entity_name .. " | " .. pos .. " | " .. tag.id .. " |")
            end
        end
    else
        -- Get tags from all sections
        local sections_json = tools.entities.list_sections()
        local sections = json.decode(sections_json)

        if sections == nil or #sections == 0 then
            return "No sections found in the project"
        end

        if group_by == "entity" then
            -- Group by entity
            local by_entity = {}
            for _, section in ipairs(sections) do
                local tags_json = tools.entities.get_tags(section.id)
                local tags = json.decode(tags_json)
                if tags then
                    for _, tag in ipairs(tags) do
                        if not by_entity[tag.entity_id] then
                            by_entity[tag.entity_id] = {}
                        end
                        table.insert(by_entity[tag.entity_id], {
                            section = section,
                            tag = tag
                        })
                    end
                end
            end

            for entity_id, occurrences in pairs(by_entity) do
                local entity_json = tools.entities.get(entity_id)
                local entity = json.decode(entity_json)
                local entity_name = entity and entity.name or entity_id

                table.insert(lines, "## " .. entity_name)
                table.insert(lines, "")
                table.insert(lines, "**Appearances:** " .. #occurrences)
                table.insert(lines, "")

                for _, occ in ipairs(occurrences) do
                    table.insert(lines, "- " .. occ.section.title .. " (pos " .. occ.tag.from_pos .. "-" .. occ.tag.to_pos .. ")")
                end
                table.insert(lines, "")
            end

            if next(by_entity) == nil then
                table.insert(lines, "No tags found in the project.")
            end
        else
            -- Group by section (default)
            local total_tags = 0
            for _, section in ipairs(sections) do
                local tags_json = tools.entities.get_tags(section.id)
                local tags = json.decode(tags_json)

                if tags and #tags > 0 then
                    table.insert(lines, "## " .. section.title)
                    table.insert(lines, "")
                    for _, tag in ipairs(tags) do
                        local entity_json = tools.entities.get(tag.entity_id)
                        local entity = json.decode(entity_json)
                        local entity_name = entity and entity.name or tag.entity_id
                        table.insert(lines, "- " .. entity_name .. " (pos " .. tag.from_pos .. "-" .. tag.to_pos .. ")")
                        total_tags = total_tags + 1
                    end
                    table.insert(lines, "")
                end
            end

            if total_tags == 0 then
                table.insert(lines, "No tags found in the project.")
            else
                table.insert(lines, "---")
                table.insert(lines, "**Total tags:** " .. total_tags)
            end
        end
    end

    return table.concat(lines, "\n")
end
