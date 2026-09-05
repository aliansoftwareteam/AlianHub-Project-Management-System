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

const ACTION_DONE = 'agent.action';
const ACTION_REFUSED = 'agent.action_refused';
const ACTION_UNDONE = 'agent.action_undone';
const PROPOSAL_DECIDED = 'agent.proposal_decided';
const AGENT_DELETED = 'agent.deleted';
const RUN_REVERTED = 'agent.run_reverted';

const clip = (v, n = 2000) => {
    try { const s = JSON.stringify(v); return s.length > n ? JSON.parse(s.slice(0, n - 1) + '"') : v; } catch (e) { return String(v).slice(0, n); }
};

const safeParams = (params) => {
    const p = { ...(params || {}) };
    delete p.__proposal;
    return clip(p);
};

const write = async (companyId, entry) => {
    const n = normalizeAuditEntry(entry);
    if (!n.valid || !companyId) return null;
    try {
        const saved = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.AUDIT_LOGS, data: n.entry }, 'save');
        return saved && saved._id ? String(saved._id) : null;
    } catch (e) {
        logger.error(`agent audit write failed: ${e.message}`);
        return null;
    }
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

/* An allowed agent call. `undo` is the inverse-action descriptor executed by undo.js. */
const recordAction = async (companyId, actor, { action, reason, params, cost, undo, entityType, entityId, entityName, ip }) => {
    const a = attribution(actor);
    return write(companyId, {
        actorId: a.actorId, actorName: a.label, ip,
        action: ACTION_DONE,
        entityType: entityType || 'task', entityId: entityId ? String(entityId) : '', entityName: entityName || '',
        meta: { ...baseMeta(actor), action, reason: reason || '', params: safeParams(params), cost: cost || null,
                undo: undo || null, undoable: Boolean(undo), undoneAt: null, undoneBy: null },
    });
};

/* A refused call — logged with what was attempted and why, and nothing ran. */
const recordRefusal = async (companyId, actor, { action, reason, params, entityType, entityId, path, ip }) => {
    const a = attribution(actor);
    return write(companyId, {
        actorId: a.actorId, actorName: a.label, ip,
        action: ACTION_REFUSED,
        entityType: entityType || 'task', entityId: entityId ? String(entityId) : '',
        meta: { ...baseMeta(actor), action, reason, params: safeParams(params), path: path || null, ran: false },
    });
};

const recordUndo = async (companyId, actor, { originalId, action, entityType, entityId, ip }) => {
    const a = attribution(actor);
    return write(companyId, {
        actorId: a.actorId, actorName: a.label, ip,
        action: ACTION_UNDONE,
        entityType: entityType || 'task', entityId: entityId ? String(entityId) : '',
        meta: { ...baseMeta(actor), action, originalAuditId: String(originalId) },
    });
};

const recordProposalDecision = async (companyId, actor, { proposalId, decision, agentName, runId, changes, ip }) => {
    const a = attribution(actor);
    return write(companyId, {
        actorId: a.actorId, actorName: a.label, ip,
        action: PROPOSAL_DECIDED,
        entityType: 'agent_proposal', entityId: String(proposalId),
        meta: { ...baseMeta(actor), decision, agentName: agentName || null, runId: runId || null, changes: clip(changes || []) },
    });
};

const recordAgentDeleted = async (companyId, actor, { agentId, agentName, ip }) => {
    const a = attribution(actor);
    return write(companyId, {
        actorId: a.actorId, actorName: a.label, ip,
        action: AGENT_DELETED,
        entityType: 'agent', entityId: String(agentId), entityName: agentName || '',
        meta: { ...baseMeta(actor), agentId: String(agentId), agentName: agentName || null },
    });
};

const recordRunReverted = async (companyId, actor, { runId, agentId, agentName, reverted, failed, ip }) => {
    const a = attribution(actor);
    return write(companyId, {
        actorId: a.actorId, actorName: a.label, ip,
        action: RUN_REVERTED,
        entityType: 'agent_run', entityId: String(runId), entityName: agentName || '',
        meta: { ...baseMeta(actor), runId: String(runId), agentId: agentId || null, agentName: agentName || null, reverted, failed: clip(failed || []) },
    });
};

const markUndone = async (companyId, auditId, byActorId) => {
    if (!/^[0-9a-fA-F]{24}$/.test(String(auditId))) return;
    await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.AUDIT_LOGS,
        data: [{ _id: new mongoose.Types.ObjectId(String(auditId)) }, { $set: { 'meta.undoneAt': new Date(), 'meta.undoneBy': String(byActorId || '') } }],
    }, 'updateOne').catch((e) => logger.error(`markUndone: ${e.message}`));
};

const findById = async (companyId, auditId) => {
    if (!/^[0-9a-fA-F]{24}$/.test(String(auditId))) return null;
    return MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.AUDIT_LOGS, data: [{ _id: new mongoose.Types.ObjectId(String(auditId)) }],
    }, 'findOne');
};

module.exports = {
    ACTION_DONE, ACTION_REFUSED, ACTION_UNDONE, PROPOSAL_DECIDED, AGENT_DELETED, RUN_REVERTED,
    recordAction, recordRefusal, recordUndo, recordProposalDecision, recordAgentDeleted, recordRunReverted, markUndone, findById,
};
