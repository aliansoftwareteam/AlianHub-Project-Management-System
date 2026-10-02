const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { oid } = require('../Automations/engine/tools');
const names = require('../Mcp/names');
const { readableTaskIds } = require('../Tasks/helpers/taskWritePlacement');
const { isTaskFieldOf } = require('../CustomField/helpers/fieldValueInput');
const setup = require('./setupRequests');
const plans = require('./projectSetup');

// What a waiting change will make, as the lines its card shows (frontend IntentPreview). It is built for one viewer:
// a project, list, parent task, person or custom field is named only when that viewer may see it, and everything
// else on a line is the proposal's own text, handed over as text. Fields, a view and a whole plan are the project's own,
// so for a viewer who cannot open the project they have no preview at all. A kind of change with no entry in BUILDERS has none.

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

const createPreview = (change, { named, parents }) => {
    const create = CREATES[change.action];
    const params = paramsOf(change);
    const fields = create.fields(params);
    const parent = create.kind === 'subtask' ? parents.get(idOf(params.taskId)) : null;
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
    return {
        kind: 'field', name, type: setup.FIELD_TYPES.includes(field.type) ? field.type : '',
        options: listOf(field.options).map((option) => textOf(option, setup.OPTION_MAX)).filter(Boolean).slice(0, setup.OPTIONS_MAX),
    };
};

const fieldsPreview = (change, { named }) => {
    const params = paramsOf(change);
    const place = placeLine(params, named);
    if (!place) return null;
    const fields = listOf(params.definitions).slice(0, setup.FIELDS_MAX).map(fieldLine).filter(Boolean);
    return { kind: 'fields', title: fields.map((field) => field.name).join(', ').slice(0, TEXT_MAX), lines: [place, ...fields] };
};

const PLAN = 'project.setup';
const planViews = (change) => listOf(paramsOf(change).views).slice(0, plans.VIEWS_MAX).map(objectOf);
/* The looks a waiting change names: a view's own, or one for each view of a plan. */
const looksOf = (change) => (change.action === PLAN ? planViews(change).map((view) => objectOf(view.look)) : [objectOf(paramsOf(change).look)]);
const namedFieldIds = (look) => [look.groupBy, look.sortBy, ...listOf(look.showFieldIds)].map(idOf).filter(Boolean);

/* A built-in choice by its key, a custom field by its name, and nothing for a field the viewer's project does not have. */
const chosen = (choices, value, fieldName) => {
    if (Object.hasOwn(choices, String(value))) return { by: String(value), field: '' };
    const field = fieldName(idOf(value));
    return field ? { by: '', field } : null;
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

const namesLine = (kind, given, max, nameMax) => {
    const names = listOf(given).slice(0, max).map((name) => textOf(name, nameMax)).filter(Boolean);
    return names.length > 0 && { kind, names };
};

const planViewLines = (view, projectId, context) => {
    const name = textOf(view.name, setup.VIEW_NAME_MAX);
    if (!name) return [];
    const planned = listOf(view.showFields).map((field) => textOf(field, setup.FIELD_NAME_MAX)).filter(Boolean);
    return [
        { kind: 'planView', name, layout: Object.hasOwn(setup.VIEW_KINDS, String(view.kind)) ? String(view.kind) : '' },
        ...lookLines(objectOf(view.look), projectId, context, planned),
    ];
};

/* A whole plan on one card: the statuses and lists by name, each field with its type, and each view followed by what it shows. */
const planPreview = (change, context) => {
    const params = paramsOf(change);
    const place = placeLine(params, context.named);
    if (!place) return null;
    return {
        kind: 'setup',
        title: place.project,
        lines: [
            place,
            namesLine('newStatuses', params.statuses, plans.STATUSES_MAX, plans.STATUS_NAME_MAX),
            namesLine('newLists', params.lists, plans.LISTS_MAX, TEXT_MAX),
            ...listOf(params.definitions).slice(0, setup.FIELDS_MAX).map(fieldLine),
            ...planViews(change).flatMap((view) => planViewLines(view, idOf(params.projectId), context)),
        ].filter(Boolean),
    };
};

const SETUPS = Object.freeze({ 'fields.create': fieldsPreview, 'view.create': viewPreview, [PLAN]: planPreview });
const BUILDERS = Object.freeze({ ...Object.fromEntries(Object.keys(CREATES).map((action) => [action, createPreview])), ...SETUPS });
const builderOf = (change) => (change && Object.hasOwn(BUILDERS, change.action) ? BUILDERS[change.action] : null);
const isSetup = (change) => Boolean(change) && Object.hasOwn(SETUPS, change.action);

const changesOf = (proposal) => (Array.isArray(proposal && proposal.changes) ? proposal.changes : []);

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

/* The parent tasks the viewer can read, by id, each with its name and project. */
const readableParents = async (companyId, uid, changes) => {
    const asked = changes.filter((change) => CREATES[change.action].kind === 'subtask').map((change) => idOf(paramsOf(change).taskId)).filter(Boolean);
    const readable = await readableTaskIds(companyId, uid, asked);
    if (!readable.length) return new Map();
    const tasks = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.TASKS, data: [{ _id: { $in: readable.map(oid) }, deletedStatusKey: { $ne: 1 } }, { TaskName: 1, ProjectID: 1 }],
    }, 'find');
    return new Map((tasks || []).map((task) => [String(task._id), { name: task.TaskName || '', projectId: idOf(task.ProjectID) }]));
};

/* For each proposal id, one entry per change, in order: its preview, or null where it has none. */
const forProposals = async (companyId, uid, proposals) => {
    const list = Array.isArray(proposals) ? proposals : [];
    if (!list.flatMap(changesOf).some(builderOf)) return new Map();
    const changes = list.flatMap(changesOf).filter(isCreate);
    const setups = list.flatMap(changesOf).filter(isSetup);
    const parents = await readableParents(companyId, uid, changes);
    const named = await names.resolver({ companyId, userId: String(uid), projectIds: [] }, {
        projectIds: [...[...changes, ...setups].map((change) => idOf(paramsOf(change).projectId)), ...[...parents.values()].map((parent) => parent.projectId)].filter(Boolean),
        sprintIds: changes.map((change) => idOf(paramsOf(change).sprintId)).filter(Boolean),
        userIds: [...changes.flatMap((change) => peopleOf(CREATES[change.action].fields(paramsOf(change)))), ...setups.flatMap((change) => looksOf(change).flatMap((look) => peopleOf({ AssigneeUserId: look.assigneeIds })))],
    });
    const fieldNames = await fieldNamesFor(companyId, setups.filter((change) => named.project(idOf(paramsOf(change).projectId)).name));
    return new Map(list.map((proposal) => [
        String(proposal._id),
        changesOf(proposal).map((change) => (builderOf(change) ? builderOf(change)(change, { named, parents, fieldNames }) : null)),
    ]));
};

module.exports = { forProposals, DESCRIPTION_MAX };
