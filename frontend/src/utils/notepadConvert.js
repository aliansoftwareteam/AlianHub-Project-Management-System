// Personal notepad (COLLAB-06) — note-to-task name derivation, mirroring the
// backend Modules/Notes/notesRules.js so the frontend seeds the EXISTING
// task-create flow (taskClass.create) with the same rules. Pure helpers only.

export const TASK_NAME_MIN = 3;
export const TASK_NAME_MAX = 250;

// First non-empty trimmed line of a string.
export function firstLine(text) {
    if (typeof text !== "string") return "";
    const lines = text.split(/\r?\n/);
    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed) return trimmed;
    }
    return "";
}

// Derive the task name from a note: prefer the title, else the first line of the
// content, clamped to the task-name max length.
export function deriveTaskName(note) {
    const title = note && typeof note.title === "string" ? note.title.trim() : "";
    const base = title || firstLine(note && note.content);
    return base.slice(0, TASK_NAME_MAX);
}

// Whether a note can be converted: derived name within the allowed length.
export function canConvertToTask(note) {
    const name = deriveTaskName(note);
    return name.length >= TASK_NAME_MIN && name.length <= TASK_NAME_MAX;
}
