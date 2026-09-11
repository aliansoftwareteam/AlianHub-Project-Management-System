const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { dbCollections } = require('../../Config/collections');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { removeCache } = require('../../utils/commonFunctions');
const { ROLE_OWNER, ROLE_ADMIN } = require('../../Config/permissionGuard');
const logger = require('../../Config/loggerConfig');
const runs = require('./runs');
const spend = require('../AICore/spend');

// Company-level agent settings (undo window, monthly budget) and this month's
// AI spend, read from the ledger every model call books into (AICore/spend),
// so every feature counts, not only agent runs. The company row is the store,
// as agentPolicy already is; the provider block is read from the instance env
// and never includes the key.

const DEFAULTS = Object.freeze({ undoHours: 24, monthlyBudgetUsd: 0 });
const UNDO_HOURS_MIN = 1;
const UNDO_HOURS_MAX = 168;
const LEVELS = ['80', '100'];
const PROVIDER_KEYS = Object.freeze({ openai: 'AI_API_KEY', anthropic: 'ANTHROPIC_API_KEY', deepseek: 'DEEPSEEK_API_KEY' });
const oid = (id) => { try { return new mongoose.Types.ObjectId(String(id)); } catch (e) { return null; } };
const money = (n) => Math.round(Number(n || 0) * 10000) / 10000;

const readCompany = (companyId) => MongoDbCrudOpration(dbCollections.GLOBAL, {
    type: dbCollections.COMPANIES, data: [{ _id: oid(companyId) }, 'agentUndoHours agentMonthlyBudgetUsd agentBudgetAlerts'],
}, 'findOne').catch(() => null);

const writeCompany = async (companyId, set) => {
    await MongoDbCrudOpration(dbCollections.GLOBAL, { type: dbCollections.COMPANIES, data: [{ _id: oid(companyId) }, { $set: set }] }, 'updateOne');
    removeCache(`companyData_${companyId}`);
};

const settingsOf = (company) => {
    const c = company || {};
    const hours = Number(c.agentUndoHours);
    const usd = Number(c.agentMonthlyBudgetUsd);
    return {
        undoHours: Number.isInteger(hours) && hours >= UNDO_HOURS_MIN && hours <= UNDO_HOURS_MAX ? hours : DEFAULTS.undoHours,
        monthlyBudgetUsd: Number.isFinite(usd) && usd >= 0 ? usd : DEFAULTS.monthlyBudgetUsd,
    };
};

const settings = async (companyId) => settingsOf(await readCompany(companyId));

const validate = ({ undoHours, monthlyBudgetUsd } = {}) => {
    const set = {};
    if (undoHours !== undefined) {
        const n = typeof undoHours === 'number' ? undoHours : (typeof undoHours === 'string' && undoHours.trim() !== '' ? Number(undoHours) : NaN);
        if (!Number.isInteger(n) || n < UNDO_HOURS_MIN || n > UNDO_HOURS_MAX) return { error: `undoHours must be a whole number between ${UNDO_HOURS_MIN} and ${UNDO_HOURS_MAX}.` };
        set.agentUndoHours = n;
    }
    if (monthlyBudgetUsd !== undefined) {
        const n = typeof monthlyBudgetUsd === 'number' ? monthlyBudgetUsd : (typeof monthlyBudgetUsd === 'string' && monthlyBudgetUsd.trim() !== '' ? Number(monthlyBudgetUsd) : NaN);
        if (!Number.isFinite(n) || n < 0) return { error: 'monthlyBudgetUsd must be a number of 0 or more (0 means no budget).' };
        set.agentMonthlyBudgetUsd = n;
    }
    if (!Object.keys(set).length) return { error: 'Nothing to update.' };
    return { set };
};

const updateSettings = async (companyId, body) => {
    const check = validate(body);
    if (check.error) return { error: check.error, status: 400 };
    await writeCompany(companyId, check.set);
    return { settings: await settings(companyId) };
};

const configuredProviderName = () => {
    try { return require('../AIProjectGenerator/llmProvider').getProvider().name; } catch (e) { return null; }
};

const provider = () => {
    const selected = (process.env.LLM_PROVIDER || '').trim().toLowerCase();
    const name = configuredProviderName() || (PROVIDER_KEYS[selected] ? selected : null);
    const usage = require('../AIProjectGenerator/usage');
    const model = usage.configuredModel();
    return {
        name, hasKey: Boolean(name && process.env[PROVIDER_KEYS[name]]), region: (process.env.LLM_REGION || '').trim() || null,
        model, priced: model ? usage.priceFor(model).priced : null,
    };
};

/* Booked spend from the ledger, plus what open runs hold for calls in flight.
 * A reservation left on a finished run is a leftover, never spend, so only
 * open runs count. */
const ledgerThisMonth = async (companyId, month) => {
    const from = new Date(`${month}-01T00:00:00.000Z`);
    const to = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1));
    const [booked, open] = await Promise.all([
        spend.monthly(companyId, month),
        MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.AGENT_RUNS, data: [{ startedAt: { $gte: from }, status: { $in: runs.OPEN } }, 'startedAt reservedUsd'] }, 'find').catch(() => []),
    ]);
    const inMonth = (open || []).filter((r) => new Date(r.startedAt).getTime() < to.getTime());
    return { usedUsd: money(booked.usedUsd), reservedUsd: money(inMonth.reduce((s, r) => s + Number(r.reservedUsd || 0), 0)) };
};

const alertsOf = (company, month) => {
    const a = (company && company.agentBudgetAlerts) || {};
    const current = a.month === month;
    return Object.fromEntries(LEVELS.map((l) => [l, current && a[l] ? new Date(a[l]).toISOString() : null]));
};

const status = async (companyId) => {
    const month = runs.monthKey();
    const company = await readCompany(companyId);
    const { monthlyBudgetUsd } = settingsOf(company);
    const { usedUsd, features } = await spend.monthly(companyId, month);
    return {
        month, usedUsd: money(usedUsd), budgetUsd: monthlyBudgetUsd,
        percent: monthlyBudgetUsd > 0 ? Math.round((usedUsd / monthlyBudgetUsd) * 100) : 0,
        alerts: alertsOf(company, month),
        features,
    };
};

/* What the month can still absorb, for the pre-call gate. `budgetUsd` 0 means no budget. */
const headroom = async (companyId) => {
    const { monthlyBudgetUsd } = await settings(companyId);
    const ledger = await ledgerThisMonth(companyId, runs.monthKey());
    return { budgetUsd: monthlyBudgetUsd, ...ledger, remainingUsd: money(monthlyBudgetUsd - ledger.usedUsd - ledger.reservedUsd) };
};

const check = async (companyId) => {
    const s = await status(companyId);
    if (s.budgetUsd > 0 && s.usedUsd >= s.budgetUsd) {
        return { ok: false, reason: `Company agent budget reached ($${s.usedUsd.toFixed(2)} of $${s.budgetUsd} this month).` };
    }
    return { ok: true, reason: '' };
};

const ownersAndAdmins = async (companyId) => {
    const rows = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.COMPANY_USERS, data: [{ roleType: { $in: [ROLE_OWNER, ROLE_ADMIN] }, isDelete: { $ne: true } }, 'userId'],
    }, 'find').catch(() => []);
    return [...new Set((rows || []).map((r) => String(r.userId)).filter(Boolean))];
};

/* `source` is the agent run that crossed the line, or `{ feature, userId }`
 * for any other feature; the notification links what it has. */
const notify = async (companyId, source, s, level) => {
    const recipients = await ownersAndAdmins(companyId);
    if (!recipients.length) return;
    const { handleNotificationtFun } = require('../notification/prepare-notification-data/controllerV2');
    const { Notification_key } = require('../../Config/notificationKey');
    const src = source || {};
    const message = level === '100'
        ? `AI budget reached: $${s.usedUsd.toFixed(2)} of $${s.budgetUsd} used this month — new agent runs are refused until the budget is raised or the month ends.`
        : `AI budget at ${s.percent}%: $${s.usedUsd.toFixed(2)} of $${s.budgetUsd} used this month.`;
    await handleNotificationtFun({ body: {
        createdAt: new Date(), updatedAt: new Date(),
        key: Notification_key.TASK_NOTIFICATION, type: 'tasks', changeType: 'agent_budget',
        changeData: {
            month: s.month, level, usedUsd: s.usedUsd, budgetUsd: s.budgetUsd, percent: s.percent,
            ...(src._id ? { runId: String(src._id) } : {}), feature: src.feature || 'agent_run',
        },
        message,
        companyId: String(companyId), projectId: String(src.projectId || ''), taskId: String(src.taskId || ''),
        userId: String(src.agentId || src.userId || ''), assigneeUsers: recipients, notSeen: recipients,
        isSelected: false, folderId: '', sprintId: '', comments_id: '',
    } });
};

/* Called after a billed row is written. The highest newly crossed level is
 * announced once; every crossed level is stamped so a month that jumps
 * straight past 100% does not announce 80% afterwards. */
const alertIfCrossed = async (companyId, source) => {
    const s = await status(companyId);
    if (!s.budgetUsd) return null;
    const crossed = LEVELS.filter((l) => s.percent >= Number(l) && !s.alerts[l]);
    if (!crossed.length) return null;
    const at = new Date();
    const next = { month: s.month, ...Object.fromEntries(LEVELS.map((l) => [l, s.alerts[l] ? new Date(s.alerts[l]) : (crossed.includes(l) ? at : null)])) };
    await writeCompany(companyId, { agentBudgetAlerts: next });
    const level = crossed[crossed.length - 1];
    try { await notify(companyId, source, s, level); } catch (e) { logger.error(`[agent-budget] ${companyId}: alert at ${level}% failed: ${e.message}`); }
    return { level, at };
};

module.exports = { DEFAULTS, UNDO_HOURS_MIN, UNDO_HOURS_MAX, settings, validate, updateSettings, provider, status, headroom, check, alertIfCrossed };
