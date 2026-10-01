const crypto = require('crypto');
const mongoose = require('mongoose');
const { ownOrNotPersonal } = require('../../PersonalList/ownership');
const { TASK_LIST, projectPermissions, taskListProjectIds } = require('../../../Config/rulePermissions');

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 50;
const MAX_LIST = 100;
const MAX_PROJECTS = 500;
const MAX_TEXT = 100;
const MAX_SEARCH = 200;
const MAX_CURSOR = 1024;
const OBJECT_ID = /^[a-f0-9]{24}$/i;
const PLAIN_ID = /^[A-Za-z0-9_-]{1,64}$/;
const UNASSIGNED = 'unassigned';

const GROUPS = Object.freeze(['none', 'status', 'assignee', 'project', 'priority', 'dueDate']);
const STATUS_TYPES = Object.freeze(['default_active', 'active', 'done', 'close', 'default_close']);
const DEFAULT_DIRECTION = Object.freeze({ updatedAt: 'desc', DueDate: 'asc' });
/* The direction _id takes next to an ascending sort key, as the two indexes of migration 067 store
 * it: { updatedAt: -1, _id: 1 } and { DueDate: 1, _id: 1 }. Following it, in either direction,
 * lets MongoDB read a page off the index instead of sorting every match in memory. */
const ID_BESIDE_ASCENDING = Object.freeze({ updatedAt: -1, DueDate: 1 });

const TASK_ACTIVE = 0;
const TASK_IN_CLOSED_PROJECT = 8;
const PROJECT_TRASHED = 1;
const PROJECT_ARCHIVED = 2;

const ROW_FIELDS = Object.freeze({
    TaskName: 1, TaskKey: 1, status: 1, statusKey: 1, statusType: 1, Task_Priority: 1, AssigneeUserId: 1,
    DueDate: 1, startDate: 1, ProjectID: 1, sprintId: 1, folderObjId: 1, TaskType: 1, TaskTypeKey: 1, tagsArray: 1,
    subTasks: 1, ancestors: 1, ParentTaskId: 1, isParentTask: 1, createdAt: 1, updatedAt: 1, extraLists: 1,
});

const TOP_KEYS = ['filter', 'group', 'sort', 'cursor', 'limit', 'includeSubtasks', 'includeClosedProjects', 'timezone'];
const FILTER_KEYS = ['status', 'statusType', 'assignee', 'priority', 'dueDate', 'taskType', 'tags', 'search', 'projectIds', 'sprintIds'];
const SORT_OPTION_KEYS = ['by', 'dir'];
const DUE_DATE_KEYS = ['from', 'to', 'none'];

class EverythingRefused extends Error {
    constructor(field, reason) {
        super(`${field} ${reason}`);
        this.name = 'EverythingRefused';
        this.field = field;
    }
}

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));

const onlyKeys = (value, allowed, path) => {
    const unknown = Object.keys(value).find((key) => !allowed.includes(key));
    if (unknown !== undefined) throw new EverythingRefused(path ? `${path}.${unknown}` : unknown, 'is not a known key');
};

const listOf = (value, field, max, accepts, what) => {
    if (value === undefined) return [];
    if (!Array.isArray(value)) throw new EverythingRefused(field, 'must be a list');
    if (value.length > max) throw new EverythingRefused(field, `takes at most ${max} entries`);
    if (!value.every(accepts)) throw new EverythingRefused(field, `takes ${what}`);
    return [...new Set(value)];
};

const isText = (value) => typeof value === 'string' && value.length > 0 && value.length <= MAX_TEXT;
const isKey = (value) => Number.isSafeInteger(value);
const isPlainId = (value) => typeof value === 'string' && PLAIN_ID.test(value);

const namesAndKeys = (value, field) => {
    const entries = listOf(value, field, MAX_LIST, (entry) => isText(entry) || isKey(entry), `names of at most ${MAX_TEXT} characters or whole-number keys`);
    if (!entries.length) return null;
    return { names: entries.filter((entry) => typeof entry === 'string'), keys: entries.filter((entry) => typeof entry === 'number') };
};

const someOf = (value, field, accepts, what) => {
    const entries = listOf(value, field, MAX_LIST, accepts, what);
    return entries.length ? entries : null;
};

const dateOf = (value, field) => {
    if (value === undefined || value === null) return null;
    const date = (typeof value === 'string' && value.length <= 40) || isKey(value) ? new Date(value) : null;
    if (!date || Number.isNaN(date.getTime())) throw new EverythingRefused(field, 'must be an ISO date or a time in milliseconds');
    return date;
};

const flagOf = (value, field) => {
    if (value === undefined) return false;
    if (typeof value !== 'boolean') throw new EverythingRefused(field, 'must be true or false');
    return value;
};

const dueDateOf = (value) => {
    if (value === undefined) return null;
    if (!isPlainObject(value)) throw new EverythingRefused('filter.dueDate', 'must be an object with from, to or none');
    onlyKeys(value, DUE_DATE_KEYS, 'filter.dueDate');
    const from = dateOf(value.from, 'filter.dueDate.from');
    const to = dateOf(value.to, 'filter.dueDate.to');
    const none = flagOf(value.none, 'filter.dueDate.none');
    if (none && (from || to)) throw new EverythingRefused('filter.dueDate', 'takes none or a range, not both');
    if (from && to && from > to) throw new EverythingRefused('filter.dueDate', 'must have from before to');
    return from || to || none ? { from, to, none } : null;
};

const assigneeOf = (value) => {
    const entries = listOf(value, 'filter.assignee', MAX_LIST, isPlainId, `user ids or "${UNASSIGNED}"`);
    if (!entries.length) return null;
    return { ids: entries.filter((entry) => entry !== UNASSIGNED), unassigned: entries.includes(UNASSIGNED) };
};

const searchOf = (value) => {
    if (value === undefined) return null;
    if (typeof value !== 'string' || value.length > MAX_SEARCH) throw new EverythingRefused('filter.search', `must be text of at most ${MAX_SEARCH} characters`);
    return value.trim() || null;
};

const projectIdsOf = (value) => {
    const ids = listOf(value, 'filter.projectIds', MAX_PROJECTS, (id) => typeof id === 'string' && OBJECT_ID.test(id), 'project ids');
    return ids.length ? [...new Set(ids.map((id) => id.toLowerCase()))] : null;
};

const sprintIdsOf = (value) => {
    const ids = listOf(value, 'filter.sprintIds', MAX_LIST, (id) => typeof id === 'string' && OBJECT_ID.test(id), 'list ids');
    return ids.length ? [...new Set(ids.map((id) => id.toLowerCase()))] : null;
};

const filterOf = (value) => {
    const filter = value === undefined ? {} : value;
    if (!isPlainObject(filter)) throw new EverythingRefused('filter', 'must be an object');
    onlyKeys(filter, FILTER_KEYS, 'filter');
    return {
        status: namesAndKeys(filter.status, 'filter.status'),
        statusType: someOf(filter.statusType, 'filter.statusType', (type) => STATUS_TYPES.includes(type), `any of ${STATUS_TYPES.join(', ')}`),
        assignee: assigneeOf(filter.assignee),
        priority: someOf(filter.priority, 'filter.priority', isText, 'priority names'),
        dueDate: dueDateOf(filter.dueDate),
        taskType: namesAndKeys(filter.taskType, 'filter.taskType'),
        tags: someOf(filter.tags, 'filter.tags', isPlainId, 'tag ids'),
        search: searchOf(filter.search),
        projectIds: projectIdsOf(filter.projectIds),
        sprintIds: sprintIdsOf(filter.sprintIds),
    };
};

const sortOf = (value) => {
    const sort = value === undefined ? {} : value;
    if (!isPlainObject(sort)) throw new EverythingRefused('sort', 'must be an object with by and dir');
    onlyKeys(sort, SORT_OPTION_KEYS, 'sort');
    const by = sort.by === undefined ? 'updatedAt' : sort.by;
    if (!Object.hasOwn(DEFAULT_DIRECTION, by)) throw new EverythingRefused('sort.by', `must be one of ${Object.keys(DEFAULT_DIRECTION).join(', ')}`);
    const dir = sort.dir === undefined ? DEFAULT_DIRECTION[by] : sort.dir;
    if (dir !== 'asc' && dir !== 'desc') throw new EverythingRefused('sort.dir', 'must be asc or desc');
    return { by, dir };
};

const limitOf = (value) => {
    if (value === undefined) return DEFAULT_LIMIT;
    if (!Number.isSafeInteger(value) || value < 1) throw new EverythingRefused('limit', 'must be a whole number of at least 1');
    return Math.min(value, MAX_LIMIT);
};

const timezoneOf = (value) => {
    if (value === undefined) return 'UTC';
    const refused = () => new EverythingRefused('timezone', 'must be an IANA timezone name');
    if (typeof value !== 'string' || !value || value.length > 64) throw refused();
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: value });
    } catch (error) {
        throw refused();
    }
    return value;
};

const cursorOf = (value) => {
    if (value === undefined || value === null) return null;
    if (typeof value !== 'string' || !value || value.length > MAX_CURSOR) throw new EverythingRefused('cursor', 'is not valid');
    return value;
};

const parseRequest = (body) => {
    const sent = body === undefined || body === null ? {} : body;
    if (!isPlainObject(sent)) throw new EverythingRefused('body', 'must be an object');
    onlyKeys(sent, TOP_KEYS, '');
    const group = sent.group === undefined ? 'none' : sent.group;
    if (!GROUPS.includes(group)) throw new EverythingRefused('group', `must be one of ${GROUPS.join(', ')}`);
    return {
        filter: filterOf(sent.filter),
        group,
        sort: sortOf(sent.sort),
        cursor: cursorOf(sent.cursor),
        limit: limitOf(sent.limit),
        includeSubtasks: flagOf(sent.includeSubtasks, 'includeSubtasks'),
        includeClosedProjects: flagOf(sent.includeClosedProjects, 'includeClosedProjects'),
        timezone: timezoneOf(sent.timezone),
    };
};

const objectId = (id) => new mongoose.Types.ObjectId(String(id));

const scopedProjectIds = (visibleIds, namedIds) => {
    if (!namedIds) return [...visibleIds];
    const named = new Set(namedIds.map((id) => String(id).toLowerCase()));
    return visibleIds.filter((id) => named.has(String(id).toLowerCase()));
};

const projectMatch = (projectIds, uid, includeClosedProjects) => ({
    _id: { $in: projectIds.map(objectId) },
    deletedStatusKey: { $nin: [PROJECT_TRASHED, PROJECT_ARCHIVED] },
    isRestrict: { $ne: true },
    ...(includeClosedProjects ? {} : { statusType: { $ne: 'close' } }),
    ...ownOrNotPersonal(uid),
});

/* The rule the List row applies (rowEditRights in the web app): a picker opens only when the task
 * list and the field are both set to edit, and never in a closed project. `permissionOf` is null
 * for an owner or an admin, whom no rule holds back. */
const rowEditRights = (project, permissionOf) => {
    const open = project.statusType !== 'close';
    const yes = (path) => !permissionOf || permissionOf(project, path) === true;
    const tasks = open && yes(TASK_LIST);
    return { status: tasks && yes('task.task_status'), priority: tasks && yes('task.task_priority') };
};

const anyOf = (clauses) => (clauses.length === 1 ? clauses[0] : { $or: clauses });
const inList = (field, values) => (values.length ? [{ [field]: { $in: values } }] : []);

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const filterClauses = (filter) => {
    const clauses = [];
    if (filter.status) clauses.push(anyOf([...inList('status.text', filter.status.names), ...inList('statusKey', filter.status.keys)]));
    if (filter.statusType) clauses.push({ statusType: { $in: filter.statusType } });
    if (filter.assignee) {
        clauses.push(anyOf([
            ...inList('AssigneeUserId', filter.assignee.ids),
            ...(filter.assignee.unassigned ? [{ AssigneeUserId: { $size: 0 } }, { AssigneeUserId: null }] : []),
        ]));
    }
    if (filter.priority) clauses.push({ Task_Priority: { $in: filter.priority } });
    if (filter.dueDate) {
        const { from, to, none } = filter.dueDate;
        clauses.push({ DueDate: none ? null : { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) } });
    }
    if (filter.taskType) clauses.push(anyOf([...inList('TaskType', filter.taskType.names), ...inList('TaskTypeKey', filter.taskType.keys)]));
    if (filter.tags) clauses.push({ tagsArray: { $in: filter.tags } });
    if (filter.search) clauses.push({ TaskName: { $regex: escapeRegex(filter.search), $options: 'i' } });
    if (filter.sprintIds) {
        const lists = filter.sprintIds.map(objectId);
        clauses.push({ $or: [{ sprintId: { $in: lists } }, { extraLists: { $elemMatch: { sprintId: { $in: lists } } } }] });
    }
    return clauses;
};

/* The scope fields sit at the top level and every filter under $and, so nothing a filter says can
 * take the place of a scope field. `projectIds` is what the caller can open, already narrowed, and
 * `filter.sprintIds` holds only lists the caller can open: a task is in a list as its home or as an
 * extra list, and the scope is judged on its home either way. */
const buildMatch = (request, { projectIds, hiddenSprintIds = [] }) => {
    const clauses = filterClauses(request.filter);
    return {
        ProjectID: { $in: projectIds },
        deletedStatusKey: request.includeClosedProjects ? { $in: [TASK_ACTIVE, TASK_IN_CLOSED_PROJECT] } : TASK_ACTIVE,
        mainChat: { $ne: true },
        ...(request.includeSubtasks ? {} : { isParentTask: true }),
        ...(hiddenSprintIds.length ? { sprintId: { $nin: hiddenSprintIds } } : {}),
        ...(clauses.length ? { $and: clauses } : {}),
    };
};

const withClauses = (match, clauses) => ({ ...match, $and: [...(match.$and || []), ...clauses] });

/* Rows that have the sort key come first, in its order; rows without it follow, by _id. MongoDB
 * would put the rows with no due date ahead of the soonest one, so each kind is read on its own:
 * `segment` is 'dated' or 'undated', and `after` is where the previous page stopped. */
const pagePipeline = (match, sort, { segment, after, limit }) => {
    const keyDirection = sort.dir === 'asc' ? 1 : -1;
    const idDirection = keyDirection * ID_BESIDE_ASCENDING[sort.by];
    const beyond = (direction, value) => ({ [direction > 0 ? '$gt' : '$lt']: value });
    const dated = segment === 'dated';
    const clauses = [];
    if (!dated) clauses.push({ [sort.by]: null });
    if (after && dated) {
        const value = new Date(after.value);
        /* The range says nothing the $or does not, but it is what lets the index seek to the
         * cursor; with the $or alone MongoDB walks every earlier key again on each page. */
        clauses.push({
            [sort.by]: { [keyDirection > 0 ? '$gte' : '$lte']: value },
            $or: [{ [sort.by]: beyond(keyDirection, value) }, { [sort.by]: value, _id: beyond(idDirection, objectId(after.id)) }],
        });
    } else if (after) {
        clauses.push({ _id: beyond(idDirection, objectId(after.id)) });
    } else if (dated) {
        clauses.push({ [sort.by]: { $type: 'date' } });
    }
    return [
        { $match: withClauses(match, clauses) },
        { $sort: dated ? { [sort.by]: keyDirection, _id: idDirection } : { _id: idDirection } },
        { $limit: limit },
        { $project: ROW_FIELDS },
    ];
};

const positionOf = (row, sort) => ({
    value: row[sort.by] instanceof Date ? row[sort.by].getTime() : null,
    id: String(row._id),
});

const GROUP_IDS = {
    none: () => null,
    status: () => '$status.text',
    assignee: () => '$AssigneeUserId',
    project: () => '$ProjectID',
    priority: () => '$Task_Priority',
    dueDate: (timezone) => ({ $dateToString: { format: '%Y-%m-%d', date: '$DueDate', timezone } }),
};

const groupPipeline = (match, { group, timezone }) => [
    { $match: match },
    ...(group === 'assignee' ? [{ $unwind: { path: '$AssigneeUserId', preserveNullAndEmptyArrays: true } }] : []),
    { $group: { _id: GROUP_IDS[group](timezone), count: { $sum: 1 } } },
    { $sort: { _id: 1 } },
];

const shapeGroups = (rows, group) => {
    if (group === 'none' && !rows.length) return [{ key: null, count: 0 }];
    return rows.map(({ _id, count }) => ({ key: _id === null || _id === undefined ? null : String(_id), count }));
};

/* What a cursor is good for: the same company, person, filter, sort and subtask and closed-project
 * switches. The page size and the grouping may change between pages; they do not move the rows. */
const queryBinding = ({ companyId, uid }, request) => crypto.createHash('sha256')
    .update(JSON.stringify([String(companyId), String(uid), request.filter, request.sort, request.includeSubtasks, request.includeClosedProjects]))
    .digest('base64url');

const signatureOf = (body, key) => crypto.createHmac('sha256', key).update(body).digest('base64url');

const encodeCursor = (position, binding, key) => {
    const body = Buffer.from(JSON.stringify({ v: position.value, i: position.id, q: binding })).toString('base64url');
    return `${body}.${signatureOf(body, key)}`;
};

const decodeCursor = (cursor, binding, key) => {
    const refused = () => new EverythingRefused('cursor', 'is not valid for this request');
    const [body, signature, extra] = String(cursor).split('.');
    if (!body || !signature || extra !== undefined) throw refused();
    const expected = Buffer.from(signatureOf(body, key));
    const given = Buffer.from(signature);
    if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) throw refused();
    let claims;
    try {
        claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    } catch (error) {
        throw refused();
    }
    const { v: value, i: id, q } = isPlainObject(claims) ? claims : {};
    if (q !== binding || typeof id !== 'string' || !OBJECT_ID.test(id)) throw refused();
    if (value !== null && !(Number.isSafeInteger(value) && !Number.isNaN(new Date(value).getTime()))) throw refused();
    return { value, id };
};

module.exports = {
    MAX_LIMIT,
    DEFAULT_LIMIT,
    GROUPS,
    STATUS_TYPES,
    ROW_FIELDS,
    EverythingRefused,
    parseRequest,
    scopedProjectIds,
    projectMatch,
    taskListProjectIds,
    projectPermissions,
    rowEditRights,
    buildMatch,
    pagePipeline,
    positionOf,
    groupPipeline,
    shapeGroups,
    queryBinding,
    encodeCursor,
    decodeCursor,
};
