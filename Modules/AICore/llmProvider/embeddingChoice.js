const { ADAPTERS, configuredNames } = require('./registry');

const COMPATIBLE = 'openai_compatible';

/* The provider that answers chat when LLM_PROVIDER names none: the first configured, as in index.js. */
const chatProviderName = () => {
    const selected = String(process.env.LLM_PROVIDER || '').trim().toLowerCase();
    if (selected && ADAPTERS[selected]) return selected;
    return configuredNames()[0] || null;
};

/* Embeddings and speech-to-text follow the provider that answers chat: an instance that chose its
 * own OpenAI-compatible server sends no text or audio to OpenAI, even with an OpenAI key set
 * (owner, 2026-09-17: otherwise OpenAI with the instance key). */
const embeddingProviderName = () => (chatProviderName() === COMPATIBLE ? COMPATIBLE : 'openai');

/** The embedding model the chosen provider names, or null when the caller keeps its own default. */
const embeddingModel = () => (embeddingProviderName() === COMPATIBLE ? ADAPTERS[COMPATIBLE].embeddingsModel : null);

module.exports = { COMPATIBLE, embeddingProviderName, embeddingModel };
