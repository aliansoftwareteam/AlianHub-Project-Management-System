const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const socketEmitter = require('../../event/socketEventEmitter');
const logger = require('../../Config/loggerConfig');
const { summarize } = require('../AIProjectGenerator/usage');
const registry = require('./registry');

// Agent runs and spend. A run is the unit the rail footer counts ("2 running"),
// the project header chip sums (elapsed, spend) and the audit log links to
// (run #n). Spend caps are enforced before a run starts, not measured after.

const STATUS = Object.freeze({ QUEUED: 'queued', RUNNING: 'running', WAITING: 'waiting_approval', DONE: 'done', SKIPPED: 'skipped', FAILED: 'failed', STOPPED: 'stopped' });
const OPEN = [STATUS.QUEUED, STATUS.RUNNING, STATUS.WAITING];
// A skip is the skill declining its input (no URL, no PR link, brief too short):
// neither a success to count as clean nor a failure to fix, so it is its own status.
const TERMINAL = [STATUS.DONE, STATUS.SKIPPED, STATUS.FAILED, STATUS.STOPPED];
const oid = (id) => { try { return new mongoose.Types.ObjectId(String(id)); } catch (e) { return null; } };
const monthKey = (d = new Date()) => d.toISOString().slice(0, 7);
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

/* Can this agent start a run right now? Returns { ok, reason }. */
const canStart = async (agent, { trigger, viaAccount, companyId } = {}) => {
    if (!agent) return { ok: false, reason: 'Agent not found.' };
    if (agent.paused) return { ok: false, reason: `Agent is paused${agent.pausedReason ? ` (${agent.pausedReason})` : ''}.` };
    const month = agent.spendMonth && agent.spendMonth.month === monthKey() ? agent.spendMonth : { usd: 0 };
    if (Number(agent.spendCapUsd) > 0 && Number(month.usd || 0) >= Number(agent.spendCapUsd)) {
        return { ok: false, reason: `Spend cap reached ($${Number(month.usd).toFixed(2)} of $${agent.spendCapUsd}).` };
    }
    const via = viaAccount || agent.account || 'workspace';
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
    return { ok: true, reason: '' };
};

const create = async (companyId, { agent, taskId, projectId, skill, trigger, startedBy, viaAccount, note }) => {
    const run = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.AGENT_RUNS,
        data: {
            agentId: String(agent._id), agentName: agent.name, taskId: taskId ? String(taskId) : null, projectId: projectId ? String(projectId) : null,
            skill: skill || null, trigger: trigger || 'manual', status: STATUS.RUNNING, viaAccount: viaAccount || agent.account || 'workspace',
            startedBy: startedBy ? String(startedBy) : null, startedAt: new Date(), elapsedMs: 0,
            spend: { tokens: 0, usd: 0, model: null, billedToWorkspace: (viaAccount || agent.account || 'workspace') === 'workspace' },
            actions: note ? [{ action: 'mention', note: String(note).slice(0, 2000), at: new Date() }] : [],
            proposals: [], refusals: 0,
        },
    }, 'save');
    emit(companyId, 'run', { run });
    return run;
};

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

const finish = async (companyId, runId, { status = STATUS.DONE, outcome, error, onlyIf } = {}) => {
    const run = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.AGENT_RUNS, data: [{ _id: oid(runId) }] }, 'findOne');
    if (!run) return null;
    const startedAt = run.startedAt ? new Date(run.startedAt).getTime() : Date.now();
    return patch(companyId, runId, { status, finishedAt: new Date(), elapsedMs: Date.now() - startedAt, outcome: outcome || null, error: error || null }, {}, { onlyIf });
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
    const run = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.AGENT_RUNS, data: [{ _id: oid(runId) }] }, 'findOne');
    if (!run) return { error: 'Run not found.' };
    if (!OPEN.includes(run.status)) return { error: `Run is already ${run.status}.` };
    const stopped = await finish(companyId, runId, { status: STATUS.STOPPED, outcome: `stopped by ${byUserId || 'a person'}` });
    return { run: stopped };
};

/* Record tokens/cost on the run and the agent's month. Personal-account spend is
 * the developer's own and never billed to the workspace (27a). */
const recordSpend = async (companyId, run, usage, model) => {
    const priced = summarize(usage || {}, model);
    const billed = run.viaAccount !== 'personal' && run.viaAccount !== 'local';
    const usd = billed && priced.costUsd ? priced.costUsd : 0;
    await patch(companyId, run._id, {
        spend: { tokens: priced.totalTokens, usd, model: priced.model || model || null, billedToWorkspace: billed, personalUsd: !billed && priced.costUsd ? priced.costUsd : 0 },
    });
    if (!billed) return { usd: 0, tokens: priced.totalTokens, capReached: false };
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

const list = async (companyId, { status, projectId, agentId, taskId, limit = 50 } = {}) => {
    const match = {};
    if (status === 'open') match.status = { $in: OPEN };
    else if (status) match.status = String(status);
    if (projectId) match.projectId = String(projectId);
    if (agentId) match.agentId = String(agentId);
    if (taskId) match.taskId = String(taskId);
    return MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.AGENT_RUNS, data: [match, {}, { sort: { startedAt: -1 }, limit: Math.min(200, Math.max(1, Number(limit) || 50)) }],
    }, 'find');
};

/* What the rail footer and the project header chip show. */
const summary = async (companyId, { projectId } = {}) => {
    const match = { status: { $in: OPEN } };
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
const countsByStatus = async (companyId, { projectId, agentId } = {}) => {
    const match = {};
    if (projectId) match.projectId = String(projectId);
    if (agentId) match.agentId = String(agentId);
    const rows = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.AGENT_RUNS, data: [[{ $match: match }, { $group: { _id: '$status', n: { $sum: 1 } } }]],
    }, 'aggregate').catch(() => []);
    const counts = Object.fromEntries(Object.values(STATUS).map((k) => [k, 0]));
    (rows || []).forEach((r) => { if (r && r._id in counts) counts[r._id] = r.n; });
    return counts;
};

const pauseAll = async (companyId, reason) => {
    await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.AGENTS, data: [{ deletedStatusKey: { $ne: 1 } }, { $set: { paused: true, pausedReason: reason || 'pause_all', pausedAt: new Date() } }] }, 'updateMany');
    const open = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.AGENT_RUNS, data: [{ status: { $in: OPEN } }, '_id'] }, 'find');
    for (const r of open || []) {
        // eslint-disable-next-line no-await-in-loop
        await finish(companyId, r._id, { status: STATUS.STOPPED, outcome: 'pause all' });
    }
    emit(companyId, 'agent', { pausedAll: true });
    return { stopped: (open || []).length };
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

/* Execute the run's skill. Findings land as a proposal (review mode) unless
 * autonomy lets the agent act. Resolves with the terminal state, or with
 * { status: 'abandoned' } when stop/pause-all took the run away mid-flight —
 * then nothing more is written and no proposal is filed. */
const executeSkill = async (companyId, run, agent, task, { proposals, actions, actor }) => {
    const orchestrator = require('./engine/orchestrator');
    const memory = require('./engine/findingMemory');
    const abandoned = { status: 'abandoned', outcome: 'stopped before it finished' };
    const settle = async (status, outcome) => {
        const saved = await finish(companyId, run._id, { status, outcome, onlyIf: STATUS.RUNNING });
        return saved ? { status, outcome, refusals: Number(saved.refusals || 0) } : abandoned;
    };
    try {
        const result = await orchestrator.run({ skillSlug: run.skill || 'qa-review', task, companyId, budget: { maxTokens: 4000 } });
        const spent = await recordSpend(companyId, run, result.usage, result.model);
        if (result.status !== 'success') return settle(result.status === 'skipped' ? STATUS.SKIPPED : STATUS.FAILED, result.reason);

        const { changes, alreadyTracked } = await changesFor(companyId, task, result);
        if (!changes.length) return settle(STATUS.DONE, `nothing new to file — ${alreadyTracked} finding(s) already tracked`);

        const mayAct = changes.every((c) => registry.mayActDirectly(agent.autonomy, c.action));
        if (mayAct) {
            let applied = 0;
            let refusals = 0;
            for (const c of changes) {
                try {
                    // eslint-disable-next-line no-await-in-loop
                    const out = await actions.perform({ companyId, actor, action: c.action, params: c.params, reason: `${run.skill} finding`, allowedActions: agent.allowedActions });
                    // eslint-disable-next-line no-await-in-loop
                    await appendAction(companyId, run._id, { action: c.action, auditId: out.auditId, ok: true });
                    applied += 1;
                    // eslint-disable-next-line no-await-in-loop
                    if (c.remember) await memory.record(companyId, { ...c.remember, subtaskId: out.result && out.result.subtaskId });
                } catch (e) {
                    if (e.name !== 'RefusedError') throw e;
                    refusals += 1;
                    // eslint-disable-next-line no-await-in-loop
                    await patch(companyId, run._id, {}, { $inc: { refusals: 1 }, $push: { actions: { action: c.action, auditId: e.auditId || null, ok: false, refused: e.message, at: new Date() } } });
                }
            }
            return settle(applied ? STATUS.DONE : STATUS.FAILED, `${applied} change(s) applied${refusals ? `, ${refusals} refused` : ''}${alreadyTracked ? `, ${alreadyTracked} already tracked` : ''}`);
        }

        if (!(await isRunning(companyId, run._id))) return abandoned;
        const proposal = await proposals.create(companyId, {
            agent, runId: String(run._id), taskId: String(task._id), projectId: String(task.ProjectID),
            what: Array.isArray(result.changes) ? `${run.skill}: ${changes.length} change(s) on ${task.TaskKey || task.TaskName}` : `File ${result.findings.length - alreadyTracked} QA finding(s) on ${task.TaskKey || task.TaskName}`,
            // What the grounding check removed is part of the record a person reviews.
            why: [result.summary, Array.isArray(result.dropped) && result.dropped.length ? `Dropped as unsupported by the data: ${result.dropped.map((d) => `"${String(d.text).slice(0, 80)}" (${d.reason})`).join('; ')}` : ''].filter(Boolean).join('\n\n'),
            changes,
            cost: { tokens: result.usage && result.usage.totalTokens, model: result.model, usd: spent && spent.usd },
        });
        const waiting = await patch(companyId, run._id, { status: STATUS.WAITING }, { $push: { proposals: String(proposal._id) } }, { onlyIf: STATUS.RUNNING });
        return waiting ? { status: STATUS.WAITING, proposalId: String(proposal._id), refusals: 0 } : abandoned;
    } catch (e) {
        logger.error(`[agent-run] ${run._id}: ${e.message}`);
        const saved = await finish(companyId, run._id, { status: STATUS.FAILED, error: e.message, onlyIf: STATUS.RUNNING });
        return saved ? { status: STATUS.FAILED, error: e.message } : abandoned;
    }
};
/* Which skill a run executes. Agents store skills as objects ({ key, name, … });
 * an explicit slug wins, then the agent's first skill key, then the QA review. */
const skillSlugOf = (agent, explicit) => {
    if (explicit && typeof explicit === 'string') return explicit;
    const first = agent && Array.isArray(agent.skills) ? agent.skills[0] : null;
    if (!first) return 'qa-review';
    if (typeof first === 'string') return first;
    return first.key || first.slug || first.name || 'qa-review';
};

module.exports = { STATUS, OPEN, TERMINAL, canStart, runsToday, skillSlugOf, create, patch, appendAction, finish, isRunning, reapStale, stop, recordSpend, list, summary, countsByStatus, pauseAll, getAgent, emitAgent, executeSkill, monthKey };
