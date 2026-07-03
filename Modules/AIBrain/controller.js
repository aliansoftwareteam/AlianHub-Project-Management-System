// AHE-3792 — AI Brain HTTP controller (Phase 1: the safe spine).
//
// Exposes the per-company autonomy settings, the action registry, the audit
// log, and the AI inbox (approve / decline). All endpoints are companyId-scoped
// (read from the `companyid` header, like the rest of the app); mutations are
// gated to Owner/Admin (roleType 1/2). Read-only where not gated.

const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const logger = require('../../Config/loggerConfig');
const mongoose = require('mongoose');
const { listActions, getAction } = require('./actionRegistry');
const { dispatch, runAction, getSettings, writeAudit } = require('./dispatcher');

const isAdmin = (roleType) => Number(roleType) === 1 || Number(roleType) === 2;

// GET /api/v1/ai-brain/settings
exports.getSettings = async (req, res) => {
    try {
        const companyId = req.headers['companyid'];
        if (!companyId) return res.status(400).json({ status: false, message: 'companyId header required' });
        const settings = await getSettings(companyId);
        return res.status(200).json({ status: true, data: settings });
    } catch (error) {
        logger.error(`AIBrain getSettings error: ${error && error.message ? error.message : error}`);
        return res.status(500).json({ status: false, message: 'Failed to load AI Brain settings' });
    }
};

// POST /api/v1/ai-brain/settings  (admin only)
exports.updateSettings = async (req, res) => {
    try {
        const companyId = req.headers['companyid'];
        if (!companyId) return res.status(400).json({ status: false, message: 'companyId header required' });
        const b = req.body || {};
        if (!isAdmin(b.callerRoleType)) return res.status(403).json({ status: false, message: 'Owner/Admin only' });

        const set = { key: 'default', updatedBy: String(b.callerUserId || '') };
        if (b.autonomyLevel !== undefined) set.autonomyLevel = Math.max(0, Math.min(4, Number(b.autonomyLevel) || 0));
        if (b.killSwitch !== undefined) set.killSwitch = !!b.killSwitch;
        if (b.spendCapUSD !== undefined) set.spendCapUSD = Number(b.spendCapUSD) || 0;
        if (b.dailyActionLimit !== undefined) set.dailyActionLimit = Number(b.dailyActionLimit) || 0;
        if (Array.isArray(b.allowedActions)) set.allowedActions = b.allowedActions.map(String);

        const updated = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.AI_BRAIN_SETTINGS,
            data: [
                { key: 'default' },
                { $set: set },
                { new: true, upsert: true, useFindAndModify: false, setDefaultsOnInsert: true },
            ],
        }, 'findOneAndUpdate');
        return res.status(200).json({ status: true, data: updated });
    } catch (error) {
        logger.error(`AIBrain updateSettings error: ${error && error.message ? error.message : error}`);
        return res.status(500).json({ status: false, message: 'Failed to update AI Brain settings' });
    }
};

// GET /api/v1/ai-brain/actions  — the registry (handler-free view)
exports.listActions = async (req, res) => {
    try {
        return res.status(200).json({ status: true, data: listActions() });
    } catch (error) {
        logger.error(`AIBrain listActions error: ${error && error.message ? error.message : error}`);
        return res.status(500).json({ status: false, message: 'Failed to list actions' });
    }
};

// POST /api/v1/ai-brain/audit  — recent audit entries (filterable)
exports.listAudit = async (req, res) => {
    try {
        const companyId = req.headers['companyid'];
        if (!companyId) return res.status(400).json({ status: false, message: 'companyId header required' });
        const b = req.body || {};
        const filter = { deletedStatusKey: { $in: [0, null] } };
        if (b.projectId) filter.projectId = String(b.projectId);
        if (b.status) filter.status = String(b.status);
        if (b.actionKey) filter.actionKey = String(b.actionKey);
        const limit = Math.min(Number(b.limit) || 50, 200);
        const rows = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.AI_AUDIT_LOG,
            data: [filter, null, { sort: { createdAt: -1 }, limit }],
        }, 'find').catch(() => []);
        return res.status(200).json({ status: true, data: rows || [] });
    } catch (error) {
        logger.error(`AIBrain listAudit error: ${error && error.message ? error.message : error}`);
        return res.status(500).json({ status: false, message: 'Failed to load audit log' });
    }
};

// GET /api/v1/ai-brain/inbox?status=pending
exports.listInbox = async (req, res) => {
    try {
        const companyId = req.headers['companyid'];
        if (!companyId) return res.status(400).json({ status: false, message: 'companyId header required' });
        const status = req.query && req.query.status ? String(req.query.status) : 'pending';
        const filter = { deletedStatusKey: { $in: [0, null] } };
        if (status !== 'all') filter.status = status;
        const rows = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.AI_INBOX,
            data: [filter, null, { sort: { createdAt: -1 }, limit: 100 }],
        }, 'find').catch(() => []);
        return res.status(200).json({ status: true, data: rows || [] });
    } catch (error) {
        logger.error(`AIBrain listInbox error: ${error && error.message ? error.message : error}`);
        return res.status(500).json({ status: false, message: 'Failed to load AI inbox' });
    }
};

// POST /api/v1/ai-brain/inbox/decide  (admin only) — approve or decline
exports.decideInbox = async (req, res) => {
    try {
        const companyId = req.headers['companyid'];
        if (!companyId) return res.status(400).json({ status: false, message: 'companyId header required' });
        const b = req.body || {};
        if (!isAdmin(b.callerRoleType)) return res.status(403).json({ status: false, message: 'Owner/Admin only' });

        const inboxId = b.inboxId;
        const decision = b.decision;
        if (!inboxId || !mongoose.Types.ObjectId.isValid(String(inboxId))) {
            return res.status(400).json({ status: false, message: 'valid inboxId required' });
        }
        if (!['approve', 'decline'].includes(decision)) {
            return res.status(400).json({ status: false, message: "decision must be 'approve' or 'decline'" });
        }

        const item = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.AI_INBOX,
            data: [{ _id: new mongoose.Types.ObjectId(String(inboxId)) }, {}],
        }, 'findOne').catch(() => null);
        if (!item) return res.status(404).json({ status: false, message: 'inbox item not found' });
        if (item.status !== 'pending') return res.status(409).json({ status: false, message: `already ${item.status}` });

        const decidedBy = String(b.callerUserId || '');
        const ctxBase = {
            actionKey: item.actionKey, params: item.params || {}, reason: item.reason,
            projectId: item.projectId, taskId: item.taskId, skill: item.skill,
            actorType: 'user', actorUserId: decidedBy, inboxId: String(item._id),
        };

        if (decision === 'decline') {
            const updated = await MongoDbCrudOpration(companyId, {
                type: SCHEMA_TYPE.AI_INBOX,
                data: [{ _id: item._id }, { $set: { status: 'declined', decidedBy, decidedAt: new Date() } }, { new: true, useFindAndModify: false }],
            }, 'findOneAndUpdate');
            await writeAudit(companyId, { ...ctxBase, status: 'declined' });
            return res.status(200).json({ status: true, data: updated });
        }

        // approve -> run the action (a human decided, so it bypasses the autonomy gate)
        const action = getAction(item.actionKey);
        if (!action) return res.status(400).json({ status: false, message: 'unknown action on inbox item' });
        const outcome = await runAction(companyId, action, ctxBase);
        const updated = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.AI_INBOX,
            data: [
                { _id: item._id },
                { $set: { status: outcome.status === 'executed' ? 'executed' : 'failed', decidedBy, decidedAt: new Date(), result: outcome.result || {}, error: outcome.error || '' } },
                { new: true, useFindAndModify: false },
            ],
        }, 'findOneAndUpdate');
        return res.status(200).json({ status: true, data: updated, outcome });
    } catch (error) {
        logger.error(`AIBrain decideInbox error: ${error && error.message ? error.message : error}`);
        return res.status(500).json({ status: false, message: 'Failed to decide inbox item' });
    }
};

// POST /api/v1/ai-brain/propose  — push an action through the gate. This is the
// single entry point the skills / brain (and manual testing) use; actorType
// defaults to 'ai'. Returns { status: executed | proposed | blocked | failed }.
exports.propose = async (req, res) => {
    try {
        const companyId = req.headers['companyid'];
        if (!companyId) return res.status(400).json({ status: false, message: 'companyId header required' });
        const b = req.body || {};
        if (!b.actionKey) return res.status(400).json({ status: false, message: 'actionKey required' });
        const outcome = await dispatch(companyId, {
            actionKey: String(b.actionKey),
            params: b.params || {},
            reason: String(b.reason || ''),
            projectId: String(b.projectId || ''),
            taskId: String(b.taskId || ''),
            skill: String(b.skill || ''),
            actorType: b.actorType === 'user' ? 'user' : 'ai',
            actorUserId: String(b.callerUserId || ''),
        });
        return res.status(200).json({ status: true, data: outcome });
    } catch (error) {
        logger.error(`AIBrain propose error: ${error && error.message ? error.message : error}`);
        return res.status(500).json({ status: false, message: 'Failed to dispatch action' });
    }
};
