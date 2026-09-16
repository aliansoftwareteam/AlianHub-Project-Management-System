/* Builds in every tenant the pages text index knowledge retrieval searches, rather than
 * waiting for Mongoose to build it on the first page read. createIndexes, not syncIndexes:
 * syncIndexes would also drop any pages index the schema does not declare. */

const ID = '024-knowledge-page-text-index';

async function indexCompany(ctx, companyId) {
    const type = ctx.SCHEMA_TYPE.PAGES;
    await ctx.company(companyId, { type, data: [] }, 'createIndexes');
    const indexes = await ctx.company(companyId, { type, data: [] }, 'listIndexes') || [];
    const text = indexes.find((index) => index && index.key && index.key._fts === 'text');
    if (!text) throw new Error('pages text index missing after createIndexes');
    return { textIndex: text.name };
}

module.exports = {
    id: ID,
    scope: 'company',
    indexCompany,
    async up(ctx) {
        await ctx.forEachCompany(async (companyId) => {
            const counts = await indexCompany(ctx, companyId);
            ctx.logger.info(`[migrations] 024 ${companyId}: ${JSON.stringify(counts)}`);
            return counts;
        });
    },
};
