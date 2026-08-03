// Personal notepad (COLLAB-06) — pure rule helpers. No DB / network / mongoose
// here so they can be unit-tested in isolation (see tests/collab-notes-rules.test.js),
// mirroring Modules/Reminders/remindersRules.js.

// Task names in this app are constrained to 3..250 chars (see CreateTask.vue /
// the task-create flow). A note converts into a task using its title (or, when
// the title is blank, the first line of its content) as the task name. This
// helper derives a safe task name + description seed from a note WITHOUT
// touching the task-create path itself — the frontend feeds the result into the
// existing taskClass.create() flow.
const TASK_NAME_MIN = 3;
const TASK_NAME_MAX = 250;

// First non-empty line of a string, trimmed.
function firstLine(text) {
    if (typeof text !== 'string') return '';
    const lines = text.split(/\r?\n/);
    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed) return trimmed;
    }
    return '';
}

// Derive the task name from a note: prefer the title, fall back to the first
// line of the content. Returns a string clamped to the task-name max length.
function deriveTaskName(note) {
    const title = note && typeof note.title === 'string' ? note.title.trim() : '';
    const base = title || firstLine(note && note.content);
    return base.slice(0, TASK_NAME_MAX);
}

// Whether a note can be converted into a task: the derived name must satisfy the
// same min-length rule the task-create UI enforces.
function canConvertToTask(note) {
    const name = deriveTaskName(note);
    return name.length >= TASK_NAME_MIN && name.length <= TASK_NAME_MAX;
}

// Normalise an incoming create/update payload to the note fields we persist.
// Anything not listed here is dropped (the schema is strict anyway). `undefined`
// fields are omitted so an update only sets what was sent.
function sanitizeNotePayload(body) {
    const b = body || {};
    const out = {};
    if (b.title !== undefined) out.title = typeof b.title === 'string' ? b.title : String(b.title || '');
    if (b.content !== undefined) out.content = typeof b.content === 'string' ? b.content : String(b.content || '');
    if (b.convertedTaskId !== undefined) {
        out.convertedTaskId = b.convertedTaskId ? String(b.convertedTaskId) : '';
    }
    // Archive / restore. Expressed as a boolean by the client and stored on the
    // existing deletedStatusKey using this app's convention (0 = active,
    // 1 = deleted, 2 = archived), so no schema change is needed.
    if (b.archived !== undefined) {
        out.deletedStatusKey = (b.archived === true || b.archived === 'true') ? 2 : 0;
    }
    return out;
}

module.exports = {
    TASK_NAME_MIN,
    TASK_NAME_MAX,
    firstLine,
    deriveTaskName,
    canConvertToTask,
    sanitizeNotePayload,
};
