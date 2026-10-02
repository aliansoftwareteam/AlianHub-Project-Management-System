const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { settingsCollectionDocs } = require('../../Config/collections');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { idForms } = require('../../utils/mongo-handler/objectIdKeys');
const socketEmitter = require('../../event/socketEventEmitter');
const tools = require('../Automations/engine/tools');
const permissions = require('./permissions');
const setup = require('./setupRequests');
const { storedProject, whoOf } = require('./taskRequests');

// One plan for a project that exists: statuses, lists, fields and views. Each part is made by the route the web app
// calls for it, as the person behind the agent, and only where the person who approved may make that part by hand
// too. A part that fails is reported beside the parts that worked. Taking a plan back removes what it made, part
// by part, and leaves whatever is in use by then.

const PARTS = Object.freeze(['statuses', 'lists', 'fields', 'views']);
const PLAN_KEY = Object.freeze({ statuses: 'statuses', lists: 'lists', fields: 'definitions', views: 'views' });
const STATUSES_MAX = 10;
const LISTS_MAX = 10;
const VIEWS_MAX = 5;
const STATUS_NAME_MAX = setup.LOOK_MAX.status;
const CLOSING_TYPES = Object.freeze(['done', 'close']);
const NEW_STATUS_COLOURS = Object.freeze(['#6473e8', '#ff9600', '#9b59b6', '#00a3bf', '#e8590c', '#2f9e44']);
const LIST_CREATE = 'project.project_sprint_create';
const ADMIN_ONLY = 'the company does not have this status yet, and only an owner or an admin adds one';

const work = () => require('./workRequests');
const refuse = (message) => new tools.DeterministicError(message);
const idOf = (value) => (value === undefined || value === null ? '' : String(value));
const lower = (value) => String(value).trim().toLowerCase();
const listOf = (value) => (Array.isArray(value) ? value : []);
const objectOf = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});
const unique = (values) => [...new Set(values)];
const sameName = (a, b) => lower(a) === lower(b);
const plain = (row) => (row && typeof row.toObject === 'function' ? row.toObject() : row);

const listNameMax = () => work().LIST_NAME_MAX;
const namesOf = (given, max) => listOf(given).map((name) => setup.lineOf(name, max));
const fieldsGiven = (plan) => (plan.definitions !== undefined ? plan.definitions : plan.fields);
const lookGiven = (view) => (view.look && typeof view.look === 'object' ? view.look : view);

const viewOf = (given) => {
    const view = objectOf(given);
    const showFields = unique(namesOf(view.showFields, setup.FIELD_NAME_MAX).filter(Boolean)).slice(0, setup.LOOK_MAX.columns);
    return {
        name: setup.viewNameOf(view.name),
        kind: view.kind === undefined || view.kind === '' ? 'list' : String(view.kind),
        look: setup.lookOf(lookGiven(view)),
        ...(showFields.length ? { showFields } : {}),
    };
};

/* What a caller names, kept as plain text and held to what each part's own tool takes; a part left out is left out. */
const planOf = (given) => {
    const plan = objectOf(given);
    const statuses = namesOf(plan.statuses, STATUS_NAME_MAX);
    const lists = namesOf(plan.lists, listNameMax());
    const definitions = setup.draftsOf(fieldsGiven(plan));
    const views = listOf(plan.views).map(viewOf);
    return {
        ...(statuses.length ? { statuses } : {}),
        ...(lists.length ? { lists } : {}),
        ...(definitions.length ? { definitions } : {}),
        ...(views.length ? { views } : {}),
    };
};

const partsOf = (plan) => PARTS.filter((part) => listOf(plan[PLAN_KEY[part]]).length > 0);
const namesIn = (plan, part) => listOf(plan[PLAN_KEY[part]]).map((entry) => (typeof entry === 'string' ? entry : entry.name));

const namesProblem = (part, given, max, nameMax) => {
    if (given === undefined) return '';
    const names = namesOf(given, nameMax);
    if (!names.length || names.length > max) return `${part} needs 1 to ${max} names`;
    if (names.some((name) => !name)) return `${part} needs some text for each name`;
    const twice = names.find((name, at) => names.findIndex((other) => sameName(other, name)) !== at);
    return twice ? `"${twice}" is named twice in ${part}` : '';
};

const viewsProblem = (plan) => {
    if (plan.views === undefined) return '';
    const given = listOf(plan.views);
    if (!given.length || given.length > VIEWS_MAX) return `views needs 1 to ${VIEWS_MAX} views`;
    const planned = setup.draftsOf(fieldsGiven(plan)).map((draft) => draft.name);
    for (const [at, entry] of given.entries()) {
        const view = viewOf(entry);
        const where = `views[${at}]${view.name ? ` (${view.name})` : ''}`;
        if (!view.name) return `${where} needs a name`;
        if (!Object.hasOwn(setup.VIEW_KINDS, view.kind)) return `${where} needs a kind: one of ${Object.keys(setup.VIEW_KINDS).join(', ')}`;
        const wrong = setup.lookProblem(lookGiven(objectOf(entry)));
        if (wrong) return `${where}: ${wrong}`;
        const unknown = listOf(view.showFields).find((name) => !planned.some((field) => sameName(field, name)));
        if (unknown) return `${where} shows "${unknown}", which is not a field of this plan; a field the project already has goes in showFieldIds`;
    }
    const names = given.map((entry) => viewOf(entry).name);
    const twice = names.find((name, at) => names.findIndex((other) => sameName(other, name)) !== at);
    return twice ? `"${twice}" is named twice in views` : '';
};

/* '' for a plan every part of which can be asked for; otherwise what is wrong with it. */
const planProblem = (given) => {
    const plan = objectOf(given);
    const fields = fieldsGiven(plan);
    if ([plan.statuses, plan.lists, fields, plan.views].every((part) => part === undefined)) return `the plan needs at least one of ${PARTS.join(', ')}`;
    return namesProblem('statuses', plan.statuses, STATUSES_MAX, STATUS_NAME_MAX)
        || namesProblem('lists', plan.lists, LISTS_MAX, listNameMax())
        || (fields !== undefined ? setup.draftsProblem(fields) : '')
        || viewsProblem(plan);
};

/* The keys the web app's route for a part asks of a person in that project. */
const keysOf = (part, uid) => {
    const { FIELD_PERMISSIONS, permissionsForProjectUpdate } = require('../../Config/projectAccess');
    if (part === 'statuses') return permissionsForProjectUpdate({ taskStatusData: [] }, uid);
    if (part === 'lists') return [LIST_CREATE];
    return [FIELD_PERMISSIONS.ProjectRequiredComponent];
};

/* '' where `uid` may make that part of a plan by hand in the project; otherwise the key that person lacks. */
const whyNot = async (companyId, uid, projectId, part) => {
    if (part === 'fields') {
        const held = await permissions.holderMay(companyId, { kind: 'human', userId: uid }, 'fields.create', { projectId });
        return held.allowed ? '' : `${held.permission} is not granted`;
    }
    const keys = keysOf(part, uid);
    const access = await require('../../Config/projectAccess').canEditProject(companyId, uid, projectId, keys);
    return access.allowed ? '' : `${access.permission || keys.flat().join(' or ')} is not granted`;
};

/* The parts of a plan `uid` may not make, each with the reason. */
const refusedParts = async (companyId, uid, projectId, plan) => {
    const refused = [];
    for (const part of partsOf(plan)) {
        const reason = await whyNot(companyId, uid, projectId, part);
        if (reason) refused.push({ part, reason });
    }
    return refused;
};

const isAdmin = async (companyId, uid) => {
    const { getRoleType, isPrivileged } = require('../../Config/permissionGuard');
    return isPrivileged(await getRoleType(companyId, uid));
};

const companyStatuses = async (companyId) => {
    const doc = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.SETTINGS, data: [{ name: settingsCollectionDocs.TASK_STATUS }] }, 'findOne');
    return listOf(doc && doc.settings).map(plain).filter((status) => status && status.isDeleted !== true);
};

/* A status the company does not have is added to its list first, as the settings screen adds one: by an owner or an admin. */
const addToCompany = async ({ companyId, who, approvedBy, name, at }) => {
    if (approvedBy && !(await isAdmin(companyId, approvedBy))) throw refuse(ADMIN_ONLY);
    const colour = NEW_STATUS_COLOURS[at % NEW_STATUS_COLOURS.length];
    const answer = await setup.answerOf('statusInsert', { companyId, who, body: { name, textColor: colour, bgColor: `${colour}35`, isDeleted: false } });
    const saved = answer.code === 200 ? listOf(answer.body && answer.body.settings).map(plain).filter((status) => status && sameName(status.name, name)).pop() : null;
    if (!saved) throw refuse(setup.reasonOf(answer, 'the status was not added'));
    return saved;
};

/* The project's statuses are saved as the status form saves them: the whole list, through the project route. */
const saveStatuses = async ({ companyId, who, projectId, next }) => {
    const answer = await setup.answerOf('projectUpdate', { companyId, who, params: { id: projectId }, body: { updateObject: { taskStatusData: next } } });
    if (answer.code !== 200) return setup.reasonOf(answer, 'the statuses were not saved');
    socketEmitter.emit('update', { type: 'update', companyId: String(companyId), data: await storedProject(companyId, projectId), updatedFields: { taskStatusData: next }, module: 'project' });
    return '';
};

/* A new status is a working stage: it goes after the stages the project has and before the ones that close a task. */
const addStatuses = async ({ companyId, who, approvedBy, project, projectId, plan }) => {
    const held = listOf(project.taskStatusData).map(plain);
    const known = await companyStatuses(companyId);
    const added = [];
    const items = [];
    for (const name of plan.statuses) {
        const has = [...held, ...added].find((status) => sameName(status.name || '', name));
        if (has) {
            items.push({ name: has.name, made: false, statusKey: has.key });
            continue;
        }
        try {
            const entry = known.find((status) => sameName(status.name || '', name))
                || await addToCompany({ companyId, who, approvedBy, name, at: known.length + added.length });
            added.push({ name: entry.name, bgColor: entry.bgColor, textColor: entry.textColor, key: entry.key, type: 'active' });
            items.push({ name: entry.name, made: true, statusKey: entry.key });
        } catch (error) {
            items.push({ name, made: false, error: error.message });
        }
    }
    if (!added.length) return items;
    const closing = held.findIndex((status) => CLOSING_TYPES.includes(status.type));
    const at = closing < 0 ? held.length : closing;
    const failed = await saveStatuses({ companyId, who, projectId, next: [...held.slice(0, at), ...added, ...held.slice(at)] });
    return failed ? items.map((item) => (item.made ? { name: item.name, made: false, error: failed } : item)) : items;
};

const addLists = async ({ companyId, who, projectId, plan }) => {
    const items = [];
    for (const name of plan.lists) {
        try {
            const made = await work().createList({ companyId, who, projectId, name });
            items.push({ name: made.name, made: true, sprintId: made.sprintId });
        } catch (error) {
            items.push({ name, made: false, error: error.message });
        }
    }
    return items;
};

const addFields = async ({ companyId, who, projectId, plan }) => (await setup.createFields({ companyId, who, projectId, definitions: plan.definitions })).fields;

/* A view shows a field of the same plan by its name: the field made, or the one the project already had. */
const addViews = async ({ companyId, who, projectId, plan, fields }) => {
    const fieldId = (name) => idOf((fields.find((field) => field.fieldId && sameName(field.name, name)) || {}).fieldId);
    const items = [];
    for (const view of plan.views) {
        const named = listOf(view.showFields);
        const found = named.map(fieldId).filter(Boolean);
        const shown = unique([...listOf(view.look.showFieldIds), ...found]).slice(0, setup.LOOK_MAX.columns);
        try {
            const made = await setup.createView({ companyId, who, projectId, name: view.name, kind: view.kind, look: { ...view.look, ...(shown.length ? { showFieldIds: shown } : {}) } });
            items.push({ name: made.name, kind: made.kind, made: true, viewId: made.viewId, leftOut: unique([...made.leftOut, ...(found.length < named.length ? ['columns'] : [])]) });
        } catch (error) {
            items.push({ name: view.name, kind: view.kind, made: false, error: error.message });
        }
    }
    return items;
};

const MAKERS = Object.freeze({ statuses: addStatuses, lists: addLists, fields: addFields, views: addViews });

/* Every part in turn, each answered on its own: made, kept, or why not. */
const carryOut = async ({ companyId, who, approvedBy, projectId, plan }) => {
    const requester = await refusedParts(companyId, who.uid, projectId, plan);
    const approver = approvedBy ? await refusedParts(companyId, approvedBy, projectId, plan) : [];
    const barred = (part) => {
        const byApprover = approver.find((entry) => entry.part === part);
        if (byApprover) return `the approver may not make this part: ${byApprover.reason}`;
        const byRequester = requester.find((entry) => entry.part === part);
        return byRequester ? `${permissions.REASON}: ${byRequester.reason}` : '';
    };
    const parts = [];
    for (const part of partsOf(plan)) {
        const error = barred(part);
        if (error) {
            parts.push({ part, ok: false, error, items: [] });
            continue;
        }
        const fields = (parts.find((made) => made.part === 'fields') || { items: [] }).items;
        try {
            const items = await MAKERS[part]({ companyId, who, approvedBy, projectId, plan, fields, project: await storedProject(companyId, projectId) });
            parts.push({ part, ok: items.every((item) => !item.error), items });
        } catch (failure) {
            parts.push({ part, ok: false, error: failure.message, items: [] });
        }
    }
    return parts;
};

const madeIn = (parts, part) => ((parts.find((entry) => entry.part === part) || {}).items || []).filter((item) => item.made);

const notMadeIn = (parts, plan) => parts.flatMap((entry) => (entry.error
    ? namesIn(plan, entry.part).map((name) => ({ part: entry.part, name, error: entry.error }))
    : entry.items.filter((item) => item.error).map((item) => ({ part: entry.part, name: item.name, error: item.error }))));

const liveTaskIn = (companyId, projectId, filter) => MongoDbCrudOpration(companyId, {
    type: SCHEMA_TYPE.TASKS, data: [{ ProjectID: { $in: idForms(projectId) }, deletedStatusKey: { $ne: 1 }, ...filter }, { _id: 1 }],
}, 'findOne');

const withdrawViews = async ({ companyId, who, projectId, viewIds }, out) => {
    for (const viewId of listOf(viewIds)) {
        try {
            const gone = await setup.withdrawView({ companyId, who, projectId, viewId });
            if (gone.removed) out.removed.views.push(gone.name);
        } catch (error) {
            out.kept.push({ part: 'views', name: '', reason: error.message });
        }
    }
};

const withdrawFields = async ({ companyId, who, projectId, fieldIds }, out) => {
    if (!listOf(fieldIds).length) return;
    try {
        const gone = await setup.withdrawFields({ companyId, who, projectId, fieldIds });
        out.removed.fields.push(...gone.removed.map((field) => field.name));
        out.kept.push(...gone.kept.map((field) => ({ part: 'fields', name: field.name, reason: field.reason })));
    } catch (error) {
        out.kept.push({ part: 'fields', name: '', reason: error.message });
    }
};

const withdrawLists = async ({ companyId, who, projectId, lists }, out) => {
    for (const list of listOf(lists)) {
        try {
            await work().withdrawList({ companyId, who, projectId, sprintId: list.sprintId });
            out.removed.lists.push(list.name);
        } catch (error) {
            out.kept.push({ part: 'lists', name: list.name, reason: error.message });
        }
    }
};

/* A status goes only while no task of the project is in it. The company's own list of statuses keeps it, as it does when a person takes a status off a project. */
const withdrawStatuses = async ({ companyId, who, projectId, statusKeys }, out) => {
    const keys = listOf(statusKeys).map(String);
    if (!keys.length) return;
    const held = listOf((await storedProject(companyId, projectId)).taskStatusData).map(plain);
    const going = [];
    for (const status of held.filter((row) => keys.includes(String(row.key)))) {
        if (await liveTaskIn(companyId, projectId, { statusKey: status.key })) out.kept.push({ part: 'statuses', name: status.name, reason: 'a task is in this status' });
        else going.push(status);
    }
    if (!going.length) return;
    const failed = await saveStatuses({ companyId, who, projectId, next: held.filter((row) => !going.includes(row)) });
    if (failed) out.kept.push(...going.map((status) => ({ part: 'statuses', name: status.name, reason: failed })));
    else out.removed.statuses.push(...going.map((status) => status.name));
};

/* Taking a plan back, newest part first, as the person undoing: what it made is removed, and whatever is in use now stays and is named with the reason. */
const withdraw = async ({ companyId, who, made }) => {
    const projectId = idOf((await storedProject(companyId, made.projectId))._id);
    const out = { removed: { views: [], fields: [], lists: [], statuses: [] }, kept: [] };
    await withdrawViews({ companyId, who, projectId, viewIds: made.viewIds }, out);
    await withdrawFields({ companyId, who, projectId, fieldIds: made.fieldIds }, out);
    await withdrawLists({ companyId, who, projectId, lists: made.lists }, out);
    await withdrawStatuses({ companyId, who, projectId, statusKeys: made.statusKeys }, out);
    return out;
};

const executors = {
    async 'project.setup'({ companyId, actor, params, depth, approvedBy }) {
        const project = await storedProject(companyId, params.projectId);
        const projectId = idOf(project._id);
        const problem = planProblem(params);
        if (problem) throw refuse(problem);
        const plan = planOf(params);
        const parts = await carryOut({ companyId, who: whoOf(actor, depth), approvedBy: idOf(approvedBy), projectId, plan });
        const notMade = notMadeIn(parts, plan);
        const made = PARTS.reduce((count, part) => count + madeIn(parts, part).length, 0);
        if (!made && notMade.length) throw refuse(unique(notMade.map((entry) => `${entry.part}: ${entry.name}: ${entry.error}`)).join('; '));
        return {
            result: { projectId, made, parts, notMade },
            undo: made ? {
                kind: 'setup', projectId,
                statusKeys: madeIn(parts, 'statuses').map((item) => item.statusKey),
                lists: madeIn(parts, 'lists').map((item) => ({ sprintId: item.sprintId, name: item.name })),
                fieldIds: madeIn(parts, 'fields').map((item) => item.fieldId),
                viewIds: madeIn(parts, 'views').map((item) => item.viewId),
            } : null,
            entityType: 'project', entityId: projectId, entityName: project.ProjectName || '',
        };
    },
};

const inverses = {
    async setup(companyId, made, actor) {
        const out = await withdraw({ companyId, who: whoOf(actor), made });
        return { projectId: made.projectId, ...out };
    },
};

module.exports = { executors, inverses, planOf, planProblem, refusedParts, viewOf, partsOf, keysOf, carryOut, notMadeIn, PARTS, STATUSES_MAX, LISTS_MAX, VIEWS_MAX, STATUS_NAME_MAX };
