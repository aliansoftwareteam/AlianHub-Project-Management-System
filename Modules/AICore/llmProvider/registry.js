const openaiProvider = require('./openaiProvider');
const anthropicProvider = require('./anthropicProvider');
const deepseekProvider = require('./deepseekProvider');
const googleProvider = require('./googleProvider');
const { capabilitiesOf } = require('./normalise');
const { priceFor } = require('../usage');

/* The one place a provider is known. Nothing outside Modules/AICore names a
 * vendor, so adding one is adding an adapter here and nowhere else.
 *
 * Insertion order is the fallback preference when LLM_PROVIDER is unset:
 * OpenAI first for back-compat, and a newcomer goes last so configuring it
 * cannot quietly take a call from the provider that answers today. */
const ADAPTERS = Object.freeze({
    openai: openaiProvider,
    anthropic: anthropicProvider,
    deepseek: deepseekProvider,
    google: googleProvider,
});

const PROVIDER_NAMES = Object.freeze(Object.keys(ADAPTERS));

const adapterFor = (name) => ADAPTERS[String(name || '').trim().toLowerCase()] || null;

const configuredNames = () => PROVIDER_NAMES.filter((name) => ADAPTERS[name].isConfigured);

const isAnyConfigured = () => configuredNames().length > 0;

/* What the routing console needs to render a provider row. Health, breaker
 * state and rate-limit budget join this in sprint 4 step 3. */
function describe(name) {
    const adapter = ADAPTERS[name];
    const caps = capabilitiesOf(adapter);
    const model = adapter.model;
    const price = priceFor(model);
    return {
        provider: name,
        model,
        configured: adapter.isConfigured,
        priced: Boolean(model) && price.priced,
        maxOutputTokens: model ? caps.maxOutputTokens(model) : null,
        reasoning: model ? Boolean(caps.isReasoningModel(model)) : false,
        structuredOutput: caps.structuredOutput,
    };
}

const list = () => PROVIDER_NAMES.map(describe);

module.exports = { ADAPTERS, PROVIDER_NAMES, adapterFor, configuredNames, isAnyConfigured, describe, list };
