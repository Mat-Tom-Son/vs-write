-- Hello Extension Tools
-- Demonstrates basic Lua tool implementation for VS Write

--- Say hello to a person
-- @param args table with optional 'name' field
-- @return string greeting message
function say_hello(args)
    local name = args.name or "World"
    return "Hello, " .. name .. "! Welcome to VS Write."
end

--- Count files matching a pattern in the workspace
-- @param args table with optional 'pattern' field
-- @return string message with file count
function count_files(args)
    local pattern = args.pattern or "*"

    -- Use the tools.glob function provided by the runtime
    local files_json = tools.glob(pattern, ".")

    -- Parse the JSON result
    local files = json.decode(files_json)

    if files == nil then
        return "No files found matching pattern: " .. pattern
    end

    local count = #files

    if count == 0 then
        return "No files found matching pattern: " .. pattern
    elseif count == 1 then
        return "Found 1 file matching pattern: " .. pattern
    else
        return "Found " .. count .. " files matching pattern: " .. pattern
    end
end
