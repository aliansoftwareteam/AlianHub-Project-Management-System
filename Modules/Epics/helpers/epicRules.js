// Epic rules. Pure — no I/O — shared by controller and tests.

const OBJECT_ID_PATTERN = /^[0-9a-fA-F]{24}$/;
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
const MAX_NAME_LENGTH = 120;
const EPIC_STATUSES = Object.freeze(['open', 'done']);

const isObjectIdString = (id) => OBJECT_ID_PATTERN.test(String(id || ''));

/* Validate epic creation/update input. Returns { valid, reason }. */
const validateEpicInput = ({ companyId, name, projectId, color }) => {
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

module.exports = {
    EPIC_STATUSES,
    MAX_NAME_LENGTH,
    isObjectIdString,
    validateEpicInput,
    validateAssignInput,
    countDeltas,
};
