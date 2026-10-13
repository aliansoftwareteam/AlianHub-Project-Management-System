/* Builds the permission_decisions indexes in the global database, which holds decisions that name no
 * company, and in every tenant, before their first would-be denial: the unique key keeps concurrent first
 * writes on one row, and the TTL index is the only thing that expires rows.
 * createIndexes, not syncIndexes, which would drop any index the schema does not declare. */

const ID = '029-permission-decisions';

async function indexCompany(ctx, companyId) {
    const type = ctx.SCHEMA_TYPE.PERMISSION_DECISIONS;
    await ctx.company(companyId, { type, data: [] }, 'createIndexes');
    const indexes = await ctx.company(companyId, { type, data: [] }, 'listIndexes') || [];
    const ttl = indexes.find((index) => index && index.key && index.key.day === 1 && Object.keys(index.key).length === 1 && index.expireAfterSeconds !== undefined);
    if (!ttl) throw new Error('permission_decisions TTL index missing after createIndexes');
    return { ttlIndex: ttl.name, expireAfterSeconds: ttl.expireAfterSeconds };
}

module.exports = {
    id: ID,
    scope: 'company',
    indexCompany,
    async up(ctx) {
        const instance = await indexCompany(ctx, ctx.SCHEMA_TYPE.GOLBAL);
        ctx.logger.info(`[migrations] 029 global: ${JSON.stringify(instance)}`);
        await ctx.forEachCompany(async (companyId) => {
            const counts = await indexCompany(ctx, companyId);
            ctx.logger.info(`[migrations] 029 ${companyId}: ${JSON.stringify(counts)}`);
            return counts;
        });
    },
};
