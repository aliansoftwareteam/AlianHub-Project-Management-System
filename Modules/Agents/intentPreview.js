const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { oid } = require('../Automations/engine/tools');
const names = require('../Mcp/names');
const { readableTaskIds } = require('../Tasks/helpers/taskWritePlacement');
const { isTaskFieldOf } = require('../CustomField/helpers/fieldValueInput');
const setup = require('./setupRequests');
const computed = require('./computedFields');
const plans = require('./projectSetup');
const projects = require('./projectCreate');
const planChoice = require('./planChoice');
const planFiling = require('./planFiling');
const planLocks = require('./planLocks');
const planShown = require('./planShown');
const planWorkPreview = require('./planWorkPreview');
const automation = require('./automationPreview');
const listSetup = require('./listSetupPreview');
const projectCopy = require('./projectDuplicatePreview');
const dashboards = require('./dashboardRequests');

// What a waiting change will make, as the lines its card shows (frontend IntentPreview). It is built for one viewer:
// a project, list, parent task, person or custom field is named only when that viewer may see it, and everything
// else on a line is the proposal's own text, handed over as text. Fields, a view and a whole plan, with its automations and first tasks, are the project's own,
// so for a viewer who cannot open the project they have no preview at all, and neither has a rule (./automationPreview.js),
// a folder or a list made a sprint (./listSetupPreview.js), or a copy of a project (./projectDuplicatePreview.js).
// A project that is not there yet has no project to open: its card is the proposal's own text, for whoever is shown the proposal.
// A card for a dashboard is previewed only for a viewer who can open that dashboard (./dashboardRequests.js).
// A kind of change with no entry in BUILDERS has none.
// A connected agent's batch is several changes on one card (forBatches): how many tasks, what changes on them, the
// first few tasks by name with the rest behind "show all", and a line for each change whose value the lines above
// do not already say.

const DESCRIPTION_MAX = 280;
const TEXT_MAX = 250;
const OBJECT_ID = /^[a-f0-9]{24}$/i;

const idOf = (value) => { const text = String(value === undefined || value === null ? '' : value); return OBJECT_ID.test(text) ? text : ''; };
const textOf = (value, max = TEXT_MAX) => (typeof value === 'string' || typeof value === 'number' ? String(value).trim().slice(0, max) : '');
const paramsOf = (change) => (change && change.params && typeof change.params === 'object' ? change.params : {});

const detailedFields = (params) => (params.fields && typeof params.fields === 'object' ? params.fields : {});
const simpleFields = (params) => ({ rawDescription: params.description, Task_Priority: params.priority });
const CREATES = Object.freeze({
    'task.add': { kind: 'task', fields: detailedFields },
    'task.create': { kind: 'task', fields: simpleFields },
    'subtask.add': { kind: 'subtask', fields: detailedFields },
    'subtask.create': { kind: 'subtask', fields: () => ({}) },
});
const isCreate = (change) => Boolean(change) && Object.hasOwn(CREATES, change.action);

const peopleOf = (fields) => (Array.isArray(fields.AssigneeUserId) ? fields.AssigneeUserId.map(idOf).filter(Boolean) : []);

const placeLine = (params, named) => {
    const projectId = idOf(params.projectId);
    const project = projectId ? named.project(projectId).name : null;
    if (!project) return null;
    const sprintId = idOf(params.sprintId);
    return { kind: 'place', project, list: (sprintId && named.sprint(sprintId, projectId).name) || '' };
};

const assigneesLine = (fields, projectId, named) => {
    const ids = peopleOf(fields);
    if (!ids.length) return null;
    const shown = ids.map((id) => named.person(id, projectId).name).filter(Boolean);
    return { kind: 'assignees', names: shown, others: ids.length - shown.length };
};

const descriptionLine = (fields) => {
    const text = typeof fields.rawDescription === 'string' ? fields.rawDescription.trim() : '';
    return text ? { kind: 'description', text: text.slice(0, DESCRIPTION_MAX), more: text.length > DESCRIPTION_MAX } : null;
};

const detailLines = (fields) => [
    textOf(fields.DueDate, 40) && { kind: 'due', date: textOf(fields.DueDate, 40) },
    textOf(fields.startDate, 40) && { kind: 'start', date: textOf(fields.startDate, 40) },
    textOf(fields.Task_Priority, 10) && { kind: 'priority', value: textOf(fields.Task_Priority, 10).toUpperCase() },
    textOf(fields.status, 60) && { kind: 'status', name: textOf(fields.status, 60) },
    textOf(fields.TaskType, 60) && { kind: 'type', name: textOf(fields.TaskType, 60) },
    Number(fields.totalEstimatedTime) > 0 && { kind: 'estimate', minutes: Math.round(Number(fields.totalEstimatedTime)) },
    descriptionLine(fields),
    Array.isArray(fields.links) && fields.links.length > 0 && { kind: 'links', count: fields.links.length },
];

const createPreview = (change, { named, tasks }) => {
    const create = CREATES[change.action];
    const params = paramsOf(change);
    const fields = create.fields(params);
    const parent = create.kind === 'subtask' ? tasks.get(idOf(params.taskId)) : null;
    const projectId = create.kind === 'subtask' ? (parent ? parent.projectId : '') : idOf(params.projectId);
    return {
        kind: create.kind,
        title: textOf(params.title),
        lines: [
            create.kind === 'subtask' ? parent && { kind: 'parent', task: parent.name } : placeLine(params, named),
            assigneesLine(fields, projectId, named),
            ...detailLines(fields),
        ].filter(Boolean),
    };
};

const listOf = (value) => (Array.isArray(value) ? value : []);
const objectOf = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});

const fieldLine = (given) => {
    const field = objectOf(given);
    const name = textOf(field.name, setup.FIELD_NAME_MAX);
    if (!name) return null;
    if (computed.isComputed(field.type)) return computed.lineOf(name, field);
    return {
        kind: 'field', name, type: setup.FIELD_TYPES.includes(field.type) ? field.type : '',
        options: listOf(field.options).map((option) => textOf(option, setup.OPTION_MAX)).filter(Boolean).slice(0, setup.OPTIONS_MAX),
    };
};

const FIELDS = 'fields.create';
const valuesIn = (change) => (change.action === FIELDS ? listOf(paramsOf(change).values).slice(0, setup.VALUES_MAX).map(objectOf) : []);
const partsOf = (value) => [].concat(value).filter((part) => typeof part === 'string' || typeof part === 'number');
const peopleIn = (value) => partsOf(value).map(idOf).filter(Boolean);

/* A first value, on a task of the project the viewer can read; a member is shown by name, and one the viewer may not see is counted. */
const valueLine = (entry, projectId, { named, tasks }) => {
    const field = textOf(entry.field, setup.FIELD_NAME_MAX);
    const task = tasks.get(idOf(entry.taskId));
    if (!field || !task || task.projectId !== projectId) return null;
    if (typeof entry.value === 'boolean') return { kind: 'fieldValue', field, task: task.name, checked: entry.value };
    const parts = partsOf(entry.value);
    const shown = parts.map((part) => (idOf(part) ? named.person(idOf(part), projectId).name : textOf(part))).filter(Boolean);
    return { kind: 'fieldValue', field, task: task.name, value: shown.join(', ').slice(0, TEXT_MAX), others: parts.length - shown.length };
};

const fieldsPreview = (change, context) => {
    const params = paramsOf(change);
    const place = placeLine(params, context.named);
    if (!place) return null;
    const fields = listOf(params.definitions).slice(0, setup.FIELDS_MAX).map(fieldLine).filter(Boolean);
    const asked = valuesIn(change);
    const values = asked.map((entry) => valueLine(entry, idOf(params.projectId), context)).filter(Boolean);
    const hidden = asked.length - values.length;
    return {
        kind: 'fields',
        title: fields.map((field) => field.name).join(', ').slice(0, TEXT_MAX),
        lines: [place, ...fields, ...values, ...(hidden ? [{ kind: 'fieldValuesHidden', count: hidden }] : [])],
    };
};

const PLAN = 'project.setup';
const PLANS = Object.freeze([PLAN, projects.ACTION]);
const planViews = (change) => listOf(paramsOf(change).views).slice(0, plans.VIEWS_MAX).map(objectOf);
/* The looks a waiting change names: a view's own, or one for each view of a plan. */
const looksOf = (change) => (PLANS.includes(change.action) ? planViews(change).map((view) => objectOf(view.look)) : [objectOf(paramsOf(change).look)]);
const namedFieldIds = (look) => [look.groupBy, look.sortBy, ...listOf(look.showFieldIds)].map(idOf).filter(Boolean);

/* A built-in choice by its key, a custom field by its name, and nothing for a field the viewer's project does not have. */
const chosen = (choices, value, fieldName) => {
    if (Object.hasOwn(choices, String(value))) return { by: String(value), field: '' };
    const field = fieldName(idOf(value));
    return field ? { by: '', field } : null;
};

const dueLine = (look) => {
    const kept = setup.lookOf({ due: look.due, dueFrom: look.dueFrom, dueTo: look.dueTo });
    if (kept.dueFrom) return { kind: 'dueFilter', from: kept.dueFrom, to: kept.dueTo };
    return kept.due ? { kind: 'dueFilter', when: kept.due } : null;
};

/* What a view shows, line by line; `planned` are fields of the same plan it shows, which have a name and no id yet. */
const lookLines = (look, projectId, { named, fieldNames }, planned = []) => {
    const fieldName = (id) => (id && fieldNames.get(`${projectId}:${id.toLowerCase()}`)) || '';
    const group = look.groupBy !== undefined ? chosen(setup.GROUPS, look.groupBy, fieldName) : null;
    const sort = look.sortBy !== undefined ? chosen(setup.SORTS, look.sortBy, fieldName) : null;
    const statuses = listOf(look.statuses).map((name) => textOf(name, setup.LOOK_MAX.status)).filter(Boolean);
    const priorities = listOf(look.priorities).filter((value) => setup.PRIORITIES.includes(value));
    const columns = listOf(look.showFieldIds).map(idOf).filter(Boolean);
    const shown = [...columns.map(fieldName).filter(Boolean), ...planned];
    return [
        group && { kind: 'group', ...group },
        sort && { kind: 'sort', ...sort, descending: look.sortDirection === 'desc' },
        look.mine === true && { kind: 'mine' },
        assigneesLine({ AssigneeUserId: look.assigneeIds }, projectId, named),
        statuses.length > 0 && { kind: 'statuses', names: statuses },
        priorities.length > 0 && { kind: 'priorities', values: priorities },
        dueLine(look),
        textOf(look.search, setup.LOOK_MAX.search) && { kind: 'search', text: textOf(look.search, setup.LOOK_MAX.search) },
        columns.length + planned.length > 0 && { kind: 'columns', names: shown, others: columns.length + planned.length - shown.length },
    ];
};

const viewPreview = (change, context) => {
    const params = paramsOf(change);
    const place = placeLine(params, context.named);
    if (!place) return null;
    return {
        kind: 'view',
        title: textOf(params.name, setup.VIEW_NAME_MAX),
        lines: [
            place,
            Object.hasOwn(setup.VIEW_KINDS, String(params.kind)) && { kind: 'layout', value: String(params.kind) },
            ...lookLines(objectOf(params.look), idOf(params.projectId), context),
        ].filter(Boolean),
    };
};

const { keyOf } = planChoice;

const namesLine = (kind, part, given, max, nameMax) => {
    const kept = listOf(given).slice(0, max).map((name, at) => ({ name: textOf(name, nameMax), pick: keyOf(part, at) })).filter((entry) => entry.name);
    return kept.length > 0 && { kind, names: kept.map((entry) => entry.name), picks: kept.map((entry) => entry.pick) };
};

const picked = (line, pick) => line && { ...line, pick };

const planViewLines = (view, at, projectId, context) => {
    const name = textOf(view.name, setup.VIEW_NAME_MAX);
    if (!name) return [];
    const planned = listOf(view.showFields).map((field) => textOf(field, setup.FIELD_NAME_MAX)).filter(Boolean);
    const pick = keyOf('views', at);
    return [
        { kind: 'planView', name, layout: Object.hasOwn(setup.VIEW_KINDS, String(view.kind)) ? String(view.kind) : '', pick },
        ...lookLines(objectOf(view.look), projectId, context, planned).filter(Boolean).map((line) => ({ ...line, under: pick })),
    ];
};

/* The parts of a plan: the statuses and lists by name, each field with its type, and each view followed by what it
 * shows. A line says which part of the stored plan it is (`pick`, `picks` for a line of names), or which part it
 * belongs under, so the person approving can leave that part out (./planChoice.js). */
const planLines = (change, context) => {
    const params = paramsOf(change);
    return [
        namesLine('newStatuses', 'statuses', params.statuses, plans.STATUSES_MAX, plans.STATUS_NAME_MAX),
        namesLine('newLists', 'lists', params.lists, plans.LISTS_MAX, planShown.NAME_MAX),
        ...listOf(params.definitions).slice(0, setup.FIELDS_MAX).map((field, at) => picked(fieldLine(field), keyOf('fields', at))),
        ...planViews(change).flatMap((view, at) => planViewLines(view, at, idOf(params.projectId), context)),
    ];
};

/* What a plan's card says beside its lines: which part needs which, which parts the viewer may not approve and
 * why (./planLocks.js), and which parts have nothing to show (./planShown.js). */
const planMarks = async (change, context) => {
    const locks = await planLocks.locksIn(context.companyId, await context.viewer(), change);
    const blank = planShown.blankIn(change.action, paramsOf(change));
    return {
        needs: planChoice.needsOf(paramsOf(change)),
        ...(locks.size ? { locked: [...locks.keys()], lockedWhy: Object.fromEntries(locks) } : {}),
        ...(blank.length ? { blank } : {}),
    };
};

/* The plan of a project that exists also lists its automations and first tasks, each a part of its own (./planWorkPreview.js). */
const planPreview = async (change, context) => {
    const place = placeLine(paramsOf(change), context.named);
    if (!place) return null;
    const lines = [place, ...planLines(change, context), ...(await planWorkPreview.lines(change, context))].filter(Boolean);
    return { kind: 'setup', title: place.project, lines, ...(await planMarks(change, context)) };
};

/* A project that is not there yet: its name, who will be on it, what it is for, and the plan that comes with it. */
const projectPreview = async (change, context) => {
    const params = paramsOf(change);
    const title = textOf(params.name, projects.NAME_MAX);
    if (!title) return null;
    return {
        kind: 'project',
        title,
        lines: [{ kind: 'members', only: 'approver' }, descriptionLine({ rawDescription: params.description }), ...planLines(change, context)].filter(Boolean),
        ...(await planMarks(change, context)),
    };
};

const SETUPS = Object.freeze({ 'fields.create': fieldsPreview, 'view.create': viewPreview, [PLAN]: planPreview, [projects.ACTION]: projectPreview, [automation.ACTION]: automation.preview, ...listSetup.BUILDERS, ...projectCopy.BUILDERS, [dashboards.ACTION]: dashboards.preview });
const BUILDERS = Object.freeze({ ...Object.fromEntries(Object.keys(CREATES).map((action) => [action, createPreview])), ...SETUPS });
const builderOf = (change) => (change && Object.hasOwn(BUILDERS, change.action) ? BUILDERS[change.action] : null);
const isSetup = (change) => Boolean(change) && Object.hasOwn(SETUPS, change.action);

/* A plan is read in the shape it is kept in, so its card shows every part its executor would make. */
const asKept = (change) => (change && planFiling.isPlan(change.action) ? { action: change.action, params: planFiling.storedParams(change.action, paramsOf(change)) } : change);
const changesOf = (proposal) => (Array.isArray(proposal && proposal.changes) ? proposal.changes : []).map(asKept);

/* The name of each custom field a waiting view names, under the project it is a field of: "<project>:<field>". */
const fieldNamesFor = async (companyId, views) => {
    const ids = [...new Set(views.flatMap((change) => looksOf(change).flatMap(namedFieldIds)))];
    if (!ids.length) return new Map();
    const definitions = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.CUSTOM_FIELDS, data: [{ _id: { $in: ids.map(oid) } }, { fieldTitle: 1, global: 1, projectId: 1, type: 1, isDelete: 1 }],
    }, 'find');
    return new Map(views.flatMap((change) => {
        const projectId = idOf(paramsOf(change).projectId);
        return (definitions || []).filter((definition) => isTaskFieldOf(definition, projectId)).map((definition) => [`${projectId}:${String(definition._id).toLowerCase()}`, textOf(definition.fieldTitle)]);
    }));
};

/* The tasks waiting changes name that the viewer can read, by id, each with its name and project: the parent of a new subtask, and the task of a first value. */
const readableTasks = async (companyId, uid, changes) => {
    const parents = changes.filter((change) => isCreate(change) && CREATES[change.action].kind === 'subtask').map((change) => paramsOf(change).taskId);
    const asked = [...parents, ...changes.flatMap(valuesIn).map((entry) => entry.taskId)].map(idOf).filter(Boolean);
    const readable = await readableTaskIds(companyId, uid, asked);
    if (!readable.length) return new Map();
    const tasks = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.TASKS, data: [{ _id: { $in: readable.map(oid) }, deletedStatusKey: { $ne: 1 } }, { TaskName: 1, ProjectID: 1 }],
    }, 'find');
    return new Map((tasks || []).map((task) => [String(task._id), { name: task.TaskName || '', projectId: idOf(task.ProjectID) }]));
};

/* For each proposal id, one entry per change, in order: its preview, or null where it has none. */
const forProposals = async (companyId, uid, proposals) => {
    const list = (Array.isArray(proposals) ? proposals : []).map((proposal) => ({ id: String(proposal._id), changes: changesOf(proposal) }));
    const filed = list.flatMap((proposal) => proposal.changes);
    if (!filed.some(builderOf)) return new Map();
    const changes = filed.filter(isCreate);
    const setups = filed.filter(isSetup);
    const tasks = await readableTasks(companyId, uid, [...changes, ...setups]);
    const named = await names.resolver({ companyId, userId: String(uid), projectIds: [] }, {
        projectIds: [...[...changes, ...setups].map((change) => idOf(paramsOf(change).projectId)), ...setups.map(projectCopy.sourceIdOf), ...[...tasks.values()].map((task) => task.projectId)].filter(Boolean),
        sprintIds: changes.map((change) => idOf(paramsOf(change).sprintId)).filter(Boolean),
        userIds: [...changes.flatMap((change) => peopleOf(CREATES[change.action].fields(paramsOf(change)))), ...setups.flatMap((change) => looksOf(change).flatMap((look) => peopleOf({ AssigneeUserId: look.assigneeIds }))), ...setups.flatMap(valuesIn).flatMap((entry) => peopleIn(entry.value)), ...setups.filter((change) => change.action === PLAN).flatMap(planWorkPreview.peopleIn)],
    });
    const fieldNames = await fieldNamesFor(companyId, setups.filter((change) => named.project(idOf(paramsOf(change).projectId)).name));
    let seat = null;
    const viewer = () => { seat = seat || planLocks.personOf(companyId, uid); return seat; };
    const built = { named, tasks, fieldNames, companyId, uid, viewer };
    return new Map(await Promise.all(list.map(async (proposal) => [
        proposal.id,
        await Promise.all(proposal.changes.map((change) => (builderOf(change) ? builderOf(change)(change, built) : null))),
    ])));
};

const SOURCE_MCP = 'mcp';
const BATCH_NAMES = 5;
const STATUS_CHANGES = Object.freeze(['task.status.set', 'task.status.change']);
const EDITS = Object.freeze(['task.edit', 'task.update']);
const clipped = (value) => { const text = typeof value === 'string' ? value.trim() : ''; return { value: text.slice(0, DESCRIPTION_MAX), more: text.length > DESCRIPTION_MAX }; };
const EDITED = Object.freeze({
    TaskName: (value) => ({ what: 'title', value: textOf(value) }),
    rawDescription: (value) => ({ what: 'description', ...clipped(value) }),
    Task_Priority: (value) => ({ what: 'priority', value: textOf(value, 10).toUpperCase() }),
    DueDate: (value) => ({ what: 'due', value: textOf(value, 40) }),
    startDate: (value) => ({ what: 'start', value: textOf(value, 40) }),
    totalEstimatedTime: (value) => ({ what: 'estimate', value: Number(value) > 0 ? Math.round(Number(value)) : '' }),
});
const OTHER = 'other';
const ASSIGN = Object.freeze(['task.assignees.set', 'task.assign']);
const FIELD_SET = 'task.field.set';
const ASSIGN_MODES = Object.freeze(['set', 'add', 'remove']);
/* A summary line says the one value of these in full; every other kind of change is spelled out change by change. */
const SAID_BY_SUMMARY = Object.freeze(['status', 'title', 'priority', 'due', 'start', 'estimate']);

const lower = (id) => idOf(id).toLowerCase();
const taskOn = (change, { tasks }) => tasks.get(lower(paramsOf(change).taskId)) || null;
const placeOf = (projectId, sprintId, { named }) => {
    const project = idOf(projectId) ? named.project(idOf(projectId)).name : null;
    return project ? { project, list: (idOf(sprintId) && named.sprint(idOf(sprintId), idOf(projectId)).name) || '' } : {};
};
const assigned = (change, context) => {
    const params = paramsOf(change);
    const task = taskOn(change, context);
    const ids = listOf(params.userIds).map(idOf).filter(Boolean);
    const shown = task ? ids.map((id) => context.named.person(id, task.projectId).name).filter(Boolean) : [];
    return { what: 'assignees', mode: ASSIGN_MODES.includes(params.mode) ? params.mode : '', names: shown, others: ids.length - shown.length };
};
const fieldSet = (change, context) => {
    const params = paramsOf(change);
    const task = taskOn(change, context);
    const field = task ? context.fieldNames.get(`${task.projectId}:${lower(params.fieldId)}`) || '' : '';
    if (!field) return { what: 'field' };
    if (typeof params.value === 'boolean') return { what: 'field', field, checked: params.value };
    const parts = partsOf(params.value);
    const shown = parts.map((part) => (idOf(part) ? context.named.person(idOf(part), task.projectId).name : textOf(part))).filter(Boolean);
    return { what: 'field', field, value: shown.join(', ').slice(0, TEXT_MAX), others: parts.length - shown.length };
};
const moved = (change, context) => ({ what: 'move', ...placeOf(paramsOf(change).projectId || (taskOn(change, context) || {}).projectId, paramsOf(change).sprintId, context) });
const otherTask = (what) => (change, { tasks }) => ({ what, value: (tasks.get(lower(paramsOf(change).relatedTaskId)) || { name: '' }).name });
const inList = (what) => (change, context) => ({ what, ...placeOf(paramsOf(change).listProjectId, paramsOf(change).sprintId, context) });
const titled = (what) => (change) => ({ what, value: textOf(paramsOf(change).title) });
const said = (what, key) => (change) => ({ what, ...clipped(paramsOf(change)[key]) });
const only = (what) => () => ({ what });

/* What one change of a batch changes, for one viewer: the kind, and what it sets where the viewer may see that. */
const CHANGED = Object.freeze({
    ...Object.fromEntries(ASSIGN.map((action) => [action, assigned])),
    [FIELD_SET]: fieldSet,
    'task.move': moved, 'task.sprint.move': moved,
    'task.archive': only('archive'), 'task.restore': only('restore'),
    'task.add': titled('task'), 'task.create': titled('task'), 'subtask.add': titled('subtask'), 'subtask.create': titled('subtask'),
    'task.comment': said('comment', 'body'), 'comment.create': said('comment', 'body'),
    'task.link': (change) => ({ what: 'link', value: textOf(paramsOf(change).label) || textOf(paramsOf(change).url) }),
    'task.relation.add': otherTask('relation_add'), 'task.relation.remove': otherTask('relation_remove'),
    'task.lists.add': inList('list_add'), 'task.lists.remove': inList('list_remove'),
});

/* A connected agent files one change for a call of its own, so several changes are a batch. */
const isBatch = (proposal) => Boolean(proposal) && proposal.source === SOURCE_MCP && changesOf(proposal).length > 1;
/* One change a connected agent filed that has no card of its own: a move, an edit, a comment. */
const isBareChange = (proposal) => Boolean(proposal) && proposal.source === SOURCE_MCP && changesOf(proposal).length === 1 && !builderOf(changesOf(proposal)[0]);

const changedBy = (change, context) => {
    const params = paramsOf(change);
    if (STATUS_CHANGES.includes(change.action)) return [{ what: 'status', value: textOf(objectOf(params.status).name, 60) }];
    if (EDITS.includes(change.action)) {
        return Object.entries(detailedFields(params)).map(([field, value]) => (Object.hasOwn(EDITED, field) ? EDITED[field](value) : { what: OTHER }));
    }
    return [Object.hasOwn(CHANGED, change.action) ? CHANGED[change.action](change, context) : { what: OTHER }];
};

const fieldLineOf = (entry, task) => (entry.field && task
    ? { kind: 'fieldValue', field: entry.field, task, ...(typeof entry.checked === 'boolean' ? { checked: entry.checked } : { value: entry.value, others: entry.others }) }
    : null);

/* One line for each thing a batch changes, with how many tasks it changes that on: the value when every change
 * sets the same one, `mixed` when they differ. A change that names no task, a new task for one, counts as its own.
 * After them comes one line for each change those lines do not say in full: its task by name and what it sets. */
const changeLinesOf = (changes, context) => {
    const groups = new Map();
    const entries = changes.flatMap((change, at) => changedBy(change, context).map((entry) => ({ entry, change, at })));
    entries.forEach(({ entry, change, at }) => {
        const group = groups.get(entry.what) || { on: new Set(), values: new Set() };
        group.on.add(lower(paramsOf(change).taskId) || `change:${at}`);
        group.values.add(SAID_BY_SUMMARY.includes(entry.what) ? entry.value : '');
        groups.set(entry.what, group);
    });
    const summary = [...groups].map(([what, { on, values }]) => ({ kind: 'batchChange', what, count: on.size, value: values.size === 1 ? [...values][0] : '', mixed: values.size > 1 }));
    const spelledOut = entries
        .filter(({ entry }) => !SAID_BY_SUMMARY.includes(entry.what) || groups.get(entry.what).values.size > 1)
        .map(({ entry, change }) => {
            const task = (taskOn(change, context) || { name: '' }).name;
            return entry.what === 'field' ? fieldLineOf(entry, task) : { kind: 'batchItem', task, ...entry };
        });
    return { summary, spelledOut: spelledOut.filter(Boolean) };
};

const taskIdsOf = (changes) => [...new Set(changes.flatMap((change) => [paramsOf(change).taskId, paramsOf(change).relatedTaskId]).map(lower).filter(Boolean))];

/* The name of each custom field a batch sets, under the project of the task it sets it on: "<project>:<field>". */
const setFieldNames = async (companyId, changes, tasks) => {
    const sets = changes.filter((change) => change.action === FIELD_SET && tasks.has(lower(paramsOf(change).taskId)) && idOf(paramsOf(change).fieldId));
    if (!sets.length) return new Map();
    const definitions = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.CUSTOM_FIELDS, data: [{ _id: { $in: [...new Set(sets.map((change) => idOf(paramsOf(change).fieldId)))].map(oid) } }, { fieldTitle: 1, global: 1, projectId: 1, type: 1, isDelete: 1 }],
    }, 'find');
    return new Map(sets.flatMap((change) => {
        const { projectId } = tasks.get(lower(paramsOf(change).taskId));
        return (definitions || []).filter((definition) => String(definition._id).toLowerCase() === lower(paramsOf(change).fieldId) && isTaskFieldOf(definition, projectId))
            .map((definition) => [`${projectId}:${String(definition._id).toLowerCase()}`, textOf(definition.fieldTitle)]);
    }));
};

/* For each batch among the proposals, by proposal id: its one card. A task is named, and can be opened from the
 * card, only when the viewer can read it; the rest are a count. `others` counts every task past the first few, and
 * `rest` holds those of them the viewer can read. A person, a place and a field are named as the viewer may see
 * them (../Mcp/names.js), and a text is the proposal's own. With `bareChanges`, a screen that shows a change
 * through its card alone gets the same card for one change that has none of its own. */
const forBatches = async (companyId, uid, proposals, { bareChanges = false } = {}) => {
    const batches = (Array.isArray(proposals) ? proposals : []).filter((proposal) => isBatch(proposal) || (bareChanges && isBareChange(proposal)));
    if (!batches.length) return new Map();
    const all = batches.flatMap(changesOf);
    const readable = await readableTaskIds(companyId, uid, taskIdsOf(all));
    const rows = readable.length ? await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.TASKS, data: [{ _id: { $in: readable.map(oid) }, deletedStatusKey: { $ne: 1 } }, { TaskName: 1, ProjectID: 1, sprintId: 1, folderObjId: 1 }],
    }, 'find') : [];
    const tasks = new Map((rows || []).map((task) => [String(task._id).toLowerCase(), {
        taskId: String(task._id), name: textOf(task.TaskName), projectId: idOf(task.ProjectID), sprintId: idOf(task.sprintId), folderId: idOf(task.folderObjId),
    }]));
    const named = await names.resolver({ companyId, userId: String(uid), projectIds: [] }, {
        projectIds: [...[...tasks.values()].map((task) => task.projectId), ...all.flatMap((change) => [paramsOf(change).projectId, paramsOf(change).listProjectId])].map(idOf).filter(Boolean),
        sprintIds: all.map((change) => idOf(paramsOf(change).sprintId)).filter(Boolean),
        userIds: all.flatMap((change) => [...listOf(paramsOf(change).userIds), ...(change.action === FIELD_SET ? peopleIn(paramsOf(change).value) : [])]).map(idOf).filter(Boolean),
    });
    const context = { named, tasks, fieldNames: await setFieldNames(companyId, all, tasks) };
    return new Map(batches.map((proposal) => {
        const changes = changesOf(proposal);
        const ids = taskIdsOf(changes);
        const readable = ids.map((id) => tasks.get(id)).filter((row) => row && row.name);
        const shown = readable.slice(0, BATCH_NAMES);
        const rest = readable.slice(BATCH_NAMES);
        const { summary, spelledOut } = changeLinesOf(changes, context);
        return [String(proposal._id), {
            kind: 'batch',
            tasks: ids.length,
            changes: changes.length,
            lines: [...summary, ids.length > 0 && { kind: 'batchTasks', tasks: shown, others: ids.length - shown.length, ...(rest.length ? { rest } : {}) }, ...spelledOut].filter(Boolean),
        }];
    }));
};

module.exports = { forProposals, forBatches, DESCRIPTION_MAX };
