const mongoose = require('mongoose');

/* More tasks than this are copied after the answer, as a job the client polls. */
const INLINE_TASK_LIMIT = 300;
const BATCH = 100;
const MAX_NAME = 255;
const JOB_SOURCE = 'duplicate';
const LIVE = 0;
const TRASHED = 1;

const INCLUDE_KEYS = ['tasks', 'assignees', 'dates'];
const OBJECT_ID = /^[a-f0-9]{24}$/i;
const HEX_RUN = /[a-f0-9]{24}/gi;

const PROJECT_SETTINGS = [
    'BillingPeriod', 'ProjectCurrency', 'ProjectRequiredComponent', 'ProjectRequiredDefaultComponent', 'ProjectType',
    'TaskTypeTemplateId', 'TemplateId', 'TemplateTaskStatusId', 'projectStatusTemplateId', 'apps', 'description', 'descriptionBlock',
    'isPrivateSpace', 'projectIcon', 'projectStatusData', 'status', 'statusType', 'sprintCadence', 'taskStatusData',
    'isGlobalPermission', 'workingDays', 'isRestrict', 'viewColumn', 'estimationScale', 'customField', 'tagsArray',
    'skills', 'aiGuide', 'autoArchive',
];
const PROJECT_DATES = ['StartDate', 'DueDate', 'EndDate', 'dueDateDeadLine'];

const LIST_FIELDS = ['name', 'private', 'AssigneeUserId', 'type', 'iconName', 'prefix', 'url', 'isScrum', 'isBacklog', 'goal'];
const LIST_DATES = ['startDate', 'endDate'];

const TASK_FIELDS = [
    'TaskName', 'TaskType', 'TaskTypeKey', 'status', 'statusKey', 'statusType', 'Task_Priority',
    'description', 'rawDescription', 'descriptionBlock', 'tagsArray', 'customField', 'totalEstimatedTime', 'points',
    'groupByAssigneeIndex', 'groupByPriorityIndex', 'groupByDueDateIndex', 'groupByStatusIndex',
];
const TASK_DATES = ['DueDate', 'startDate', 'dueDateDeadLine'];

const RULE_FIELDS = ['name', 'trigger', 'version', 'conditions', 'actions', 'steps', 'limits', 'reactToAutomation'];
const PERMISSION_FIELDS = ['dependency', 'desc', 'isParent', 'key', 'name', 'priorityIndex', 'roles', 'allowAdminForPrivateSpace', 'showAllTasks', 'showAllProjects'];

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;

const refusal = (statusText) => ({ ok: false, statusText });

const parseRequest = (body) => {
    if (!isPlainObject(body)) return refusal('A name and what to include are required.');
    const unknown = Object.keys(body).find((key) => key !== 'name' && key !== 'include');
    if (unknown) return refusal(`${unknown} is not something a duplicate takes.`);
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name || name.length > MAX_NAME) return refusal(`name is required, as text of at most ${MAX_NAME} characters.`);
    if (!isPlainObject(body.include)) return refusal('include is required: { tasks, assignees, dates }, each true or false.');
    const stray = Object.keys(body.include).find((key) => !INCLUDE_KEYS.includes(key));
    if (stray) return refusal(`include.${stray} is not something a duplicate takes.`);
    const notBoolean = INCLUDE_KEYS.find((key) => typeof body.include[key] !== 'boolean');
    if (notBoolean) return refusal(`include.${notBoolean} must be true or false.`);
    const { tasks, assignees, dates } = body.include;
    return { ok: true, name, include: { tasks, assignees, dates } };
};

/* The fields a schema refused, when that is why a save failed. */
const refusedPaths = (error) => (error && error.name === 'ValidationError' && error.errors ? Object.keys(error.errors) : []);

const newId = () => new mongoose.Types.ObjectId();
const idOf = (value) => String(value == null ? '' : value);
const pick = (source, fields) => Object.fromEntries(fields.filter((field) => source[field] !== undefined).map((field) => [field, source[field]]));

/* A deep copy in which every id of the source that the value names is the copy's id instead, wherever
   it sits: as a value, as a key, or inside a string such as an automation's "<projectId>:<statusKey>".
   Ids the map does not hold (people, statuses, custom fields) are left as they are. */
const remap = (value, ids) => {
    if (value == null) return value;
    if (value instanceof mongoose.Types.ObjectId) return ids.has(String(value)) ? new mongoose.Types.ObjectId(ids.get(String(value))) : value;
    if (typeof value === 'string') return value.replace(HEX_RUN, (hit) => ids.get(hit.toLowerCase()) || hit);
    if (Array.isArray(value)) return value.map((item) => remap(item, ids));
    if (!isPlainObject(value)) return value;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [remap(key, ids), remap(item, ids)]));
};

const NO_IDS = new Map();

const nextProjectCode = (sourceCode, taken) => {
    const base = String(sourceCode || 'PRJ').toUpperCase().replace(/[^A-Z0-9]/g, '') || 'PRJ';
    const used = new Set([...taken].map((code) => String(code || '').toUpperCase()));
    for (let n = 2; n < 1000; n += 1) {
        const suffix = String(n);
        const candidate = `${base.slice(0, Math.max(1, 6 - suffix.length))}${suffix}`;
        if (!used.has(candidate)) return candidate;
    }
    return `${base.slice(0, 2)}${Math.random().toString(16).slice(2, 6).toUpperCase()}`;
};

/* A project made before the currency was required, or by a path that skipped validation, may hold none, or an empty one. */
const hasCurrency = (project) => Boolean(project.ProjectCurrency) && typeof project.ProjectCurrency === 'object' && Boolean(project.ProjectCurrency.code);

const withCaller = (people, caller) => [...new Set([...(Array.isArray(people) ? people : []).map(String), String(caller)])];

/* What a copy is made from, for one person alone: a private project with only them on it and on each of its private
   lists, whoever is on the source. */
const forCallerAlone = (bundle, caller) => ({
    ...bundle,
    source: { ...bundle.source, isPrivateSpace: true, AssigneeUserId: [caller] },
    lists: bundle.lists.map((list) => (list.private === true ? { ...list, AssigneeUserId: [caller] } : list)),
});

/* The copy is a project of its own: no proposal id, favourites, watchers or activity of the source come with it. */
const projectCopy = (source, { id, name, code, caller, companyId, include, ids, currency = {} }) => ({
    ...remap(pick(source, PROJECT_SETTINGS), ids),
    ProjectCurrency: hasCurrency(source) ? source.ProjectCurrency : currency,
    ...(include.dates ? pick(source, PROJECT_DATES) : {}),
    _id: id,
    ProjectName: name,
    ProjectCode: code,
    CompanyId: new mongoose.Types.ObjectId(companyId),
    AssigneeUserId: source.isPrivateSpace === true ? withCaller(source.AssigneeUserId, caller) : (source.AssigneeUserId || []).map(String),
    LeadUserId: [caller],
    projectCreatedBy: caller,
    taskTypeCounts: (source.taskTypeCounts || []).map((type) => ({ ...type, taskCount: 0 })),
    lastTaskId: 0,
    deletedStatusKey: LIVE,
    source: 'other',
});

const isLive = (row) => Number(row.deletedStatusKey || 0) === LIVE;

/* Parents first, so a subfolder always finds the copy of its parent; one whose parent is not copied goes to the top. */
const folderCopies = (folders, projectId, ids) => {
    const live = folders.filter(isLive);
    const liveIds = new Set(live.map((folder) => idOf(folder._id)));
    live.forEach((folder) => ids.set(idOf(folder._id), String(newId())));
    const hasParent = (folder) => Boolean(folder.parentFolderId);
    const moved = [];
    const copies = [...live.filter((folder) => !hasParent(folder)), ...live.filter(hasParent)].map((folder) => {
        const copy = { _id: new mongoose.Types.ObjectId(ids.get(idOf(folder._id))), name: folder.name, projectId, deletedStatusKey: LIVE };
        if (!hasParent(folder)) return copy;
        if (liveIds.has(idOf(folder.parentFolderId))) return { ...copy, parentFolderId: new mongoose.Types.ObjectId(ids.get(idOf(folder.parentFolderId))) };
        moved.push(folder.name);
        return copy;
    });
    return { copies, moved };
};

/* A list in a folder that is not copied stays behind with it. */
const listCopies = (lists, projectId, ids, include) => lists
    .filter((list) => isLive(list) && (!list.folderId || ids.has(idOf(list.folderId))))
    .map((list) => {
        const id = newId();
        ids.set(idOf(list._id), String(id));
        return {
            ...remap(pick(list, LIST_FIELDS), NO_IDS),
            ...(include.dates ? pick(list, LIST_DATES) : {}),
            _id: id,
            projectId,
            tasks: 0,
            deletedStatusKey: LIVE,
            ...(list.folderId ? { folderId: new mongoose.Types.ObjectId(ids.get(idOf(list.folderId))) } : {}),
        };
    });

const ruleTargets = (rule, projectId) => {
    const scoped = rule.scope && rule.scope.allProjects === false && (rule.scope.projectIds || []).map(String).includes(projectId);
    const legacy = rule.conditions && idOf(rule.conditions.projectId) === projectId;
    return Boolean(scoped || legacy);
};

/* Switched off, so nothing fires on a copy before someone has looked at it. */
const ruleCopy = (rule, { projectId, caller, ids }) => ({
    ...remap(pick(rule, RULE_FIELDS), ids),
    _id: newId(),
    scope: { ...remap(rule.scope || {}, ids), allProjects: false, projectIds: [projectId] },
    enabled: false,
    stats: {},
    assignCursors: {},
    notifyWindows: {},
    lastRunCount: 0,
    createdBy: caller,
    deletedStatusKey: LIVE,
});

const permissionCopies = (rows, projectId) => {
    const ids = new Map(rows.map((row) => [idOf(row._id), String(newId())]));
    return rows.map((row) => ({
        ...remap(pick(row, PERMISSION_FIELDS), NO_IDS),
        _id: new mongoose.Types.ObjectId(ids.get(idOf(row._id))),
        parentId: ids.get(idOf(row.parentId)) || '',
        projectId,
    }));
};

const NOBODY = new Set();

/* A checklist as the copy stores it: each row's people are the ones in `kept`. */
const keepingPeople = (value, kept) => {
    if (Array.isArray(value)) return value.map((item) => keepingPeople(item, kept));
    if (!isPlainObject(value)) return value;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, key === 'AssigneeUserId'
        ? (Array.isArray(item) ? item : []).filter((id) => kept.has(String(id)))
        : keepingPeople(item, kept)]));
};

const withoutPeople = (value) => keepingPeople(value, NOBODY);

const peopleIn = (value) => {
    if (Array.isArray(value)) return value.flatMap(peopleIn);
    if (!isPlainObject(value)) return [];
    return Object.entries(value).flatMap(([key, item]) => (key === 'AssigneeUserId' ? (Array.isArray(item) ? item.map(String) : []) : peopleIn(item)));
};

/* Top-level tasks, then their subtasks, then theirs. A subtask whose parent is not among the rows is left out with everything under it. */
const taskLevels = (rows) => {
    const known = new Set(rows.map((row) => idOf(row._id)));
    const childrenOf = new Map();
    const tops = [];
    rows.forEach((row) => {
        const parent = idOf(row.ParentTaskId);
        if (!parent) { tops.push(row); return; }
        if (!known.has(parent)) return;
        childrenOf.set(parent, [...(childrenOf.get(parent) || []), row]);
    });
    const levels = [tops];
    while (levels[levels.length - 1].length) {
        levels.push(levels[levels.length - 1].flatMap((row) => childrenOf.get(idOf(row._id)) || []));
    }
    levels.pop();
    return { levels, childrenOf };
};

module.exports = {
    INLINE_TASK_LIMIT, BATCH, MAX_NAME, JOB_SOURCE, LIVE, TRASHED, OBJECT_ID, PROJECT_DATES, LIST_DATES, TASK_FIELDS, TASK_DATES,
    isPlainObject, refusal, parseRequest, refusedPaths, newId, idOf, pick, remap, nextProjectCode, forCallerAlone, projectCopy, hasCurrency,
    isLive, folderCopies, listCopies, ruleTargets, ruleCopy, permissionCopies, withoutPeople, keepingPeople, peopleIn, taskLevels,
};
