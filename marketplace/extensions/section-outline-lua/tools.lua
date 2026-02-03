-- Section Outline Tools
-- Generate outlines and summaries of project sections

--- Count words in a string
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

--- Generate a structured outline of the project sections
-- @param args table with optional include_word_count, include_entities, format
-- @return string formatted outline
function section_outline(args)
    local include_word_count = args.include_word_count
    if include_word_count == nil then
        include_word_count = true
    end
    local include_entities = args.include_entities
    if include_entities == nil then
        include_entities = true
    end
    local format = args.format or "markdown"

    -- Get all sections
    local sections_json = tools.entities.list_sections()
    local sections = json.decode(sections_json)

    if sections == nil or #sections == 0 then
        return "No sections found in the project"
    end

    -- Sort sections by order if available
    table.sort(sections, function(a, b)
        local order_a = a.order or 0
        local order_b = b.order or 0
        return order_a < order_b
    end)

    -- Gather data for each section
    local section_data = {}
    local total_words = 0

    for _, section in ipairs(sections) do
        local data = {
            id = section.id,
            title = section.title or section.id,
            synopsis = section.synopsis,
            word_count = 0,
            entities = {}
        }

        -- Get word count from content
        if section.content then
            data.word_count = count_words(section.content)
            total_words = total_words + data.word_count
        end

        -- Get entities mentioned in this section
        if include_entities then
            local tags_json = tools.entities.get_tags(section.id)
            local tags = json.decode(tags_json)
            if tags then
                local seen = {}
                for _, tag in ipairs(tags) do
                    if not seen[tag.entity_id] then
                        local entity_json = tools.entities.get(tag.entity_id)
                        local entity = json.decode(entity_json)
                        if entity then
                            table.insert(data.entities, entity.name)
                        end
                        seen[tag.entity_id] = true
                    end
                end
            end
        end

        table.insert(section_data, data)
    end

    -- Format output
    if format == "tree" then
        return format_tree(section_data, include_word_count, include_entities, total_words)
    elseif format == "plain" then
        return format_plain_outline(section_data, include_word_count, include_entities, total_words)
    else
        return format_markdown_outline(section_data, include_word_count, include_entities, total_words)
    end
end

--- Format as tree structure
function format_tree(section_data, include_word_count, include_entities, total_words)
    local lines = {}
    table.insert(lines, "PROJECT OUTLINE")
    table.insert(lines, "")

    for i, section in ipairs(section_data) do
        local prefix = (i == #section_data) and "└── " or "├── "
        local line = prefix .. section.title

        if include_word_count then
            line = line .. " (" .. section.word_count .. " words)"
        end

        table.insert(lines, line)

        if include_entities and #section.entities > 0 then
            local sub_prefix = (i == #section_data) and "    " or "│   "
            table.insert(lines, sub_prefix .. "Entities: " .. table.concat(section.entities, ", "))
        end
    end

    if include_word_count then
        table.insert(lines, "")
        table.insert(lines, "Total: " .. total_words .. " words")
    end

    return table.concat(lines, "\n")
end

--- Format as plain text
function format_plain_outline(section_data, include_word_count, include_entities, total_words)
    local lines = {}
    table.insert(lines, "PROJECT OUTLINE")
    table.insert(lines, string.rep("=", 40))
    table.insert(lines, "")

    for i, section in ipairs(section_data) do
        local line = i .. ". " .. section.title

        if include_word_count then
            line = line .. " [" .. section.word_count .. " words]"
        end

        table.insert(lines, line)

        if section.synopsis then
            table.insert(lines, "   " .. section.synopsis)
        end

        if include_entities and #section.entities > 0 then
            table.insert(lines, "   Entities: " .. table.concat(section.entities, ", "))
        end

        table.insert(lines, "")
    end

    if include_word_count then
        table.insert(lines, string.rep("-", 40))
        table.insert(lines, "Total word count: " .. total_words)
    end

    return table.concat(lines, "\n")
end

--- Format as markdown
function format_markdown_outline(section_data, include_word_count, include_entities, total_words)
    local lines = {}
    table.insert(lines, "# Project Outline")
    table.insert(lines, "")

    if include_word_count then
        table.insert(lines, "**Total:** " .. total_words .. " words | " .. #section_data .. " sections")
        table.insert(lines, "")
    end

    table.insert(lines, "---")
    table.insert(lines, "")

    for i, section in ipairs(section_data) do
        local header = "## " .. i .. ". " .. section.title

        if include_word_count then
            header = header .. " *(" .. section.word_count .. " words)*"
        end

        table.insert(lines, header)
        table.insert(lines, "")

        if section.synopsis then
            table.insert(lines, "> " .. section.synopsis)
            table.insert(lines, "")
        end

        if include_entities and #section.entities > 0 then
            table.insert(lines, "**Entities:** " .. table.concat(section.entities, ", "))
            table.insert(lines, "")
        end
    end

    return table.concat(lines, "\n")
end

--- Get detailed information about a specific section
-- @param args table with section_id and optional preview_length
-- @return string formatted section details
function section_detail(args)
    local section_id = args.section_id
    local preview_length = args.preview_length or 500

    if not section_id then
        return "Error: section_id is required"
    end

    -- Get the section
    local section_json = tools.entities.get_section(section_id)
    local section = json.decode(section_json)

    if section == nil then
        return "Error: Section not found: " .. section_id
    end

    local lines = {}
    table.insert(lines, "# " .. (section.title or section_id))
    table.insert(lines, "")

    -- Metadata
    table.insert(lines, "## Metadata")
    table.insert(lines, "")
    table.insert(lines, "- **ID:** `" .. section_id .. "`")

    if section.order then
        table.insert(lines, "- **Order:** " .. section.order)
    end

    if section.content then
        local word_count = count_words(section.content)
        table.insert(lines, "- **Word Count:** " .. word_count)
        table.insert(lines, "- **Character Count:** " .. #section.content)
    end

    table.insert(lines, "")

    -- Synopsis
    if section.synopsis then
        table.insert(lines, "## Synopsis")
        table.insert(lines, "")
        table.insert(lines, section.synopsis)
        table.insert(lines, "")
    end

    -- Entities
    local tags_json = tools.entities.get_tags(section_id)
    local tags = json.decode(tags_json)

    if tags and #tags > 0 then
        table.insert(lines, "## Entities (" .. #tags .. " mentions)")
        table.insert(lines, "")

        local entity_counts = {}
        for _, tag in ipairs(tags) do
            entity_counts[tag.entity_id] = (entity_counts[tag.entity_id] or 0) + 1
        end

        for entity_id, count in pairs(entity_counts) do
            local entity_json = tools.entities.get(entity_id)
            local entity = json.decode(entity_json)
            local name = entity and entity.name or entity_id
            table.insert(lines, "- " .. name .. " (" .. count .. " mentions)")
        end
        table.insert(lines, "")
    end

    -- Content preview
    if section.content and #section.content > 0 then
        table.insert(lines, "## Content Preview")
        table.insert(lines, "")

        local preview = section.content
        if #preview > preview_length then
            preview = preview:sub(1, preview_length) .. "..."
        end

        table.insert(lines, "```")
        table.insert(lines, preview)
        table.insert(lines, "```")
    end

    return table.concat(lines, "\n")
end
