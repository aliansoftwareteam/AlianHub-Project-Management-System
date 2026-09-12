const { metered } = require('../spend');
const { ADAPTERS, PROVIDER_NAMES, adapterFor, configuredNames, isAnyConfigured, describe, list } = require('./registry');
const { routerEnabled } = require('./normalise');

function configuredAdapter() {
    const selected = (process.env.LLM_PROVIDER || '').trim().toLowerCase();
    if (selected && ADAPTERS[selected]) {
        if (!ADAPTERS[selected].isConfigured) {
            throw new Error(`LLM_PROVIDER="${selected}" is selected but not configured (missing API key or model env var)`);
        }
        return ADAPTERS[selected];
    }
    const fallback = configuredNames()[0];
    if (fallback) return ADAPTERS[fallback];
    throw new Error(`No LLM provider is configured. Set one of ${PROVIDER_NAMES.join(', ')} (AI_API_KEY+AI_MODEL, ANTHROPIC_API_KEY+ANTHROPIC_MODEL, DEEPSEEK_API_KEY+DEEPSEEK_MODEL, GOOGLE_API_KEY+GOOGLE_MODEL), and optionally LLM_PROVIDER.`);
}

/* A provider named by the caller only wins while AI_MODEL_ROUTER is on. With
 * the flag at its default the configured provider answers every call, so the
 * registry changes nothing until a policy is there to drive it. */
function selectAdapter(selection) {
    const asked = selection && selection.provider ? String(selection.provider).trim().toLowerCase() : '';
    if (!asked || !routerEnabled()) return configuredAdapter();
    const adapter = adapterFor(asked);
    if (!adapter) throw new Error(`Unknown LLM provider "${asked}"; known providers are ${PROVIDER_NAMES.join(', ')}`);
    if (!adapter.isConfigured) throw new Error(`LLM provider "${asked}" is not configured (missing API key or model env var)`);
    return adapter;
}

/**
 * The selected adapter behind the spend meter: every chat() is priced
 * before the vendor call and booked to the ledger after it.
 * @param {{provider?: string}} [selection]
 * @returns {import('./types').LlmProvider}
 */
function getProvider(selection) {
    return metered(selectAdapter(selection));
}

function isAnyProviderConfigured() {
    return isAnyConfigured();
}

module.exports = {
    getProvider,
    isAnyProviderConfigured,
    selectAdapter,
    routerEnabled,
    adapterFor,
    describeProvider: describe,
    listProviders: list,
    PROVIDER_NAMES,
};
