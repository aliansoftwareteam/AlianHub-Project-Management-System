const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const logger = require('../../Config/loggerConfig');
const { sanitizeInput } = require('../serviceFunction');
const { canReadTask } = require('../Tasks/helpers/taskReadAccess');
const { loadRules, canTake, namesOf, RuleError, plain } = require('./rules');
const engine = require('./engine');

/* How long after creation a task with create rules is still expected to get a decision. */
const PENDING_WINDOW_MS = 2 * 60 * 1000;
const PUBLIC_FIELDS = ['_id', 'taskId', 'state', 'mode', 'userId', 'source', 'reason', 'model', 'trigger', 'createdAt'];

const publicView = (decision) => Object.fromEntries(PUBLIC_FIELDS.map((field) => [field, field === '_id' ? String(decision._id) : decision[field] === undefined ? null : decision[field]]));

const latestOpen = async (companyId, taskId) => plain(await MongoDbCrudOpration(companyId, {
    type: SCHEMA_TYPE.ASSIGNMENT_DECISIONS,
    data: [{ taskId: String(taskId), state: { $in: [...engine.OPEN_STATES, 'pending'] } }, null, { sort: { createdAt: -1, _id: -1 }, limit: 1 }],
}, 'find'))?.[0] || null;

const shown = (decision, task) => {
    if (!decision) return false;
    const assignees = (task.AssigneeUserId || []).map(String);
    if (decision.state === 'suggested') return assignees.length === 0;
    if (decision.state === 'applied') return assignees.includes(String(decision.userId));
    return false;
};

async function forTask(companyId, uid, taskId) {
    const task = await engine.readTask(companyId, taskId);
    if (!task || !(await canReadTask(companyId, uid, task))) throw new RuleError('Task not found.', 404);
    const decision = await latestOpen(companyId, taskId);
    let pending = Boolean(decision && decision.state === 'pending');
    if (!decision && !engine.hasAssignee(task) && task.createdAt && Date.now() - new Date(task.createdAt).getTime() < PENDING_WINDOW_MS) {
        const rules = await loadRules(companyId, task.ProjectID);
        pending = Boolean(rules && rules.onCreate && (rules.entries.length || rules.fallbackUserId));
    }
    return { decision: shown(decision, task) ? publicView(decision) : null, pending };
}

async function loadForAction(companyId, uid, taskId, decisionId) {
    if (!mongoose.Types.ObjectId.isValid(String(decisionId || ''))) throw new RuleError('A valid decision id is required.');
    const task = await engine.readTask(companyId, taskId);
    if (!task || !(await canReadTask(companyId, uid, task))) throw new RuleError('Task not found.', 404);
    const decision = plain(await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.ASSIGNMENT_DECISIONS,
        data: [{ _id: new mongoose.Types.ObjectId(String(decisionId)), taskId: String(task._id) }],
    }, 'findOne'));
    if (!decision) throw new RuleError('Suggestion not found.', 404);
    if (String(decision.projectId) !== String(task.ProjectID)) {
        await engine.updateDecision(companyId, decision, { state: 'stale' });
        throw new RuleError('This task has moved to another project since the suggestion was made.', 409);
    }
    return { task, decision };
}

/* Only one caller wins a state change; the loser is told the suggestion has moved on. */
async function transition(companyId, decision, from, to, actorId) {
    const now = new Date();
    const before = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.ASSIGNMENT_DECISIONS,
        data: [{ _id: decision._id, state: from }, { $set: { state: to, resolvedBy: String(actorId), resolvedAt: now, updatedAt: now } }],
    }, 'findOneAndUpdate');
    if (!before) throw new RuleError('This suggestion has already been handled.', 409);
    return { ...decision, state: to, resolvedBy: String(actorId), resolvedAt: now };
}

const restore = (companyId, decision, state) => MongoDbCrudOpration(companyId, {
    type: SCHEMA_TYPE.ASSIGNMENT_DECISIONS,
    data: [{ _id: decision._id }, { $set: { state, resolvedBy: '', updatedAt: new Date() } }],
}, 'updateOne').catch((error) => logger.error(`[assignment-rules] could not restore decision ${decision._id}: ${error.message}`));

async function accept(companyId, actor, taskId, decisionId) {
    const { task, decision } = await loadForAction(companyId, actor.id, taskId, decisionId);
    if (decision.state !== 'suggested') throw new RuleError('This suggestion has already been handled.', 409);
    if (engine.hasAssignee(task)) {
        await engine.updateDecision(companyId, decision, { state: 'stale' });
        throw new RuleError('This task already has an assignee.', 409);
    }
    if (!(await canTake(companyId, decision.userId, task))) {
        await engine.updateDecision(companyId, decision, { state: 'stale' });
        throw new RuleError('The suggested person can no longer open this task.', 409);
    }
    const claimed = await transition(companyId, decision, 'suggested', 'accepted', actor.id);
    try {
        const project = await engine.readProject(companyId, task.ProjectID);
        const name = (await namesOf(companyId, [decision.userId])).get(String(decision.userId)) || '';
        await engine.changeAssignee({ companyId, project, task, userId: String(decision.userId), name, type: 'assigneeAdd', userData: actor });
    } catch (error) {
        await restore(companyId, decision, 'suggested');
        throw error;
    }
    return publicView(claimed);
}

async function dismiss(companyId, actor, taskId, decisionId) {
    const { task, decision } = await loadForAction(companyId, actor.id, taskId, decisionId);
    const dismissed = await transition(companyId, decision, 'suggested', 'dismissed', actor.id);
    const name = (await namesOf(companyId, [decision.userId])).get(String(decision.userId)) || 'Someone';
    await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.HISTORY,
        data: {
            Type: 'task',
            Key: 'AI_Assignment_Dismissed',
            UserId: String(actor.id),
            ProjectId: String(task.ProjectID),
            TaskId: String(task._id),
            Message: `<b>${sanitizeInput(actor.Employee_Name)}</b> dismissed the suggestion to assign <b>${sanitizeInput(name)}</b>.`,
        },
    }, 'save').catch((error) => logger.error(`[assignment-rules] dismiss history for task ${task._id}: ${error.message}`));
    return publicView(dismissed);
}

async function undo(companyId, actor, taskId, decisionId) {
    const { task, decision } = await loadForAction(companyId, actor.id, taskId, decisionId);
    if (decision.state !== 'applied') throw new RuleError('Only an assignment made by the rules can be undone.', 409);
    if (!(task.AssigneeUserId || []).map(String).includes(String(decision.userId))) {
        throw new RuleError('That person is no longer assigned to this task.', 409);
    }
    const undone = await transition(companyId, decision, 'applied', 'undone', actor.id);
    try {
        const project = await engine.readProject(companyId, task.ProjectID);
        const name = (await namesOf(companyId, [decision.userId])).get(String(decision.userId)) || '';
        await engine.changeAssignee({ companyId, project, task, userId: String(decision.userId), name, type: 'assigneRemove', userData: actor });
    } catch (error) {
        await restore(companyId, decision, 'applied');
        throw error;
    }
    return publicView(undone);
}

module.exports = { forTask, accept, dismiss, undo, publicView };
