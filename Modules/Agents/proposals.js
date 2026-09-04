const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const socketEmitter = require('../../event/socketEventEmitter');
const registry = require('./registry');
const actions = require('./actions');
const undo = require('./undo');
const audit = require('./agentAudit');

// AI Inbox proposals (9b). A proposal says what, why and exactly which registry
// actions it would run. Approving applies them through perform() — so they are
// audited and undoable like any other agent action — and hands back an undo
// token that is honoured for 30 seconds.

const STATUS = Object.freeze({ PENDING: 'pending', APPROVED: 'approved', EDITED: 'edited', DECLINED: 'declined', UNDONE: 'undone' });
const UNDO_WINDOW_MS = 30 * 1000;
const PRIMARY_AGE_MS = 24 * 60 * 60 * 1000;
const GATE_OWNER_ADMIN = 'owner_admin';
const oid = (id) => { try { return new mongoose.Types.ObjectId(String(id)); } catch (e) { return null; } };

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
            changes: changes.map((c) => ({ action: c.action, params: c.params || {}, label: String(c.label || c.action).slice(0, 300), reversible: Boolean(registry.get(c.action) && registry.get(c.action).undoable) })),
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
        counts: { waiting: byStatus.pending || 0, doneByAi: (byStatus.approved || 0) + (byStatus.edited || 0), declined: byStatus.declined || 0, undone: byStatus.undone || 0,
                  primary: shaped.filter((p) => p.bucket === 'primary').length, later: shaped.filter((p) => p.bucket === 'later').length },
    };
};

const get = (companyId, id) => MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.AGENT_PROPOSALS, data: [{ _id: oid(id) }] }, 'findOne');

const setStatus = async (companyId, id, set) => {
    const updated = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.AGENT_PROPOSALS, data: [{ _id: oid(id) }, { $set: set }, { returnDocument: 'after' }],
    }, 'findOneAndUpdate');
    if (updated) emit(companyId, updated);
    return updated;
};

/* Approve (optionally with edited changes). `decider` is the human actor;
 * the changes execute AS the agent, on the human's decision. */
const approve = async (companyId, id, { decider, isPrivileged, changes: edited, ip }) => {
    const p = await get(companyId, id);
    if (!p) return { error: 'Proposal not found.', status: 404 };
    if (p.status !== STATUS.PENDING) return { error: `Proposal is already ${p.status}.`, status: 409 };
    if (p.gate === GATE_OWNER_ADMIN && !isPrivileged) return { error: 'This proposal needs an Owner or Admin.', status: 403 };

    let changes = p.changes;
    let status = STATUS.APPROVED;
    if (Array.isArray(edited) && edited.length) {
        const check = validateChanges(edited);
        if (!check.valid) return { error: check.reason, status: 400 };
        changes = edited.map((c) => ({ action: c.action, params: c.params || {}, label: c.label || c.action }));
        status = STATUS.EDITED;
    }

    const agentActor = { kind: 'agent', userId: decider.userId, agentId: p.agentId, agentName: p.agentName, runId: p.runId, viaAccount: 'workspace', tokenId: null };
    const auditIds = [];
    const applied = [];
    for (const c of changes) {
        try {
            // eslint-disable-next-line no-await-in-loop
            const out = await actions.perform({ companyId, actor: agentActor, action: c.action, params: { ...c.params, __proposal: true }, reason: `approved proposal ${id} by ${decider.userId}`, ip });
            if (out.auditId) auditIds.push(out.auditId);
            applied.push({ action: c.action, ok: true, result: out.result });
        } catch (e) {
            applied.push({ action: c.action, ok: false, error: e.message });
        }
    }
    const undoUntil = new Date(Date.now() + UNDO_WINDOW_MS);
    const updated = await setStatus(companyId, id, { status, changes, decidedBy: decider.userId, decidedAt: new Date(), undoUntil, auditIds });
    await audit.recordProposalDecision(companyId, decider, { proposalId: id, decision: status, agentName: p.agentName, runId: p.runId, changes: applied, ip });
    // The run was waiting on this decision; without closing it here it sat in
    // "waiting_approval" — and in every running count — after the work was done.
    if (p.runId) {
        const runs = require('./runs');
        const okCount = applied.filter((a) => a.ok).length;
        await runs.finish(companyId, p.runId, { status: runs.STATUS.DONE, outcome: `${status} by a person — ${okCount} of ${applied.length} change(s) applied` }).catch(() => {});
    }
    return { proposal: updated, applied, undoToken: String(id), undoUntil };
};

const decline = async (companyId, id, { decider, ip, reason }) => {
    const p = await get(companyId, id);
    if (!p) return { error: 'Proposal not found.', status: 404 };
    if (p.status !== STATUS.PENDING) return { error: `Proposal is already ${p.status}.`, status: 409 };
    const updated = await setStatus(companyId, id, { status: STATUS.DECLINED, decidedBy: decider.userId, decidedAt: new Date() });
    if (p.runId) { const runs = require('./runs'); await runs.finish(companyId, p.runId, { status: runs.STATUS.DONE, outcome: 'declined by a person' }).catch(() => {}); }
    await audit.recordProposalDecision(companyId, decider, { proposalId: id, decision: `declined${reason ? `: ${String(reason).slice(0, 200)}` : ''}`, agentName: p.agentName, runId: p.runId, ip });
    return { proposal: updated };
};

/* Undo within the window: every audited action, newest first. */
const undoApproval = async (companyId, id, { decider, ip }) => {
    const p = await get(companyId, id);
    if (!p) return { error: 'Proposal not found.', status: 404 };
    if (![STATUS.APPROVED, STATUS.EDITED].includes(p.status)) return { error: `Nothing to undo — proposal is ${p.status}.`, status: 409 };
    if (!p.undoUntil || new Date(p.undoUntil).getTime() < Date.now()) return { error: 'The undo window has closed. Use the audit log to undo individual actions.', status: 410 };
    const results = [];
    for (const auditId of [...(p.auditIds || [])].reverse()) {
        // eslint-disable-next-line no-await-in-loop
        const row = await audit.findById(companyId, auditId);
        // eslint-disable-next-line no-await-in-loop
        results.push({ auditId, ...(await undo.undoAuditRow(companyId, row, decider, ip).catch((e) => ({ ok: false, reason: e.message }))) });
    }
    const updated = await setStatus(companyId, id, { status: STATUS.UNDONE, undoUntil: null });
    await audit.recordProposalDecision(companyId, decider, { proposalId: id, decision: 'undone', agentName: p.agentName, runId: p.runId, changes: results, ip });
    return { proposal: updated, results };
};

module.exports = { STATUS, UNDO_WINDOW_MS, GATE_OWNER_ADMIN, validateChanges, create, list, get, approve, decline, undoApproval, bucketOf };
