const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const { FEATURES } = require('../../AICore/features');
const aiSwitch = require('../../AICore/aiSwitch');

const DEFAULT_DAILY_LIMIT = 500;
const DEFAULT_BULK_MAX = 200;

const STOP = Object.freeze({
    AI_OFF: 'ai_off',
    NO_PROVIDER: 'no_provider',
    DAILY_LIMIT: 'daily_limit',
    BUDGET: 'budget',
});

const positive = (raw, fallback) => {
    const n = Number(raw);
    return Number.isInteger(n) && n > 0 ? n : fallback;
};

const dailyLimit = () => positive(process.env.AI_FIELD_DAILY_LIMIT, DEFAULT_DAILY_LIMIT);
const bulkMax = () => positive(process.env.AI_FIELD_BULK_MAX, DEFAULT_BULK_MAX);

const startOfUtcDay = () => {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
};

/* The spend ledger is the count: one ai_usage row per model call, whoever or whatever made it. */
const usedToday = async (companyId) => {
    const count = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.AI_USAGE,
        data: [{ feature: FEATURES.AI_FIELD, at: { $gte: startOfUtcDay() } }],
    }, 'countDocuments').catch(() => 0);
    return Number(count) || 0;
};

const providerConfigured = () => {
    try {
        const factory = require('../../AICore/llmProvider');
        return typeof factory.isAnyProviderConfigured === 'function' && factory.isAnyProviderConfigured();
    } catch (_error) {
        return false;
    }
};

/* Whether one more model call may start now; `code` names the cap that says no. */
async function gate(companyId) {
    if (!(await aiSwitch.allowed(companyId))) return { ok: false, code: STOP.AI_OFF, reason: 'AI is turned off.' };
    if (!providerConfigured()) return { ok: false, code: STOP.NO_PROVIDER, reason: 'No AI provider is configured.' };
    if ((await usedToday(companyId)) >= dailyLimit()) return { ok: false, code: STOP.DAILY_LIMIT, reason: `The daily limit of ${dailyLimit()} AI field fills is reached.` };
    const budget = await require('../../Agents/budget').check(companyId);
    if (!budget.ok) return { ok: false, code: STOP.BUDGET, reason: budget.reason };
    return { ok: true };
}

module.exports = { STOP, dailyLimit, bulkMax, usedToday, gate };
