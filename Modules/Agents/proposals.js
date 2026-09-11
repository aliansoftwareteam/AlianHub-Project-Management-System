const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const socketEmitter = require('../../event/socketEventEmitter');
const registry = require('./registry');
const actions = require('./actions');
const undo = require('./undo');
const audit = require('./agentAudit');
const memory = require('./memory');
const findingMemory = require('./engine/findingMemory');
const persistence = require('../AICore/persistence');
const logger = require('../../Config/loggerConfig');

// AI Inbox proposals (9b). A proposal says what, why and exactly which registry
// actions it would run. Approving applies them through perform() — so they are
// audited and undoable like any other agent action — and hands back an undo
// token that is honoured for 30 seconds.

// 'applying' is the claim a decider holds while the changes run, so a second
// approve or decline racing the first finds the proposal already taken. A claim
// nobody released is reaped to 'failed' (reapStuck) rather than re-applied.
const REAPED_PREFIX = 'applying for more than ';
const STATUS = Object.freeze({ PENDING: 'pending', APPLYING: 'applying', APPROVED: 'approved', EDITED: 'edited', DECLINED: 'declined', UNDONE: 'undone', FAILED: 'failed' });
const STUCK_DEFAULT_MINUTES = 10;
const REAPER = Object.freeze({ kind: 'human', userId: 'system', personName: 'System' });
// 30s was a reflex window, not a review window: by the time a person opened the
// Inbox to look at what an agent did, it had closed. The audit row keeps the undo
// descriptor either way, so a longer window costs nothing.
const UNDO_WINDOW_MS = 15 * 60 * 1000;
const PRIMARY_AGE_MS = 24 * 60 * 60 * 1000;
const GATE_OWNER_ADMIN = 'owner_admin';
// The canned decline reasons the Inbox offers; only these can grow into a user preference.
const DECLINE_REASONS = Object.freeze(Object.keys(memory.DECLINE_REASON_TEXT));
const DECLINE_REASON_MAX = 200;
const REASON = Object.freeze({ RUN_MISSING: 'run_missing' });
const oid = (id) => { try { return new mongoose.Types.ObjectId(String(id)); } catch (e) { return null; } };

const quietly = async (what, fn) => {
    try { return await fn(); } catch (e) { logger.error(`[agent-proposal] ${what}: ${e.message}`); return null; }
};

const runOf = (companyId, runId) => MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.AGENT_RUNS, data: [{ _id: oid(runId) }] }, 'findOne');
const dropThread = (companyId, runId) => quietly(`drop thread ${runId}`, () => persistence.saverFor(companyId).deleteThread(String(runId)));

/* What the graph's remember node would have written, from what is in hand. */
const episodeFrom = (run, p, { decision, applied, reason }) => {
    const declined = decision === STATUS.DECLINED;
    const changes = Array.isArray(p.changes) ? p.changes : [];
    return {
        skill: run.skill || null, taskId: p.taskId || run.taskId || null, taskTitle: null,
        proposed: changes.length, acted: (run.actions || []).filter((a) => a && a.ok === true).length,
        approved: declined ? 0 : (applied || []).filter((a) => a.ok).length,
        declined: declined ? changes.length : 0, declinedReason: reason || null,
        reverted: false, spendUsd: Number((run.spend && run.spend.usd) || 0), at: new Date(),
    };
};

/* The run that filed the proposal continues from its checkpoint with the
 * decision. Only a run still waiting is resumed: a stopped or reaped run keeps
 * its status and its parked thread is dropped. When the resume itself fails
 * twice, the run is closed with an episode built here; a run from before the
 * graph, or one whose thread is gone, is closed directly as it always was. */
const settleRun = async (companyId, p, { decision, applied, reason, outcome }) => {
    if (!p.runId) return;
    const runs = require('./runs');
    const run = await quietly(`read run ${p.runId}`, () => runOf(companyId, p.runId));
    if (!run) return;
    if (run.status !== runs.STATUS.WAITING) { await dropThread(companyId, p.runId); return; }
    const resume = () => require('./engine/graph').resumeGraph({ companyId, runId: p.runId, resume: { decision, applied, reason } });
    let resumed;
    try {
        resumed = await resume();
    } catch (first) {
        logger.error(`[agent-proposal] resume run ${p.runId}: ${first.message}; retrying once`);
        try {
            resumed = await resume();
        } catch (second) {
            logger.error(`[agent-proposal] resume run ${p.runId} failed again: ${second.message}; closing the run directly`);
            const episode = episodeFrom(run, p, { decision, applied, reason });
            await runs.finish(companyId, p.runId, { status: runs.STATUS.DONE, outcome, episode, onlyIf: runs.STATUS.WAITING }).catch(() => {});
            await dropThread(companyId, p.runId);
            return;
        }
    }
    if (resumed && resumed.resumed) return;
    await runs.finish(companyId, p.runId, { status: runs.STATUS.DONE, outcome, onlyIf: runs.STATUS.WAITING }).catch(() => {});
};

const emit = (companyId, proposal) => {
    socketEmitter.emit('update', { type: 'update', module: 'agent', companyId: String(companyId), data: { kind: 'proposal', proposal }, updatedFields: { kind: 'proposal' }, actor: { kind: 'agent' }, depth: 1 });
};

/* Validate the change list: every entry must be a registry action and pass the
 * same evaluation it will face when applied. */
const validateChanges = (changes) => {
    if (!Array.isArray(changes) || !changes.length) return { valid: false, reason: 'A proposal needs at least one change.' };
    for (const c of changes) {
        const check = registry.evaluate(c && c.action, { ...(c && c.params), __proposal: true });
        if (!check.allowed) return { valid: false, reason: check.reason };
    }
    return { valid: true, reason: '' };
};

const gateOf = (changes, explicit) => {
    if (explicit) return explicit;
    const gated = (changes || []).find((c) => registry.get(c.action) && registry.get(c.action).gate);
    return gated ? registry.get(gated.action).gate : null;
};

const create = async (companyId, { agent, runId, taskId, projectId, what, why, changes, gate, priority, cost }) => {
    const check = validateChanges(changes);
    if (!check.valid) throw Object.assign(new Error(check.reason), { status: 400 });
    const saved = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.AGENT_PROPOSALS,
        data: {
            agentId: String(agent._id), agentName: agent.name, runId: runId || null, taskId: taskId || null, projectId: projectId || null,
            what: String(what).slice(0, 300), why: String(why || '').slice(0, 2000),
            changes: changes.map((c) => ({ action: c.action, params: c.params || {}, label: String(c.label || c.action).slice(0, 300), reversible: Boolean(registry.get(c.action) && registry.get(c.action).undoable), rating: c.rating || null, ...(c.remember ? { remember: c.remember } : {}) })),
            status: STATUS.PENDING, gate: gateOf(changes, gate), priority: priority || 'normal', cost: cost || null, auditIds: [],
        },
    }, 'save');
    emit(companyId, saved);
    return saved;
};

const bucketOf = (p, now = Date.now()) => {
    if (p.status !== STATUS.PENDING) return null;
    if (p.priority === 'high' || p.gate) return 'primary';
    return now - new Date(p.createdAt || now).getTime() < PRIMARY_AGE_MS ? 'primary' : 'later';
};

const list = async (companyId, { status, bucket, agentId, limit = 100 } = {}) => {
    const match = {};
    if (status) match.status = String(status);
    if (agentId) match.agentId = String(agentId);
    const rows = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.AGENT_PROPOSALS, data: [match, {}, { sort: { createdAt: -1 }, limit: Math.min(500, Number(limit) || 100) }],
    }, 'find');
    const shaped = (rows || []).map((p) => { const o = typeof p.toObject === 'function' ? p.toObject() : p; return { ...o, bucket: bucketOf(o), undoAvailable: o.undoUntil ? new Date(o.undoUntil).getTime() > Date.now() : false }; });
    const filtered = bucket ? shaped.filter((p) => p.bucket === bucket) : shaped;
    const counts = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.AGENT_PROPOSALS, data: [[{ $group: { _id: '$status', n: { $sum: 1 } } }]],
    }, 'aggregate').catch(() => []);
    const byStatus = {};
    (counts || []).forEach((c) => { byStatus[c._id] = c.n; });
    return {
        proposals: filtered,
        counts: { waiting: byStatus.pending || 0, doneByAi: (byStatus.approved || 0) + (byStatus.edited || 0), declined: byStatus.declined || 0, undone: byStatus.undone || 0, failed: byStatus.failed || 0,
                  primary: shaped.filter((p) => p.bucket === 'primary').length, later: shaped.filter((p) => p.bucket === 'later').length },
    };
};

const get = (companyId, id) => MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.AGENT_PROPOSALS, data: [{ _id: oid(id) }] }, 'findOne');

const setStatus = async (companyId, id, set, { onlyIf } = {}) => {
    const filter = onlyIf ? { _id: oid(id), status: onlyIf } : { _id: oid(id) };
    const updated = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.AGENT_PROPOSALS, data: [filter, { $set: set }, { returnDocument: 'after' }],
    }, 'findOneAndUpdate');
    if (updated) emit(companyId, updated);
    return updated;
};

const alreadyDecided = async (companyId, id) => {
    const now = await get(companyId, id);
    const state = now && now.status === STATUS.APPLYING ? 'being applied' : `already ${(now && now.status) || 'decided'}`;
    return { error: `Proposal is ${state}.`, status: 409 };
};

/* Approve (optionally with edited changes). `decider` is the human actor;
 * the changes execute AS the agent, on the human's decision, inside the
 * agent's allowedActions. */
const approve = async (companyId, id, { decider, isPrivileged, changes: edited, ip }) => {
    const p = await get(companyId, id);
    if (!p) return { error: 'Proposal not found.', status: 404 };
    if (p.status !== STATUS.PENDING) return alreadyDecided(companyId, id);
    if (p.gate === GATE_OWNER_ADMIN && !isPrivileged) return { error: 'This proposal needs an Owner or Admin.', status: 403 };

    let changes = p.changes;
    let status = STATUS.APPROVED;
    if (Array.isArray(edited) && edited.length) {
        const check = validateChanges(edited);
        if (!check.valid) return { error: check.reason, status: 400 };
        changes = edited.map((c) => ({ action: c.action, params: c.params || {}, label: c.label || c.action }));
        status = STATUS.EDITED;
    }

    const runs = require('./runs');
    const agent = await runs.getAgent(companyId, p.agentId);
    if (!agent) return { error: 'This agent was deleted — decline the proposal instead.', status: 409 };
    const run = p.runId ? await runOf(companyId, p.runId) : null;
    if (p.runId && !run) return { error: 'The run behind this proposal no longer exists — decline it instead.', status: 409, reason: REASON.RUN_MISSING };
    if (run && run.status === runs.STATUS.STOPPED) return { error: 'Run was stopped.', status: 409 };
    const depth = runs.originDepth(run);

    const claimed = await setStatus(companyId, id, { status: STATUS.APPLYING, decidedBy: decider.userId, decidedAt: new Date() }, { onlyIf: STATUS.PENDING });
    if (!claimed) return alreadyDecided(companyId, id);

    const runTrace = run && run.traceId ? { traceId: run.traceId } : {};
    const agentActor = { kind: 'agent', userId: decider.userId, agentId: p.agentId, agentName: p.agentName, runId: p.runId, viaAccount: 'workspace', tokenId: null, ...runTrace };
    const auditIds = [];
    const applied = [];
    for (const c of changes) {
        try {
            // eslint-disable-next-line no-await-in-loop
            const out = await actions.perform({ companyId, actor: agentActor, action: c.action, params: { ...c.params, __proposal: true }, reason: `approved proposal ${id} by ${decider.userId}`, ip, allowedActions: agent.allowedActions, depth });
            if (out.auditId) auditIds.push(out.auditId);
            applied.push({ action: c.action, ok: true, result: out.result });
        } catch (e) {
            applied.push({ action: c.action, ok: false, error: e.message });
        }
    }
    const undoUntil = new Date(Date.now() + UNDO_WINDOW_MS);
    const updated = await setStatus(companyId, id, { status, changes, undoUntil, auditIds });
    await audit.recordProposalDecision(companyId, { ...decider, ...runTrace }, { proposalId: id, decision: status, agentName: p.agentName, runId: p.runId, changes: applied, ip });
    const row = typeof p.toObject === 'function' ? p.toObject() : p;
    await quietly(`remember approved changes of ${id}`, () => memory.rememberApprovedChanges({ companyId, projectId: p.projectId, proposal: { ...row, changes, decidedBy: decider.userId }, applied }));
    for (const [i, a] of applied.entries()) {
        const c = changes[i];
        // eslint-disable-next-line no-await-in-loop
        if (a.ok && c && c.remember) await findingMemory.record(companyId, { ...c.remember, subtaskId: a.result && a.result.subtaskId });
    }
    // The run was waiting on this decision; without closing it here it sat in
    // "waiting_approval" — and in every running count — after the work was done.
    const okCount = applied.filter((a) => a.ok).length;
    await settleRun(companyId, p, { decision: status, applied, reason: null, outcome: `${status} by a person — ${okCount} of ${applied.length} change(s) applied` });
    return { proposal: updated, applied, undoToken: String(id), undoUntil };
};

const decline = async (companyId, id, { decider, ip, reason }) => {
    const p = await get(companyId, id);
    if (!p) return { error: 'Proposal not found.', status: 404 };
    if (p.status !== STATUS.PENDING) return alreadyDecided(companyId, id);
    const declineReason = typeof reason === 'string' ? reason.trim().slice(0, DECLINE_REASON_MAX) : '';
    const updated = await setStatus(companyId, id, { status: STATUS.DECLINED, decidedBy: decider.userId, decidedAt: new Date(), ...(declineReason ? { declineReason } : {}) }, { onlyIf: STATUS.PENDING });
    if (!updated) return alreadyDecided(companyId, id);
    await audit.recordProposalDecision(companyId, decider, { proposalId: id, decision: `declined${declineReason ? `: ${declineReason}` : ''}`, agentName: p.agentName, runId: p.runId, ip });
    if (DECLINE_REASONS.includes(declineReason)) {
        await quietly(`preference candidate for ${decider.userId}`, () => memory.preferenceCandidate({ companyId, userId: decider.userId, reasonKey: declineReason }));
    }
    await settleRun(companyId, p, { decision: STATUS.DECLINED, applied: [], reason: declineReason || null, outcome: 'declined by a person' });
    return { proposal: updated };
};

/* Undo within the window: every audited action, newest first. */
const undoApproval = async (companyId, id, { decider, ip }) => {
    const p = await get(companyId, id);
    if (!p) return { error: 'Proposal not found.', status: 404 };
    if (![STATUS.APPROVED, STATUS.EDITED].includes(p.status)) return { error: `Nothing to undo — proposal is ${p.status}.`, status: 409 };
    const undoUntil = p.undoUntil ? new Date(p.undoUntil).toISOString() : null;
    if (!undoUntil || new Date(undoUntil).getTime() < Date.now()) return { error: 'The undo window has closed. Use the audit log to undo individual actions.', status: 410, reason: undo.REASON.WINDOW_PASSED, undoUntil };
    const ctx = await undo.undoContext(companyId, decider);
    if (p.projectId && !ctx.visibleProjectIds.includes(String(p.projectId))) return { error: 'You cannot see the project this proposal touched.', status: 403, reason: undo.REASON.NOT_VISIBLE, undoUntil };
    const results = [];
    for (const auditId of [...(p.auditIds || [])].reverse()) {
        // eslint-disable-next-line no-await-in-loop
        const row = await audit.findById(companyId, auditId);
        // eslint-disable-next-line no-await-in-loop
        results.push({ auditId, ...(await undo.undoAuditRow(companyId, row, decider, ip, ctx).catch((e) => ({ ok: false, reason: e.message }))) });
    }
    const updated = await setStatus(companyId, id, { status: STATUS.UNDONE, undoUntil: null });
    await audit.recordProposalDecision(companyId, decider, { proposalId: id, decision: 'undone', agentName: p.agentName, runId: p.runId, changes: results, ip });
    return { proposal: updated, results };
};

const stuckThresholdMs = () => {
    const minutes = Number(process.env.AGENT_PROPOSAL_STUCK_MINUTES);
    return (Number.isFinite(minutes) && minutes > 0 ? minutes : STUCK_DEFAULT_MINUTES) * 60 * 1000;
};

const failWaitingRun = async (companyId, p, reason) => {
    if (!p.runId) return;
    const runs = require('./runs');
    const run = await quietly(`read run ${p.runId}`, () => runOf(companyId, p.runId));
    if (!run || run.status !== runs.STATUS.WAITING) return;
    await quietly(`fail run ${p.runId}`, () => runs.finish(companyId, p.runId, { status: runs.STATUS.FAILED, outcome: `proposal ${p._id} stalled while applying`, error: reason, onlyIf: runs.STATUS.WAITING }));
    await dropThread(companyId, p.runId);
};

/* A decider that died mid-apply leaves its claim behind. Nobody can tell which
 * of its changes ran, so the proposal is failed — never re-applied — and the
 * run that was waiting on it is closed instead of counting as live forever. */
const reapStuck = async (companyId, { olderThanMs = stuckThresholdMs(), now = new Date() } = {}) => {
    const cutoff = new Date(now.getTime() - olderThanMs);
    const failedReason = `${REAPED_PREFIX}${Math.round(olderThanMs / 60000)} minutes — the decider never finished, so the changes were not re-applied`;
    const stuck = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.AGENT_PROPOSALS, data: [{ status: STATUS.APPLYING, decidedAt: { $lt: cutoff } }] }, 'find');
    let reaped = 0;
    for (const p of stuck || []) {
        // eslint-disable-next-line no-await-in-loop
        const failed = await setStatus(companyId, p._id, { status: STATUS.FAILED, failedReason, failedAt: now }, { onlyIf: STATUS.APPLYING });
        if (!failed) continue;
        reaped += 1;
        // eslint-disable-next-line no-await-in-loop
        await audit.recordProposalDecision(companyId, REAPER, { proposalId: String(p._id), decision: `failed: ${failedReason}`, agentName: p.agentName, runId: p.runId, ip: '' });
        // eslint-disable-next-line no-await-in-loop
        await failWaitingRun(companyId, p, failedReason);
    }
    if (reaped) logger.info(`[agent-proposal] reaped ${reaped} proposal(s) stuck in applying`);
    return { reaped };
};

module.exports = { STATUS, REASON, REAPED_PREFIX, UNDO_WINDOW_MS, GATE_OWNER_ADMIN, DECLINE_REASONS, validateChanges, create, list, get, approve, decline, undoApproval, bucketOf, reapStuck, stuckThresholdMs };
