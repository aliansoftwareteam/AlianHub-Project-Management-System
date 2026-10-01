const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const registry = require('./registry');
const accounts = require('./accounts');
const { isAgent } = require('./actor');

// A project's own rule for agents, and the one function every agent write asks. It only holds an agent
// back: the registry, the never-list, the person's permissions, the manage grant and taint routing are
// asked around it exactly as they were, and an answer of "act" here grants nothing they refuse.

const DONE = Object.freeze({ NEVER: 'never', APPROVAL: 'approval', YES: 'yes' });
const CONNECTED = Object.freeze({ PROPOSE_ALL: 'propose_all', SINGLE_TASK: 'single_task' });
const DEFAULTS = Object.freeze({ done: DONE.APPROVAL, connected: CONNECTED.SINGLE_TASK });
const DECISION = Object.freeze({ ACT: 'act', PROPOSE: 'propose', REFUSE: 'refuse' });

const DONE_BY_STRICTNESS = Object.freeze([DONE.YES, DONE.APPROVAL, DONE.NEVER]);
const DECISION_BY_STRICTNESS = Object.freeze([DECISION.ACT, DECISION.PROPOSE, DECISION.REFUSE]);

// The workspace's "a person must check before Done" has always left the close itself to a person.
const WORKSPACE_CHECK_HOLDS_TO = DONE.NEVER;

// Records that a batch ran and changes nothing itself: each change in the batch asks on its own.
const ASKS_NOTHING = new Set(['tasks.batch']);
const STATUS_ACTIONS = new Set(['task.status.set', 'task.status.change']);
const CREATE_ACTIONS = new Set(['task.add', 'subtask.add']);

const REASON = Object.freeze({
    WORKSPACE_CHECK: 'this workspace has a person check an agent\'s work before it is closed, so a person closes this task',
    NEVER: 'this project has people close its tasks, so a person closes this task',
    APPROVAL: 'this project has a person approve an agent\'s close',
    PROPOSE_ALL: 'this project has connected agents propose every change',
    PROPOSE_ONLY: 'an agent never makes this kind of change on its own',
});

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const idOf = (value) => { const text = String(value || ''); return OBJECT_ID.test(text) ? text.toLowerCase() : ''; };
const oid = (id) => new mongoose.Types.ObjectId(id);
const act = Object.freeze({ decision: DECISION.ACT, reason: '' });

const stricter = (order) => (a, b) => (order.indexOf(b) > order.indexOf(a) ? b : a);
const stricterDone = stricter(DONE_BY_STRICTNESS);

const clean = (stored) => {
    const given = stored && typeof stored === 'object' ? stored : {};
    return {
        done: Object.values(DONE).includes(given.done) ? given.done : DEFAULTS.done,
        connected: Object.values(CONNECTED).includes(given.connected) ? given.connected : DEFAULTS.connected,
    };
};

const storedRow = (companyId, type, id, fields) => (idOf(id)
    ? MongoDbCrudOpration(companyId, { type, data: [{ _id: oid(idOf(id)) }, fields] }, 'findOne')
    : null);

const read = async (companyId, projectId) => {
    const project = await storedRow(companyId, SCHEMA_TYPE.PROJECTS, projectId, { agentPolicy: 1 });
    return clean(project && project.agentPolicy);
};

const effective = async (companyId, projectId) => {
    const [project, company] = await Promise.all([read(companyId, projectId), accounts.getPolicy(companyId)]);
    const workspaceChecksBeforeDone = Boolean(company.requireCheckBeforeDone);
    return {
        done: workspaceChecksBeforeDone ? stricterDone(project.done, WORKSPACE_CHECK_HOLDS_TO) : project.done,
        connected: project.connected,
        workspaceChecksBeforeDone,
    };
};

const validated = (given) => {
    const sent = given && typeof given === 'object' ? given : {};
    const named = ['done', 'connected'].filter((key) => sent[key] !== undefined);
    if (!named.length) return { error: 'Send done, connected or both.' };
    if (sent.done !== undefined && !Object.values(DONE).includes(sent.done)) return { error: `done must be one of ${Object.values(DONE).join(', ')}.` };
    if (sent.connected !== undefined && !Object.values(CONNECTED).includes(sent.connected)) return { error: `connected must be one of ${Object.values(CONNECTED).join(', ')}.` };
    return { values: Object.fromEntries(named.map((key) => [key, sent[key]])) };
};

/* Answers the project as it reads afterwards, with what it held before, or the reason nothing was saved. */
const save = async (companyId, projectId, given, updatedBy) => {
    const check = validated(given);
    if (check.error) return { error: check.error, status: 400 };
    const from = await read(companyId, projectId);
    const to = { ...from, ...check.values };
    const agentPolicy = { ...to, updatedBy: String(updatedBy), updatedAt: new Date() };
    const project = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.PROJECTS, data: [{ _id: oid(idOf(projectId)) }, { $set: { agentPolicy } }, { returnDocument: 'after' }],
    }, 'findOneAndUpdate');
    if (!project) return { error: 'Project not found.', status: 404 };
    return { from, to, project, agentPolicy };
};

const isConnected = (actor) => isAgent(actor) && Boolean(actor.tokenId || actor.clientId);

const projectOfRow = async (companyId, type, id) => {
    const row = await storedRow(companyId, type, id, { ProjectID: 1 });
    return row && row.ProjectID ? idOf(row.ProjectID) : '';
};

const projectsOf = async (companyId, params) => {
    const found = await Promise.all([
        idOf(params.projectId),
        projectOfRow(companyId, SCHEMA_TYPE.TASKS, params.taskId),
        projectOfRow(companyId, SCHEMA_TYPE.TASKS, params.relatedTaskId),
        projectOfRow(companyId, SCHEMA_TYPE.PAGES, params.pageId),
    ]);
    return [...new Set(found.filter(Boolean))];
};

const isDoneType = (statusType) => registry.DONE_STATUS_TYPES.includes(String(statusType || '').toLowerCase());

/* The project's done statuses of that name, matched as the status tools match one (resolveStatus in
 * Automations/engine/tools). Every status of the name counts, so a name two statuses share never reads as the open one. */
const doneStatusesNamed = async (companyId, projectId, name) => {
    const wanted = String(name || '').trim().toLowerCase();
    const project = wanted ? await storedRow(companyId, SCHEMA_TYPE.PROJECTS, projectId, { taskStatusData: 1 }) : null;
    return (Array.isArray(project && project.taskStatusData) ? project.taskStatusData : [])
        .map((row) => (row && row.convertStatus ? row.convertStatus : row))
        .filter((status) => status && String(status.name || '').trim().toLowerCase() === wanted && isDoneType(status.type));
};

/* Whether the change leaves a task in a done status it is not in now: a status change, or a task created already done. */
const closes = async (companyId, action, params) => {
    if (STATUS_ACTIONS.has(action)) {
        const status = params.status && typeof params.status === 'object' ? params.status : {};
        if (isDoneType(status.statusType || status.type)) return true;
        const task = await storedRow(companyId, SCHEMA_TYPE.TASKS, params.taskId, { ProjectID: 1, statusKey: 1 });
        if (!task) return false;
        return (await doneStatusesNamed(companyId, task.ProjectID, status.name || status.text)).some((next) => String(next.key) !== String(task.statusKey));
    }
    if (CREATE_ACTIONS.has(action) && params.fields && params.fields.status !== undefined) {
        const projectId = idOf(params.projectId) || await projectOfRow(companyId, SCHEMA_TYPE.TASKS, params.taskId);
        return (await doneStatusesNamed(companyId, projectId, params.fields.status)).length > 0;
    }
    return false;
};

/* What the projects a write reaches hold it to: act as the caller's other rules allow, wait for a person, or
 * not at all. `approved` is true only where a person has approved this very change. A write that names no
 * project, a goal's for one, is outside every project's rule. An action the registry marks proposeOnly waits
 * for a person whatever a project is set to: answered here, a caller files it instead of meeting the registry's refusal. */
const ask = async ({ companyId, actor, action, params = {}, approved = false }) => {
    const entry = registry.get(action);
    if (!isAgent(actor) || !entry || !entry.write || ASKS_NOTHING.has(entry.key)) return act;
    if (entry.proposeOnly && !approved) return { decision: DECISION.PROPOSE, reason: REASON.PROPOSE_ONLY };
    const mayClose = STATUS_ACTIONS.has(entry.key) || CREATE_ACTIONS.has(entry.key);
    if (!mayClose && !isConnected(actor)) return act;
    const given = params && typeof params === 'object' ? params : {};
    const projectIds = await projectsOf(companyId, given);
    if (!projectIds.length) return act;
    const policies = await Promise.all(projectIds.map((id) => read(companyId, id)));

    if (mayClose && await closes(companyId, entry.key, given)) {
        const company = await accounts.getPolicy(companyId);
        const workspace = company.requireCheckBeforeDone ? WORKSPACE_CHECK_HOLDS_TO : DONE.YES;
        const done = policies.map((policy) => policy.done).reduce(stricterDone, workspace);
        if (done === DONE.NEVER) return { decision: DECISION.REFUSE, reason: workspace === DONE.NEVER ? REASON.WORKSPACE_CHECK : REASON.NEVER };
        if (done === DONE.APPROVAL && !approved) return { decision: DECISION.PROPOSE, reason: REASON.APPROVAL };
    }
    if (!approved && isConnected(actor) && policies.some((policy) => policy.connected === CONNECTED.PROPOSE_ALL)) {
        return { decision: DECISION.PROPOSE, reason: REASON.PROPOSE_ALL };
    }
    return act;
};

/* The stricter of a verdict already reached and what the project holds the change to, in the verdict's shape. */
const review = async ({ companyId, actor, action, params, verdict }) => {
    const rule = await ask({ companyId, actor, action, params });
    const holds = DECISION_BY_STRICTNESS.indexOf(rule.decision) > DECISION_BY_STRICTNESS.indexOf(verdict.decision);
    return holds ? { ...verdict, decision: rule.decision, reason: rule.reason } : verdict;
};

module.exports = { DONE, CONNECTED, DEFAULTS, DECISION, REASON, read, effective, save, ask, review, isConnected };
