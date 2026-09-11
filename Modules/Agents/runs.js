const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const socketEmitter = require('../../event/socketEventEmitter');
const logger = require('../../Config/loggerConfig');
const usage = require('../AICore/usage');
const { MAX_DEPTH } = require('../../event/domainEventBus');
const telemetry = require('../../Config/telemetry');

// Agent runs and spend. A run is the unit the rail footer counts ("2 running"),
// the project header chip sums (elapsed, spend) and the audit log links to
// (run #n). The agent's spend cap is enforced before a run starts; a run's own
// cap is checked once its spend is recorded.

const STATUS = Object.freeze({ QUEUED: 'queued', RUNNING: 'running', WAITING: 'waiting_approval', DONE: 'done', SKIPPED: 'skipped', FAILED: 'failed', STOPPED: 'stopped' });
const OPEN = [STATUS.QUEUED, STATUS.RUNNING, STATUS.WAITING];
// A skip is the skill declining its input (no URL, no PR link, brief too short):
// neither a success to count as clean nor a failure to fix, so it is its own status.
const TERMINAL = [STATUS.DONE, STATUS.SKIPPED, STATUS.FAILED, STATUS.STOPPED];
// How long a finished run is kept. Open runs never expire: a run waiting on a
// person must outlive its proposal, however long that person takes.
const RETENTION_SECONDS = 15552000;
const oid = (id) => { try { return new mongoose.Types.ObjectId(String(id)); } catch (e) { return null; } };
const monthKey = (d = new Date()) => d.toISOString().slice(0, 7);
const clampDepth = (depth) => Math.max(0, Number(depth) || 0);
const originDepth = (run) => clampDepth(run && run.triggerDepth);
const startOfDayUtc = (d = new Date()) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

const emit = (companyId, type, data) => {
    socketEmitter.emit('update', { type: 'update', module: 'agent', companyId: String(companyId), data: { kind: type, ...data }, updatedFields: { kind: type }, actor: { kind: 'agent' }, depth: 1 });
};

const emitAgent = (companyId, data) => emit(companyId, 'agent', data);

const getAgent = (companyId, agentId) => MongoDbCrudOpration(companyId, {
    type: SCHEMA_TYPE.AGENTS, data: [{ _id: oid(agentId), deletedStatusKey: { $ne: 1 } }],
}, 'findOne');

const runsToday = (companyId, agentId) => MongoDbCrudOpration(companyId, {
    type: SCHEMA_TYPE.AGENT_RUNS, data: [{ agentId: String(agentId), startedAt: { $gte: startOfDayUtc() } }],
}, 'countDocuments');

// The bus drops any envelope deeper than MAX_DEPTH, so a run whose actions would
// emit past it is refused up front instead of running and losing its events.
const LOOP_DEPTH_EXCEEDED = 'loop_depth_exceeded';

/* Can this agent start a run right now? Returns { ok, reason }. */
const canStart = async (agent, { trigger, viaAccount, companyId, depth } = {}) => {
    if (!agent) return { ok: false, reason: 'Agent not found.' };
    if (clampDepth(depth) >= MAX_DEPTH) return { ok: false, reason: LOOP_DEPTH_EXCEEDED, code: LOOP_DEPTH_EXCEEDED, depth: clampDepth(depth), maxDepth: MAX_DEPTH };
    if (agent.paused) return { ok: false, reason: `Agent is paused${agent.pausedReason ? ` (${agent.pausedReason})` : ''}.` };
    const via = viaAccount || agent.account || 'workspace';
    if (via !== 'local') {
        const price = usage.checkConfiguredModelPriced();
        if (!price.ok) return { ok: false, reason: price.reason, code: price.code, model: price.model };
    }
    const month = agent.spendMonth && agent.spendMonth.month === monthKey() ? agent.spendMonth : { usd: 0 };
    if (Number(agent.spendCapUsd) > 0 && Number(month.usd || 0) >= Number(agent.spendCapUsd)) {
        return { ok: false, reason: `Spend cap reached ($${Number(month.usd).toFixed(2)} of $${agent.spendCapUsd}).` };
    }
    if (trigger === 'schedule' && via === 'personal') {
        return { ok: false, reason: 'Personal accounts cannot run unattended — scheduled runs need the workspace key.' };
    }
    if (trigger === 'schedule' && Number(agent.autonomy) < 3) {
        return { ok: false, reason: 'This agent is not allowed to run on a schedule (autonomy below L3).' };
    }
    if (companyId && Number(agent.rateLimitPerDay) > 0) {
        const today = Number(await runsToday(companyId, agent._id)) || 0;
        if (today >= Number(agent.rateLimitPerDay)) return { ok: false, reason: `Daily run limit reached (${today} of ${agent.rateLimitPerDay} today).` };
    }
    if (companyId) {
        const budget = await require('./budget').check(companyId);
        if (!budget.ok) return budget;
    }
    return { ok: true, reason: '' };
};

const SCHEDULE_BUCKET_MS = 60 * 60 * 1000;
const isDuplicateKey = (e) => Boolean(e && (e.code === 11000 || /duplicate key/i.test(e.message || '')));

/* Same agent, task, trigger and reference → same key, so a redelivered job or a
 * retried request lands on the run its first attempt made. A manual or mention
 * start has no reference; for those the open-run index alone stops the double. */
const idempotencyKeyFor = ({ agent, taskId, trigger, ref, now = new Date() }) => {
    const kind = trigger || 'manual';
    const parts = [String(agent._id), taskId ? String(taskId) : '-', kind];
    if (ref) parts.push(String(ref));
    else if (kind === 'schedule') parts.push(String(Math.floor(now.getTime() / SCHEDULE_BUCKET_MS)));
    else return null;
    return parts.join(':');
};

const existingRun = async (companyId, { agent, taskId, idempotencyKey }) => {
    if (idempotencyKey) {
        const byKey = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.AGENT_RUNS, data: [{ idempotencyKey }] }, 'findOne');
        if (byKey) return byKey;
    }
    if (!taskId) return null;
    return MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.AGENT_RUNS, data: [{ agentId: String(agent._id), taskId: String(taskId), status: { $in: OPEN } }] }, 'findOne');
};

/* Insert and let the unique indexes arbitrate: the loser of a race gets the
 * winner's run back instead of a second model bill. */
const start = async (companyId, { agent, taskId, projectId, skill, trigger, startedBy, viaAccount, note, spendCapUsd, notifyMe, triggerDepth, triggerEventId, idempotencyKey, ref, traceId }) => {
    const key = idempotencyKey ? String(idempotencyKey) : idempotencyKeyFor({ agent, taskId, trigger, ref });
    const via = viaAccount || agent.account || 'workspace';
    const pinned = await require('./revisions').pinFor(companyId, agent, skill);
    try {
        const run = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.AGENT_RUNS,
            data: {
                agentId: String(agent._id), agentName: agent.name, taskId: taskId ? String(taskId) : null, projectId: projectId ? String(projectId) : null,
                skill: skill || null, trigger: trigger || 'manual', status: STATUS.RUNNING, viaAccount: via,
                triggerDepth: clampDepth(triggerDepth), triggerEventId: triggerEventId ? String(triggerEventId) : null,
                startedBy: startedBy ? String(startedBy) : null, startedAt: new Date(), elapsedMs: 0,
                spend: { tokens: 0, usd: 0, model: null, billedToWorkspace: via === 'workspace' },
                reservedUsd: 0,
                actions: note ? [{ action: 'mention', note: String(note).slice(0, 2000), at: new Date() }] : [],
                proposals: [], refusals: 0, decisions: [],
                ...(Number(spendCapUsd) > 0 ? { spendCapUsd: Number(spendCapUsd) } : {}),
                notifyMe: Boolean(notifyMe),
                ...(key ? { idempotencyKey: key } : {}),
                agentRevision: pinned.agentRevision, skillRevision: pinned.skillRevision,
                traceId: traceId || telemetry.traceIdNow() || telemetry.newTraceId(),
            },
        }, 'save');
        emit(companyId, 'run', { run });
        return { run, deduplicated: false };
    } catch (e) {
        if (!isDuplicateKey(e)) throw e;
        const run = await existingRun(companyId, { agent, taskId, idempotencyKey: key });
        if (!run) throw e;
        logger.debug(`[agent-run] ${run._id}: start deduplicated (${key || 'open run for the task'})`);
        return { run, deduplicated: true };
    }
};

const create = async (companyId, opts) => (await start(companyId, opts)).run;

/* `onlyIf` makes the write conditional on the run's current status: a worker that
 * lost its run to stop/pause-all must not resurrect it with a terminal state. */
const patch = async (companyId, runId, set, extra = {}, { onlyIf } = {}) => {
    const filter = onlyIf ? { _id: oid(runId), status: onlyIf } : { _id: oid(runId) };
    const updated = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.AGENT_RUNS, data: [filter, { $set: set, ...extra }, { returnDocument: 'after' }],
    }, 'findOneAndUpdate');
    if (updated) emit(companyId, 'run', { run: updated });
    return updated;
};

const appendAction = (companyId, runId, entry) => patch(companyId, runId, {}, { $push: { actions: { ...entry, at: new Date() } } });

/* No socket event, unlike patch: a step lands after every node and nothing renders it live. */
const recordStep = (companyId, runId, step) => MongoDbCrudOpration(companyId, {
    type: SCHEMA_TYPE.AGENT_RUNS, data: [{ _id: oid(runId) }, { $push: { steps: step } }],
}, 'updateOne').catch((e) => logger.error(`[agent-run] ${runId}: step ${step.node} not recorded: ${e.message}`));

const get = (companyId, runId) => MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.AGENT_RUNS, data: [{ _id: oid(runId) }] }, 'findOne');

const terminalUpdate = (status, at = new Date()) => {
    if (!TERMINAL.includes(status)) throw new Error(`${status} is not a terminal run status`);
    return { status, finishedAt: at, expiresAt: new Date(at.getTime() + RETENTION_SECONDS * 1000) };
};

const finish = async (companyId, runId, { status = STATUS.DONE, outcome, error, failure, episode, onlyIf } = {}) => {
    const run = await get(companyId, runId);
    if (!run) return null;
    const now = new Date();
    const startedAt = run.startedAt ? new Date(run.startedAt).getTime() : now.getTime();
    const set = { ...terminalUpdate(status, now), elapsedMs: now.getTime() - startedAt, outcome: outcome || null, error: error || null, ...(failure ? { failure } : {}), ...(episode ? { episode } : {}) };
    return patch(companyId, runId, set, {}, { onlyIf });
};

const isRunning = async (companyId, runId) => {
    const current = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.AGENT_RUNS, data: [{ _id: oid(runId) }, 'status'] }, 'findOne');
    return Boolean(current && current.status === STATUS.RUNNING);
};

/* Runs a previous process left "running" can never finish — the worker died
 * with them. Called once at boot for every company. */
const reapStale = async (companyId) => {
    const stale = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.AGENT_RUNS, data: [{ status: STATUS.RUNNING }, '_id'] }, 'find');
    for (const r of stale || []) {
        // eslint-disable-next-line no-await-in-loop
        await finish(companyId, r._id, { status: STATUS.FAILED, outcome: 'server restarted', onlyIf: STATUS.RUNNING });
    }
    return { reaped: (stale || []).length };
};

const stop = async (companyId, runId, byUserId) => {
    const run = await get(companyId, runId);
    if (!run) return { error: 'Run not found.', status: 404 };
    if (!OPEN.includes(run.status)) return { error: `Run is already ${run.status}.`, status: 409 };
    const stopped = await finish(companyId, runId, { status: STATUS.STOPPED, outcome: `stopped by ${byUserId || 'a person'}` });
    return { run: stopped };
};

/* Record tokens/cost on the run and the agent's month. The ledger row the budget
 * reads was already booked by the core meter (AICore/spend) with this run's id;
 * this only keeps the run's own figures, the agent's cap and the run-context alert.
 * Personal-account spend is the developer's own and never billed to the workspace (27a). */
const recordSpend = async (companyId, run, tokens, model) => {
    const priced = usage.summarize(tokens || {}, model);
    const billed = run.viaAccount !== 'personal' && run.viaAccount !== 'local';
    if (priced.priced === false && priced.totalTokens > 0 && run.viaAccount !== 'local') {
        const message = `refusing to book ${priced.totalTokens} tokens as $0: ${usage.unpricedMessage(priced.model || model)}`;
        logger.error(`[agent-run] ${run._id}: ${message}`);
        const error = new Error(message);
        error.code = usage.UNPRICED_MODEL;
        throw error;
    }
    const usd = billed && priced.costUsd ? priced.costUsd : 0;
    await patch(companyId, run._id, {
        spend: { tokens: priced.totalTokens, usd, model: priced.model || model || null, billedToWorkspace: billed, personalUsd: !billed && priced.costUsd ? priced.costUsd : 0 },
    });
    if (!billed) return { usd: 0, tokens: priced.totalTokens, capReached: false };
    await require('./budget').alertIfCrossed(companyId, run).catch((e) => logger.error(`[agent-run] ${run._id}: budget alert failed: ${e.message}`));
    const agent = await getAgent(companyId, run.agentId);
    if (!agent) return { usd, tokens: priced.totalTokens, capReached: false };
    const month = agent.spendMonth && agent.spendMonth.month === monthKey() ? agent.spendMonth : { month: monthKey(), usd: 0, tokens: 0, runs: 0 };
    const next = { month: month.month, usd: Math.round((Number(month.usd || 0) + usd) * 10000) / 10000, tokens: Number(month.tokens || 0) + priced.totalTokens, runs: Number(month.runs || 0) + 1 };
    const set = { spendMonth: next };
    const capReached = Number(agent.spendCapUsd) > 0 && next.usd >= Number(agent.spendCapUsd);
    if (capReached && !agent.paused) { set.paused = true; set.pausedReason = 'spend_cap'; set.pausedAt = new Date(); }
    await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.AGENTS, data: [{ _id: agent._id }, { $set: set }] }, 'updateOne');
    emit(companyId, 'agent', { agentId: String(agent._id), spendMonth: next, paused: Boolean(set.paused || agent.paused) });
    return { usd, tokens: priced.totalTokens, capReached };
};

/* projectIds, when given, is the caller's visible set: a projectId outside it matches nothing. */
const inProjects = (projectIds) => (Array.isArray(projectIds) ? { projectId: { $in: projectIds.map(String) } } : {});

const list = async (companyId, { status, projectId, agentId, taskId, errorType, limit = 50, projectIds } = {}) => {
    const match = { ...inProjects(projectIds) };
    if (status === 'open') match.status = { $in: OPEN };
    else if (status) match.status = String(status);
    if (projectId) match.projectId = String(projectId);
    if (agentId) match.agentId = String(agentId);
    if (taskId) match.taskId = String(taskId);
    if (errorType) match['failure.type'] = String(errorType);
    return MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.AGENT_RUNS, data: [match, {}, { sort: { startedAt: -1 }, limit: Math.min(200, Math.max(1, Number(limit) || 50)) }],
    }, 'find');
};

/* What the rail footer and the project header chip show. */
const summary = async (companyId, { projectId, projectIds } = {}) => {
    const match = { status: { $in: OPEN }, ...inProjects(projectIds) };
    if (projectId) match.projectId = String(projectId);
    const open = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.AGENT_RUNS, data: [match, 'agentId agentName status startedAt spend taskId'] }, 'find');
    const now = Date.now();
    const running = (open || []).filter((r) => r.status === STATUS.RUNNING);
    return {
        running: running.length,
        waitingApproval: (open || []).filter((r) => r.status === STATUS.WAITING).length,
        agents: [...new Set((open || []).map((r) => String(r.agentId)))].length,
        elapsedMs: running.reduce((s, r) => s + Math.max(0, now - new Date(r.startedAt || now).getTime()), 0),
        spendUsd: Math.round((open || []).reduce((s, r) => s + Number((r.spend && r.spend.usd) || 0), 0) * 100) / 100,
        runs: (open || []).map((r) => ({ _id: String(r._id), agentId: r.agentId, agentName: r.agentName, status: r.status, taskId: r.taskId, startedAt: r.startedAt })),
    };
};

/* Runs by status, for the counts a page shows next to the live summary. */
const countsByStatus = async (companyId, { projectId, agentId, projectIds } = {}) => {
    const match = { ...inProjects(projectIds) };
    if (projectId) match.projectId = String(projectId);
    if (agentId) match.agentId = String(agentId);
    const rows = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.AGENT_RUNS, data: [[{ $match: match }, { $group: { _id: '$status', n: { $sum: 1 } } }]],
    }, 'aggregate').catch(() => []);
    const counts = Object.fromEntries(Object.values(STATUS).map((k) => [k, 0]));
    (rows || []).forEach((r) => { if (r && r._id in counts) counts[r._id] = r.n; });
    return counts;
};

/* A run waiting on a person is left alone: stopping it would strand its pending
 * proposal, and approving that later would mark the stopped run done anyway. */
const pauseAll = async (companyId, reason) => {
    await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.AGENTS, data: [{ deletedStatusKey: { $ne: 1 } }, { $set: { paused: true, pausedReason: reason || 'pause_all', pausedAt: new Date() } }] }, 'updateMany');
    const active = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.AGENT_RUNS, data: [{ status: { $in: [STATUS.QUEUED, STATUS.RUNNING] } }, '_id status'] }, 'find');
    let stopped = 0;
    for (const r of active || []) {
        // eslint-disable-next-line no-await-in-loop
        if (await finish(companyId, r._id, { status: STATUS.STOPPED, outcome: 'pause all', onlyIf: r.status })) stopped += 1;
    }
    emit(companyId, 'agent', { pausedAll: true });
    return { stopped };
};

const subtaskChange = (task, f) => ({
    action: 'subtask.create', label: `Create subtask "[${f.severity}] ${f.title}"`, reversible: true,
    params: { taskId: String(task._id), title: `[${f.severity}] ${f.title}`, description: [f.why, f.fix ? `Fix: ${f.fix}` : '', f.evidence ? `Evidence: ${f.evidence}` : ''].filter(Boolean).join('\n') },
});

/* QA findings become subtasks, minus the ones finding memory already tracks —
 * without that a second run on the same page files every finding again. */
const changesFor = async (companyId, task, result) => {
    if (Array.isArray(result.changes)) return { changes: result.changes, alreadyTracked: 0 };
    const memory = require('./engine/findingMemory');
    const changes = [];
    let alreadyTracked = 0;
    if (result.findings.length) {
        const known = await memory.load(companyId, task._id);
        const decisions = await memory.decide(companyId, task._id, result.findings, known);
        for (const d of decisions) {
            if (d.action === 'skip') {
                alreadyTracked += 1;
                // eslint-disable-next-line no-await-in-loop
                await memory.touch(companyId, d.prior);
                continue;
            }
            const f = d.finding;
            changes.push({ ...subtaskChange(task, f), remember: { projectId: task.ProjectID, taskId: String(task._id), factId: f.factId, skill: result.skill, title: f.title, severity: f.severity, prior: d.prior } });
        }
        if (!changes.length) return { changes, alreadyTracked };
    }
    changes.push({ action: 'task.comment', label: 'Post the review summary', reversible: true, params: { taskId: String(task._id), body: result.summary } });
    return { changes, alreadyTracked };
};

/* The person who ticked "notify me" gets one in-app notification when the run
 * needs them or is over. It goes through the task-notification pipeline so their
 * notification settings still apply; the agent is the sender so the starter is
 * not filtered out as "self". */
const notifyStarter = async (companyId, run, task, { status, outcome, error }) => {
    if (!run.notifyMe || !run.startedBy) return;
    try {
        const { handleNotificationtFun } = require('../notification/prepare-notification-data/controllerV2');
        const { Notification_key } = require('../../Config/notificationKey');
        const detail = outcome || error || '';
        const what = status === STATUS.WAITING ? 'needs your approval' : `is ${status}${detail ? ` — ${detail}` : ''}`;
        const starter = String(run.startedBy);
        await handleNotificationtFun({ body: {
            createdAt: new Date(), updatedAt: new Date(),
            key: Notification_key.TASK_NOTIFICATION, type: 'tasks', changeType: 'agent_run',
            changeData: { runId: String(run._id), agentId: String(run.agentId), status, outcome: detail },
            message: `${run.agentName || 'Agent'} run on ${task.TaskKey || task.TaskName || 'a task'} ${what}`,
            companyId: String(companyId), projectId: String(run.projectId || task.ProjectID || ''), taskId: String(run.taskId || task._id || ''),
            userId: String(run.agentId), assigneeUsers: [starter], notSeen: [starter],
            isSelected: false, folderId: '', sprintId: '', comments_id: '',
        } });
    } catch (e) { logger.error(`[agent-run] ${run._id}: notify failed: ${e.message}`); }
};

/* Execute the run's skill as a graph thread (engine/graph.js). Below L2 every
 * change becomes one proposal; from L2 the policy reviews each change. Resolves
 * with the terminal state, with { status: 'waiting_approval', proposalId } while
 * a proposal is open, or with { status: 'abandoned' } when stop/pause-all took
 * the run away mid-flight — then nothing more is written and nobody is told. */
const executeSkill = async (companyId, run, agent, task, deps) => {
    const { runGraph } = require('./engine/graph');
    const state = await runGraph({ companyId, run, agent, task, deps });
    if (state.status !== 'abandoned') await notifyStarter(companyId, run, task, state);
    return state;
};
/* Which skill a run executes. Agents store skills as objects ({ key, name, … });
 * an explicit slug wins, then the agent's first enabled skill key, then the QA review. */
const skillSlugOf = (agent, explicit) => {
    if (explicit && typeof explicit === 'string') return explicit;
    const first = agent && Array.isArray(agent.skills) ? agent.skills.find((s) => typeof s === 'string' || (s && s.enabled !== false)) : null;
    if (!first) return 'qa-review';
    if (typeof first === 'string') return first;
    return first.key || first.slug || first.name || 'qa-review';
};

module.exports = { STATUS, OPEN, TERMINAL, RETENTION_SECONDS, LOOP_DEPTH_EXCEEDED, originDepth, terminalUpdate, canStart, runsToday, skillSlugOf, idempotencyKeyFor, start, create, get, patch, appendAction, recordStep, finish, isRunning, reapStale, stop, recordSpend, list, summary, countsByStatus, pauseAll, getAgent, emitAgent, changesFor, executeSkill, monthKey };
