-- Hello Extension Lifecycle Hooks
-- Demonstrates lifecycle hook implementation

--- Called when the extension is activated
-- @param args table (empty for on_activate)
-- @return table with success and optional message
function on_activate(args)
    -- Log activation (tools.log is available in the runtime)
    return {
        success = true,
        result = "Hello Extension activated successfully!"
    }
end

--- Called when the extension is deactivated
-- @param args table (empty for on_deactivate)
-- @return table with success and optional message
function on_deactivate(args)
    return {
        success = true,
        result = "Hello Extension deactivated. Goodbye!"
    }
end
