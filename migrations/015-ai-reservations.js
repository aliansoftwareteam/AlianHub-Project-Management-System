/* ai_reservations is new, and the only thing standing between a stranded hold
 * and a collection that grows forever is its TTL index. Mongoose would build it
 * on the first write in each tenant database; syncIndexes builds it now, before
 * a budget depends on it, and names what it built in the migration record. */

module.exports = {
    id: '015-ai-reservations',
    scope: 'company',
    async up(ctx) {
        await ctx.forEachCompany(async (companyId) => {
            const droppedIndexes = (await ctx.company(companyId, { type: ctx.SCHEMA_TYPE.AI_RESERVATIONS, data: [] }, 'syncIndexes')) || [];
            const counts = { droppedIndexes };
            ctx.logger.info(`[migrations] 015 ${companyId}: ${JSON.stringify(counts)}`);
            return counts;
        });
    },
};
