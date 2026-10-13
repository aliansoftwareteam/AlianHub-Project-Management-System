/* CommonJS on purpose: webpack consumes it in the app and root Jest loads it untranspiled, so the
   server's fixture test (tests/everything-fixture.test.js) sends exactly what the page sends. */
const OPEN_STATUS_TYPES = ['default_active', 'active'];
const PAGE_SIZE = 50;
const GROUPS = ['none', 'status', 'assignee', 'project', 'priority', 'dueDate'];
const MODES = ['list', 'board', 'table'];
const SORT_DIRECTION = { updatedAt: 'desc', DueDate: 'asc' };
const DUE_BUCKETS = ['overdue', 'today', 'week', 'later', 'none'];
const UNASSIGNED = 'unassigned';
const PRIORITY_ORDER = ['URGENT', 'HIGH', 'MEDIUM', 'LOW'];
const LIST_KEYS = ['status', 'assignee', 'priority', 'taskType', 'projectIds'];
const MAX_LIST = 100;
const MAX_TEXT = 100;
const MAX_SEARCH = 200;

const DEFAULT_SETTINGS = Object.freeze({
    mode: 'list', search: '', status: [], assignee: [], priority: [], taskType: [], projectIds: [], due: '',
    group: 'none', sortBy: 'updatedAt', sortDir: 'desc', showSubtasks: false, hideDone: true, includeClosed: false
});

const textList = (value) => (Array.isArray(value)
    ? [...new Set(value.filter((entry) => typeof entry === 'string' && entry && entry.length <= MAX_TEXT))].slice(0, MAX_LIST)
    : []);

/* What was saved in this browser may be from an older build or edited by hand; the server refuses
   an unknown key or value, so only what it would accept is kept. */
function cleanSettings(raw) {
    const saved = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const sortBy = Object.prototype.hasOwnProperty.call(SORT_DIRECTION, saved.sortBy) ? saved.sortBy : DEFAULT_SETTINGS.sortBy;
    const flag = (key) => (typeof saved[key] === 'boolean' ? saved[key] : DEFAULT_SETTINGS[key]);
    return {
        mode: MODES.includes(saved.mode) ? saved.mode : DEFAULT_SETTINGS.mode,
        search: typeof saved.search === 'string' ? saved.search.slice(0, MAX_SEARCH) : '',
        ...Object.fromEntries(LIST_KEYS.map((key) => [key, textList(saved[key])])),
        due: DUE_BUCKETS.includes(saved.due) ? saved.due : '',
        group: GROUPS.includes(saved.group) ? saved.group : DEFAULT_SETTINGS.group,
        sortBy,
        sortDir: saved.sortDir === 'asc' || saved.sortDir === 'desc' ? saved.sortDir : SORT_DIRECTION[sortBy],
        showSubtasks: flag('showSubtasks'),
        hideDone: flag('hideDone'),
        includeClosed: flag('includeClosed')
    };
}

const dayFormat = (timeZone) => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
const dayKey = (instant, timeZone) => dayFormat(timeZone).format(instant);

function addDays(key, days) {
    const [year, month, day] = key.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

const weekdayOf = (key) => new Date(`${key}T00:00:00Z`).getUTCDay();

function zoneOffset(instant, timeZone) {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
    }).formatToParts(instant);
    const at = Object.fromEntries(parts.map((part) => [part.type, Number(part.value)]));
    return Date.UTC(at.year, at.month - 1, at.day, at.hour, at.minute, at.second) - Math.floor(instant.getTime() / 1000) * 1000;
}

/* Midnight of a calendar day in a timezone, as an instant. The offset is read twice because the
   first guess can sit on the other side of a daylight-saving change. */
function dayStart(key, timeZone) {
    const asUtc = Date.parse(`${key}T00:00:00Z`);
    const guess = asUtc - zoneOffset(new Date(asUtc), timeZone);
    return asUtc - zoneOffset(new Date(guess), timeZone);
}

/* The same buckets the project List groups by (dueDateBuckets): the week runs to Saturday, and on a
   Saturday there is no "this week" left. Each bucket carries the filter that asks for its rows. */
function dueWindows(now, timeZone) {
    const today = dayKey(now, timeZone);
    const tomorrow = addDays(today, 1);
    const nextWeek = addDays(today, 7 - weekdayOf(today));
    const iso = (ms) => new Date(ms).toISOString();
    const start = (key) => dayStart(key, timeZone);
    const filters = {
        overdue: { to: iso(start(today) - 1) },
        today: { from: iso(start(today)), to: iso(start(tomorrow) - 1) },
        later: { from: iso(start(nextWeek)) },
        none: { none: true }
    };
    if (nextWeek > tomorrow) filters.week = { from: iso(start(tomorrow)), to: iso(start(nextWeek) - 1) };
    return { today, nextWeek, filters };
}

function bucketOfDay(key, windows) {
    if (key === null || key === undefined) return 'none';
    if (key < windows.today) return 'overdue';
    if (key === windows.today) return 'today';
    return key < windows.nextWeek ? 'week' : 'later';
}

function foldDueDays(groups, now, timeZone) {
    const windows = dueWindows(now, timeZone);
    const counts = {};
    (groups || []).forEach(({ key, count }) => {
        const bucket = bucketOfDay(key, windows);
        counts[bucket] = (counts[bucket] || 0) + count;
    });
    return DUE_BUCKETS.filter((id) => counts[id]).map((id) => ({ id, count: counts[id] }));
}

function baseRequest(settings, { now, timeZone }) {
    const filter = {};
    if (settings.status.length) filter.status = settings.status;
    if (settings.hideDone) filter.statusType = OPEN_STATUS_TYPES;
    if (settings.assignee.length) filter.assignee = settings.assignee;
    if (settings.priority.length) filter.priority = settings.priority;
    const due = settings.due ? dueWindows(now, timeZone).filters[settings.due] : null;
    if (due) filter.dueDate = due;
    if (settings.taskType.length) filter.taskType = settings.taskType;
    const search = settings.search.trim();
    if (search) filter.search = search;
    if (settings.projectIds.length) filter.projectIds = settings.projectIds;
    return {
        filter,
        sort: { by: settings.sortBy, dir: settings.sortDir },
        includeSubtasks: settings.showSubtasks,
        includeClosedProjects: settings.includeClosed,
        timezone: timeZone
    };
}

/* A board's columns are statuses, whatever the list is grouped by. */
const queryGroup = (settings) => (settings.mode === 'board' ? 'status' : settings.group);

/* The first request of a query: the counts, and for an ungrouped list the first page with them. */
function firstRequest(settings, context, pageSize = PAGE_SIZE) {
    const base = baseRequest(settings, context);
    const kind = queryGroup(settings);
    return kind === 'none' ? { ...base, limit: pageSize } : { ...base, group: kind, limit: 1 };
}

const within = (range, bounds) => {
    if (!bounds || bounds.none || range.none) return range;
    const from = [range.from, bounds.from].filter(Boolean).sort().pop();
    const to = [range.to, bounds.to].filter(Boolean).sort().shift();
    return { ...(from ? { from } : {}), ...(to ? { to } : {}) };
};

const group = (id, key, count, filter) => ({ id, key, count, filter });

const byPriority = (a, b) => {
    const rank = (key) => (PRIORITY_ORDER.includes(key) ? PRIORITY_ORDER.indexOf(key) : PRIORITY_ORDER.length);
    return rank(a.key) - rank(b.key) || String(a.key).localeCompare(String(b.key));
};

/* The groups a response's counts make, each with the filter that asks the server for its rows:
   a page inside a group is the same query narrowed to that group. */
function groupsFrom(counts, settings, context) {
    const list = Array.isArray(counts) ? counts.filter((entry) => entry.count > 0) : [];
    const kind = queryGroup(settings);
    if (kind === 'none') return [group('all', null, list.reduce((sum, entry) => sum + entry.count, 0), {})];
    if (kind === 'status') return list.filter((e) => e.key !== null).map((e) => group(`status:${e.key}`, e.key, e.count, { status: [e.key] }));
    if (kind === 'project') return list.filter((e) => e.key !== null).map((e) => group(`project:${e.key}`, e.key, e.count, { projectIds: [e.key] }));
    if (kind === 'priority') {
        return list.filter((e) => e.key !== null).map((e) => group(`priority:${e.key}`, e.key, e.count, { priority: [e.key] })).sort(byPriority);
    }
    if (kind === 'assignee') {
        const wanted = settings.assignee;
        return list
            .map((e) => ({ ...e, value: e.key === null ? UNASSIGNED : e.key }))
            // A task counts under each of its assignees, so a filtered count names people outside the filter too.
            .filter((e) => !wanted.length || wanted.includes(e.value))
            .map((e) => group(`assignee:${e.value}`, e.key, e.count, { assignee: [e.value] }))
            .sort((a, b) => (a.key === null) - (b.key === null));
    }
    const windows = dueWindows(context.now, context.timeZone);
    const chosen = settings.due ? windows.filters[settings.due] : null;
    return foldDueDays(list, context.now, context.timeZone)
        .filter((bucket) => windows.filters[bucket.id])
        .map((bucket) => group(`dueDate:${bucket.id}`, bucket.id, bucket.count, { dueDate: within(windows.filters[bucket.id], chosen) }));
}

const STATUS_KINDS = [['default_active', 'default'], ['active'], ['done', 'close', 'default_close']];
const statusRank = (type) => {
    const rank = STATUS_KINDS.findIndex((types) => types.includes(type));
    return rank === -1 ? 1 : rank;
};

/* The board's columns: one per status name, merged across projects. A status no task holds yet
   still gets a column, so a card has somewhere to be dropped; with done work hidden the closed
   statuses get none. `statuses` is every status of the projects the person can see. */
function boardColumns(groups, statuses, settings) {
    const typeOf = new Map();
    (statuses || []).forEach((status) => { if (status && status.name && !typeOf.has(status.name)) typeOf.set(status.name, status.type); });
    const counted = new Set(groups.map((entry) => entry.key));
    const wanted = (name) => !settings.status.length || settings.status.includes(name);
    const open = (type) => !settings.hideDone || OPEN_STATUS_TYPES.includes(type);
    const empty = [...typeOf.keys()]
        .filter((name) => !counted.has(name) && wanted(name) && open(typeOf.get(name)))
        .map((name) => group(`status:${name}`, name, 0, { status: [name] }));
    return [...groups, ...empty].sort((a, b) => statusRank(typeOf.get(a.key)) - statusRank(typeOf.get(b.key)) || String(a.key).localeCompare(String(b.key)));
}

/* A card may land in a column only when its own project has a status of that name. */
function dropDecision(task, project, columnName) {
    if (task.status && task.status.text === columnName) return { allowed: false, reason: 'same' };
    if (!project || !project.edit || project.edit.status !== true) return { allowed: false, reason: 'no_permission' };
    const status = (project.taskStatusData || []).find((entry) => entry.name === columnName);
    return status ? { allowed: true, status } : { allowed: false, reason: 'no_status' };
}

/* Which group a row belongs to under the current grouping, for the groups an inline edit can move it between. */
function groupIdOf(kind, row) {
    if (kind === 'status') return `status:${row.status ? row.status.text : ''}`;
    if (kind === 'priority') return `priority:${row.Task_Priority}`;
    return null;
}

const sameSettings = (a, b) => JSON.stringify(cleanSettings(a)) === JSON.stringify(cleanSettings(b));

/* What a saved view is sent as: a name and the page's settings, cleaned the same way. */
const viewBody = (name, settings) => ({ name, settings: cleanSettings(settings) });

function viewPatch({ name, isDefault, settings }) {
    return {
        ...(name === undefined ? {} : { name }),
        ...(isDefault === undefined ? {} : { isDefault }),
        ...(settings === undefined ? {} : { settings: cleanSettings(settings) })
    };
}

function groupRequest(base, groupFilter, { cursor = null, limit = PAGE_SIZE } = {}) {
    return { ...base, filter: { ...base.filter, ...groupFilter }, limit, ...(cursor ? { cursor } : {}) };
}

module.exports = {
    OPEN_STATUS_TYPES, PAGE_SIZE, GROUPS, MODES, SORT_DIRECTION, DUE_BUCKETS, UNASSIGNED, DEFAULT_SETTINGS,
    cleanSettings, sameSettings, dayKey, dueWindows, foldDueDays, baseRequest, firstRequest, queryGroup, groupsFrom, groupRequest,
    boardColumns, dropDecision, groupIdOf, viewBody, viewPatch
};
