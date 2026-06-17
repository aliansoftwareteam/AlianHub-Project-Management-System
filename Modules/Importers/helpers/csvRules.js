// CSV-import rules. Pure — no I/O — shared by the controller and the tests.
// Input: rows parsed client-side from a CSV/XLSX export (each row a
// { header: value } map), plus an optional column `mapping`
// ({ taskName, status, priority, dueDate, description } → source column name).
// Without a mapping, common column names are auto-detected (same heuristics as
// the Jira importer). Output rows match the shape createMultipleTasks expects.
const { isObjectIdString, fieldOf, mapPriority, mapStatusName } = require('./jiraRules');

const MAX_ROWS = 2000;

// Resolve a canonical field: prefer the user's explicit column mapping, else
// fall back to auto-detecting one of the candidate header names.
const valueFor = (row, mapping, field, candidates) => {
    const col = mapping && mapping[field];
    if (col && row && row[col] !== undefined && row[col] !== null && String(row[col]).trim() !== '') {
        return String(row[col]).trim();
    }
    return fieldOf(row, candidates);
};

const validateCsvInput = ({ companyId, projectId, sprintId, rows, userId }) => {
    if (!companyId) return { valid: false, reason: 'companyId is required.' };
    if (!userId) return { valid: false, reason: 'userId is required.' };
    if (!isObjectIdString(projectId)) return { valid: false, reason: 'A valid projectId is required.' };
    if (!isObjectIdString(sprintId)) return { valid: false, reason: 'A valid sprintId is required.' };
    if (!Array.isArray(rows) || !rows.length) return { valid: false, reason: 'rows must be a non-empty array.' };
    if (rows.length > MAX_ROWS) return { valid: false, reason: `At most ${MAX_ROWS} rows per import.` };
    return { valid: true, reason: '' };
};

/* Transform parsed CSV rows into createMultipleTasks input.
 * Returns { tasks, skipped } — rows without a task name are skipped. */
const transformCsvRows = ({ rows, mapping = {}, statusNames, leaderId }) => {
    const tasks = [];
    let skipped = 0;
    (rows || []).forEach((row) => {
        const name = valueFor(row, mapping, 'taskName', ['task name', 'summary', 'title', 'name']);
        if (!name) { skipped += 1; return; }
        const dueRaw = valueFor(row, mapping, 'dueDate', ['due date', 'duedate', 'due', 'end date']);
        const due = dueRaw ? new Date(dueRaw) : null;
        tasks.push({
            TaskName: name.slice(0, 500),
            status: mapStatusName(valueFor(row, mapping, 'status', ['status', 'state']), statusNames),
            Task_Priority: mapPriority(valueFor(row, mapping, 'priority', ['priority'])),
            TaskType: 'task',
            TaskTypeKey: 1,
            Task_Leader: leaderId,
            AssigneeUserId: [],
            DueDate: due && !Number.isNaN(due.getTime()) ? due.toISOString() : null,
            rawDescription: valueFor(row, mapping, 'description', ['description', 'desc', 'notes']).slice(0, 10000),
            ParentTaskId: '',
        });
    });
    return { tasks, skipped };
};

module.exports = { MAX_ROWS, valueFor, validateCsvInput, transformCsvRows };
