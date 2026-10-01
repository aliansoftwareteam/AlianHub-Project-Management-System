// ClickUp-import rules. Pure — no I/O — shared by the controller and the tests.
// Input: rows parsed client-side from ClickUp's CSV/Excel export ("Export view"
// or the workspace export), each row a { header: value } map.
// A ClickUp List becomes a sprint: into the chosen sprint of an existing project,
// or into a new project named after the list (one project per list).
const { isObjectIdString } = require('./jiraRules');
const { parseClickUpDate, parseComments, parseChecklists, parseAttachmentLinks } = require('./clickupDetails');
const { fieldTypeOf } = require('./clickupFields');

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
    attachments: ['attachments'],
    checklists: ['checklists'],
    comments: ['comments'],
};

const KNOWN = new Set([
    ...Object.values(COLUMNS).flat(),
    'task custom id', 'date created', 'date created text', 'date updated', 'date updated text', 'date closed', 'date closed text',
    'date done', 'date done text', 'assigned comments', 'time spent', 'time spent text',
    'rolled up time', 'rolled up time text', 'time logged', 'time logged text', 'time logged rolled up with subtasks',
    'time logged rolled up with subtasks text', 'list id', 'folder id', 'space id', 'task type', 'watchers', 'creator', 'created by',
    'latest comment', 'points', 'sprint points', 'linked tasks', 'dependencies', 'url', 'task url', 'task link', 'subtask ids',
]);

// ClickUp names each custom-field column "<field> (<type>)".
const CUSTOM_COLUMN = /^(.+?)\s*\(([a-z_ ]+)\)\s*$/i;

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
    return match ? [{ column: header, name: match[1].trim().slice(0, 80), ...fieldTypeOf(match[2]) }] : [];
});

const ignoredColumns = (headers) => {
    const custom = new Set(customColumns(headers).map((field) => field.column));
    return headers.filter((header) => !KNOWN.has(lower(header)) && !custom.has(header));
};

const READ = new Set(Object.values(COLUMNS).flat());

/* The columns ClickUp is known to write that the importer does not bring in. */
const unreadColumns = (headers) => headers.filter((header) => KNOWN.has(lower(header)) && !READ.has(lower(header)));

const cell = (row, index, key) => trimmed(index[key] ? row[index[key]] : '');

const parseList = (raw) => trimmed(raw).replace(/^\[|\]$/g, '').split(/[,;]/).map((entry) => entry.trim().replace(/^["']|["']$/g, '')).filter(Boolean);

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

const SKIP_REASONS = { no_name: 'The task has no name.', repeated_id: 'A row above has the same task id.' };
const skipEntry = (i, code) => ({ row: i + 1, code, reason: SKIP_REASONS[code] });

/* Why each row is left out, by its place in `rows`: it has no name, or a named row above it holds the same task id. */
const skipCodes = (rows, index) => {
    const seen = new Set();
    return (rows || []).map((row) => {
        if (!cell(row, index, 'name')) return 'no_name';
        const id = cell(row, index, 'id');
        if (id && seen.has(id)) return 'repeated_id';
        if (id) seen.add(id);
        return '';
    });
};

const DATE_PAIRS = Object.freeze([['due', 'dueText'], ['start', 'startText']]);
const DATE_KEYS = DATE_PAIRS.flat();
const NUMERIC_DATE = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/;

/* The date columns whose all-number dates only make sense day first: one of them has a day past the twelfth and none
 * has a month past it. A column that mixes both orders is neither, and its day-first dates are reported unread. */
const dayFirstColumns = (rows, index) => DATE_KEYS.filter((key) => {
    const parts = (rows || []).map((row) => NUMERIC_DATE.exec(cell(row, index, key))).filter(Boolean);
    return parts.some((part) => Number(part[1]) > 12) && parts.every((part) => Number(part[1]) <= 31 && Number(part[2]) <= 12);
});

const dayFirstFrom = (given, rows, index) => new Set(Array.isArray(given) ? given.filter((key) => DATE_KEYS.includes(key)) : dayFirstColumns(rows, index));

const readDate = (raw, dayFirst) => {
    const numeric = dayFirst ? NUMERIC_DATE.exec(trimmed(raw)) : null;
    if (!numeric) return parseClickUpDate(raw);
    const [day, month, year] = [Number(numeric[1]), Number(numeric[2]), Number(numeric[3])];
    const date = new Date(year, month - 1, day);
    return date.getDate() === day ? date : null;
};

/* Each date of a row, read from its number column or else its text column, and the cell it could not read. */
const datesOf = (row, index, dayFirst) => {
    const dates = {};
    const unread = [];
    DATE_PAIRS.forEach(([first, second]) => {
        const read = readDate(cell(row, index, first), dayFirst.has(first)) || readDate(cell(row, index, second), dayFirst.has(second));
        dates[first] = read;
        const written = [first, second].find((key) => cell(row, index, key));
        if (!read && written) unread.push({ column: index[written], value: cell(row, index, written).slice(0, 100) });
    });
    return { dates, unread };
};

const fieldCellsOf = (row, custom) => Object.fromEntries(custom
    .map((field) => [field.column, trimmed(row[field.column])])
    .filter(([, value]) => value));

/* Transform ClickUp rows into createMultipleTasks input. `statusFor` maps a ClickUp
 * status name to the project status to use. Assignees travel as emails and are
 * resolved later among the company's members only. Each row keeps the parent the file
 * names: the create path orders the levels and re-hangs what does not fit in three.
 * Comments, checklists, attachment links and field cells ride on the task as read;
 * `fields` lists the file's field columns for the importer to plan. A row with a task id carries it as
 * `importSourceId`. `dayFirst` names the date columns to read day first; left out, the rows decide.
 * `unreadDates` lists each date cell that could not be read, by the row's place in `rows`. */
const transformClickUpRows = ({ rows, statusFor, leaderId, dayFirst }) => {
    const headers = headersOf(rows);
    const index = columnIndex(headers);
    const custom = customColumns(headers);
    const skippedRows = [];
    const unreadDates = [];
    const kept = [];
    const dayFirstKeys = dayFirstFrom(dayFirst, rows, index);

    skipCodes(rows, index).forEach((code, i) => {
        if (code) skippedRows.push(skipEntry(i, code));
        else kept.push({ row: rows[i], place: i + 1, sourceId: cell(rows[i], index, 'id') });
    });

    const unnamedAssignees = new Set();

    const tasks = kept.map(({ row, place, sourceId }) => {
        const id = sourceId || `row-${place}`;
        const people = parseList(cell(row, index, 'assignees'));
        people.filter((person) => !person.includes('@')).forEach((person) => unnamedAssignees.add(person));
        const { dates: { due, start }, unread } = datesOf(row, index, dayFirstKeys);
        unread.forEach((entry) => unreadDates.push({ row: place, name: cell(row, index, 'name').slice(0, 200), ...entry }));
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
            ParentTaskId: cell(row, index, 'parent'),
            emptyCells: ['status', 'priority'].filter((key) => !cell(row, index, key)),
        };
        if (sourceId) task.importSourceId = sourceId;
        if (start) task.startDate = start.toISOString();
        if (estimate !== null) task.totalEstimatedTime = estimate;
        if (tagNames.length) task.tagNames = tagNames.slice(0, MAX_TAGS);
        const details = {
            fieldCells: fieldCellsOf(row, custom),
            comments: parseComments(cell(row, index, 'comments')),
            checklists: parseChecklists(cell(row, index, 'checklists')),
            links: parseAttachmentLinks(cell(row, index, 'attachments')),
        };
        Object.entries(details).forEach(([key, value]) => { if (Object.keys(value).length) task[key] = value; });
        return task;
    });

    return { tasks, fields: custom, skipped: skippedRows.length, skippedRows, unreadDates, unnamedAssignees: Array.from(unnamedAssignees) };
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
    const unreadDates = [];
    const codes = skipCodes(rows, index);
    const dayFirst = dayFirstColumns(rows, index);
    const dayFirstKeys = new Set(dayFirst);
    /* Each list is imported on its own, so a subtask whose parent sits in another list arrives as a task. */
    const listOfId = new Map((rows || []).filter((row, i) => !codes[i] && cell(row, index, 'id')).map((row) => [cell(row, index, 'id'), listKey(row, index)]));

    (rows || []).forEach((row, i) => {
        const code = codes[i];
        if (code) {
            skippedRows.push(skipEntry(i, code));
            return;
        }
        datesOf(row, index, dayFirstKeys).unread.forEach((entry) => unreadDates.push({ row: i + 1, name: cell(row, index, 'name').slice(0, 200), ...entry }));
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
        if (listOfId.get(cell(row, index, 'parent')) === key) list.subtasks += 1;
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
        unreadDates,
        dayFirstColumns: dayFirst,
        unreadColumns: unreadColumns(headers),
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
