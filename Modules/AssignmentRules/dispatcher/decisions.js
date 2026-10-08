const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const { canReadTask } = require('../../Tasks/helpers/taskReadAccess');
const { RuleError, plain } = require('../rules');
const flag = require('./flag');
const settingsOf = require('./settings');
const gate = require('./gate');
const queue = require('./queue');
const audit = require('./audit');
const { isClosedTask } = require('../../Tasks/helpers/taskSignals');

/* The same lead choice this many times for one task type, and the dispatcher offers it as a rule. */
const OFFER_AFTER = 3;
const LISTED = 50;
const SHOWN = Object.freeze(['suggested', 'needs_routing', 'applied', 'accepted', 'routed']);
const PUBLIC_FIELDS = ['taskId', 'projectId', 'state', 'mode', 'role', 'source', 'ruleIndex', 'confidence', 'agentId', 'chosenRole', 'createdAt'];

const roleView = (key) => (key ? { key, name: settingsOf.roleName(key) } : null);

const publicView = (decision) => ({
    _id: String(decision._id),
    ...Object.fromEntries(PUBLIC_FIELDS.map((field) => [field, decision[field] === undefined ? null : decision[field]])),
    roleName: settingsOf.roleName(decision.chosenRole || decision.role),
});

const latest = async (companyId, taskId) => plain(await MongoDbCrudOpration(companyId, {
    type: SCHEMA_TYPE.DISPATCH_DECISIONS,
    data: [{ taskId: String(taskId), state: { $in: SHOWN } }, null, { sort: { createdAt: -1, _id: -1 }, limit: 1 }],
}, 'find'))?.[0] || null;

const readable = async (companyId, uid, taskId) => {
    const task = await gate.readTask(companyId, taskId);
    if (!task || !(await canReadTask(companyId, uid, task))) throw new RuleError('Task not found.', 404);
    return task;
};

const usableRoles = (settings) => settings.roles.filter((key) => !gate.roleProblem(settings, key)).map(roleView);

async function forTask(companyId, uid, taskId) {
    if (!flag.enabled()) return { on: false, decision: null, roles: [] };
    const task = await readable(companyId, uid, taskId);
    const settings = await settingsOf.load(companyId, task.ProjectID);
    if (settings.mode === 'off') return { on: false, decision: null, roles: [] };
    const decision = await latest(companyId, taskId);
    return { on: true, decision: decision ? publicView(decision) : null, roles: usableRoles(settings) };
}

async function needsRouting(companyId, uid, projectId) {
    if (!flag.enabled()) return { on: false, items: [] };
    const rows = (await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.DISPATCH_DECISIONS,
        data: [{ projectId: String(projectId), state: 'needs_routing' }, null, { sort: { createdAt: -1 }, limit: LISTED }],
    }, 'find') || []).map(plain);
    const items = [];
    for (const row of rows) {
        // eslint-disable-next-line no-await-in-loop
        const task = await gate.readTask(companyId, row.taskId);
        // eslint-disable-next-line no-await-in-loop
        if (task && await canReadTask(companyId, uid, task)) items.push({ decision: publicView(row), task: { _id: String(task._id), TaskName: task.TaskName || '', TaskKey: task.TaskKey || '' } });
    }
    return { on: true, items };
}

async function loadForAction(companyId, uid, taskId, decisionId) {
    if (!flag.enabled()) throw new RuleError('Not found.', 404);
    if (!mongoose.Types.ObjectId.isValid(String(decisionId || ''))) throw new RuleError('A valid decision id is required.');
    const task = await readable(companyId, uid, taskId);
    const decision = plain(await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.DISPATCH_DECISIONS,
        data: [{ _id: new mongoose.Types.ObjectId(String(decisionId)), taskId: String(task._id) }],
    }, 'findOne'));
    if (!decision) throw new RuleError('Suggestion not found.', 404);
    if (String(decision.projectId) !== String(task.ProjectID)) throw new RuleError('This task has moved to another project since the suggestion was made.', 409);
    if ((await settingsOf.load(companyId, task.ProjectID)).mode === 'off') throw new RuleError('The dispatcher is off in this project, so its suggestions can no longer be acted on.', 409);
    return { task, decision };
}

/* Only one caller wins a state change; the loser is told the suggestion has moved on. */
async function transition(companyId, decision, to, actorId, more = {}) {
    const now = new Date();
    const set = { state: to, resolvedBy: String(actorId), resolvedAt: now, updatedAt: now, ...more };
    const before = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.DISPATCH_DECISIONS,
        data: [{ _id: decision._id, state: { $in: gate.WAITING } }, { $set: set }],
    }, 'findOneAndUpdate');
    if (!before) throw new RuleError('This suggestion has already been handled.', 409);
    const after = { ...decision, ...set };
    gate.announce(companyId, after);
    return after;
}

async function assertCanRoute(companyId, task, role) {
    const settings = await settingsOf.load(companyId, task.ProjectID);
    if (isClosedTask(task)) throw new RuleError('This task is done, so it is not routed to an agent.', 409);
    if (gate.roleProblem(settings, role)) throw new RuleError('That role is not on for this project.', 409);
    if (await queue.paused(companyId, task.ProjectID)) throw new RuleError('Agents are paused in this project.', 409);
    return settings;
}

/* A queue write that failed after the claim gives the decision back to the leads, waiting as it was. */
async function restore(companyId, decision) {
    await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.DISPATCH_DECISIONS,
        data: [{ _id: decision._id }, { $set: { state: decision.state, resolvedBy: '', chosenRole: decision.chosenRole || null, agentId: decision.agentId || null, updatedAt: new Date() }, $unset: { resolvedAt: '' } }],
    }, 'updateOne');
    gate.announce(companyId, decision);
}

async function queueAs(companyId, actor, task, decision, to, role, agentId) {
    const done = await transition(companyId, decision, to, actor.id, to === 'routed' ? { chosenRole: role, agentId } : {});
    try {
        await queue.put(companyId, task, { role, agentId, by: actor.id, byPerson: true });
    } catch (error) {
        await restore(companyId, decision);
        throw error;
    }
    return done;
}

async function accept(companyId, actor, taskId, decisionId) {
    const { task, decision } = await loadForAction(companyId, actor.id, taskId, decisionId);
    if (decision.state !== 'suggested') throw new RuleError('This suggestion has already been handled.', 409);
    await assertCanRoute(companyId, task, decision.role);
    const done = await queueAs(companyId, actor, task, decision, 'accepted', decision.role, decision.agentId);
    audit.decided(companyId, actor, 'accept', task, { role: decision.role, agentId: decision.agentId, decisionId: String(decision._id) });
    return { decision: publicView(done), offer: null };
}

async function dismiss(companyId, actor, taskId, decisionId) {
    const { task, decision } = await loadForAction(companyId, actor.id, taskId, decisionId);
    const done = await transition(companyId, decision, 'dismissed', actor.id);
    audit.decided(companyId, actor, 'dismiss', task, { role: decision.role, from: decision.state, decisionId: String(decision._id) });
    return { decision: publicView(done), offer: null };
}

const ruleCovers = (settings, role, taskTypeKey) => settings.rules.some((rule) => rule.role === role && (rule.when.taskTypeKeys || []).includes(taskTypeKey));

/* After the same choice for the same task type OFFER_AFTER times, the rule a lead could add; it is never added here. */
async function offerFor(companyId, settings, decision, role) {
    if (decision.taskTypeKey === null || decision.taskTypeKey === undefined || ruleCovers(settings, role, decision.taskTypeKey)) return null;
    const same = Number(await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.DISPATCH_DECISIONS,
        data: [{ projectId: String(decision.projectId), state: 'routed', role: decision.role || null, chosenRole: role, taskTypeKey: decision.taskTypeKey }],
    }, 'countDocuments')) || 0;
    return same >= OFFER_AFTER ? { role: roleView(role), when: { taskTypeKeys: [decision.taskTypeKey] }, times: same } : null;
}

/* A lead picks the role: the dispatcher's own pick counts as an accept, any other as an override. */
async function route(companyId, actor, taskId, decisionId, role) {
    const { task, decision } = await loadForAction(companyId, actor.id, taskId, decisionId);
    if (!gate.WAITING.includes(decision.state)) throw new RuleError('This suggestion has already been handled.', 409);
    if (decision.state === 'suggested' && role === decision.role) return accept(companyId, actor, taskId, decisionId);
    const settings = await assertCanRoute(companyId, task, role);
    const agent = await queue.leastLoaded(companyId, role);
    const done = await queueAs(companyId, actor, task, decision, 'routed', role, agent ? agent.id : null);
    audit.decided(companyId, actor, 'route', task, { from: decision.role, to: role, agentId: agent ? agent.id : null, decisionId: String(decision._id) });
    return { decision: publicView(done), offer: await offerFor(companyId, settings, decision, role) };
}

module.exports = { OFFER_AFTER, forTask, needsRouting, accept, dismiss, route, publicView };
