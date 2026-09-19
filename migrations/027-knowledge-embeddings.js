/* Builds in every tenant the key the vector search scans by: the newest chunks of a source type
 * under one embedding model. createIndexes, not syncIndexes, which would drop any index the
 * schema does not declare. The `embedding` field itself needs no migration: a chunk without one
 * reads as an empty array, which is what it means. */

const ID = '027-knowledge-embeddings';
const KEY = { sourceType: 1, embeddingModel: 1, sourceUpdatedAt: -1 };

const keyed = (fields) => (index) => Boolean(index && index.key)
    && Object.keys(index.key).length === Object.keys(fields).length
    && Object.entries(fields).every(([field, direction]) => index.key[field] === direction);

async function indexCompany(ctx, companyId) {
    const type = ctx.SCHEMA_TYPE.KNOWLEDGE_CHUNKS;
    await ctx.company(companyId, { type, data: [] }, 'createIndexes');
    const indexes = await ctx.company(companyId, { type, data: [] }, 'listIndexes') || [];
    const index = indexes.find(keyed(KEY));
    if (!index) throw new Error('knowledge_chunks embedding index missing after createIndexes');
    return { embeddingIndex: index.name };
}

module.exports = {
    id: ID,
    scope: 'company',
    indexCompany,
    async up(ctx) {
        await ctx.forEachCompany(async (companyId) => {
            const names = await indexCompany(ctx, companyId);
            ctx.logger.info(`[migrations] 027 ${companyId}: ${JSON.stringify(names)}`);
            return names;
        });
    },
};
