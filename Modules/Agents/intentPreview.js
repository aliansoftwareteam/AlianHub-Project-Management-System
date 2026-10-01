const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { oid } = require('../Automations/engine/tools');
const names = require('../Mcp/names');
const { readableTaskIds } = require('../Tasks/helpers/taskWritePlacement');

// What a waiting change will make, as the lines its card shows (frontend IntentPreview). It is built for one viewer:
// a project, list, parent task or person is named only when that viewer may see it, and everything else on a line
// is the proposal's own text, handed over as text. A kind of change with no entry in BUILDERS has no preview.

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

const BUILDERS = Object.freeze(Object.fromEntries(Object.keys(CREATES).map((action) => [action, createPreview])));
const builderOf = (change) => (change && Object.hasOwn(BUILDERS, change.action) ? BUILDERS[change.action] : null);

const changesOf = (proposal) => (Array.isArray(proposal && proposal.changes) ? proposal.changes : []);

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
    const parents = await readableParents(companyId, uid, changes);
    const named = await names.resolver({ companyId, userId: String(uid), projectIds: [] }, {
        projectIds: [...changes.map((change) => idOf(paramsOf(change).projectId)), ...[...parents.values()].map((parent) => parent.projectId)].filter(Boolean),
        sprintIds: changes.map((change) => idOf(paramsOf(change).sprintId)).filter(Boolean),
        userIds: changes.flatMap((change) => peopleOf(CREATES[change.action].fields(paramsOf(change)))),
    });
    return new Map(list.map((proposal) => [
        String(proposal._id),
        changesOf(proposal).map((change) => (builderOf(change) ? builderOf(change)(change, { named, parents }) : null)),
    ]));
};

module.exports = { forProposals, DESCRIPTION_MAX };
