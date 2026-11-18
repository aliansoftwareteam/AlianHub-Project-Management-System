/* Builds in every tenant the doc comment indexes before the first comment: a doc's comments are read by page in
 * order on every open, and a thread's replies by parentId on every delete. createIndexes, not syncIndexes, which
 * would drop any index the schema does not declare. */

const ID = '063-page-comments';

async function indexCompany(ctx, companyId) {
    const type = ctx.SCHEMA_TYPE.PAGE_COMMENTS;
    await ctx.company(companyId, { type, data: [] }, 'createIndexes');
    const indexes = await ctx.company(companyId, { type, data: [] }, 'listIndexes') || [];
    const byPage = indexes.find((index) => index && index.key && index.key.pageId === 1);
    if (!byPage) throw new Error('pageComments page index missing after createIndexes');
    return { pageIndex: byPage.name };
}

module.exports = {
    id: ID,
    scope: 'company',
    indexCompany,
    async up(ctx) {
        await ctx.forEachCompany(async (companyId) => {
            const names = await indexCompany(ctx, companyId);
            ctx.logger.info(`[migrations] 063 ${companyId}: ${JSON.stringify(names)}`);
            return names;
        });
    },
};
