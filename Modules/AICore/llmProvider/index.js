const openaiProvider = require('./openaiProvider');
const anthropicProvider = require('./anthropicProvider');
const deepseekProvider = require('./deepseekProvider');
const { metered } = require('../spend');

const SUPPORTED = {
    openai: openaiProvider,
    anthropic: anthropicProvider,
    deepseek: deepseekProvider,
};

function configuredAdapter() {
    const selected = (process.env.LLM_PROVIDER || '').trim().toLowerCase();
    if (selected && SUPPORTED[selected]) {
        if (!SUPPORTED[selected].isConfigured) {
            throw new Error(`LLM_PROVIDER="${selected}" is selected but not configured (missing API key or model env var)`);
        }
        return SUPPORTED[selected];
    }
    // Fallback: pick whichever is configured, preferring openai for back-compat.
    if (openaiProvider.isConfigured) return openaiProvider;
    if (anthropicProvider.isConfigured) return anthropicProvider;
    if (deepseekProvider.isConfigured) return deepseekProvider;
    throw new Error('No LLM provider is configured. Set AI_API_KEY+AI_MODEL, ANTHROPIC_API_KEY+ANTHROPIC_MODEL, or DEEPSEEK_API_KEY+DEEPSEEK_MODEL, and optionally LLM_PROVIDER.');
}

/**
 * The configured adapter behind the spend meter: every chat() is priced
 * before the vendor call and booked to the ledger after it.
 * @returns {import('./types').LlmProvider}
 */
function getProvider() {
    return metered(configuredAdapter());
}

function isAnyProviderConfigured() {
    return openaiProvider.isConfigured || anthropicProvider.isConfigured || deepseekProvider.isConfigured;
}

module.exports = {
    getProvider,
    isAnyProviderConfigured,
};
