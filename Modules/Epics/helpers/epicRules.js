// Epic rules. Pure — no I/O — shared by controller and tests.

const OBJECT_ID_PATTERN = /^[0-9a-fA-F]{24}$/;
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
const MAX_NAME_LENGTH = 120;
const EPIC_STATUSES = Object.freeze(['open', 'in_progress', 'done']);
const EPIC_PRIORITIES = Object.freeze(['low', 'medium', 'high']);

const isObjectIdString = (id) => OBJECT_ID_PATTERN.test(String(id || ''));

/* Validate epic creation/update input. Returns { valid, reason }. */
const validateEpicInput = ({ companyId, name, projectId, color, priority }) => {
    if (!companyId) {
        return { valid: false, reason: 'companyId is required.' };
    }
    if (!name || !String(name).trim() || String(name).length > MAX_NAME_LENGTH) {
        return { valid: false, reason: `A name up to ${MAX_NAME_LENGTH} characters is required.` };
    }
    if (!isObjectIdString(projectId)) {
        return { valid: false, reason: 'A valid projectId is required.' };
    }
    if (color !== undefined && color !== '' && !HEX_COLOR_PATTERN.test(String(color))) {
        return { valid: false, reason: 'color must be a #rrggbb hex value.' };
    }
    if (priority !== undefined && priority !== '' && priority !== null && !EPIC_PRIORITIES.includes(String(priority))) {
        return { valid: false, reason: `priority must be one of: ${EPIC_PRIORITIES.join(', ')}.` };
    }
    return { valid: true, reason: '' };
};

/* Validate a task assignment. epicId null/'' means "remove from epic". */
const validateAssignInput = ({ companyId, taskId, epicId }) => {
    if (!companyId) {
        return { valid: false, reason: 'companyId is required.' };
    }
    if (!isObjectIdString(taskId)) {
        return { valid: false, reason: 'A valid taskId is required.' };
    }
    if (epicId !== null && epicId !== '' && epicId !== undefined && !isObjectIdString(epicId)) {
        return { valid: false, reason: 'epicId must be a valid id, or empty to remove.' };
    }
    return { valid: true, reason: '' };
};

/* Counter deltas when a task moves between epics.
 * Returns [{ epicId, inc: { taskCount, completedCount } }] — one entry per
 * affected epic, ready for $inc. */
const countDeltas = ({ oldEpicId, newEpicId, isCompleted }) => {
    const oldId = oldEpicId ? String(oldEpicId) : null;
    const newId = newEpicId ? String(newEpicId) : null;
    if (oldId === newId) return [];
    const completedDelta = isCompleted ? 1 : 0;
    const deltas = [];
    if (oldId) {
        deltas.push({ epicId: oldId, inc: { taskCount: -1, completedCount: -completedDelta } });
    }
    if (newId) {
        deltas.push({ epicId: newId, inc: { taskCount: 1, completedCount: completedDelta } });
    }
    return deltas;
};

/* Parse + validate optional epic dates. Returns { valid, reason, startDate,
 * dueDate } with Date objects (or null). Rejects unparseable dates, and a
 * startDate later than dueDate when both are supplied in the same call. */
const parseEpicDates = ({ startDate, dueDate }) => {
    const toDate = (v) => {
        if (v === null || v === '') return null;
        const d = new Date(v);
        return Number.isNaN(d.getTime()) ? false : d;
    };
    const out = { valid: true, reason: '', startDate: undefined, dueDate: undefined };
    if (startDate !== undefined) {
        const d = toDate(startDate);
        if (d === false) return { valid: false, reason: 'startDate is not a valid date.' };
        out.startDate = d;
    }
    if (dueDate !== undefined) {
        const d = toDate(dueDate);
        if (d === false) return { valid: false, reason: 'dueDate is not a valid date.' };
        out.dueDate = d;
    }
    if (out.startDate && out.dueDate && out.startDate.getTime() > out.dueDate.getTime()) {
        return { valid: false, reason: 'startDate must be on or before dueDate.' };
    }
    return out;
};

module.exports = {
    EPIC_STATUSES,
    EPIC_PRIORITIES,
    MAX_NAME_LENGTH,
    isObjectIdString,
    validateEpicInput,
    validateAssignInput,
    parseEpicDates,
    countDeltas,
};
