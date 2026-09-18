const llmProvider = require('../AICore/llmProvider');
const { FEATURES } = require('../AICore/features');
const flag = require('./flag');

// Every embedding the knowledge module asks for goes through here: one model for the whole
// instance, one feature tag on the ledger, and the provider layer's meter around the call.

const DEFAULT_MODEL = 'text-embedding-3-small';

const model = () => String(process.env.KNOWLEDGE_EMBEDDING_MODEL || DEFAULT_MODEL).trim() || DEFAULT_MODEL;

const configured = () => llmProvider.isEmbeddingConfigured();

/* Whether this company's chunks carry vectors: the hybrid mode of the retrieval switch,
 * with an instance key to embed with. */
const planFor = async (companyId) => ((await flag.hybridFor(companyId)) && configured() ? { model: model() } : null);

const spendFor = (companyId, userId) => ({ feature: FEATURES.KNOWLEDGE_EMBED, companyId: String(companyId), ...(userId ? { userId: String(userId) } : {}) });

/* One provider call for a batch of texts; the vectors come back in the order of the texts. The
 * model recorded beside a vector is the one configured here, which is what a search filters on,
 * while the ledger keeps whatever dated alias the vendor billed. */
const embedTexts = async (companyId, texts, { userId } = {}) => {
    const wanted = model();
    const result = await llmProvider.embeddingProvider().embed({ texts, model: wanted, spend: spendFor(companyId, userId) });
    return { vectors: result.embeddings, model: wanted };
};

const embedQuery = async (companyId, query, { userId } = {}) => {
    const { vectors, model: used } = await embedTexts(companyId, [String(query)], { userId });
    return { vector: vectors[0] || [], model: used };
};

module.exports = { DEFAULT_MODEL, model, configured, planFor, embedTexts, embedQuery };
