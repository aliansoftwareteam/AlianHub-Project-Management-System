const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { idForms } = require('../../utils/mongo-handler/objectIdKeys');
const socketEmitter = require('../../event/socketEventEmitter');
const tools = require('../Automations/engine/tools');
const { storedProject, whoOf } = require('./taskRequests');
const { runAs } = require('./actingAgent');

// Custom fields and saved views an agent adds to a project the way a person adds them: through the route the web
// app calls, its guards and its handler in the order a request meets them, as the person behind the agent. So who
// may add one, what it may hold, the limits and the events are the web app's. The routes are loaded on first use.

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const FIELD_TYPES = Object.freeze(['text', 'textarea', 'number', 'money', 'date', 'dropdown', 'checkbox', 'email', 'phone', 'url', 'people', 'rating', 'progress']);
const FIELDS_MAX = 10;
const FIELD_NAME_MAX = 80;
const OPTIONS_MAX = 30;
const OPTION_MAX = 60;
const NOTE_MAX = 200;

/* The `tab` of each kind of view a project can keep a saved copy of (Modules/ViewTemplates/templateRules.js). */
const VIEW_KINDS = Object.freeze({ list: 'ProjectListView', board: 'ProjectKanban', table: 'TableView', calendar: 'Calendar', workload: 'Workload' });
const VIEW_NAME_MAX = 60;
const GROUPS = Object.freeze({ status: 0, assignee: 1, priority: 2, due_date: 3 });
const SORTS = Object.freeze({
    due: 'DueDate', priority: 'Task_Priority', created: 'createdAt', updated: 'updatedAt', name: 'TaskName', status: 'statusKey',
    assignee: 'AssigneeUserId', points: 'points', estimate: 'totalEstimatedTime',
});
const DIRECTIONS = Object.freeze(['asc', 'desc']);
const PRIORITIES = Object.freeze(['URGENT', 'HIGH', 'MEDIUM', 'LOW']);
const SUBTASKS = Object.freeze(['collapsed', 'expanded']);
const LOOK_MAX = Object.freeze({ assignees: 20, statuses: 20, status: 60, search: 200, columns: 30 });

const FIELD_ROUTE = '/api/v1/customField';
const ROUTES = Object.freeze({
    fieldInsert: { routes: () => require('../CustomField/routes'), method: 'post', path: FIELD_ROUTE },
    fieldUpdate: { routes: () => require('../CustomField/routes'), method: 'put', path: FIELD_ROUTE },
    viewCreate: { routes: () => require('../Project/routes'), method: 'post', path: '/api/v1/project/:id/views' },
    projectUpdate: { routes: () => require('../Project/routes'), method: 'put', path: '/api/v1/project/:id' },
});

const refuse = (message) => new tools.DeterministicError(message);
const idOf = (value) => (value === undefined || value === null ? '' : String(value));
const isId = (value) => OBJECT_ID.test(idOf(value));
const lower = (value) => String(value).trim().toLowerCase();
const listOf = (value) => (Array.isArray(value) ? value : []);
const unique = (values) => [...new Set(values)];

const chains = new Map();

/* The guards and the handler a module registers for one route, in the order the web app's request meets them. */
const chainOf = (name) => {
    if (!chains.has(name)) {
        const { routes, method, path } = ROUTES[name];
        let found = null;
        const take = (verb) => (at, ...handlers) => { if (verb === method && at === path) found = handlers.flat(); };
        routes().init({ get: take('get'), post: take('post'), put: take('put'), patch: take('patch'), delete: take('delete'), use: take('use') });
        if (!found) throw new Error(`${method} ${path} is not a route`);
        chains.set(name, found);
    }
    return chains.get(name);
};

/* What that route answers to `who`, with the status it set and no HTTP around it. */
const answerOf = (name, { companyId, who, params = {}, body = {} }) => runAs(who.mark, () => new Promise((resolve, reject) => {
    const chain = chainOf(name);
    const res = { statusCode: 200 };
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (sent) => { resolve({ code: res.statusCode, body: sent }); return res; };
    res.send = res.json;
    const req = { uid: who.uid, aud: String(companyId), headers: { companyid: String(companyId) }, params, query: {}, body };
    const step = (at) => Promise.resolve().then(() => chain[at](req, res, () => step(at + 1))).catch(reject);
    step(0);
}));

const reasonOf = (answer, fallback) => {
    const sent = answer.body && typeof answer.body === 'object' ? answer.body : {};
    return [sent.statusText, sent.message].find((text) => typeof text === 'string' && text) || fallback;
};

const printable = (value) => [...value].filter((char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127).join('');
const lineOf = (value, max) => (typeof value === 'string' ? printable(value).replace(/\s+/g, ' ').trim().slice(0, max).trim() : '');
const sameName = (a, b) => lower(lineOf(a, FIELD_NAME_MAX)) === lower(lineOf(b, FIELD_NAME_MAX));

const optionsOf = (given) => {
    const labels = listOf(given).map((option) => lineOf(option, OPTION_MAX)).filter(Boolean);
    return labels.filter((label, at) => labels.findIndex((other) => lower(other) === lower(label)) === at).slice(0, OPTIONS_MAX);
};

/* What a caller names for one field, kept as plain text: its name, one of the types the field form offers, and a dropdown's options. */
const draftOf = (given) => {
    const field = given && typeof given === 'object' ? given : {};
    const type = FIELD_TYPES.includes(field.type) ? field.type : '';
    const note = lineOf(field.description, NOTE_MAX);
    return { name: lineOf(field.name, FIELD_NAME_MAX), type, ...(type === 'dropdown' ? { options: optionsOf(field.options) } : {}), ...(note ? { description: note } : {}) };
};

const draftProblem = (draft) => {
    if (!draft.name) return 'needs a name';
    if (!draft.type) return `needs a type: one of ${FIELD_TYPES.join(', ')}`;
    if (draft.type === 'dropdown' && !draft.options.length) return 'is a dropdown, which needs at least one option';
    return '';
};

const draftsOf = (given) => listOf(given).map(draftOf);

/* '' when every field named can be made; otherwise what is wrong with each one that cannot. */
const draftsProblem = (given) => {
    const drafts = draftsOf(given);
    if (!drafts.length || drafts.length > FIELDS_MAX) return `fields needs 1 to ${FIELDS_MAX} fields`;
    const wrong = drafts.map((draft, at) => ({ at, draft, why: draftProblem(draft) })).filter((entry) => entry.why);
    if (wrong.length) return wrong.map(({ at, draft, why }) => `fields[${at}]${draft.name ? ` (${draft.name})` : ''} ${why}`).join('; ');
    const twice = drafts.find((draft, at) => drafts.findIndex((other) => sameName(other.name, draft.name)) !== at);
    return twice ? `"${twice.name}" is named twice` : '';
};

/* The definition the field form saves for a field of one project. */
const definitionOf = (draft, { projectId, uid }) => {
    const { fieldDefinitionFrom, newOption } = require('../Importers/helpers/clickupFields');
    return fieldDefinitionFrom({
        fieldTitle: draft.name,
        fieldType: draft.type,
        fieldDescription: draft.description || draft.name,
        ...(draft.type === 'dropdown' ? { fieldOptions: draft.options.map(newOption) } : {}),
    }, { projectId, userId: uid });
};

const fieldsOfProject = async (companyId, projectId) => {
    const { isTaskFieldOf } = require('../CustomField/helpers/fieldValueInput');
    const rows = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.CUSTOM_FIELDS, data: [{ type: 'task', isDelete: { $ne: false } }] }, 'find');
    return (rows || []).filter((definition) => isTaskFieldOf(definition, projectId));
};

const saveField = async ({ companyId, who, projectId, draft }) => {
    const answer = await answerOf('fieldInsert', { companyId, who, body: { type: 'save', updateObject: definitionOf(draft, { projectId, uid: who.uid }) } });
    const saved = answer.code === 200 && answer.body && answer.body._id;
    return saved
        ? { name: draft.name, type: draft.type, fieldId: idOf(answer.body._id), made: true }
        : { name: draft.name, type: draft.type, made: false, error: reasonOf(answer, 'the field was not saved') };
};

/* One answer per field named: made, kept because the project already has a field of that name, or why it was not saved. */
const createFields = async ({ companyId, who, projectId, definitions }) => {
    const project = await storedProject(companyId, projectId);
    const inProject = idOf(project._id);
    const problem = draftsProblem(definitions);
    if (problem) throw refuse(problem);
    const held = await fieldsOfProject(companyId, inProject);
    const fields = [];
    for (const draft of draftsOf(definitions)) {
        const existing = held.find((definition) => sameName(definition.fieldTitle, draft.name));
        fields.push(existing
            ? { name: existing.fieldTitle, type: existing.fieldType, fieldId: idOf(existing._id), made: false }
            : await saveField({ companyId, who, projectId: inProject, draft }));
    }
    return { project, projectId: inProject, fields };
};

const storedField = (companyId, fieldId) => (isId(fieldId)
    ? MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.CUSTOM_FIELDS, data: [{ _id: tools.oid(fieldId) }] }, 'findOne')
    : null);

const holdsValues = async (companyId, projectId, fieldId) => Boolean(await MongoDbCrudOpration(companyId, {
    type: SCHEMA_TYPE.TASKS,
    data: [{ ProjectID: { $in: idForms(projectId) }, [`customField.${fieldId}`]: { $exists: true }, deletedStatusKey: { $ne: 1 } }, { _id: 1 }],
}, 'findOne'));

const whyKept = async (companyId, projectId, field) => {
    const elsewhere = field.global === true || [].concat(field.projectId || []).map(String).some((id) => id !== projectId);
    if (elsewhere) return 'it is on other projects now';
    return await holdsValues(companyId, projectId, idOf(field._id)) ? 'it holds a value on a task' : '';
};

/* Taking back fields an agent made switches each one off, as the field form does, and only a field that is still
 * this project's alone and holds no value. The rest stay as they are, and the answer names them and says why. */
const withdrawFields = async ({ companyId, who, projectId, fieldIds }) => {
    const removed = [];
    const kept = [];
    for (const fieldId of listOf(fieldIds).map(idOf)) {
        const field = await storedField(companyId, fieldId);
        if (!field || field.isDelete === false) continue;
        const named = { fieldId, name: field.fieldTitle || '' };
        const reason = await whyKept(companyId, idOf(projectId), field);
        if (reason) {
            kept.push({ ...named, reason });
            continue;
        }
        const answer = await answerOf('fieldUpdate', { companyId, who, body: { type: 'updateOne', key: '$set', id: fieldId, updateObject: { isDelete: false } } });
        if (answer.code !== 200) throw refuse(reasonOf(answer, `the field "${named.name}" was not removed`));
        removed.push(named);
    }
    return { removed, kept };
};

const isGroup = (value) => Object.hasOwn(GROUPS, idOf(value)) || isId(value);
const isSort = (value) => Object.hasOwn(SORTS, idOf(value)) || isId(value);
const idsOf = (value, max) => unique(listOf(value).filter(isId).map((id) => idOf(id).toLowerCase())).slice(0, max);

/* What a caller names for a view, kept to what a saved view holds; a part left out is left to the view's own default. */
const lookOf = (given) => {
    const look = given && typeof given === 'object' ? given : {};
    const statuses = unique(listOf(look.statuses).map((name) => lineOf(name, LOOK_MAX.status)).filter(Boolean)).slice(0, LOOK_MAX.statuses);
    const priorities = unique(listOf(look.priorities).filter((value) => PRIORITIES.includes(value)));
    const assigneeIds = idsOf(look.assigneeIds, LOOK_MAX.assignees);
    const showFieldIds = idsOf(look.showFieldIds, LOOK_MAX.columns);
    const search = lineOf(look.search, LOOK_MAX.search);
    return {
        ...(isGroup(look.groupBy) ? { groupBy: lower(look.groupBy) } : {}),
        ...(isSort(look.sortBy) ? { sortBy: lower(look.sortBy), ...(DIRECTIONS.includes(look.sortDirection) ? { sortDirection: look.sortDirection } : {}) } : {}),
        ...(look.mine === true ? { mine: true } : {}),
        ...(assigneeIds.length ? { assigneeIds } : {}),
        ...(statuses.length ? { statuses } : {}),
        ...(priorities.length ? { priorities } : {}),
        ...(search ? { search } : {}),
        ...(SUBTASKS.includes(look.subtasks) ? { subtasks: look.subtasks } : {}),
        ...(showFieldIds.length ? { showFieldIds } : {}),
    };
};

const lookProblem = (given) => {
    const look = given && typeof given === 'object' ? given : {};
    if (look.groupBy !== undefined && !isGroup(look.groupBy)) return `groupBy must be one of ${Object.keys(GROUPS).join(', ')}, or the id of a custom field`;
    if (look.sortBy !== undefined && !isSort(look.sortBy)) return `sortBy must be one of ${Object.keys(SORTS).join(', ')}, or the id of a custom field`;
    if (look.sortDirection !== undefined && look.sortBy === undefined) return 'sortDirection needs sortBy';
    return '';
};

const viewNameOf = (value) => lineOf(value, VIEW_NAME_MAX);
const viewIdOf = (view) => idOf(view && (view._id || view.id));
const viewsOf = (project) => listOf(project && project.ProjectRequiredComponent);
const statusesOf = (project) => listOf(project.taskStatusData).map((row) => (row && row.convertStatus ? row.convertStatus : row)).filter(Boolean);

/* The view of that kind a new one starts from, as the project's "duplicate view" does. */
const sourceView = (project, kind) => {
    const { isCopyable } = require('../Project/controller/viewSettings');
    return viewsOf(project).find((view) => view && view.keyName === VIEW_KINDS[kind] && isCopyable(view)) || null;
};

const noSource = (kind) => `this project has no ${kind} view to start from; the person adds one in AlianHub first`;

/* The row the task filter saves for a field whose values are picked from a list. */
const filterRow = (field, name, values) => ({ name: { value: field, name, type: 'array', filterOn: field }, comparison: { value: ':', name: 'Is' }, values, condition: '&&' });

/* The settings a saved view stores for what was named, fitted to the project as a view template is: a status or a
 * custom field the project does not have is left out, and the answer says which part lost something. */
const settingsFor = async (companyId, project, look) => {
    const statuses = statusesOf(project);
    const named = listOf(look.statuses);
    const keys = named.map((name) => statuses.find((status) => lower(status.name || '') === lower(name))).filter(Boolean).map((status) => status.key);
    const fieldPath = (id) => `customField.${id}.fieldValue`;
    const raw = {
        ...(look.groupBy !== undefined ? { groupBy: Object.hasOwn(GROUPS, look.groupBy) ? GROUPS[look.groupBy] : `cf:${look.groupBy}` } : {}),
        ...(look.sortBy !== undefined ? { sort: { field: SORTS[look.sortBy] || fieldPath(look.sortBy), dir: look.sortDirection === 'desc' ? -1 : 1 } } : {}),
        me: look.mine === true,
        assignees: listOf(look.assigneeIds),
        search: look.search || '',
        subtasks: look.subtasks,
        filters: [
            keys.length ? filterRow('statusKey', 'status', keys) : null,
            listOf(look.priorities).length ? filterRow('Task_Priority', 'priority', look.priorities) : null,
        ].filter(Boolean),
        columns: { shown: listOf(look.showFieldIds).map((id) => `cf:${id}`) },
    };
    const fitted = await require('../ViewTemplates/templateStore').fitToProject(companyId, project, { settings: raw });
    return { settings: fitted.settings, leftOut: unique([...fitted.leftOut, ...(keys.length < named.length ? ['filters'] : [])]) };
};

const addressOf = (companyId, made) => {
    const base = require('../Mcp/screenTools').webBase();
    return base ? `${base}/#/${encodeURIComponent(String(companyId))}/project/${made.projectId}/p?tab=${made.keyName}&view=${made.viewId}` : '';
};

const createView = async ({ companyId, who, projectId, name, kind = 'list', look }) => {
    const project = await storedProject(companyId, projectId);
    const inProject = idOf(project._id);
    if (!Object.hasOwn(VIEW_KINDS, kind)) throw refuse(`kind needs one of ${Object.keys(VIEW_KINDS).join(', ')}`);
    const problem = lookProblem(look);
    if (problem) throw refuse(problem);
    const source = sourceView(project, kind);
    if (!source) throw refuse(noSource(kind));
    const fitted = await settingsFor(companyId, project, lookOf(look));
    const answer = await answerOf('viewCreate', { companyId, who, params: { id: inProject }, body: { sourceViewId: viewIdOf(source), title: viewNameOf(name), settings: fitted.settings } });
    if (answer.code !== 200 || !answer.body || answer.body.status !== true) throw refuse(reasonOf(answer, 'the view was not added'));
    const view = answer.body.data;
    return { project, projectId: inProject, viewId: viewIdOf(view), name: view.title, kind, keyName: view.keyName, leftOut: fitted.leftOut };
};

/* Taking back a view an agent added removes that one view, as the view's own "delete" does. */
const withdrawView = async ({ companyId, who, projectId, viewId }) => {
    const project = await storedProject(companyId, projectId);
    const inProject = idOf(project._id);
    const view = viewsOf(project).find((entry) => viewIdOf(entry) === idOf(viewId));
    if (!view) return { removed: false };
    const answer = await answerOf('projectUpdate', { companyId, who, params: { id: inProject }, body: { key: '$pull', updateObject: { ProjectRequiredComponent: { _id: view._id } } } });
    if (answer.code !== 200) throw refuse(reasonOf(answer, 'the view was not removed'));
    socketEmitter.emit('update', { type: 'update', data: await storedProject(companyId, inProject), updatedFields: { ProjectRequiredComponent: 'remove' }, module: 'project' });
    return { removed: true, name: view.title || '' };
};

const executors = {
    async 'fields.create'({ companyId, actor, params, depth }) {
        const out = await createFields({ companyId, who: whoOf(actor, depth), projectId: params.projectId, definitions: params.definitions });
        const made = out.fields.filter((field) => field.made);
        const failed = out.fields.filter((field) => field.error);
        if (!made.length && failed.length) throw refuse(unique(failed.map((field) => `${field.name}: ${field.error}`)).join('; '));
        return {
            result: { projectId: out.projectId, made: made.length, fields: out.fields },
            undo: made.length ? { kind: 'fields', projectId: out.projectId, fieldIds: made.map((field) => field.fieldId) } : null,
            entityType: 'project', entityId: out.projectId, entityName: out.project.ProjectName || '',
        };
    },

    async 'view.create'({ companyId, actor, params, depth }) {
        const made = await createView({ companyId, who: whoOf(actor, depth), projectId: params.projectId, name: params.name, kind: params.kind, look: params.look });
        const url = addressOf(companyId, made);
        return {
            result: { projectId: made.projectId, viewId: made.viewId, name: made.name, kind: made.kind, leftOut: made.leftOut, ...(url ? { url } : {}) },
            undo: { kind: 'view', projectId: made.projectId, viewId: made.viewId },
            entityType: 'project', entityId: made.projectId, entityName: made.project.ProjectName || '',
        };
    },
};

module.exports = {
    executors, withdrawFields, withdrawView, draftsOf, draftsProblem, lookOf, lookProblem, viewNameOf, sourceView, noSource,
    FIELD_TYPES, FIELDS_MAX, FIELD_NAME_MAX, OPTIONS_MAX, OPTION_MAX, NOTE_MAX, VIEW_KINDS, VIEW_NAME_MAX, GROUPS, SORTS, DIRECTIONS, PRIORITIES, SUBTASKS, LOOK_MAX,
};
