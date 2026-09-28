// ClickUp-import rules. Pure — no I/O — shared by the controller and the tests.
// Input: rows parsed client-side from ClickUp's CSV/Excel export ("Export view"
// or the workspace export), each row a { header: value } map.
// A ClickUp List becomes a sprint: into the chosen sprint of an existing project,
// or into a new project named after the list (one project per list).
const { isObjectIdString } = require('./jiraRules');
const { parseDate } = require('./csvRules');

const MAX_ROWS = 2000;
const MAX_TAGS = 20;
const DEFAULT_LIST = 'ClickUp import';

const COLUMNS = {
    id: ['task id'],
    name: ['task name', 'name'],
    description: ['task content', 'content', 'description', 'text content'],
    status: ['status'],
    priority: ['priority'],
    assignees: ['assignees', 'assignee'],
    tags: ['tags'],
    parent: ['parent id', 'parent task id'],
    list: ['list name', 'list'],
    folder: ['folder name', 'folder'],
    space: ['space name', 'space'],
    due: ['due date'],
    dueText: ['due date text'],
    start: ['start date'],
    startText: ['start date text'],
    estimate: ['time estimated', 'time estimate'],
    estimateText: ['time estimated text', 'time estimate text'],
};

const KNOWN = new Set([
    ...Object.values(COLUMNS).flat(),
    'task custom id', 'date created', 'date created text', 'date updated', 'date updated text', 'date closed', 'date closed text',
    'date done', 'date done text', 'attachments', 'checklists', 'comments', 'assigned comments', 'time spent', 'time spent text',
    'rolled up time', 'rolled up time text', 'time logged', 'time logged text', 'time logged rolled up with subtasks',
    'time logged rolled up with subtasks text', 'list id', 'folder id', 'space id', 'task type', 'watchers', 'creator', 'created by',
    'latest comment', 'points', 'sprint points', 'linked tasks', 'dependencies', 'url', 'task url',
]);

// ClickUp names each custom-field column "<field> (<type>)".
const CUSTOM_COLUMN = /^(.+?)\s*\(([a-z_ ]+)\)\s*$/i;
const CUSTOM_TYPES = {
    number: 'number', currency: 'number', money: 'number', rating: 'number', progress: 'number',
    manual_progress: 'number', automatic_progress: 'number', date: 'date',
    short_text: 'text', text: 'text', long_text: 'text', drop_down: 'text', dropdown: 'text', labels: 'text', email: 'text',
    phone: 'text', url: 'text', checkbox: 'text', location: 'text', emoji: 'text', users: 'text', tasks: 'text', formula: 'text',
};

const trimmed = (value) => (value === undefined || value === null ? '' : String(value).trim());
const lower = (value) => trimmed(value).toLowerCase();

const columnIndex = (headers) => {
    const byLower = new Map(headers.map((header) => [lower(header), header]));
    const index = {};
    Object.entries(COLUMNS).forEach(([key, candidates]) => {
        const hit = candidates.find((candidate) => byLower.has(candidate));
        if (hit) index[key] = byLower.get(hit);
    });
    return index;
};

const headersOf = (rows) => Array.from(new Set((rows || []).flatMap((row) => Object.keys(row || {}))));

const customColumns = (headers) => headers.flatMap((header) => {
    if (KNOWN.has(lower(header))) return [];
    const match = CUSTOM_COLUMN.exec(trimmed(header));
    if (!match) return [];
    const kind = CUSTOM_TYPES[lower(match[2]).replace(/\s+/g, '_')];
    return kind ? [{ column: header, name: match[1].trim().slice(0, 80), type: kind }] : [];
});

const ignoredColumns = (headers) => {
    const custom = new Set(customColumns(headers).map((field) => field.column));
    return headers.filter((header) => !KNOWN.has(lower(header)) && !custom.has(header));
};

const cell = (row, index, key) => trimmed(index[key] ? row[index[key]] : '');

const parseList = (raw) => trimmed(raw).replace(/^\[|\]$/g, '').split(/[,;]/).map((entry) => entry.trim().replace(/^["']|["']$/g, '')).filter(Boolean);

const parseClickUpDate = (raw) => {
    const text = trimmed(raw);
    if (!text) return null;
    if (/^\d{11,14}$/.test(text)) {
        const date = new Date(Number(text));
        return Number.isNaN(date.getTime()) ? null : date;
    }
    const direct = parseDate(text);
    if (direct) return direct;
    const cleaned = text.replace(/^[A-Za-z]+day,\s*/i, '').replace(/(\d+)(st|nd|rd|th)\b/gi, '$1');
    const parsed = new Date(cleaned);
    if (!Number.isNaN(parsed.getTime())) return parsed;
    const dayOnly = new Date(cleaned.split(',')[0]);
    return Number.isNaN(dayOnly.getTime()) ? null : dayOnly;
};

const UNIT_MINUTES = { w: 7 * 24 * 60, d: 24 * 60, h: 60, m: 1 };

const parseEstimateMinutes = (millis, text) => {
    const raw = trimmed(millis);
    if (raw && Number.isFinite(Number(raw)) && Number(raw) > 0) return Math.round(Number(raw) / 60000);
    let total = 0;
    const pattern = /(\d+(?:\.\d+)?)\s*(w|d|h|m)[a-z]*/gi;
    let match = pattern.exec(trimmed(text));
    while (match) {
        total += Number(match[1]) * UNIT_MINUTES[match[2].toLowerCase()];
        match = pattern.exec(trimmed(text));
    }
    return total > 0 ? Math.round(total) : null;
};

// Stored priority values are the company defaults HIGH / MEDIUM / LOW; ClickUp's "urgent" has no default of its own.
const mapClickUpPriority = (raw) => ({ urgent: 'HIGH', high: 'HIGH', normal: 'MEDIUM', medium: 'MEDIUM', low: 'LOW' }[lower(raw)] || 'MEDIUM');

const DONE_NAMES = ['complete', 'completed', 'closed', 'done', 'resolved'];
const OPEN_NAMES = ['to do', 'todo', 'open', 'backlog', 'new'];

const statusType = (name) => {
    const key = lower(name);
    if (DONE_NAMES.includes(key)) return 'close';
    if (OPEN_NAMES.includes(key)) return 'default_active';
    return 'active';
};

const titleCase = (name) => trimmed(name).replace(/\b\w/g, (letter) => letter.toUpperCase());

const clickUpStatuses = (rows) => {
    const index = columnIndex(headersOf(rows));
    const seen = new Map();
    (rows || []).forEach((row) => {
        const name = cell(row, index, 'status');
        if (name && !seen.has(lower(name))) seen.set(lower(name), { name: titleCase(name), type: statusType(name) });
    });
    return Array.from(seen.values());
};

/* Each ClickUp status resolves to a project status: the same name, else the project's
 * first status of the same kind for the usual done/open names, else a status to create. */
const resolveStatuses = ({ wanted = [], existing = [] }) => {
    const mapping = {};
    const missing = [];
    const byName = new Map(existing.map((status) => [lower(status.name), status.name]));
    const firstOfType = (type) => (existing.find((status) => status.type === type) || {}).name;
    wanted.forEach((status) => {
        const key = lower(status.name);
        const aliased = status.type === 'close' || OPEN_NAMES.includes(key) ? firstOfType(status.type) : '';
        const name = byName.get(key) || aliased;
        if (name) mapping[key] = name;
        else {
            missing.push(status);
            mapping[key] = status.name;
            byName.set(key, status.name);
        }
    });
    return { mapping, missing };
};

const listKey = (row, index) => [cell(row, index, 'space'), cell(row, index, 'folder'), cell(row, index, 'list')].join('\u0000');

const validateClickUpRows = (rows) => {
    if (!Array.isArray(rows) || !rows.length) return { valid: false, reason: 'rows must be a non-empty array.' };
    if (rows.length > MAX_ROWS) return { valid: false, reason: `At most ${MAX_ROWS} rows per import.` };
    if (!columnIndex(headersOf(rows)).name) return { valid: false, reason: 'The file has no "Task Name" column. Export it from ClickUp as CSV or Excel.' };
    return { valid: true, reason: '' };
};

const validateClickUpInput = ({ companyId, projectId, sprintId, rows, userId }) => {
    if (!companyId) return { valid: false, reason: 'companyId is required.' };
    if (!userId) return { valid: false, reason: 'userId is required.' };
    if (!isObjectIdString(projectId)) return { valid: false, reason: 'A valid projectId is required.' };
    if (!isObjectIdString(sprintId)) return { valid: false, reason: 'A valid sprintId is required.' };
    return validateClickUpRows(rows);
};

/* Subtasks of subtasks hang off the top-level task (subtasks here are one level deep);
 * a parent missing from the file leaves the row a task of its own. */
const topAncestor = (id, parentOf) => {
    let current = id;
    const seen = new Set([current]);
    while (parentOf.has(current) && parentOf.get(current) && parentOf.has(parentOf.get(current))) {
        const next = parentOf.get(current);
        if (seen.has(next)) return '';
        seen.add(next);
        current = next;
    }
    return current === id ? '' : current;
};

const SKIP_REASONS = { no_name: 'The task has no name.' };
const skipCode = (row, index) => (cell(row, index, 'name') ? '' : 'no_name');
const skipEntry = (i, code) => ({ row: i + 1, code, reason: SKIP_REASONS[code] });

/* Transform ClickUp rows into createMultipleTasks input. `statusFor` maps a ClickUp
 * status name to the project status to use. Assignees travel as emails and are
 * resolved later among the company's members only. */
const transformClickUpRows = ({ rows, statusFor, leaderId }) => {
    const headers = headersOf(rows);
    const index = columnIndex(headers);
    const custom = customColumns(headers);
    const skippedRows = [];
    const kept = [];

    (rows || []).forEach((row, i) => {
        const code = skipCode(row, index);
        if (code) skippedRows.push(skipEntry(i, code));
        else kept.push({ row, id: cell(row, index, 'id') || `row-${i + 1}` });
    });

    const parentOf = new Map(kept.map(({ row, id }) => [id, cell(row, index, 'parent')]));
    const unnamedAssignees = new Set();

    const tasks = kept.map(({ row, id }) => {
        const people = parseList(cell(row, index, 'assignees'));
        people.filter((person) => !person.includes('@')).forEach((person) => unnamedAssignees.add(person));
        const due = parseClickUpDate(cell(row, index, 'due')) || parseClickUpDate(cell(row, index, 'dueText'));
        const start = parseClickUpDate(cell(row, index, 'start')) || parseClickUpDate(cell(row, index, 'startText'));
        const estimate = parseEstimateMinutes(cell(row, index, 'estimate'), cell(row, index, 'estimateText'));
        const tagNames = [];
        parseList(cell(row, index, 'tags')).forEach((tag) => {
            if (!tagNames.some((have) => lower(have) === lower(tag))) tagNames.push(tag.slice(0, 50));
        });

        const task = {
            _id: id,
            TaskName: cell(row, index, 'name').slice(0, 500),
            status: statusFor(cell(row, index, 'status')),
            Task_Priority: mapClickUpPriority(cell(row, index, 'priority')),
            TaskType: 'task',
            TaskTypeKey: 1,
            Task_Leader: leaderId,
            AssigneeUserId: [],
            memberEmails: people.filter((person) => person.includes('@')).map((email) => email.toLowerCase()),
            DueDate: due ? due.toISOString() : null,
            rawDescription: cell(row, index, 'description').slice(0, 10000),
            ParentTaskId: topAncestor(id, parentOf),
        };
        if (start) task.startDate = start.toISOString();
        if (estimate !== null) task.totalEstimatedTime = estimate;
        if (tagNames.length) task.tagNames = tagNames.slice(0, MAX_TAGS);
        custom.forEach((field) => {
            const value = customValue(field.type, row[field.column]);
            if (value !== null) task[`custom_${field.name}`] = { type: field.type, value };
        });
        return task;
    });

    // createCustomFields defines the project's fields from the first task's keys alone.
    if (tasks.length) {
        custom.forEach((field) => {
            const key = `custom_${field.name}`;
            if (!tasks[0][key]) tasks[0][key] = { type: field.type, value: null };
        });
    }

    return { tasks, skipped: skippedRows.length, skippedRows, unnamedAssignees: Array.from(unnamedAssignees) };
};

const customValue = (type, raw) => {
    const text = trimmed(raw);
    if (!text) return null;
    if (type === 'number') {
        const number = Number(text.replace(/[^0-9.-]/g, ''));
        return Number.isFinite(number) ? number : null;
    }
    if (type === 'date') {
        const date = parseClickUpDate(text);
        return date ? date.toISOString() : null;
    }
    return text.slice(0, 1000);
};

/* What an import would bring in, per ClickUp list, with nothing written. */
const previewClickUpRows = (rows) => {
    const headers = headersOf(rows);
    const index = columnIndex(headers);
    const lists = new Map();
    const tags = new Map();
    const emails = new Set();
    const names = new Set();
    const skippedRows = [];
    const ids = new Set((rows || []).filter((row) => !skipCode(row, index)).map((row) => cell(row, index, 'id')).filter(Boolean));

    (rows || []).forEach((row, i) => {
        const code = skipCode(row, index);
        if (code) {
            skippedRows.push(skipEntry(i, code));
            return;
        }
        const key = listKey(row, index);
        if (!lists.has(key)) {
            lists.set(key, {
                key,
                name: cell(row, index, 'list') || DEFAULT_LIST,
                folder: cell(row, index, 'folder'),
                space: cell(row, index, 'space'),
                rowIndexes: [],
                tasks: 0,
                subtasks: 0,
            });
        }
        const list = lists.get(key);
        list.rowIndexes.push(i);
        if (ids.has(cell(row, index, 'parent'))) list.subtasks += 1;
        else list.tasks += 1;
        parseList(cell(row, index, 'tags')).forEach((tag) => { if (!tags.has(lower(tag))) tags.set(lower(tag), tag); });
        parseList(cell(row, index, 'assignees')).forEach((person) => (person.includes('@') ? emails.add(person.toLowerCase()) : names.add(person)));
    });

    return {
        total: (rows || []).length,
        importable: (rows || []).length - skippedRows.length,
        skippedRows,
        lists: Array.from(lists.values()),
        statuses: clickUpStatuses(rows),
        tags: Array.from(tags.values()),
        customFields: customColumns(headers).map(({ name, type }) => ({ name, type })),
        assigneeEmails: Array.from(emails),
        unnamedAssignees: Array.from(names),
        ignoredColumns: ignoredColumns(headers),
    };
};

module.exports = {
    MAX_ROWS,
    DEFAULT_LIST,
    validateClickUpRows,
    validateClickUpInput,
    parseClickUpDate,
    parseEstimateMinutes,
    mapClickUpPriority,
    clickUpStatuses,
    resolveStatuses,
    transformClickUpRows,
    previewClickUpRows,
};
