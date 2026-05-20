const openaiProvider = require('./openaiProvider');
const anthropicProvider = require('./anthropicProvider');

const SUPPORTED = {
    openai: openaiProvider,
    anthropic: anthropicProvider,
};

/**
 * @returns {import('./types').LlmProvider}
 */
function getProvider() {
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
    throw new Error('No LLM provider is configured. Set AI_API_KEY+AI_MODEL or ANTHROPIC_API_KEY+ANTHROPIC_MODEL, and optionally LLM_PROVIDER.');
}

function isAnyProviderConfigured() {
    return openaiProvider.isConfigured || anthropicProvider.isConfigured;
}

module.exports = {
    getProvider,
    isAnyProviderConfigured,
};
