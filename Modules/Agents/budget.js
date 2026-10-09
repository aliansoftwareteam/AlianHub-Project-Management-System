const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { dbCollections } = require('../../Config/collections');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { removeCache } = require('../../utils/commonFunctions');
const { ROLE_OWNER, ROLE_ADMIN } = require('../../Config/permissionGuard');
const logger = require('../../Config/loggerConfig');
const runs = require('./runs');
const spend = require('../AICore/spend');
const { routerEnabled } = require('../AICore/llmProvider/normalise');
const alertRules = require('./alertRules');
const budgetRead = require('../AICore/budgetRead');

// Company-level agent settings (undo window, monthly and daily budget) and this
// month's and today's AI spend, read from the ledger every model call books into (AICore/spend),
// so every feature counts, not only agent runs. The company row is the store,
// as agentPolicy already is; the provider block is read from the instance env
// and never includes the key.

const DEFAULTS = Object.freeze({ undoHours: 24, monthlyBudgetUsd: 0, dailyBudgetUsd: 0 });
const UNDO_HOURS_MIN = 1;
const UNDO_HOURS_MAX = 168;
const BUDGET_MAX_USD = 100000;
const LEVELS = ['80', '100'];
const PROVIDER_KEYS = Object.freeze({ openai: 'AI_API_KEY', anthropic: 'ANTHROPIC_API_KEY', deepseek: 'DEEPSEEK_API_KEY' });
const oid = (id) => { try { return new mongoose.Types.ObjectId(String(id)); } catch (e) { return null; } };
const money = (n) => Math.round(Number(n || 0) * 10000) / 10000;

const readCompany = (companyId) => MongoDbCrudOpration(dbCollections.GLOBAL, {
    type: dbCollections.COMPANIES, data: [{ _id: oid(companyId) }, 'agentUndoHours agentMonthlyBudgetUsd agentDailyBudgetUsd agentBudgetAlerts agentDailyBudgetAlerts agentAlerts'],
}, 'findOne').catch(budgetRead.rethrow(companyId, 'the workspace AI budget settings'));

const writeCompany = async (companyId, set) => {
    await MongoDbCrudOpration(dbCollections.GLOBAL, { type: dbCollections.COMPANIES, data: [{ _id: oid(companyId) }, { $set: set }] }, 'updateOne');
    removeCache(`companyData_${companyId}`);
};

const settingsOf = (company) => {
    const c = company || {};
    const hours = Number(c.agentUndoHours);
    const usd = Number(c.agentMonthlyBudgetUsd);
    const dailyUsd = Number(c.agentDailyBudgetUsd);
    return {
        undoHours: Number.isInteger(hours) && hours >= UNDO_HOURS_MIN && hours <= UNDO_HOURS_MAX ? hours : DEFAULTS.undoHours,
        monthlyBudgetUsd: Number.isFinite(usd) && usd >= 0 ? usd : DEFAULTS.monthlyBudgetUsd,
        dailyBudgetUsd: Number.isFinite(dailyUsd) && dailyUsd >= 0 ? dailyUsd : DEFAULTS.dailyBudgetUsd,
        alerts: alertRules.settingsOf(c.agentAlerts),
    };
};

const settings = async (companyId) => settingsOf(await readCompany(companyId));

const amountOf = (value) => (typeof value === 'number' ? value : (typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN));

const validate = ({ undoHours, monthlyBudgetUsd, dailyBudgetUsd, alerts } = {}, company = null) => {
    const set = {};
    if (undoHours !== undefined) {
        const n = typeof undoHours === 'number' ? undoHours : (typeof undoHours === 'string' && undoHours.trim() !== '' ? Number(undoHours) : NaN);
        if (!Number.isInteger(n) || n < UNDO_HOURS_MIN || n > UNDO_HOURS_MAX) return { error: `undoHours must be a whole number between ${UNDO_HOURS_MIN} and ${UNDO_HOURS_MAX}.` };
        set.agentUndoHours = n;
    }
    if (monthlyBudgetUsd !== undefined) {
        const n = amountOf(monthlyBudgetUsd);
        if (!Number.isFinite(n) || n < 0) return { error: 'monthlyBudgetUsd must be a number of 0 or more (0 means no budget).' };
        if (n > BUDGET_MAX_USD) return { error: `monthlyBudgetUsd must be at most ${BUDGET_MAX_USD}.` };
        set.agentMonthlyBudgetUsd = n;
    }
    if (dailyBudgetUsd !== undefined) {
        const n = amountOf(dailyBudgetUsd);
        if (!Number.isFinite(n) || n < 0) return { error: 'dailyBudgetUsd must be a number of 0 or more (0 means no daily limit).' };
        if (n > BUDGET_MAX_USD) return { error: `dailyBudgetUsd must be at most ${BUDGET_MAX_USD}.` };
        set.agentDailyBudgetUsd = n;
    }
    if (alerts !== undefined) {
        const merged = alertRules.validate(alerts, company && company.agentAlerts);
        if (merged.error) return { error: merged.error };
        set.agentAlerts = merged.value;
    }
    if (!Object.keys(set).length) return { error: 'Nothing to update.' };
    return { set };
};

const updateSettings = async (companyId, body) => {
    const check = validate(body, (body && body.alerts !== undefined) ? await readCompany(companyId) : null);
    if (check.error) return { error: check.error, status: 400 };
    await writeCompany(companyId, check.set);
    return { settings: await settings(companyId) };
};

const configuredProviderName = () => {
    try { return require('../AICore/llmProvider').getProvider().name; } catch (e) { return null; }
};

const provider = () => {
    const selected = (process.env.LLM_PROVIDER || '').trim().toLowerCase();
    const name = configuredProviderName() || (PROVIDER_KEYS[selected] ? selected : null);
    const usage = require('../AICore/usage');
    const model = usage.configuredModel();
    return {
        name, hasKey: Boolean(name && process.env[PROVIDER_KEYS[name]]), region: (process.env.LLM_REGION || '').trim() || null,
        model, priced: model ? usage.priceFor(model).priced : null,
    };
};

/* What open runs hold for calls in flight. A reservation left on a finished run
 * is a leftover, never spend, so only open runs count. A run's hold is for a
 * call being made now, so the day counts every open run, including one that
 * started before UTC midnight. */
const runHolds = async (companyId, { from, to }, { anyStart = false } = {}) => {
    const match = anyStart ? { status: { $in: runs.OPEN } } : { startedAt: { $gte: from }, status: { $in: runs.OPEN } };
    const open = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.AGENT_RUNS, data: [match, 'startedAt reservedUsd'] }, 'find').catch(budgetRead.rethrow(companyId, 'the open agent runs'));
    const inRange = anyStart ? (open || []) : (open || []).filter((r) => new Date(r.startedAt).getTime() < to.getTime());
    return money(inRange.reduce((s, r) => s + Number(r.reservedUsd || 0), 0));
};

const monthRange = (month) => {
    const from = new Date(`${month}-01T00:00:00.000Z`);
    return { from, to: new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1)) };
};

/* Booked spend from the ledger, plus what is held for calls in flight.
 *
 * Every billed call reserves against the tenant whenever a budget is set
 * (AICore/reservation.js), and that reservation is what refuses a call over
 * the day or the month. This number is the agent run's own earlier gate:
 * with the router on it reads the reservation ledger, with it off the run
 * rows' holds. Counting both would count an agent call twice. */
const PERIODS = Object.freeze({
    monthly: {
        key: () => runs.monthKey(), range: monthRange,
        booked: (companyId, key) => spend.monthlyTotal(companyId, key),
        held: (companyId, key) => require('../AICore/reservation').heldUsd(companyId, key),
    },
    daily: {
        key: () => spend.dayKey(), range: spend.dayRange,
        booked: (companyId, key) => spend.dailyTotal(companyId, key),
        held: (companyId, key) => require('../AICore/reservation').heldUsdOn(companyId, key),
        anyStart: true,
    },
});

const ledgerFor = async (companyId, period, key) => {
    const p = PERIODS[period];
    const [booked, reservedUsd] = await Promise.all([
        p.booked(companyId, key),
        routerEnabled() ? p.held(companyId, key) : runHolds(companyId, p.range(key), { anyStart: Boolean(p.anyStart) }),
    ]);
    return { usedUsd: money(booked.usedUsd), reservedUsd: money(reservedUsd) };
};

const alertsOf = (company, key, field, keyName) => {
    const a = (company && company[field]) || {};
    const current = a[keyName] === key;
    return Object.fromEntries(LEVELS.map((l) => [l, current && a[l] ? new Date(a[l]).toISOString() : null]));
};

const percentOf = (usedUsd, budgetUsd) => (budgetUsd > 0 ? Math.round((usedUsd / budgetUsd) * 100) : 0);

const status = async (companyId) => {
    const month = runs.monthKey();
    const day = spend.dayKey();
    const company = await readCompany(companyId);
    const { monthlyBudgetUsd, dailyBudgetUsd } = settingsOf(company);
    const [{ usedUsd, features }, today] = await Promise.all([spend.monthly(companyId, month), spend.daily(companyId, day)]);
    return {
        month, usedUsd: money(usedUsd), budgetUsd: monthlyBudgetUsd,
        percent: percentOf(usedUsd, monthlyBudgetUsd),
        alerts: alertsOf(company, month, 'agentBudgetAlerts', 'month'),
        features,
        daily: {
            day, usedUsd: money(today.usedUsd), budgetUsd: dailyBudgetUsd,
            percent: percentOf(today.usedUsd, dailyBudgetUsd),
            alerts: alertsOf(company, day, 'agentDailyBudgetAlerts', 'day'),
        },
    };
};

/* What the month and the day can still absorb, for the pre-call gate. `budgetUsd` 0 means no budget. */
const headroom = async (companyId) => {
    const { monthlyBudgetUsd, dailyBudgetUsd } = await settings(companyId);
    const [month, day] = await Promise.all([
        ledgerFor(companyId, 'monthly', PERIODS.monthly.key()),
        ledgerFor(companyId, 'daily', PERIODS.daily.key()),
    ]);
    return {
        budgetUsd: monthlyBudgetUsd, ...month, remainingUsd: money(monthlyBudgetUsd - month.usedUsd - month.reservedUsd),
        daily: { budgetUsd: dailyBudgetUsd, ...day, remainingUsd: money(dailyBudgetUsd - day.usedUsd - day.reservedUsd) },
    };
};

const check = async (companyId) => {
    let s;
    try {
        s = await status(companyId);
    } catch (error) {
        if (budgetRead.isUnavailable(error)) return { ok: false, reason: error.message, code: error.code };
        throw error;
    }
    if (s.daily.budgetUsd > 0 && s.daily.usedUsd >= s.daily.budgetUsd) {
        return { ok: false, reason: `Company daily AI budget reached ($${s.daily.usedUsd.toFixed(2)} of $${s.daily.budgetUsd} today, UTC).` };
    }
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

const messageOf = (view, level) => {
    if (view.period === 'daily') {
        return level === '100'
            ? `AI daily budget reached: $${view.usedUsd.toFixed(2)} of $${view.budgetUsd} used today (UTC) — new AI calls are refused until the budget is raised or the day ends.`
            : `AI daily budget at ${view.percent}%: $${view.usedUsd.toFixed(2)} of $${view.budgetUsd} used today (UTC).`;
    }
    return level === '100'
        ? `AI budget reached: $${view.usedUsd.toFixed(2)} of $${view.budgetUsd} used this month — new AI calls are refused until the budget is raised or the month ends.`
        : `AI budget at ${view.percent}%: $${view.usedUsd.toFixed(2)} of $${view.budgetUsd} used this month.`;
};

/* `source` is the agent run that crossed the line, or `{ feature, userId }`
 * for any other feature; the notification links what it has. */
const notify = async (companyId, source, view, level) => {
    const recipients = await ownersAndAdmins(companyId);
    if (!recipients.length) return;
    const { handleNotificationtFun } = require('../notification/prepare-notification-data/controllerV2');
    const { Notification_key } = require('../../Config/notificationKey');
    const src = source || {};
    await handleNotificationtFun({ body: {
        createdAt: new Date(), updatedAt: new Date(),
        key: Notification_key.TASK_NOTIFICATION, type: 'tasks', changeType: 'agent_budget',
        changeData: {
            ...(view.period === 'daily' ? { period: 'daily', day: view.key } : { month: view.key }),
            level, usedUsd: view.usedUsd, budgetUsd: view.budgetUsd, percent: view.percent,
            ...(src._id ? { runId: String(src._id) } : {}), feature: src.feature || 'agent_run',
        },
        message: messageOf(view, level),
        companyId: String(companyId), projectId: String(src.projectId || ''), taskId: String(src.taskId || ''),
        userId: String(src.agentId || src.userId || ''), assigneeUsers: recipients, notSeen: recipients,
        isSelected: false, folderId: '', sprintId: '', comments_id: '',
    } });
};

/* The highest newly crossed level is announced once; every crossed level is
 * stamped so a period that jumps straight past 100% does not announce 80%
 * afterwards. */
const alertPeriod = async (companyId, source, view, field, keyName) => {
    if (!view.budgetUsd) return null;
    const crossed = LEVELS.filter((l) => view.percent >= Number(l) && !view.alerts[l]);
    if (!crossed.length) return null;
    const at = new Date();
    const next = { [keyName]: view.key, ...Object.fromEntries(LEVELS.map((l) => [l, view.alerts[l] ? new Date(view.alerts[l]) : (crossed.includes(l) ? at : null)])) };
    await writeCompany(companyId, { [field]: next });
    const level = crossed[crossed.length - 1];
    try { await notify(companyId, source, view, level); } catch (e) { logger.error(`[agent-budget] ${companyId}: ${view.period} alert at ${level}% failed: ${e.message}`); }
    return { level, at };
};

/* Called after a billed row is written. The month and the day are announced
 * on their own, so one call can raise both. */
const alertIfCrossed = async (companyId, source) => {
    const s = await status(companyId);
    const monthly = await alertPeriod(companyId, source, { ...s, period: 'monthly', key: s.month }, 'agentBudgetAlerts', 'month');
    const daily = await alertPeriod(companyId, source, { ...s.daily, period: 'daily', key: s.daily.day }, 'agentDailyBudgetAlerts', 'day');
    return monthly || daily ? { ...(monthly || {}), ...(daily ? { daily } : {}) } : null;
};

module.exports = { DEFAULTS, UNDO_HOURS_MIN, UNDO_HOURS_MAX, BUDGET_MAX_USD, settings, validate, updateSettings, provider, status, headroom, check, alertIfCrossed };
