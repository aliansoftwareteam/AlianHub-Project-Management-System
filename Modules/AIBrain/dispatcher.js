// AHE-3792 — the AI Brain dispatcher (the safety gate).
//
// Every action the agent wants to take goes through dispatch(). It enforces, in
// order: kill switch -> known + company-allowed action -> autonomy gate (AI
// only) -> daily rate limit -> execute. Anything that doesn't clear the
// autonomy gate is turned into an AI-inbox proposal for a human to approve.
// Every outcome is written to the append-only audit log ("AI did X because Y").
//
// Persistence goes through aiStore (companyId-scoped, GLOBAL db).

const { getAction } = require('./actionRegistry');
const store = require('./aiStore');

const DEFAULT_SETTINGS = {
    key: 'default',
    autonomyLevel: 0,
    killSwitch: false,
    spendCapUSD: 0,
    dailyActionLimit: 0,
    allowedActions: [],
    deletedStatusKey: 0,
};

// Per-company autonomy config. Returns sane defaults (L0, everything off) when
// none exists yet.
async function getSettings(companyId) {
    const doc = await store.getSettingsDoc(companyId);
    return { ...DEFAULT_SETTINGS, ...(doc || {}) };
}

// Append one entry to the audit log (never throws — see aiStore.writeAudit).
async function writeAudit(companyId, entry) {
    return store.writeAudit(companyId, entry);
}

// Run an action's handler and audit the outcome. Used both by dispatch()
// (auto-run) and by inbox approval (human-approved).
async function runAction(companyId, action, ctx) {
    try {
        const result = await action.handler(companyId, ctx.params || {}, ctx);
        await store.writeAudit(companyId, { ...ctx, status: 'executed', result: result || {} });
        return { status: 'executed', result: result || {} };
    } catch (e) {
        const msg = e && e.message ? e.message : String(e);
        await store.writeAudit(companyId, { ...ctx, status: 'failed', error: msg });
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
        await store.writeAudit(companyId, { ...base, status: 'blocked', error: 'kill switch is ON' });
        return { status: 'blocked', reason: 'kill switch is ON' };
    }

    // 2. Action must be on the registry allow-list.
    const action = getAction(actionKey);
    if (!action) {
        await store.writeAudit(companyId, { ...base, status: 'blocked', error: 'unknown action' });
        return { status: 'blocked', reason: `unknown action "${actionKey}"` };
    }

    // 3. Optional per-company allow-list (empty = all registered actions allowed).
    if (Array.isArray(settings.allowedActions) && settings.allowedActions.length && !settings.allowedActions.includes(actionKey)) {
        await store.writeAudit(companyId, { ...base, status: 'blocked', error: 'action disabled for company' });
        return { status: 'blocked', reason: 'action disabled for this company' };
    }

    // 4. Autonomy gate. Human-initiated actions bypass it (a person decided);
    //    AI-initiated actions must clear the action's minimum autonomy level.
    const level = Number(settings.autonomyLevel || 0);
    const canAutoRun = actorType === 'user' || action.minAutonomyToAutoRun <= level;
    if (!canAutoRun) {
        const inbox = await store.createInboxItem(companyId, {
            actionKey, params, reason, projectId, taskId, skill,
            riskLevel: action.riskLevel, proposedBy: actorType,
        }).catch(() => null);
        const inboxId = inbox && inbox._id ? String(inbox._id) : '';
        await store.writeAudit(companyId, { ...base, status: 'proposed', inboxId });
        return { status: 'proposed', inboxId, reason: 'autonomy level too low — sent to the AI inbox for approval' };
    }

    // 5. Daily action rate limit (0 = unlimited).
    if (Number(settings.dailyActionLimit) > 0) {
        const used = await store.countExecutedToday(companyId);
        if (used >= Number(settings.dailyActionLimit)) {
            await store.writeAudit(companyId, { ...base, status: 'blocked', error: 'daily action limit reached' });
            return { status: 'blocked', reason: 'daily action limit reached' };
        }
    }

    // 6. Execute.
    return runAction(companyId, action, base);
}

module.exports = { dispatch, runAction, getSettings, writeAudit };
