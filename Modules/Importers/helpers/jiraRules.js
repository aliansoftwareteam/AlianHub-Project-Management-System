// Jira-import rules. Pure — no I/O — shared by controller and tests.
// Input: rows parsed client-side from a Jira CSV export (header: value maps).

const OBJECT_ID_PATTERN = /^[0-9a-fA-F]{24}$/;
const MAX_ROWS = 2000;

const isObjectIdString = (id) => OBJECT_ID_PATTERN.test(String(id || ''));

/* Jira exports vary in casing; resolve a field by candidate names. */
const fieldOf = (row, candidates) => {
    const keys = Object.keys(row || {});
    for (const candidate of candidates) {
        const hit = keys.find((key) => key.trim().toLowerCase() === candidate);
        if (hit !== undefined && row[hit] !== undefined && row[hit] !== null && String(row[hit]).trim() !== '') {
            return String(row[hit]).trim();
        }
    }
    return '';
};

/* Map a Jira priority onto the app's default priority names. Unknown
 * values pass through untouched (priorities are free-form strings). */
const mapPriority = (jiraPriority) => {
    const normalized = String(jiraPriority || '').trim().toLowerCase();
    const table = {
        highest: 'Urgent',
        high: 'High',
        medium: 'Normal',
        low: 'Low',
        lowest: 'Low',
    };
    return table[normalized] || (jiraPriority ? String(jiraPriority).trim() : 'Normal');
};

/* Case-insensitive status-name match against the available statuses;
 * falls back to the first status. */
const mapStatusName = (jiraStatus, statusNames) => {
    const wanted = String(jiraStatus || '').trim().toLowerCase();
    const exact = statusNames.find((name) => String(name).trim().toLowerCase() === wanted);
    if (exact) return exact;
    // Common Jira names that deserve a sensible home.
    const aliases = { 'done': 'completed', 'in review': 'in review', 'to do': 'to do', 'in progress': 'in progress' };
    if (aliases[wanted]) {
        const aliased = statusNames.find((name) => String(name).trim().toLowerCase() === aliases[wanted]);
        if (aliased) return aliased;
    }
    return statusNames[0];
};

/* Validate the import request. Returns { valid, reason }. */
const validateImportInput = ({ companyId, projectId, sprintId, rows, userId }) => {
    if (!companyId) {
        return { valid: false, reason: 'companyId is required.' };
    }
    if (!userId) {
        return { valid: false, reason: 'userId is required.' };
    }
    if (!isObjectIdString(projectId)) {
        return { valid: false, reason: 'A valid projectId is required.' };
    }
    if (!isObjectIdString(sprintId)) {
        return { valid: false, reason: 'A valid sprintId is required.' };
    }
    if (!Array.isArray(rows) || !rows.length) {
        return { valid: false, reason: 'rows must be a non-empty array.' };
    }
    if (rows.length > MAX_ROWS) {
        return { valid: false, reason: `At most ${MAX_ROWS} rows per import.` };
    }
    return { valid: true, reason: '' };
};

/* Transform parsed Jira rows into the shape createMultipleTasks expects.
 * Returns { tasks, skipped } — rows without a summary are skipped. */
const transformJiraRows = ({ rows, statusNames, leaderId }) => {
    const tasks = [];
    let skipped = 0;
    (rows || []).forEach((row) => {
        const summary = fieldOf(row, ['summary', 'task name', 'title']);
        if (!summary) {
            skipped++;
            return;
        }
        const dueRaw = fieldOf(row, ['due date', 'duedate', 'due']);
        const due = dueRaw ? new Date(dueRaw) : null;
        tasks.push({
            TaskName: summary.slice(0, 500),
            status: mapStatusName(fieldOf(row, ['status']), statusNames),
            Task_Priority: mapPriority(fieldOf(row, ['priority'])),
            TaskType: 'task',
            TaskTypeKey: 1,
            Task_Leader: leaderId,
            AssigneeUserId: [],
            DueDate: due && !Number.isNaN(due.getTime()) ? due.toISOString() : null,
            rawDescription: fieldOf(row, ['description']).slice(0, 10000),
            ParentTaskId: '',
        });
    });
    return { tasks, skipped };
};

module.exports = {
    MAX_ROWS,
    isObjectIdString,
    fieldOf,
    mapPriority,
    mapStatusName,
    validateImportInput,
    transformJiraRows,
};
