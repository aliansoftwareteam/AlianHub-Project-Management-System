const KNOWN_ERRORS = ["token_limited_to_projects", "text_required", "no_model", "import_unreadable", "items_required", "ai_off", "unauthenticated"];

export const memoryErrorKey = (code) => (KNOWN_ERRORS.includes(code) ? `AskMemory.error_${code}` : "AskMemory.error_generic");
