// Monday.com-import rules. Pure — no I/O — shared by the controller and tests.
// Input: rows parsed client-side from a Monday.com board export (Board menu →
// Export board to Excel), each row a { header: value } map, plus an optional
// column `mapping` ({ taskName, status, priority, dueDate, description } → source
// column name). Monday boards export item columns such as:
//   Name | Status | Priority | Due Date (or "Date") | Owner | Notes (or "Text")
// Without a mapping, those common column names are auto-detected (same approach
// as the CSV importer, with Monday's column synonyms added). Output rows match
// the shape createMultipleTasks expects. Monday subitems export as their own rows
// with an empty Name in the parent's group, so blank-name rows are simply skipped.
const { isObjectIdString, fieldOf, mapPriority, mapStatusName } = require('./jiraRules');

const MAX_ROWS = 2000;

// Monday column synonyms layered on top of the generic CSV candidates.
const CANDIDATES = {
    taskName: ['name', 'item name', 'task name', 'title', 'summary', 'item'],
    status: ['status', 'state'],
    priority: ['priority'],
    dueDate: ['due date', 'duedate', 'due', 'date', 'timeline', 'end date'],
    description: ['notes', 'description', 'desc', 'text', 'long text'],
};

// Resolve a canonical field: prefer the user's explicit column mapping, else
// fall back to auto-detecting one of the candidate header names.
const valueFor = (row, mapping, field, candidates) => {
    const col = mapping && mapping[field];
    if (col && row && row[col] !== undefined && row[col] !== null && String(row[col]).trim() !== '') {
        return String(row[col]).trim();
    }
    return fieldOf(row, candidates);
};

const validateMondayInput = ({ companyId, projectId, sprintId, rows, userId }) => {
    if (!companyId) return { valid: false, reason: 'companyId is required.' };
    if (!userId) return { valid: false, reason: 'userId is required.' };
    if (!isObjectIdString(projectId)) return { valid: false, reason: 'A valid projectId is required.' };
    if (!isObjectIdString(sprintId)) return { valid: false, reason: 'A valid sprintId is required.' };
    if (!Array.isArray(rows) || !rows.length) return { valid: false, reason: 'rows must be a non-empty array.' };
    if (rows.length > MAX_ROWS) return { valid: false, reason: `At most ${MAX_ROWS} rows per import.` };
    return { valid: true, reason: '' };
};

/* Transform parsed Monday rows into createMultipleTasks input.
 * Returns { tasks, skipped } — rows without a task name are skipped. */
const parseMondayExport = ({ rows, mapping = {}, statusNames, leaderId }) => {
    const tasks = [];
    let skipped = 0;
    (rows || []).forEach((row) => {
        const name = valueFor(row, mapping, 'taskName', CANDIDATES.taskName);
        if (!name) { skipped += 1; return; }
        const dueRaw = valueFor(row, mapping, 'dueDate', CANDIDATES.dueDate);
        const due = dueRaw ? new Date(dueRaw) : null;
        tasks.push({
            TaskName: name.slice(0, 500),
            status: mapStatusName(valueFor(row, mapping, 'status', CANDIDATES.status), statusNames),
            Task_Priority: mapPriority(valueFor(row, mapping, 'priority', CANDIDATES.priority)),
            TaskType: 'task',
            TaskTypeKey: 1,
            Task_Leader: leaderId,
            AssigneeUserId: [],
            DueDate: due && !Number.isNaN(due.getTime()) ? due.toISOString() : null,
            rawDescription: valueFor(row, mapping, 'description', CANDIDATES.description).slice(0, 10000),
            ParentTaskId: '',
        });
    });
    return { tasks, skipped };
};

module.exports = { MAX_ROWS, CANDIDATES, valueFor, validateMondayInput, parseMondayExport };
