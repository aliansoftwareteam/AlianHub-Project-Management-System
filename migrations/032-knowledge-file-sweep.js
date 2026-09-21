/* Builds in every tenant the key the file sweep reads: files owed an extraction, by when. It is
 * partial, so it holds only the few rows that are owed one. createIndexes, not syncIndexes, which
 * would drop any index the schema does not declare. */

const ID = '032-knowledge-file-sweep';
const KEY = { sourceType: 1, extractDueAt: 1 };

const keyed = (fields) => (index) => Boolean(index && index.key)
    && Object.keys(index.key).length === Object.keys(fields).length
    && Object.entries(fields).every(([field, direction]) => index.key[field] === direction);

async function indexCompany(ctx, companyId) {
    const type = ctx.SCHEMA_TYPE.KNOWLEDGE_CHUNKS;
    await ctx.company(companyId, { type, data: [] }, 'createIndexes');
    const indexes = await ctx.company(companyId, { type, data: [] }, 'listIndexes') || [];
    const index = indexes.find(keyed(KEY));
    if (!index) throw new Error('knowledge_chunks file sweep index missing after createIndexes');
    return { fileSweepIndex: index.name };
}

module.exports = {
    id: ID,
    scope: 'company',
    indexCompany,
    async up(ctx) {
        await ctx.forEachCompany(async (companyId) => {
            const names = await indexCompany(ctx, companyId);
            ctx.logger.info(`[migrations] 032 ${companyId}: ${JSON.stringify(names)}`);
            return names;
        });
    },
};
