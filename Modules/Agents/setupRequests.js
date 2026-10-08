const { isDeepStrictEqual } = require('util');
const { DateTime } = require('luxon');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { idForms } = require('../../utils/mongo-handler/objectIdKeys');
const socketEmitter = require('../../event/socketEventEmitter');
const tools = require('../Automations/engine/tools');
const { storedProject, whoOf } = require('./taskRequests');
const { runAs } = require('./actingAgent');
const computed = require('./computedFields');

// Custom fields and saved views an agent adds to a project the way a person adds them: through the route the web
// app calls, its guards and its handler in the order a request meets them, as the person behind the agent. So who
// may add one, what it may hold, the limits and the events are the web app's. The routes are loaded on first use.

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const FIELD_TYPES = Object.freeze(['text', 'textarea', 'number', 'money', 'date', 'dropdown', 'checkbox', 'email', 'phone', 'url', 'people', 'rating', 'progress']);
const CREATE_TYPES = Object.freeze([...FIELD_TYPES, ...computed.TYPES]);
const FIELDS_MAX = 10;
const FIELD_NAME_MAX = 80;
const OPTIONS_MAX = 30;
const OPTION_MAX = 60;
const NOTE_MAX = 200;
const VALUES_MAX = 50;
const VALUE_TEXT_MAX = 4000;
const VALUE_PARTS_MAX = 50;
const FIELD_SET = 'task.field.set';
const NO_TASK = 'That task was not found in this project. Check the id.';

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
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const IS = Object.freeze({ value: ':=', name: 'Is' });
const BEFORE = Object.freeze({ value: ':<', name: 'Less_Than' });
/* The spans the task filter offers for a due date, each with the comparison its row saves (frontend TaskFilter and buildFilterQuery). */
const DUE = Object.freeze({
    today: [IS, 'Today'], tomorrow: [IS, 'Tomorrow'], this_week: [IS, 'This week'], next_week: [IS, 'Next week'],
    next_7_days: [IS, 'Next 7 days'], this_month: [IS, 'This month'], overdue: [BEFORE, 'Today'],
});
const DUE_FIELD = Object.freeze({ value: 'DueDate', name: 'due_date', type: 'date', filterOn: 'DueDate' });
const DATE_RANGE = 'Date range';

const FIELD_ROUTE = '/api/v1/customField';
const ROUTES = Object.freeze({
    fieldInsert: { routes: () => require('../CustomField/routes'), method: 'post', path: FIELD_ROUTE },
    fieldUpdate: { routes: () => require('../CustomField/routes'), method: 'put', path: FIELD_ROUTE },
    fieldCompute: { routes: () => require('../CustomField/routes'), method: 'post', path: '/api/v2/custom-fields/compute' },
    viewCreate: { routes: () => require('../Project/routes'), method: 'post', path: '/api/v1/project/:id/views' },
    projectUpdate: { routes: () => require('../Project/routes'), method: 'put', path: '/api/v1/project/:id' },
    projectCreate: { routes: () => require('../createProject/routes'), method: 'post', path: '/api/v1/createproject' },
    statusInsert: { routes: () => require('../settings/templates/routes'), method: 'put', path: '/api/v1/setting/taskStatus' },
    folderCreate: { routes: () => require('../Sprints/routes'), method: 'post', path: '/api/v1/folder' },
    folderUpdate: { routes: () => require('../Sprints/routes'), method: 'patch', path: '/api/v1/folder/:id' },
    sprintScrum: { routes: () => require('../Sprints/routes'), method: 'post', path: '/api/v2/sprints/scrum' },
    projectDuplicate: { routes: () => require('../ProjectDuplicate/routes'), method: 'post', path: '/api/v2/projects/:id/duplicate' },
    dashboardRead: { routes: () => require('../UserDashboard/routes'), method: 'get', path: '/api/v1/dashboards/:id' },
    dashboardCreate: { routes: () => require('../UserDashboard/routes'), method: 'post', path: '/api/v1/dashboards' },
    dashboardCards: { routes: () => require('../UserDashboard/routes'), method: 'put', path: '/api/v1/dashboards/:id/cards' },
    dashboardDelete: { routes: () => require('../UserDashboard/routes'), method: 'delete', path: '/api/v1/dashboards/:id' },
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

/* What that route answers to `who`, with the status it set and no HTTP around it. `set` is what the server itself
 * puts on the request, which no client can send. */
const answerOf = (name, { companyId, who, params = {}, body = {}, set = {} }) => runAs(who.mark, () => new Promise((resolve, reject) => {
    const chain = chainOf(name);
    const res = { statusCode: 200 };
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (sent) => { resolve({ code: res.statusCode, body: sent }); return res; };
    res.send = res.json;
    const req = { ...set, uid: who.uid, aud: String(companyId), headers: { companyid: String(companyId) }, params, query: {}, body };
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

/* What a caller names for one field, kept as plain text: its name, one of the types the field form offers, a dropdown's
 * options, and what a rollup or a formula works out. */
const draftOf = (given) => {
    const field = given && typeof given === 'object' ? given : {};
    const type = CREATE_TYPES.includes(field.type) ? field.type : '';
    const note = lineOf(field.description, NOTE_MAX);
    return {
        name: lineOf(field.name, FIELD_NAME_MAX), type,
        ...(type === 'dropdown' ? { options: optionsOf(field.options) } : {}),
        ...computed.partOf(field, type, (name) => lineOf(name, FIELD_NAME_MAX)),
        ...(note ? { description: note } : {}),
    };
};

const draftProblem = (draft) => {
    if (!draft.name) return 'needs a name';
    if (!draft.type) return `needs a type, which is one of ${CREATE_TYPES.join(', ')}`;
    if (draft.type === 'dropdown' && !draft.options.length) return 'is a dropdown, which needs at least one option';
    return computed.problemOf(draft);
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
const definitionOf = (draft, { projectId, uid, sourceId }) => {
    const { fieldDefinitionFrom, newOption } = require('../Importers/helpers/clickupFields');
    return fieldDefinitionFrom({
        fieldTitle: draft.name,
        fieldType: draft.type,
        fieldDescription: draft.description || draft.name,
        ...(draft.type === 'dropdown' ? { fieldOptions: draft.options.map(newOption) } : {}),
        ...computed.settingsOf(draft, sourceId),
    }, { projectId, userId: uid });
};

const fieldsOfProject = async (companyId, projectId) => {
    const { isTaskFieldOf } = require('../CustomField/helpers/fieldValueInput');
    const rows = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.CUSTOM_FIELDS, data: [{ type: 'task', isDelete: { $ne: false } }] }, 'find');
    return (rows || []).filter((definition) => isTaskFieldOf(definition, projectId));
};

/* A route of the web app that answers with this or more failed itself: the same request may pass later. */
const SERVER_FAULT = 500;
const heldField = (definition) => ({ name: definition.fieldTitle || '', type: definition.fieldType || '', fieldId: idOf(definition._id) });
const fieldNamed = (fields, name) => (name ? fields.find((field) => sameName(field.name, name)) : undefined);

/* What an agent needs to tell fields of one name apart when it asks the person which one they mean. */
const fieldChoice = (definition) => {
    const { optionsOf: optionRows, optionLabel } = require('../CustomField/helpers/fieldValueInput');
    return { fieldId: idOf(definition._id), name: definition.fieldTitle || '', type: definition.fieldType || '', options: optionRows(definition).map(optionLabel) };
};

/* Field types whose check turns a value away, so a value that fits one of them alone says which field was meant.
 * Text takes anything, so a value that fits only a text field says nothing about the typed fields beside it. */
const TELLING_TYPES = Object.freeze(['dropdown', 'number', 'money', 'date', 'checkbox', 'email']);

/* The held field a value names, by its id or its name. Of several fields with that name, one is taken only when the
 * value fits it alone and its type could have turned the value away; otherwise `choices` lists them all, so the agent asks. */
const fieldForValue = (held, entry) => {
    const byId = isId(entry.field) && held.find((field) => idOf(field._id).toLowerCase() === lower(entry.field));
    if (byId) return { definition: byId };
    const named = held.filter((field) => sameName(field.fieldTitle, entry.field));
    if (named.length < 2) return { definition: named[0] };
    const { storedValueOf } = require('../CustomField/helpers/fieldValueInput');
    const fitting = named.filter((field) => !storedValueOf(field, entry.value).error);
    return fitting.length === 1 && TELLING_TYPES.includes(fitting[0].fieldType) ? { definition: fitting[0] } : { choices: named.map(fieldChoice) };
};

const choicesText = (name, choices) => `${choices.length} fields of this project are named "${name}": `
    + choices.map((choice) => `${choice.fieldId} (${choice.type}${choice.options.length ? `: ${choice.options.join(', ')}` : ''})`).join('; ')
    + '. Ask the person which one they mean and give its fieldId as field.';

const saveField = async ({ companyId, who, projectId, draft, source }) => {
    const unreadable = computed.sourceProblem(draft, source);
    if (unreadable) return { name: draft.name, type: draft.type, made: false, error: unreadable };
    const updateObject = definitionOf(draft, { projectId, uid: who.uid, sourceId: source ? source.fieldId : '' });
    const answer = await answerOf('fieldInsert', { companyId, who, body: { type: 'save', updateObject } });
    const saved = answer.code === 200 && answer.body && answer.body._id;
    return saved
        ? { name: draft.name, type: draft.type, fieldId: idOf(answer.body._id), made: true }
        : { name: draft.name, type: draft.type, made: false, error: reasonOf(answer, 'the field was not saved'), ...(answer.code >= SERVER_FAULT ? { tryAgain: true } : {}) };
};

/* One answer per field named: made, kept because the project already has a field of that name, or why it was not saved. */
const createFields = async ({ companyId, who, projectId, definitions }) => {
    const project = await storedProject(companyId, projectId);
    const inProject = idOf(project._id);
    const problem = draftsProblem(definitions);
    if (problem) throw refuse(problem);
    const known = (await fieldsOfProject(companyId, inProject)).map(heldField);
    const drafts = draftsOf(definitions);
    const fields = [];
    for (const at of computed.saveOrder(drafts, sameName)) {
        const draft = drafts[at];
        const existing = fieldNamed(known, draft.name);
        fields[at] = existing
            ? { ...existing, made: false }
            : await saveField({ companyId, who, projectId: inProject, draft, source: fieldNamed(known, draft.source) });
        if (fields[at].made) known.push(fields[at]);
    }
    return { project, projectId: inProject, fields };
};

/* What stops the first rollup or formula that the field form would not save once the call is approved, or ''. */
const draftsMisfit = async ({ companyId, projectId, definitions }) => {
    const drafts = draftsOf(definitions);
    if (!drafts.some((draft) => computed.isComputed(draft.type))) return '';
    const held = (await fieldsOfProject(companyId, projectId)).map(heldField);
    for (const [at, draft] of drafts.entries()) {
        if (fieldNamed(held, draft.name)) continue;
        const others = drafts.filter((other) => other !== draft);
        const reason = computed.sourceProblem(draft, fieldNamed([...held, ...others], draft.source)) || await computed.formulaMisfit(companyId, draft);
        if (reason) return `fields[${at}] (${draft.name}) ${reason}`;
    }
    return '';
};

const isPart = (value) => (typeof value === 'string' && value.length <= VALUE_TEXT_MAX) || (typeof value === 'number' && Number.isFinite(value));
const isValue = (value) => value === null || typeof value === 'boolean' || isPart(value) || (Array.isArray(value) && value.length <= VALUE_PARTS_MAX && value.every(isPart));

const valuesOf = (given) => listOf(given).map((entry) => ({ taskId: idOf(entry.taskId).toLowerCase(), field: lineOf(entry.field, FIELD_NAME_MAX), value: entry.value }));

/* '' when every value names a task and a field and holds what a field can store; otherwise which one does not. */
const valuesProblem = (given) => {
    if (given === undefined) return '';
    const entries = listOf(given);
    if (!entries.length || entries.length > VALUES_MAX) return `values needs 1 to ${VALUES_MAX} values`;
    const at = entries.findIndex((entry) => !entry || !isId(entry.taskId) || !lineOf(entry.field, FIELD_NAME_MAX) || !isValue(entry.value));
    return at < 0 ? '' : `values[${at}] needs a task id, the name of a field, and a value that is text, a number, true or false, a list of those, or null`;
};

/* What stops the first value that could not be set once the fields exist, or ''. `taskIds` are the tasks of the project the caller may open. */
const valuesMisfit = async ({ companyId, uid, projectId, definitions, values, taskIds }) => {
    const { storedValueOf } = require('../CustomField/helpers/fieldValueInput');
    const held = await fieldsOfProject(companyId, projectId);
    const drafts = draftsOf(definitions);
    for (const [at, entry] of valuesOf(values).entries()) {
        if (!taskIds.includes(entry.taskId)) return `values[${at}]: ${NO_TASK}`;
        const found = fieldForValue(held, entry);
        if (found.choices) return `values[${at}]: ${choicesText(entry.field, found.choices)}`;
        const draft = drafts.find((named) => sameName(named.name, entry.field));
        const definition = found.definition || (draft && definitionOf(draft, { projectId, uid }));
        if (!definition) return `values[${at}] names "${entry.field}", which is not a field of this call or of the project`;
        const read = storedValueOf(definition, entry.value);
        if (read.error) return `values[${at}] (${definition.fieldTitle}) ${read.error}`;
    }
    return '';
};

/* One value, set the way task.field.set sets it, on a live task of the project that the person behind the agent
 * and the approver can both open and both may edit the fields of. A task either cannot open answers as a task that is not there. */
const setValue = async ({ companyId, actor, depth, approvedBy, projectId, held, entry }) => {
    const permissions = require('./permissions');
    const { readableTaskIds } = require('../Tasks/helpers/taskWritePlacement');
    const { definition, choices } = fieldForValue(held, entry);
    if (choices) throw refuse(choicesText(entry.field, choices));
    if (!definition) throw refuse(`This project has no field called "${entry.field}". Check fields.list.`);
    const task = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.TASKS, data: [{ _id: tools.oid(entry.taskId), ProjectID: { $in: idForms(projectId) }, deletedStatusKey: { $ne: 1 } }, { _id: 1 }],
    }, 'findOne');
    const people = [actor, ...(approvedBy ? [{ kind: 'human', userId: approvedBy }] : [])];
    for (const person of people) {
        if (!task || !(await readableTaskIds(companyId, idOf(person.userId), [entry.taskId])).includes(entry.taskId)) throw refuse(NO_TASK);
    }
    for (const person of people) {
        const may = await permissions.holderMay(companyId, person, FIELD_SET, { taskId: entry.taskId });
        if (!may.allowed) throw refuse(person === actor ? may.reason : `The person approving may not set a field on this task: ${may.reason}`);
    }
    const fieldId = idOf(definition._id);
    const out = await require('./taskRequests').executors[FIELD_SET]({ companyId, actor, params: { taskId: entry.taskId, fieldId, value: entry.value }, depth });
    if (require('./actor').isAgent(actor)) await require('../Tasks/helpers/completionStore').recordWork(companyId, entry.taskId, require('./actions').workEntry(actor, 0));
    return { item: { taskId: entry.taskId, field: definition.fieldTitle || entry.field, set: true }, undo: { taskId: entry.taskId, fieldId, previous: out.undo.previous[`customField.${fieldId}`] } };
};

/* One answer per value: set, or why not. A value that is not set stops no other. */
const setValues = async ({ values, ...context }) => {
    const usable = require('./registry').has(FIELD_SET);
    const held = usable ? await fieldsOfProject(context.companyId, context.projectId) : [];
    const items = [];
    const undos = [];
    for (const entry of values) {
        try {
            if (!usable) throw refuse(`${FIELD_SET} is not available here, so values cannot be set. Leave values out.`);
            const done = await setValue({ ...context, held, entry });
            items.push(done.item);
            undos.push(done.undo);
        } catch (error) {
            items.push({ taskId: entry.taskId, field: entry.field, set: false, error: error.message });
        }
    }
    return { items, undos };
};

const storedField = (companyId, fieldId) => (isId(fieldId)
    ? MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.CUSTOM_FIELDS, data: [{ _id: tools.oid(fieldId) }] }, 'findOne')
    : null);

const holdsValues = async (companyId, projectId, fieldId) => Boolean(await MongoDbCrudOpration(companyId, {
    type: SCHEMA_TYPE.TASKS,
    data: [{ ProjectID: { $in: idForms(projectId) }, [`customField.${fieldId}`]: { $exists: true }, deletedStatusKey: { $ne: 1 } }, { _id: 1 }],
}, 'findOne'));

/* The number a task stores for a rollup or a formula was worked out, not typed, so it holds no field back. */
const whyKept = async (companyId, projectId, field) => {
    const elsewhere = field.global === true || [].concat(field.projectId || []).map(String).some((id) => id !== projectId);
    if (elsewhere) return 'it is on other projects now';
    if (computed.isComputed(field.fieldType)) return '';
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
const isDay = (value) => typeof value === 'string' && ISO_DAY.test(value) && DateTime.fromISO(value).isValid;
const isSpan = (value) => typeof value === 'string' && Object.hasOwn(DUE, value);
const isRange = (look) => isDay(look.dueFrom) && isDay(look.dueTo) && look.dueFrom <= look.dueTo;
const dueOf = (look) => {
    if (isRange(look)) return { dueFrom: look.dueFrom, dueTo: look.dueTo };
    return isSpan(look.due) ? { due: look.due } : {};
};

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
        ...dueOf(look),
        ...(search ? { search } : {}),
        ...(SUBTASKS.includes(look.subtasks) ? { subtasks: look.subtasks } : {}),
        ...(showFieldIds.length ? { showFieldIds } : {}),
    };
};

const dueProblem = (look) => {
    const ranged = look.dueFrom !== undefined || look.dueTo !== undefined;
    if (look.due !== undefined && ranged) return 'name due or a range of days (dueFrom and dueTo), not both';
    if (look.due !== undefined && !isSpan(look.due)) return `due must be one of ${Object.keys(DUE).join(', ')}`;
    if (!ranged) return '';
    if (!isDay(look.dueFrom) || !isDay(look.dueTo)) return 'a range of days needs dueFrom and dueTo, each a day as YYYY-MM-DD';
    return look.dueFrom <= look.dueTo ? '' : 'dueFrom is after dueTo';
};

const lookProblem = (given) => {
    const look = given && typeof given === 'object' ? given : {};
    if (look.groupBy !== undefined && !isGroup(look.groupBy)) return `groupBy must be one of ${Object.keys(GROUPS).join(', ')}, or the id of a custom field`;
    if (look.sortBy !== undefined && !isSort(look.sortBy)) return `sortBy must be one of ${Object.keys(SORTS).join(', ')}, or the id of a custom field`;
    if (look.sortDirection !== undefined && look.sortBy === undefined) return 'sortDirection needs sortBy';
    return dueProblem(look);
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

/* A day is kept with no zone, so each person's browser reads it as that day where they are. */
const dueRow = (look) => {
    if (look.dueFrom) return { name: DUE_FIELD, comparison: IS, values: [DATE_RANGE], condition: '&&', date: [look.dueFrom, look.dueTo].map((day) => `${day}T00:00:00`) };
    if (!look.due) return null;
    const [comparison, span] = DUE[look.due];
    return { name: DUE_FIELD, comparison, values: [span], condition: '&&' };
};

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
            dueRow(look),
        ].filter(Boolean),
        columns: { shown: listOf(look.showFieldIds).map((id) => `cf:${id}`) },
    };
    const fitted = await require('../ViewTemplates/templateStore').fitToProject(companyId, project, { settings: raw });
    return { settings: fitted.settings, leftOut: unique([...fitted.leftOut, ...(keys.length < named.length ? ['filters'] : [])]) };
};

const filterKey = (row) => JSON.stringify([row.name.filterOn, row.comparison.value, row.values.map(String).sort(), row.date]);
const tasksShownBy = (settings) => ({
    me: settings.me, assignees: [...settings.assignees].sort(), search: settings.search.trim().toLowerCase(), doneBy: settings.doneBy,
    filters: settings.filters.map(filterKey).sort(),
});

/* The project's own saved view of that kind that already shows what was named and nothing narrower: the same
 * tasks, and the same grouping when one is named. null when there is none, or the project lacks a status or a field named. */
const savedViewShowing = async (companyId, project, kind, look) => {
    const { cleanViewSettings } = require('../Project/helpers/viewSettings');
    const { isCopyable } = require('../Project/controller/viewSettings');
    const asked = lookOf(look);
    const wanted = await settingsFor(companyId, project, asked);
    if (wanted.leftOut.length) return null;
    const shows = (view) => {
        const held = cleanViewSettings(view.settings);
        return (asked.groupBy === undefined || held.groupBy === wanted.settings.groupBy) && isDeepStrictEqual(tasksShownBy(held), tasksShownBy(wanted.settings));
    };
    return viewsOf(project).find((view) => view && view.keyName === VIEW_KINDS[kind] && isCopyable(view) && view.viewStatus !== false && view.isPrivate !== true && shows(view)) || null;
};

const addressOf = (companyId, made) => {
    const base = require('../Mcp/screenTools').webBase();
    return base ? `${base}/#/${encodeURIComponent(String(companyId))}/project/${made.projectId}/p?tab=${made.keyName}&view=${made.viewId}` : '';
};

const createView = async ({ companyId, who, projectId, name, kind = 'list', look }) => {
    const project = await storedProject(companyId, projectId);
    const inProject = idOf(project._id);
    if (!Object.hasOwn(VIEW_KINDS, kind)) throw refuse(`The kind of view must be one of ${Object.keys(VIEW_KINDS).join(', ')}.`);
    const problem = lookProblem(look);
    if (problem) throw refuse(problem);
    const source = sourceView(project, kind);
    if (!source) throw refuse(noSource(kind));
    const fitted = await settingsFor(companyId, project, lookOf(look));
    const answer = await answerOf('viewCreate', { companyId, who, params: { id: inProject }, body: { sourceViewId: viewIdOf(source), title: viewNameOf(name), settings: fitted.settings } });
    if (answer.code !== 200 || !answer.body || answer.body.status !== true) {
        throw Object.assign(refuse(reasonOf(answer, 'The view was not added. Try again, or tell the person.')), answer.code >= SERVER_FAULT ? { tryAgain: true } : {});
    }
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
    if (answer.code !== 200) throw refuse(reasonOf(answer, 'The view was not removed. Try again, or tell the person.'));
    socketEmitter.emit('update', { type: 'update', companyId: String(companyId), data: await storedProject(companyId, inProject), updatedFields: { ProjectRequiredComponent: 'remove' }, module: 'project' });
    return { removed: true, name: view.title || '' };
};

const executors = {
    async 'fields.create'({ companyId, actor, params, depth, approvedBy }) {
        const problem = valuesProblem(params.values);
        if (problem) throw refuse(problem);
        const out = await createFields({ companyId, who: whoOf(actor, depth), projectId: params.projectId, definitions: params.definitions });
        const values = params.values === undefined ? null : await setValues({ companyId, actor, depth, approvedBy, projectId: out.projectId, values: valuesOf(params.values) });
        const made = out.fields.filter((field) => field.made);
        const set = values ? values.undos : [];
        const failed = [...out.fields, ...(values ? values.items : [])].filter((entry) => entry.error).map((entry) => `${entry.name || entry.field}: ${entry.error}`);
        if (!made.length && !set.length && failed.length) throw refuse(unique(failed).join('; '));
        return {
            result: { projectId: out.projectId, made: made.length, fields: out.fields, ...(values ? { values: values.items } : {}) },
            undo: made.length || set.length
                ? { kind: 'fields', projectId: out.projectId, fieldIds: made.map((field) => field.fieldId), ...(set.length ? { values: set } : {}) }
                : null,
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
    executors, answerOf, reasonOf, lineOf, createFields, createView, withdrawFields, withdrawView, draftsOf, draftsProblem, draftsMisfit, valuesOf, valuesProblem, valuesMisfit, fieldChoice, lookOf, lookProblem, viewNameOf, viewIdOf, sourceView, noSource, savedViewShowing,
    FIELD_TYPES, CREATE_TYPES, FIELDS_MAX, FIELD_NAME_MAX, OPTIONS_MAX, OPTION_MAX, NOTE_MAX, VALUES_MAX, FIELD_SET, VIEW_KINDS, VIEW_NAME_MAX, GROUPS, SORTS, DIRECTIONS, PRIORITIES, SUBTASKS, LOOK_MAX, DUE,
};
