const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { dbCollections } = require('../../Config/collections');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const logger = require('../../Config/loggerConfig');
const usage = require('./usage');
const { isFeature, UNKNOWN_FEATURE } = require('./features');

/* The spend ledger: one row per model call, written here and nowhere else, so
 * a feature cannot spend without the budget seeing it. Callers name the
 * feature and the tenant through the chat option `spend`:
 *
 *   provider.chat({ ..., spend: { feature: FEATURES.ASK, companyId, userId, runId?, account? } })
 *
 * Personal and local accounts are the developer's own (see Agents/accounts):
 * their rows are kept for the per-user view but never billed to the workspace. */

const LOG_PREFIX = '[ai-spend]';
const strict = () => process.env.NODE_ENV === 'test';

const loud = (message) => {
    if (strict()) throw new Error(`${LOG_PREFIX} ${message}`);
    logger.warn(`${LOG_PREFIX} ${message}`);
};

function contextOf(opts) {
    const given = (opts && opts.spend) || {};
    let feature = given.feature;
    if (!isFeature(feature)) {
        loud(`model call without a known feature tag (${feature === undefined ? 'none' : JSON.stringify(feature)}); booked as "${UNKNOWN_FEATURE}"`);
        feature = UNKNOWN_FEATURE;
    }
    const companyId = given.companyId ? String(given.companyId) : null;
    if (!companyId) loud(`model call for "${feature}" without a companyId; booked against the global database`);
    const account = given.account || 'workspace';
    return {
        feature, companyId, account, billedToWorkspace: account === 'workspace',
        userId: given.userId ? String(given.userId) : null,
        runId: given.runId ? String(given.runId) : null,
    };
}

/* Refused before any token is bought. A zero price in LLM_PRICING is a price;
 * an unknown model is not. Unbilled accounts pay their own way and pass. */
function ensurePriced(model, context) {
    if (!context.billedToWorkspace) return;
    const price = usage.priceFor(model);
    if (price.priced) return;
    const error = new Error(price.message);
    error.code = usage.UNPRICED_MODEL;
    error.feature = context.feature;
    throw error;
}

async function record(context, result, adapter) {
    const model = (result && result.model) || adapter.model || null;
    const priced = usage.summarize(usage.usageFromResult(result), model);
    const row = {
        companyId: context.companyId, feature: context.feature, model, provider: adapter.name || null,
        inputTokens: priced.inputTokens, outputTokens: priced.outputTokens, totalTokens: priced.totalTokens,
        costUsd: priced.priced ? priced.costUsd : null, priced: priced.priced, billedToWorkspace: context.billedToWorkspace,
        runId: context.runId, userId: context.userId, at: new Date(),
    };
    await MongoDbCrudOpration(context.companyId || dbCollections.GLOBAL, { type: SCHEMA_TYPE.AI_USAGE, data: row }, 'save');
    return row;
}

/* Agent runs announce budget levels themselves, with the run's task and
 * project on the notification; every other feature announces from here. */
const alert = async (context) => {
    if (!context.billedToWorkspace || !context.companyId || context.runId) return;
    try {
        await require('../Agents/budget').alertIfCrossed(context.companyId, { feature: context.feature, userId: context.userId });
    } catch (e) {
        logger.error(`${LOG_PREFIX} ${context.companyId}: budget alert after ${context.feature} failed: ${e.message}`);
    }
};

const wrapped = new WeakMap();

function metered(adapter) {
    if (wrapped.has(adapter)) return wrapped.get(adapter);
    const provider = {
        get name() { return adapter.name; },
        get isConfigured() { return adapter.isConfigured; },
        get model() { return adapter.model; },
        async chat(opts) {
            const context = contextOf(opts);
            ensurePriced(adapter.model, context);
            const result = await adapter.chat(opts);
            try {
                await record(context, result, adapter);
            } catch (e) {
                if (strict()) throw e;
                logger.error(`${LOG_PREFIX} ${context.companyId}: ${context.feature} spent ${usage.usageFromResult(result).totalTokens} tokens that could not be booked: ${e.message}`);
            }
            await alert(context);
            return result;
        },
    };
    wrapped.set(adapter, provider);
    return provider;
}

const monthRange = (month) => {
    const from = new Date(`${month}-01T00:00:00.000Z`);
    return { from, to: new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1)) };
};

const money = (n) => Math.round(Number(n || 0) * 10000) / 10000;

/* This month's workspace-billed spend, in total and per feature (largest first). */
async function monthly(companyId, month) {
    const { from, to } = monthRange(month);
    const rows = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.AI_USAGE, data: [{ at: { $gte: from, $lt: to }, billedToWorkspace: true }, 'feature costUsd totalTokens'],
    }, 'find').catch(() => []);
    const byFeature = new Map();
    (rows || []).forEach((r) => {
        const key = r.feature || UNKNOWN_FEATURE;
        const cur = byFeature.get(key) || { feature: key, usd: 0, calls: 0, tokens: 0 };
        cur.usd += Number(r.costUsd || 0);
        cur.calls += 1;
        cur.tokens += Number(r.totalTokens || 0);
        byFeature.set(key, cur);
    });
    const features = [...byFeature.values()].map((f) => ({ ...f, usd: money(f.usd) })).sort((a, b) => b.usd - a.usd || a.feature.localeCompare(b.feature));
    return { usedUsd: money(features.reduce((s, f) => s + f.usd, 0)), features };
}

module.exports = { metered, monthly, contextOf, ensurePriced };
