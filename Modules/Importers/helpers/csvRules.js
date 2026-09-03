// CSV-import rules. Pure — no I/O — shared by the controller and the tests.
// Input: rows parsed client-side from a CSV/XLSX export (each row a
// { header: value } map), plus an optional column `mapping`
// (target → source column name). Without a mapping, common column names are
// auto-detected (same heuristics as the Jira importer). Output rows match the
// shape createMultipleTasks expects.
const { isObjectIdString, fieldOf, mapPriority, mapStatusName } = require('./jiraRules');

const MAX_ROWS = 2000;

// The task properties a CSV column can be pointed at (handoff 22b, mapping step).
// `parse` is what the preview step validates a sample value against.
const TARGETS = [
    { key: 'taskName', label: 'Task title', parse: 'text', required: true, candidates: ['task name', 'summary', 'title', 'name'] },
    { key: 'description', label: 'Description', parse: 'text', candidates: ['description', 'desc', 'notes'] },
    { key: 'status', label: 'Status', parse: 'status', candidates: ['status', 'state'] },
    { key: 'priority', label: 'Priority', parse: 'priority', candidates: ['priority'] },
    { key: 'assignee', label: 'Assignee', parse: 'user', candidates: ['assignee', 'assigned to', 'owner'] },
    { key: 'dueDate', label: 'Due date', parse: 'date', candidates: ['due date', 'duedate', 'due', 'end date'] },
    { key: 'startDate', label: 'Start date', parse: 'date', candidates: ['start date', 'startdate', 'start'] },
    { key: 'estimate', label: 'Estimate (hours)', parse: 'number', candidates: ['estimate', 'story points', 'original estimate'] },
    { key: 'loggedTime', label: 'Logged time (hours)', parse: 'number', candidates: ['time spent', 'logged time', 'worklog'] },
    { key: 'tags', label: 'Tags', parse: 'list', candidates: ['tags', 'labels'] }
];

const TARGET_KEYS = TARGETS.map((target) => target.key);

const trimmed = (value) => (value === undefined || value === null ? '' : String(value).trim());

// Resolve a canonical field: prefer the user's explicit column mapping, else
// fall back to auto-detecting one of the candidate header names. A mapping of
// '' means the user skipped that target, so auto-detection is not applied.
const valueFor = (row, mapping, field, candidates) => {
    if (mapping && Object.prototype.hasOwnProperty.call(mapping, field)) {
        const col = mapping[field];
        if (!col) return '';
        const raw = row ? row[col] : undefined;
        return trimmed(raw);
    }
    return fieldOf(row, candidates || []);
};

const parseNumber = (raw, divisor) => {
    if (!raw) return null;
    const value = Number(String(raw).replace(/,/g, '').trim());
    if (!Number.isFinite(value)) return null;
    return divisor && divisor !== 1 ? value / divisor : value;
};

const parseDate = (raw) => {
    if (!raw) return null;
    // Excel serial dates arrive as bare numbers when a sheet was exported.
    const serial = Number(raw);
    if (Number.isFinite(serial) && String(raw).trim() !== '' && serial > 20000 && serial < 60000) {
        return new Date(Math.round((serial - 25569) * 86400 * 1000));
    }
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const parseList = (raw) => trimmed(raw).split(/[,;|]/).map((entry) => entry.trim()).filter(Boolean);

const lower = (value) => trimmed(value).toLowerCase();

const validateCsvInput = ({ companyId, projectId, sprintId, rows, userId }) => {
    if (!companyId) return { valid: false, reason: 'companyId is required.' };
    if (!userId) return { valid: false, reason: 'userId is required.' };
    if (!isObjectIdString(projectId)) return { valid: false, reason: 'A valid projectId is required.' };
    if (!isObjectIdString(sprintId)) return { valid: false, reason: 'A valid sprintId is required.' };
    if (!Array.isArray(rows) || !rows.length) return { valid: false, reason: 'rows must be a non-empty array.' };
    if (rows.length > MAX_ROWS) return { valid: false, reason: `At most ${MAX_ROWS} rows per import.` };
    return { valid: true, reason: '' };
};

/* Per-row validation for the preview step: every reason a row will not import
 * cleanly, named by the column it came from. Writes nothing. */
const validateCsvRows = ({ rows, mapping = {}, statusNames = [], users = [], options = {} }) => {
    const knownStatuses = statusNames.map(lower);
    const knownUsers = new Set();
    (users || []).forEach((user) => {
        if (!user) return;
        if (user.email) knownUsers.add(lower(user.email));
        if (user.name) knownUsers.add(lower(user.name));
        if (user.id) knownUsers.add(lower(user.id));
    });

    const issues = [];
    const unknownStatuses = new Set();
    const unknownUsers = new Set();
    let importable = 0;

    (rows || []).forEach((row, index) => {
        const errors = [];
        TARGETS.forEach((target) => {
            const raw = valueFor(row, mapping, target.key, target.candidates);
            if (!raw) {
                if (target.required) errors.push({ column: target.key, message: `${target.label} is empty — this row will be skipped.`, fatal: true });
                return;
            }
            if (target.parse === 'date' && !parseDate(raw)) {
                errors.push({ column: target.key, message: `"${raw}" is not a date we can read.`, fatal: false });
            }
            if (target.parse === 'number' && parseNumber(raw, target.key === 'loggedTime' ? options.loggedTimeDivisor : options.estimateDivisor) === null) {
                errors.push({ column: target.key, message: `"${raw}" is not a number.`, fatal: false });
            }
            if (target.parse === 'status' && knownStatuses.length && !knownStatuses.includes(lower(raw))) {
                const mapped = options.statusMap && options.statusMap[raw];
                if (!mapped && !options.createMissingStatuses) {
                    unknownStatuses.add(raw);
                    errors.push({ column: target.key, message: `"${raw}" is not a status in this project.`, fatal: false });
                }
            }
            if (target.parse === 'user' && knownUsers.size && !knownUsers.has(lower(raw))) {
                const mapped = options.userMap && options.userMap[raw];
                if (!mapped) {
                    unknownUsers.add(raw);
                    errors.push({ column: target.key, message: `"${raw}" does not match anyone in this workspace.`, fatal: false });
                }
            }
        });
        if (!errors.some((error) => error.fatal)) importable += 1;
        if (errors.length) issues.push({ row: index + 1, errors });
    });

    return {
        total: (rows || []).length,
        importable,
        skipped: (rows || []).length - importable,
        issues,
        unknownStatuses: Array.from(unknownStatuses),
        unknownUsers: Array.from(unknownUsers)
    };
};

/* Transform parsed CSV rows into createMultipleTasks input.
 * Returns { tasks, skipped } — rows without a task name are skipped. */
const transformCsvRows = ({ rows, mapping = {}, statusNames, leaderId, users = [], options = {} }) => {
    const tasks = [];
    let skipped = 0;
    const userByKey = new Map();
    (users || []).forEach((user) => {
        if (!user || !user.id) return;
        if (user.email) userByKey.set(lower(user.email), String(user.id));
        if (user.name) userByKey.set(lower(user.name), String(user.id));
        userByKey.set(lower(user.id), String(user.id));
    });

    (rows || []).forEach((row) => {
        const name = valueFor(row, mapping, 'taskName', ['task name', 'summary', 'title', 'name']);
        if (!name) { skipped += 1; return; }

        const due = parseDate(valueFor(row, mapping, 'dueDate', ['due date', 'duedate', 'due', 'end date']));
        const start = parseDate(valueFor(row, mapping, 'startDate', ['start date', 'startdate', 'start']));
        const rawStatus = valueFor(row, mapping, 'status', ['status', 'state']);
        const mappedStatus = (options.statusMap && options.statusMap[rawStatus]) || rawStatus;
        const estimate = parseNumber(valueFor(row, mapping, 'estimate', ['estimate', 'story points', 'original estimate']), options.estimateDivisor);
        const assigneeRaw = valueFor(row, mapping, 'assignee', ['assignee', 'assigned to', 'owner']);
        const assigneeId = assigneeRaw
            ? userByKey.get(lower(assigneeRaw)) || (options.userMap && options.userMap[assigneeRaw]) || ''
            : '';
        const tags = parseList(valueFor(row, mapping, 'tags', ['tags', 'labels']));

        const task = {
            TaskName: name.slice(0, 500),
            status: mapStatusName(mappedStatus, statusNames),
            Task_Priority: mapPriority(valueFor(row, mapping, 'priority', ['priority'])),
            TaskType: 'task',
            TaskTypeKey: 1,
            Task_Leader: leaderId,
            AssigneeUserId: assigneeId ? [assigneeId] : [],
            DueDate: due ? due.toISOString() : null,
            rawDescription: valueFor(row, mapping, 'description', ['description', 'desc', 'notes']).slice(0, 10000),
            ParentTaskId: '',
        };
        if (start) task.StartDate = start.toISOString();
        if (estimate !== null) task.totalEstimatedTime = estimate;
        if (tags.length) task.tagsArray = tags.slice(0, 20);
        tasks.push(task);
    });
    return { tasks, skipped };
};

module.exports = { MAX_ROWS, TARGETS, TARGET_KEYS, valueFor, parseDate, parseNumber, parseList, validateCsvInput, validateCsvRows, transformCsvRows };
