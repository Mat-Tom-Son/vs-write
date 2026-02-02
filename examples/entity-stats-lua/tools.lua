-- Entity Stats Tools
-- Generate statistics and analytics about entities in the project

--- Count total mentions for an entity across all sections
local function count_entity_mentions(entity_id)
    local total = 0
    local sections_json = tools.entities.list_sections()
    local sections = json.decode(sections_json)

    if sections then
        for _, section in ipairs(sections) do
            local tags_json = tools.entities.get_tags(section.id)
            local tags = json.decode(tags_json)
            if tags then
                for _, tag in ipairs(tags) do
                    if tag.entity_id == entity_id then
                        total = total + 1
                    end
                end
            end
        end
    end

    return total
end

--- Get section distribution for an entity
local function get_entity_distribution(entity_id)
    local sections_with_entity = {}
    local sections_json = tools.entities.list_sections()
    local sections = json.decode(sections_json)

    if sections then
        for _, section in ipairs(sections) do
            local tags_json = tools.entities.get_tags(section.id)
            local tags = json.decode(tags_json)
            if tags then
                local count = 0
                for _, tag in ipairs(tags) do
                    if tag.entity_id == entity_id then
                        count = count + 1
                    end
                end
                if count > 0 then
                    table.insert(sections_with_entity, {
                        section = section,
                        mentions = count
                    })
                end
            end
        end
    end

    return sections_with_entity
end

--- Generate comprehensive statistics about entities
-- @param args table with optional include_mentions, include_distribution
-- @return string formatted statistics
function entity_stats(args)
    local include_mentions = args.include_mentions
    if include_mentions == nil then
        include_mentions = true
    end
    local include_distribution = args.include_distribution
    if include_distribution == nil then
        include_distribution = true
    end

    -- Get all entities
    local entities_json = tools.entities.list_all()
    local entities = json.decode(entities_json)

    if entities == nil or #entities == 0 then
        return "No entities found in the project"
    end

    -- Get all sections for counting
    local sections_json = tools.entities.list_sections()
    local sections = json.decode(sections_json)
    local total_sections = sections and #sections or 0

    -- Count by type
    local by_type = {}
    local total_mentions = 0
    local entity_mention_counts = {}

    for _, entity in ipairs(entities) do
        local t = entity.entity_type or "unknown"
        by_type[t] = (by_type[t] or 0) + 1

        if include_mentions then
            local mentions = count_entity_mentions(entity.id)
            entity_mention_counts[entity.id] = mentions
            total_mentions = total_mentions + mentions
        end
    end

    -- Build output
    local lines = {}
    table.insert(lines, "# Entity Statistics")
    table.insert(lines, "")

    -- Overview
    table.insert(lines, "## Overview")
    table.insert(lines, "")
    table.insert(lines, "| Metric | Value |")
    table.insert(lines, "|--------|-------|")
    table.insert(lines, "| Total Entities | " .. #entities .. " |")
    table.insert(lines, "| Total Sections | " .. total_sections .. " |")
    if include_mentions then
        table.insert(lines, "| Total Mentions | " .. total_mentions .. " |")
        local avg = #entities > 0 and (total_mentions / #entities) or 0
        table.insert(lines, "| Avg Mentions/Entity | " .. string.format("%.1f", avg) .. " |")
    end
    table.insert(lines, "")

    -- By type
    table.insert(lines, "## Entities by Type")
    table.insert(lines, "")
    table.insert(lines, "| Type | Count |")
    table.insert(lines, "|------|-------|")
    for type_name, count in pairs(by_type) do
        table.insert(lines, "| " .. type_name .. " | " .. count .. " |")
    end
    table.insert(lines, "")

    -- Mention details
    if include_mentions then
        table.insert(lines, "## Mention Counts")
        table.insert(lines, "")
        table.insert(lines, "| Entity | Type | Mentions |")
        table.insert(lines, "|--------|------|----------|")

        -- Sort entities by mention count
        local sorted = {}
        for _, entity in ipairs(entities) do
            table.insert(sorted, {
                entity = entity,
                mentions = entity_mention_counts[entity.id] or 0
            })
        end
        table.sort(sorted, function(a, b) return a.mentions > b.mentions end)

        for _, item in ipairs(sorted) do
            table.insert(lines, "| " .. item.entity.name .. " | " .. (item.entity.entity_type or "-") .. " | " .. item.mentions .. " |")
        end
        table.insert(lines, "")
    end

    -- Distribution
    if include_distribution and #entities > 0 then
        table.insert(lines, "## Section Coverage")
        table.insert(lines, "")

        -- Find entities with no mentions
        local unmentioned = {}
        for _, entity in ipairs(entities) do
            local mentions = entity_mention_counts[entity.id] or count_entity_mentions(entity.id)
            if mentions == 0 then
                table.insert(unmentioned, entity)
            end
        end

        if #unmentioned > 0 then
            table.insert(lines, "### Entities Without Mentions")
            table.insert(lines, "")
            for _, entity in ipairs(unmentioned) do
                table.insert(lines, "- " .. entity.name .. " (" .. (entity.entity_type or "unknown") .. ")")
            end
            table.insert(lines, "")
        else
            table.insert(lines, "All entities have at least one mention.")
            table.insert(lines, "")
        end
    end

    return table.concat(lines, "\n")
end

--- Get the most or least frequently mentioned entities
-- @param args table with optional top, order, entity_type
-- @return string formatted frequency list
function entity_frequency(args)
    local top = args.top or 10
    local order = args.order or "most"
    local entity_type = args.entity_type

    -- Get entities
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

    -- Count mentions for each entity
    local entity_data = {}
    for _, entity in ipairs(entities) do
        local mentions = count_entity_mentions(entity.id)
        table.insert(entity_data, {
            entity = entity,
            mentions = mentions
        })
    end

    -- Sort
    if order == "least" then
        table.sort(entity_data, function(a, b) return a.mentions < b.mentions end)
    else
        table.sort(entity_data, function(a, b) return a.mentions > b.mentions end)
    end

    -- Limit to top N
    local limited = {}
    for i = 1, math.min(top, #entity_data) do
        table.insert(limited, entity_data[i])
    end

    -- Build output
    local lines = {}
    local title = order == "least" and "Least" or "Most"
    table.insert(lines, "# " .. title .. " Frequently Mentioned Entities")
    if entity_type then
        table.insert(lines, "*Filtered to type: " .. entity_type .. "*")
    end
    table.insert(lines, "")

    table.insert(lines, "| Rank | Entity | Type | Mentions |")
    table.insert(lines, "|------|--------|------|----------|")

    for i, item in ipairs(limited) do
        table.insert(lines, "| " .. i .. " | " .. item.entity.name .. " | " .. (item.entity.entity_type or "-") .. " | " .. item.mentions .. " |")
    end

    return table.concat(lines, "\n")
end

--- Identify entities that may need more coverage or are over-represented
-- @param args table with optional threshold_low, threshold_high
-- @return string formatted coverage analysis
function entity_coverage(args)
    local threshold_low = args.threshold_low or 2
    local threshold_high = args.threshold_high or 20

    -- Get all entities
    local entities_json = tools.entities.list_all()
    local entities = json.decode(entities_json)

    if entities == nil or #entities == 0 then
        return "No entities found in the project"
    end

    -- Categorize entities
    local under_covered = {}
    local normal = {}
    local over_covered = {}

    for _, entity in ipairs(entities) do
        local mentions = count_entity_mentions(entity.id)
        local item = { entity = entity, mentions = mentions }

        if mentions < threshold_low then
            table.insert(under_covered, item)
        elseif mentions > threshold_high then
            table.insert(over_covered, item)
        else
            table.insert(normal, item)
        end
    end

    -- Sort each category
    table.sort(under_covered, function(a, b) return a.mentions < b.mentions end)
    table.sort(over_covered, function(a, b) return a.mentions > b.mentions end)

    -- Build output
    local lines = {}
    table.insert(lines, "# Entity Coverage Analysis")
    table.insert(lines, "")
    table.insert(lines, "*Thresholds: under=" .. threshold_low .. ", over=" .. threshold_high .. "*")
    table.insert(lines, "")

    -- Summary
    table.insert(lines, "## Summary")
    table.insert(lines, "")
    table.insert(lines, "| Category | Count |")
    table.insert(lines, "|----------|-------|")
    table.insert(lines, "| Under-covered (<" .. threshold_low .. ") | " .. #under_covered .. " |")
    table.insert(lines, "| Normal coverage | " .. #normal .. " |")
    table.insert(lines, "| Over-covered (>" .. threshold_high .. ") | " .. #over_covered .. " |")
    table.insert(lines, "")

    -- Under-covered
    if #under_covered > 0 then
        table.insert(lines, "## Under-Covered Entities")
        table.insert(lines, "")
        table.insert(lines, "These entities may need more mentions or could be removed:")
        table.insert(lines, "")
        for _, item in ipairs(under_covered) do
            table.insert(lines, "- **" .. item.entity.name .. "** (" .. item.mentions .. " mentions)")
        end
        table.insert(lines, "")
    end

    -- Over-covered
    if #over_covered > 0 then
        table.insert(lines, "## Over-Covered Entities")
        table.insert(lines, "")
        table.insert(lines, "These entities appear very frequently:")
        table.insert(lines, "")
        for _, item in ipairs(over_covered) do
            table.insert(lines, "- **" .. item.entity.name .. "** (" .. item.mentions .. " mentions)")
        end
        table.insert(lines, "")
    end

    if #under_covered == 0 and #over_covered == 0 then
        table.insert(lines, "All entities have balanced coverage.")
    end

    return table.concat(lines, "\n")
end
