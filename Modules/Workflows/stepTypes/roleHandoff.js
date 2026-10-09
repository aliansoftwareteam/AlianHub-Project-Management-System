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
    WITHDRAWN: 'workflow.role_handoff.withdrawn',
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
    places: require('../../Agents/manager/places'),
});

const plain = (row) => (row && typeof row.toObject === 'function' ? row.toObject() : row);

const queueRow = async (companyId, task, findings) => plain(await MongoDbCrudOpration(companyId, {
    type: SCHEMA_TYPE.PROJECT_FINDINGS,
    data: [{ projectId: { $in: idForms([String(task.ProjectID)]) }, key: `${findings.HANDED_OVER}:${task._id}` }],
}, 'findOne'));

/* Where the hand-over stands, read from the same row the dispatcher's accept writes: still waiting in the role's
 * queue, finished by the role, or out of the queue some other way (given back, taken back, re-routed, task closed).
 * A row finished by a role it was re-routed to is released as far as this step is concerned. */
const standing = (row, role, findings) => {
    if (!row) return { state: 'released' };
    const left = row.leftQueue;
    const ours = (row.facts && row.facts.role) === role;
    if (row.status === findings.STATUS.OPEN && !left) return ours ? { state: 'waiting' } : { state: 'released' };
    if (ours && left && left.why === findings.LEFT.FINISHED) return { state: 'finished', by: left.name || String(left.userId || ''), at: left.at || null };
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
    const changed = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.PROJECT_FINDINGS,
        data: [
            { _id: new mongoose.Types.ObjectId(String(row._id)), status: findings.STATUS.OPEN, 'facts.role': role },
            { $unset: { claim: '' }, $set: { status: findings.STATUS.CLOSED, closedAt: now, leftQueue: { why: findings.LEFT.WITHDRAWN, userId: '', name: ACTOR_NAME, at: now } } },
        ],
    }, 'updateOne');
    if (!(changed && changed.modifiedCount > 0)) return false;
    await dispatcher().places.giveBack(companyId, row._id);
    refreshed(companyId);
    return true;
};

/* By key alone: a deleted task leaves no project to look the row up by. */
const openRowFor = async (companyId, taskId, role, findings) => plain(await MongoDbCrudOpration(companyId, {
    type: SCHEMA_TYPE.PROJECT_FINDINGS,
    data: [{ key: `${findings.HANDED_OVER}:${taskId}`, status: findings.STATUS.OPEN, 'facts.role': role }],
}, 'findOne'));

const takeBack = async (companyId, { run, step, taskId, role, action = AUDIT.WITHDRAWN, more = {} }) => {
    const { findings } = dispatcher();
    const row = await openRowFor(companyId, taskId, role, findings);
    if (!row || !(await withdraw(companyId, row, role, findings, new Date()))) return false;
    audit(companyId, { _id: taskId, TaskName: (row.facts && row.facts.taskName) || '' }, action, run, step, role, more);
    return true;
};

const RUN_MARGIN_MS = 60 * 1000;

/* The step's own deadline from the hand-over, cut short to a minute before the run's so there is time to withdraw. */
const deadlineOf = (handedAt, config, run, now) => {
    const own = new Date(new Date(handedAt || now).getTime() + num(config.deadlineMs, flag.roleHandoffDeadlineMs()));
    if (!run.deadlineAt) return own;
    const runs = new Date(new Date(run.deadlineAt).getTime() - RUN_MARGIN_MS);
    return runs < own ? runs : own;
};

const handOver = async ({ companyId, run, step, task, role }) => {
    const { queue } = dispatcher();
    const agent = await queue.leastLoaded(companyId, role, task.ProjectID);
    await queue.put(companyId, task, { role, agentId: agent ? agent.id : null, by: run.startedBy || '', byPerson: true });
    refreshed(companyId);
    audit(companyId, task, AUDIT.QUEUED, run, step, role, { agentId: agent ? agent.id : null });
};

const execute = async ({ companyId, run, step }) => {
    const config = step.config || {};
    const where = `role hand-over step ${step.stepId}`;
    const role = String(config.role || '');
    const taskId = config.taskId || run.taskId;
    const handed = Boolean(step.handedAt);
    const fail = async (why, message) => {
        if (handed) await takeBack(companyId, { run, step, taskId, role, more: { reason: why } });
        throw deterministic(message);
    };

    if (!flag.roleHandoffSteps()) return fail('switched_off', `${where}: needs WORKFLOW_ENGINE and DISPATCHER on`);
    const { gate, settings, queue, findings } = dispatcher();
    if (!settings.roleOf(role)) return fail('unknown_role', `${where}: there is no role "${role}"`);
    if (!taskId) throw deterministic(`${where}: needs a "taskId", or a run started on a task`);
    const task = await gate.readTask(companyId, taskId);
    if (!task) return fail('task_gone', `${where}: task ${taskId} was not found`);

    const now = new Date();
    const since = step.waitingSince ? {} : { waitingSince: now };
    const settledOrGone = async () => {
        const current = await gate.readTask(companyId, taskId);
        if (!current || isClosedTask(current)) return true;
        return standing(await queueRow(companyId, current, findings), role, findings).state !== 'waiting';
    };
    const waitForRole = (reason, until, set = {}) => waitUntil(reason, until, { pollMs: flag.roleHandoffPollMs(), set: { ...set, ...since }, recheck: settledOrGone });

    if (!handed) {
        if (isClosedTask(task)) throw deterministic(`${where}: task ${taskId} is already done`);
        const until = deadlineOf(step.waitingSince || now, config, run, now);
        if (until <= now) throw deterministic(`${where}: the deadline ${until.toISOString()} passed before ${role} got the task`);
        if (gate.roleProblem(await settings.load(companyId, task.ProjectID), role)) throw deterministic(`${where}: the role "${role}" is not on for this task's project`);
        if (await queue.paused(companyId, task.ProjectID)) {
            return waitUntil(`waiting for agents to be switched on again before ${role} gets the task`, until, {
                pollMs: flag.roleHandoffPollMs(), set: since, recheck: async () => !(await queue.paused(companyId, task.ProjectID)),
            });
        }
        await handOver({ companyId, run, step, task, role });
        return waitForRole(`waiting for ${role} to finish`, deadlineOf(now, config, run, now), { handedAt: now });
    }

    const position = standing(await queueRow(companyId, task, findings), role, findings);
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

    if (isClosedTask(task)) return fail('task_closed', `${where}: task ${taskId} was closed before ${role} finished it; the task was taken out of its queue`);
    const problem = gate.roleProblem(await settings.load(companyId, task.ProjectID), role);
    if (problem) return fail(problem, `${where}: the role "${role}" was switched off for this task's project while it held the task; the task was taken out of its queue`);

    const deadlineAt = deadlineOf(step.handedAt, config, run, now);
    if (deadlineAt <= now) {
        await takeBack(companyId, { run, step, taskId, role, action: AUDIT.TIMED_OUT, more: { deadlineAt: deadlineAt.toISOString() } });
        throw deterministic(`${where}: ${role} did not finish by ${deadlineAt.toISOString()}; the task was taken out of its queue`);
    }
    if (await queue.paused(companyId, task.ProjectID)) return waitForRole(`waiting for agents to be switched on again; ${role} holds the task`, deadlineAt);
    return waitForRole(`waiting for ${role} to finish`, deadlineAt);
};

/* The engine's word that the step ended without succeeding: failed, refused, skipped by a person, or its run ended
 * under it. A hand-over still in the role's queue is taken back. */
const ended = async ({ companyId, run, step, why }) => {
    if (!step || !step.handedAt) return false;
    const config = step.config || {};
    const taskId = config.taskId || (run && run.taskId);
    if (!taskId) return false;
    return takeBack(companyId, { run, step, taskId, role: String(config.role || ''), more: { reason: why } });
};

const register = () => {
    executors.onEnd(TYPE, ended);
    if (flag.roleHandoffSteps()) executors.register(TYPE, execute);
};

register();

module.exports = { TYPE, CONTRACT, AUDIT, execute, ended, register };
