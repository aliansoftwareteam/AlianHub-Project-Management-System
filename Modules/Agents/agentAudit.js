const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { normalizeAuditEntry } = require('../Audit/helpers/auditRules');
const logger = require('../../Config/loggerConfig');
const { isAgent, attribution } = require('./actor');

// One audit log for people and agents (11b). Agent rows carry
// { actorType, agentId, runId, action, reason, params, cost, undo, viaAccount }
// in meta, and the row id is what an undo token points at — so unlike
// recordAudit this one waits for the write and returns the id.
//
// An action row is opened `pending` before the mutation and marked `applied`
// (with its undo descriptor) after it, so an action can never happen without
// a row: a failed open aborts the action, a failed mark fails its result.

const ACTION_DONE = 'agent.action';
const ACTION_REFUSED = 'agent.action_refused';
const ACTION_UNDONE = 'agent.action_undone';
const PROPOSAL_DECIDED = 'agent.proposal_decided';
const AGENT_DELETED = 'agent.deleted';
const RUN_REVERTED = 'agent.run_reverted';
const REVISION_PROMOTED = 'agent.revision_promoted';
const REVISION_ROLLED_BACK = 'agent.revision_rolled_back';

const clip = (v, n = 2000) => {
    try { const s = JSON.stringify(v); return s.length > n ? JSON.parse(s.slice(0, n - 1) + '"') : v; } catch (e) { return String(v).slice(0, n); }
};

const safeParams = (params) => {
    const p = { ...(params || {}) };
    delete p.__proposal;
    return clip(p);
};

const STATE = Object.freeze({ PENDING: 'pending', APPLIED: 'applied', FAILED: 'failed' });
const AUDIT_UNAVAILABLE = 'audit_unavailable';
const AUDIT_UNMARKED = 'audit_unmarked';

class AuditUnavailableError extends Error {
    constructor(detail) {
        super(`${AUDIT_UNAVAILABLE}: the action was not performed because its audit row could not be written (${detail})`);
        this.name = 'AuditUnavailableError'; this.reason = AUDIT_UNAVAILABLE; this.status = 503;
    }
}

class AuditUnmarkedError extends Error {
    constructor(auditId, detail) {
        super(`${AUDIT_UNMARKED}: the action ran but its audit row ${auditId} could not be marked applied (${detail})`);
        this.name = 'AuditUnmarkedError'; this.reason = AUDIT_UNMARKED; this.status = 500; this.auditId = auditId;
    }
}

const write = async (companyId, entry) => {
    const n = normalizeAuditEntry(entry);
    if (!n.valid) throw new Error(n.reason || 'invalid audit entry');
    if (!companyId) throw new Error('companyId is required');
    const saved = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.AUDIT_LOGS, data: n.entry }, 'save');
    if (!saved || !saved._id) throw new Error('no row id returned');
    return String(saved._id);
};

const writeQuietly = async (companyId, entry) => {
    try { return await write(companyId, entry); } catch (e) {
        logger.error(`agent audit write failed: ${e.message}`);
        return null;
    }
};

const rowFilter = (auditId) => (/^[0-9a-fA-F]{24}$/.test(String(auditId)) ? { _id: new mongoose.Types.ObjectId(String(auditId)) } : null);

const setRow = async (companyId, auditId, $set) => {
    const filter = rowFilter(auditId);
    if (!filter) throw new Error(`invalid audit id ${auditId}`);
    const r = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.AUDIT_LOGS, data: [filter, { $set }] }, 'updateOne');
    if (!r || !(r.matchedCount > 0 || r.modifiedCount > 0)) throw new Error(`audit row ${auditId} not found`);
};

const baseMeta = (actor) => {
    const a = attribution(actor);
    return {
        actorType: a.actorType,
        agentId: actor.agentId || null,
        agentName: actor.agentName || null,
        runId: actor.runId || null,
        viaAccount: isAgent(actor) ? actor.viaAccount : null,
        tokenId: actor.tokenId || null,
        onBehalfOf: isAgent(actor) && actor.userId ? actor.userId : null,
    };
};

/* Opens the row for an allowed agent call before anything is mutated. Throws
 * AuditUnavailableError, and the caller must not act. */
const openAction = async (companyId, actor, { action, reason, params, cost, entityType, entityId, entityName, ip }) => {
    const a = attribution(actor);
    try {
        return await write(companyId, {
            actorId: a.actorId, actorName: a.label, ip,
            action: ACTION_DONE,
            entityType: entityType || 'task', entityId: entityId ? String(entityId) : '', entityName: entityName || '',
            meta: { ...baseMeta(actor), action, reason: reason || '', params: safeParams(params), cost: cost || null,
                    state: STATE.PENDING, undo: null, undoable: false, undoneAt: null, undoneBy: null },
        });
    } catch (e) {
        logger.error(`agent audit: ${AUDIT_UNAVAILABLE} for ${action}: ${e.message}`);
        throw new AuditUnavailableError(e.message);
    }
};

/* `undo` is the inverse-action descriptor executed by undo.js. Throws
 * AuditUnmarkedError after logging: the mutation happened and the row needs reconciling. */
const applyAction = async (companyId, auditId, { undo, entityType, entityId, entityName } = {}) => {
    const $set = { 'meta.state': STATE.APPLIED, 'meta.undo': undo || null, 'meta.undoable': Boolean(undo) };
    if (entityType) $set.entityType = entityType;
    if (entityId) $set.entityId = String(entityId);
    if (entityName) $set.entityName = entityName;
    try { await setRow(companyId, auditId, $set); } catch (e) {
        logger.error(`agent audit: ${AUDIT_UNMARKED} — row ${auditId} is still pending after the action ran, reconcile it: ${e.message}`);
        throw new AuditUnmarkedError(auditId, e.message);
    }
};

/* The action threw before changing anything; the row records that and stays out of undo. */
const failAction = async (companyId, auditId, detail) => {
    try { await setRow(companyId, auditId, { 'meta.state': STATE.FAILED, 'meta.failed': String(detail || '').slice(0, 500), 'meta.undoable': false }); } catch (e) {
        logger.error(`agent audit: row ${auditId} could not be marked failed: ${e.message}`);
    }
};

const recordAction = async (companyId, actor, entry) => {
    const auditId = await openAction(companyId, actor, entry);
    await applyAction(companyId, auditId, entry);
    return auditId;
};

/* A refused call — logged with what was attempted and why, and nothing ran. */
const recordRefusal = async (companyId, actor, { action, reason, params, entityType, entityId, path, ip }) => {
    const a = attribution(actor);
    return writeQuietly(companyId, {
        actorId: a.actorId, actorName: a.label, ip,
        action: ACTION_REFUSED,
        entityType: entityType || 'task', entityId: entityId ? String(entityId) : '',
        meta: { ...baseMeta(actor), action, reason, params: safeParams(params), path: path || null, ran: false },
    });
};

const recordUndo = async (companyId, actor, { originalId, action, entityType, entityId, ip }) => {
    const a = attribution(actor);
    return writeQuietly(companyId, {
        actorId: a.actorId, actorName: a.label, ip,
        action: ACTION_UNDONE,
        entityType: entityType || 'task', entityId: entityId ? String(entityId) : '',
        meta: { ...baseMeta(actor), action, originalAuditId: String(originalId) },
    });
};

const recordProposalDecision = async (companyId, actor, { proposalId, decision, agentName, runId, changes, ip }) => {
    const a = attribution(actor);
    return writeQuietly(companyId, {
        actorId: a.actorId, actorName: a.label, ip,
        action: PROPOSAL_DECIDED,
        entityType: 'agent_proposal', entityId: String(proposalId),
        meta: { ...baseMeta(actor), decision, agentName: agentName || null, runId: runId || null, changes: clip(changes || []) },
    });
};

const recordAgentDeleted = async (companyId, actor, { agentId, agentName, ip }) => {
    const a = attribution(actor);
    return writeQuietly(companyId, {
        actorId: a.actorId, actorName: a.label, ip,
        action: AGENT_DELETED,
        entityType: 'agent', entityId: String(agentId), entityName: agentName || '',
        meta: { ...baseMeta(actor), agentId: String(agentId), agentName: agentName || null },
    });
};

const recordRunReverted = async (companyId, actor, { runId, agentId, agentName, reverted, failed, ip }) => {
    const a = attribution(actor);
    return writeQuietly(companyId, {
        actorId: a.actorId, actorName: a.label, ip,
        action: RUN_REVERTED,
        entityType: 'agent_run', entityId: String(runId), entityName: agentName || '',
        meta: { ...baseMeta(actor), runId: String(runId), agentId: agentId || null, agentName: agentName || null, reverted, failed: clip(failed || []) },
    });
};

/* One row per pointer move: which revision was live before, which is live now,
 * and what moved it (a settings save, a promote, a rollback). */
const recordRevisionChange = async (companyId, actor, { kind, agentId, agentName, from, to, ip }) => {
    const a = attribution(actor);
    return writeQuietly(companyId, {
        actorId: a.actorId, actorName: a.label, ip,
        action: kind === 'rollback' ? REVISION_ROLLED_BACK : REVISION_PROMOTED,
        entityType: 'agent', entityId: String(agentId), entityName: agentName || '',
        meta: { ...baseMeta(actor), agentId: String(agentId), agentName: agentName || null, kind: kind || 'promote', from: from == null ? null : Number(from), to: Number(to) },
    });
};

const markUndone = async (companyId, auditId, byActorId) => {
    const filter = rowFilter(auditId);
    if (!filter) return;
    await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.AUDIT_LOGS,
        data: [filter, { $set: { 'meta.undoneAt': new Date(), 'meta.undoneBy': String(byActorId || '') } }],
    }, 'updateOne').catch((e) => logger.error(`markUndone: ${e.message}`));
};

const findById = async (companyId, auditId) => {
    const filter = rowFilter(auditId);
    if (!filter) return null;
    return MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.AUDIT_LOGS, data: [filter] }, 'findOne');
};

module.exports = {
    ACTION_DONE, ACTION_REFUSED, ACTION_UNDONE, PROPOSAL_DECIDED, AGENT_DELETED, RUN_REVERTED, REVISION_PROMOTED, REVISION_ROLLED_BACK, STATE, AUDIT_UNAVAILABLE, AUDIT_UNMARKED,
    AuditUnavailableError, AuditUnmarkedError,
    openAction, applyAction, failAction, recordAction, recordRefusal, recordUndo, recordProposalDecision, recordAgentDeleted, recordRunReverted, recordRevisionChange, markUndone, findById,
};
