/**
 * Which provider serves a model id, and which model ids may be pinned.
 *
 * The allowlist is not a second list of models: it is the pricing table from
 * Modules/AICore/usage.js, joined to the registry through these prefixes. A
 * model gets on it by having a price on file — which is also how an operator
 * adds one, through LLM_PRICING, without a deploy.
 */
'use strict';

const { PROVIDER_NAMES, adapterFor } = require('./registry');
const usage = require('../usage');
const taskClass = require('../taskClass');

/* Longest prefix wins, so "o4-mini" is OpenAI's and not a stray match. */
const PROVIDER_PREFIXES = Object.freeze({
    openai: Object.freeze(['gpt-', 'o1', 'o3', 'o4-']),
    anthropic: Object.freeze(['claude-']),
    deepseek: Object.freeze(['deepseek-']),
    google: Object.freeze(['gemini-']),
});

/* Tier by family, coarse on purpose: a floor is a guard rail, not a ranking.
 * The cheap end of every vendor's line-up is basic, the flagship is frontier. */
const TIER_RULES = Object.freeze([
    { rx: /(nano|lite|haiku|flash-lite)/, tier: taskClass.QUALITY.BASIC },
    { rx: /(mini|flash|deepseek-chat)/, tier: taskClass.QUALITY.STANDARD },
    { rx: /(opus|astra|gpt-5\.5-pro|gpt-5\.4-pro|gpt-5-pro|fable|mythos)/, tier: taskClass.QUALITY.FRONTIER },
]);

function providerOf(modelId) {
    const id = String(modelId || '').trim().toLowerCase();
    if (!id) return null;
    let best = null;
    PROVIDER_NAMES.forEach((name) => {
        (PROVIDER_PREFIXES[name] || []).forEach((prefix) => {
            if (id.startsWith(prefix) && (!best || prefix.length > best.prefix.length)) best = { name, prefix };
        });
    });
    return best ? best.name : null;
}

function tierOf(modelId) {
    const id = String(modelId || '').trim().toLowerCase();
    const rule = TIER_RULES.find((r) => r.rx.test(id));
    return rule ? rule.tier : taskClass.QUALITY.HIGH;
}

const isConfigured = (provider) => {
    const adapter = adapterFor(provider);
    return Boolean(adapter && adapter.isConfigured);
};

function entryFor(modelId) {
    const price = usage.priceFor(modelId);
    const provider = providerOf(modelId);
    return {
        model: String(modelId || '').trim(),
        provider,
        priced: price.priced,
        tier: tierOf(modelId),
        configured: Boolean(provider) && isConfigured(provider),
        inputUsdPerMillion: price.priced ? price.input : null,
        outputUsdPerMillion: price.priced ? price.output : null,
    };
}

/**
 * Every priced model, newest-priced first is not a thing we know, so: grouped
 * by provider and sorted by id, which is stable and reads well in a select.
 * @param {{configuredOnly?: boolean}} [opts]
 */
function allowlist(opts = {}) {
    const rows = usage.pricedModels()
        .map(entryFor)
        .filter((row) => row.provider)
        .filter((row) => (opts.configuredOnly ? row.configured : true));
    return rows.sort((a, b) => (a.provider === b.provider ? a.model.localeCompare(b.model) : PROVIDER_NAMES.indexOf(a.provider) - PROVIDER_NAMES.indexOf(b.provider)));
}

module.exports = { PROVIDER_PREFIXES, providerOf, tierOf, entryFor, allowlist };
