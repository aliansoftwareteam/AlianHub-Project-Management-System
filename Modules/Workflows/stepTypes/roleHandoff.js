const mongoose = require('mongoose');
const executors = require('../executors');
const flag = require('../flag');
const store = require('../store');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const { idForms } = require('../../../utils/mongo-handler/objectIdKeys');
const { removeCache } = require('../../../utils/commonFunctions');
const { recordAudit } = require('../../Audit/recorder');
const { isClosedTask } = require('../../Tasks/helpers/taskSignals');
const { waitUntil } = require('./waiting');
const { num, deterministic, descendantsOf, skipAll } = require('./graph');

const TYPE = 'role_handoff';
const AUDIT = Object.freeze({
    QUEUED: 'workflow.role_handoff.queued',
    FINISHED: 'workflow.role_handoff.finished',
    RELEASED: 'workflow.role_handoff.released',
    TIMED_OUT: 'workflow.role_handoff.timed_out',
});
const ACTOR_NAME = 'Workflow';

const CONTRACT = Object.freeze({
    key: TYPE,
    label: 'Hand to a role',
    config: {
        role: { type: 'text', label: 'Role', required: true },
        taskId: { type: 'text', label: 'Task' },
        deadlineMs: { type: 'duration', label: 'Deadline' },
        onRelease: { type: 'select', label: 'If the role gives it back', options: ['skip', 'continue'] },
    },
    output: {
        role: { type: 'string', label: 'Role', required: true },
        taskId: { type: 'string', label: 'Task', required: true },
        outcome: { type: 'string', label: 'Outcome', required: true },
        finishedBy: { type: 'string', label: 'Finished by' },
        finishedAt: { type: 'date', label: 'Finished at' },
        skipped: { type: 'list', label: 'Skipped' },
    },
});

// Required lazily: the dispatcher reaches back into this package through the task events.
const dispatcher = () => ({
    gate: require('../../AssignmentRules/dispatcher/gate'),
    settings: require('../../AssignmentRules/dispatcher/settings'),
    queue: require('../../AssignmentRules/dispatcher/queue'),
    findings: require('../../Agents/manager/findings'),
    workQueue: require('../../Agents/manager/workQueue'),
});

const plain = (row) => (row && typeof row.toObject === 'function' ? row.toObject() : row);

const queueRow = async (companyId, task, findings) => plain(await MongoDbCrudOpration(companyId, {
    type: SCHEMA_TYPE.PROJECT_FINDINGS,
    data: [{ projectId: { $in: idForms([String(task.ProjectID)]) }, key: `${findings.HANDED_OVER}:${task._id}` }],
}, 'findOne'));

/* Where the hand-over stands, read from the same row the dispatcher's accept writes: still waiting in the role's
 * queue, finished by the role, or out of the queue some other way (given back, taken back, re-routed, task closed). */
const standing = (row, role, findings) => {
    if (!row) return { state: 'released' };
    const left = row.leftQueue;
    if (row.status === findings.STATUS.OPEN && !left) {
        return (row.facts && row.facts.role) === role ? { state: 'waiting' } : { state: 'released' };
    }
    if (left && left.why === findings.LEFT.FINISHED) return { state: 'finished', by: left.name || String(left.userId || ''), at: left.at || null };
    return { state: 'released' };
};

const audit = (companyId, task, action, run, step, role, more = {}) => recordAudit(companyId, {
    actorId: '', actorName: ACTOR_NAME, action, entityType: 'task', entityId: String(task._id), entityName: task.TaskName || '',
    meta: { runId: String(run._id), stepId: String(step.stepId), role, ...more },
});

const refreshed = (companyId) => {
    removeCache('UserProjectData:', true);
    dispatcher().workQueue.announce(companyId);
};

const withdraw = async (companyId, row, role, findings, now) => {
    await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.PROJECT_FINDINGS,
        data: [
            { _id: new mongoose.Types.ObjectId(String(row._id)), status: findings.STATUS.OPEN, 'facts.role': role },
            { $unset: { claim: '' }, $set: { status: findings.STATUS.CLOSED, closedAt: now, leftQueue: { why: findings.LEFT.WITHDRAWN, userId: '', name: ACTOR_NAME, at: now } } },
        ],
    }, 'updateOne');
    refreshed(companyId);
};

const deadlineOf = (step, config, context, now) => {
    const own = new Date(new Date(step.handedAt || now).getTime() + num(config.deadlineMs, flag.roleHandoffDeadlineMs()));
    const runs = context.deadlineAt ? new Date(context.deadlineAt) : null;
    return runs && runs < own ? runs : own;
};

const handOver = async ({ companyId, run, step, task, role, where }) => {
    const { gate, settings, queue } = dispatcher();
    const rules = await settings.load(companyId, task.ProjectID);
    const problem = gate.roleProblem(rules, role);
    if (problem) throw deterministic(`${where}: the role "${role}" is not on for this task's project`);
    if (await queue.paused(companyId, task.ProjectID)) return { paused: true };
    const agent = await queue.leastLoaded(companyId, role, task.ProjectID);
    await queue.put(companyId, task, { role, agentId: agent ? agent.id : null, by: run.startedBy || '', byPerson: true });
    refreshed(companyId);
    audit(companyId, task, AUDIT.QUEUED, run, step, role, { agentId: agent ? agent.id : null });
    return { paused: false };
};

const execute = async ({ companyId, run, step, context = {} }) => {
    const config = step.config || {};
    const where = `role hand-over step ${step.stepId}`;
    if (!flag.roleHandoffSteps()) throw deterministic(`${where}: needs WORKFLOW_ENGINE and DISPATCHER on`);
    const role = String(config.role || '');
    const { gate, settings, findings } = dispatcher();
    if (!settings.roleOf(role)) throw deterministic(`${where}: there is no role "${role}"`);
    const taskId = config.taskId || run.taskId;
    if (!taskId) throw deterministic(`${where}: needs a "taskId", or a run started on a task`);
    const task = await gate.readTask(companyId, taskId);
    if (!task) throw deterministic(`${where}: task ${taskId} was not found`);

    const now = new Date();
    const waitFor = (reason, until, set) => waitUntil(reason, until, {
        pollMs: flag.roleHandoffPollMs(),
        set: { ...set, ...(step.waitingSince ? {} : { waitingSince: now }) },
        recheck: async () => standing(await queueRow(companyId, task, findings), role, findings).state !== 'waiting',
    });

    if (!step.handedAt) {
        if (isClosedTask(task)) throw deterministic(`${where}: task ${taskId} is already done`);
        const since = step.waitingSince || now;
        const until = deadlineOf({ handedAt: since }, config, context, now);
        if (until <= now) throw deterministic(`${where}: agents stayed paused until ${until.toISOString()}, so ${role} never got the task`);
        const result = await handOver({ companyId, run, step, task, role, where });
        if (result.paused) return waitFor(`waiting for agents to be switched on again before ${role} gets the task`, until, {});
        return waitFor(`waiting for ${role} to finish`, deadlineOf({ handedAt: now }, config, context, now), { handedAt: now });
    }

    const row = await queueRow(companyId, task, findings);
    const position = standing(row, role, findings);
    if (position.state === 'finished') {
        audit(companyId, task, AUDIT.FINISHED, run, step, role, { finishedBy: position.by });
        return { role, taskId: String(task._id), outcome: 'finished', finishedBy: position.by, finishedAt: position.at };
    }
    if (position.state === 'released') {
        audit(companyId, task, AUDIT.RELEASED, run, step, role);
        const steps = await store.listSteps(companyId, run._id);
        const pruned = config.onRelease === 'continue'
            ? []
            : await skipAll(companyId, run._id, descendantsOf(steps, step.stepId), `skipped: ${role} gave the task back at ${step.stepId}`);
        return { role, taskId: String(task._id), outcome: 'released', skipped: pruned };
    }

    const deadlineAt = deadlineOf(step, config, context, now);
    if (deadlineAt <= now) {
        await withdraw(companyId, row, role, findings, now);
        audit(companyId, task, AUDIT.TIMED_OUT, run, step, role, { deadlineAt: deadlineAt.toISOString() });
        throw deterministic(`${where}: ${role} did not finish by ${deadlineAt.toISOString()}; the task was taken out of its queue`);
    }
    return waitFor(`waiting for ${role} to finish`, deadlineAt, {});
};

const register = () => {
    if (flag.roleHandoffSteps()) executors.register(TYPE, execute);
};

register();

module.exports = { TYPE, CONTRACT, AUDIT, execute, register };
