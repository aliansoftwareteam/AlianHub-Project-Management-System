// AHE-3792 — the AI Brain dispatcher (the safety gate).
//
// Every action the agent wants to take goes through dispatch(). It enforces, in
// order: kill switch -> known + company-allowed action -> autonomy gate (AI
// only) -> daily rate limit -> execute. Anything that doesn't clear the
// autonomy gate is turned into an AI-inbox proposal for a human to approve.
// Every outcome is written to the append-only audit log ("AI did X because Y").

const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const logger = require('../../Config/loggerConfig');
const { getAction } = require('./actionRegistry');

const DEFAULT_SETTINGS = {
    key: 'default',
    autonomyLevel: 0,
    killSwitch: false,
    spendCapUSD: 0,
    dailyActionLimit: 0,
    allowedActions: [],
    deletedStatusKey: 0,
};

// Per-company autonomy config (singleton row, key:'default'). Returns sane
// defaults (L0, everything off) when none exists yet.
async function getSettings(companyId) {
    const row = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.AI_BRAIN_SETTINGS,
        data: [{ key: 'default' }, {}],
    }, 'findOne').catch(() => null);
    const doc = row && (row.toObject ? row.toObject() : row);
    return { ...DEFAULT_SETTINGS, ...(doc || {}) };
}

// Append one entry to the audit log. Never throws — a logging failure must not
// break the action pipeline.
async function writeAudit(companyId, entry) {
    try {
        return await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.AI_AUDIT_LOG,
            data: { ...entry },
        }, 'save');
    } catch (e) {
        logger.error(`AIBrain writeAudit error: ${e && e.message ? e.message : e}`);
        return null;
    }
}

async function createInboxItem(companyId, item) {
    return MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.AI_INBOX,
        data: { ...item, status: 'pending' },
    }, 'save');
}

// Count actions already executed today — used for the daily rate limit.
async function todaysExecutedCount(companyId) {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const rows = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.AI_AUDIT_LOG,
        data: [{ status: 'executed', createdAt: { $gte: start } }, { _id: 1 }],
    }, 'find').catch(() => []);
    return (rows || []).length;
}

// Run an action's handler and audit the outcome. Used both by dispatch()
// (auto-run) and by inbox approval (human-approved).
async function runAction(companyId, action, ctx) {
    try {
        const result = await action.handler(companyId, ctx.params || {}, ctx);
        await writeAudit(companyId, { ...ctx, status: 'executed', result: result || {} });
        return { status: 'executed', result: result || {} };
    } catch (e) {
        const msg = e && e.message ? e.message : String(e);
        await writeAudit(companyId, { ...ctx, status: 'failed', error: msg });
        return { status: 'failed', error: msg };
    }
}

// The gate.
async function dispatch(companyId, req) {
    const {
        actionKey,
        params = {},
        reason = '',
        projectId = '',
        taskId = '',
        skill = '',
        actorType = 'ai',
        actorUserId = '',
    } = req || {};

    const settings = await getSettings(companyId);
    const base = { actionKey, reason, params, projectId, taskId, skill, actorType, actorUserId, autonomyLevel: settings.autonomyLevel };

    // 1. Kill switch — nothing runs.
    if (settings.killSwitch) {
        await writeAudit(companyId, { ...base, status: 'blocked', error: 'kill switch is ON' });
        return { status: 'blocked', reason: 'kill switch is ON' };
    }

    // 2. Action must be on the registry allow-list.
    const action = getAction(actionKey);
    if (!action) {
        await writeAudit(companyId, { ...base, status: 'blocked', error: 'unknown action' });
        return { status: 'blocked', reason: `unknown action "${actionKey}"` };
    }

    // 3. Optional per-company allow-list (empty = all registered actions allowed).
    if (Array.isArray(settings.allowedActions) && settings.allowedActions.length && !settings.allowedActions.includes(actionKey)) {
        await writeAudit(companyId, { ...base, status: 'blocked', error: 'action disabled for company' });
        return { status: 'blocked', reason: 'action disabled for this company' };
    }

    // 4. Autonomy gate. Human-initiated actions bypass it (a person decided);
    //    AI-initiated actions must clear the action's minimum autonomy level.
    const level = Number(settings.autonomyLevel || 0);
    const canAutoRun = actorType === 'user' || action.minAutonomyToAutoRun <= level;
    if (!canAutoRun) {
        const inbox = await createInboxItem(companyId, {
            actionKey, params, reason, projectId, taskId, skill,
            riskLevel: action.riskLevel, proposedBy: actorType,
        }).catch(() => null);
        const inboxId = inbox && inbox._id ? String(inbox._id) : '';
        await writeAudit(companyId, { ...base, status: 'proposed', inboxId });
        return { status: 'proposed', inboxId, reason: 'autonomy level too low — sent to the AI inbox for approval' };
    }

    // 5. Daily action rate limit (0 = unlimited).
    if (Number(settings.dailyActionLimit) > 0) {
        const used = await todaysExecutedCount(companyId);
        if (used >= Number(settings.dailyActionLimit)) {
            await writeAudit(companyId, { ...base, status: 'blocked', error: 'daily action limit reached' });
            return { status: 'blocked', reason: 'daily action limit reached' };
        }
    }

    // 6. Execute.
    return runAction(companyId, action, base);
}

module.exports = { dispatch, runAction, getSettings, writeAudit };
