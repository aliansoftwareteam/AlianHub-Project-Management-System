const registry = require('./registry');
const { ADAPTERS, PROVIDER_NAMES, adapterFor, configuredNames, isAnyConfigured, describe, list } = registry;
const { routerEnabled } = require('./normalise');
const { resilient } = require('./router');
const { noEmbeddings } = require('../providerError');
const aiSwitch = require('../aiSwitch');
const providerContext = require('../providerContext');
const health = require('./health');
const rateLimit = require('./rateLimit');
const { COMPATIBLE, embeddingProviderName, embeddingModel } = require('./embeddingChoice');

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
    throw new Error(`No LLM provider is configured. Set one of ${PROVIDER_NAMES.join(', ')} (AI_API_KEY+AI_MODEL, ANTHROPIC_API_KEY+ANTHROPIC_MODEL, DEEPSEEK_API_KEY+DEEPSEEK_MODEL, GOOGLE_API_KEY+GOOGLE_MODEL, OPENAI_COMPATIBLE_BASE_URL+OPENAI_COMPATIBLE_MODEL), and optionally LLM_PROVIDER.`);
}

const isEmbeddingConfigured = () => Boolean(ADAPTERS[embeddingProviderName()].embeddingsConfigured);

/** The embedding adapter behind the spend meter and the health window. */
function embeddingProvider() {
    const adapter = ADAPTERS[embeddingProviderName()];
    if (!adapter.embeddingsConfigured) {
        throw noEmbeddings(adapter.name, adapter.name === COMPATIBLE ? 'has no embeddings until OPENAI_COMPATIBLE_EMBEDDINGS_MODEL is set' : 'has no embeddings until AI_API_KEY is set');
    }
    return resilient(adapter, registry);
}

/* A provider named by the caller only wins while AI_MODEL_ROUTER is on, or
 * when it serves a model an agent or skill pinned. With the flag at its default
 * the configured provider answers every other call, so the registry changes
 * nothing until a policy is there to drive it. */
function selectAdapter(selection) {
    const asked = selection && selection.provider ? String(selection.provider).trim().toLowerCase() : '';
    if (!asked || !(routerEnabled() || selection.pinned === true)) return configuredAdapter();
    const adapter = adapterFor(asked);
    if (!adapter) throw new Error(`Unknown LLM provider "${asked}"; known providers are ${PROVIDER_NAMES.join(', ')}`);
    if (!adapter.isConfigured) throw new Error(`LLM provider "${asked}" is not configured (missing API key or model env var)`);
    return adapter;
}

/**
 * The selected adapter behind the spend meter: every chat() is priced
 * before the vendor call and booked to the ledger after it. While the router
 * flag is on it is also behind the breaker, the token bucket and failover to
 * the next configured provider; with the flag off it is one adapter and one
 * attempt, exactly as before, with the outcome recorded for the console.
 * @param {{provider?: string, pinned?: boolean}} [selection]
 * @returns {import('./types').LlmProvider}
 */
function getProvider(selection) {
    return resilient(selectAdapter(selection), registry);
}

/* False while AI is off for the instance, or for the workspace of the current request as last
 * read; the spend meter makes the authoritative check before every call. */
function isAnyProviderConfigured() {
    if (!aiSwitch.instanceEnabled()) return false;
    if (aiSwitch.workspaceOffCached(providerContext.companyIdOf())) return false;
    return isAnyConfigured();
}

const chatProviderName = () => {
    try {
        return configuredAdapter().name;
    } catch (e) {
        return null;
    }
};

/**
 * What an AI screen should show for this workspace: on, off (and at which level), or
 * unconfigured. Off wins over unconfigured, since it is a decision someone made.
 */
async function availability(companyId) {
    const instanceEnabled = aiSwitch.instanceEnabled();
    const workspaceEnabled = await aiSwitch.workspaceEnabled(companyId);
    const provider = chatProviderName();
    let state = aiSwitch.STATE.ON;
    if (!instanceEnabled) state = aiSwitch.STATE.OFF_INSTANCE;
    else if (!workspaceEnabled) state = aiSwitch.STATE.OFF_WORKSPACE;
    else if (!provider) state = aiSwitch.STATE.UNCONFIGURED;
    return { state, instanceEnabled, workspaceEnabled, provider, embeddings: isEmbeddingConfigured() };
}

/* The instance console's provider row: what the registry knows about a
 * provider, plus what this process has seen it do. */
function providerStatus() {
    return {
        routerEnabled: routerEnabled(),
        breakerPolicy: health.policy(),
        providers: list().map((row) => ({
            ...row,
            health: health.snapshot(row.provider, row.model),
            rateLimit: rateLimit.budget(row.provider),
        })),
    };
}

module.exports = {
    getProvider,
    isAnyProviderConfigured,
    embeddingProvider,
    embeddingProviderName,
    embeddingModel,
    isEmbeddingConfigured,
    availability,
    selectAdapter,
    routerEnabled,
    adapterFor,
    describeProvider: describe,
    listProviders: list,
    providerStatus,
    health,
    rateLimit,
    PROVIDER_NAMES,
};
