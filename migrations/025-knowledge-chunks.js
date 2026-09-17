/* Builds in every tenant the knowledge store's indexes: the text index retrieval searches, the
 * unique source key the indexer's upserts rely on, and the index state's and exclusions' keys.
 * createIndexes, not syncIndexes: syncIndexes would drop any index the schema does not declare. */

const ID = '025-knowledge-chunks';

const isSourceKey = (index) => Boolean(index && index.unique && index.key)
    && index.key.sourceType === 1 && index.key.sourceId === 1 && index.key.ordinal === 1;

async function indexCompany(ctx, companyId) {
    const { KNOWLEDGE_CHUNKS: chunks, KNOWLEDGE_INDEX_STATE: state, KNOWLEDGE_EXCLUSIONS: exclusions } = ctx.SCHEMA_TYPE;
    await ctx.company(companyId, { type: chunks, data: [] }, 'createIndexes');
    await ctx.company(companyId, { type: state, data: [] }, 'createIndexes');
    await ctx.company(companyId, { type: exclusions, data: [] }, 'createIndexes');

    const chunkIndexes = await ctx.company(companyId, { type: chunks, data: [] }, 'listIndexes') || [];
    const stateIndexes = await ctx.company(companyId, { type: state, data: [] }, 'listIndexes') || [];
    const exclusionIndexes = await ctx.company(companyId, { type: exclusions, data: [] }, 'listIndexes') || [];
    const text = chunkIndexes.find((index) => index && index.key && index.key._fts === 'text');
    if (!text) throw new Error('knowledge_chunks text index missing after createIndexes');
    const source = chunkIndexes.find(isSourceKey);
    if (!source) throw new Error('knowledge_chunks unique source index missing after createIndexes');
    const stateKey = stateIndexes.find((index) => index && index.unique && index.key && index.key.sourceType === 1);
    if (!stateKey) throw new Error('knowledge_index_state unique source type index missing after createIndexes');
    const exclusionKey = exclusionIndexes.find((index) => index && index.unique && index.key && index.key.kind === 1);
    if (!exclusionKey) throw new Error('knowledge_exclusions unique index missing after createIndexes');
    return { textIndex: text.name, sourceIndex: source.name, stateIndex: stateKey.name, exclusionIndex: exclusionKey.name };
}

module.exports = {
    id: ID,
    scope: 'company',
    indexCompany,
    async up(ctx) {
        await ctx.forEachCompany(async (companyId) => {
            const names = await indexCompany(ctx, companyId);
            ctx.logger.info(`[migrations] 025 ${companyId}: ${JSON.stringify(names)}`);
            return names;
        });
    },
};
