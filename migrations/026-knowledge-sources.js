/* Builds in every tenant the chunk store's task key: a task that is deleted, restored or moved
 * looks up the comment chunks it carries by it. createIndexes, not syncIndexes, which would drop
 * any index the schema does not declare. */

const ID = '026-knowledge-sources';

const isTaskKey = (index) => Boolean(index && index.key) && index.key.sourceType === 1 && index.key.taskId === 1;

async function indexCompany(ctx, companyId) {
    const { KNOWLEDGE_CHUNKS: chunks } = ctx.SCHEMA_TYPE;
    await ctx.company(companyId, { type: chunks, data: [] }, 'createIndexes');
    const indexes = await ctx.company(companyId, { type: chunks, data: [] }, 'listIndexes') || [];
    const taskKey = indexes.find(isTaskKey);
    if (!taskKey) throw new Error('knowledge_chunks task index missing after createIndexes');
    return { taskIndex: taskKey.name };
}

module.exports = {
    id: ID,
    scope: 'company',
    indexCompany,
    async up(ctx) {
        await ctx.forEachCompany(async (companyId) => {
            const names = await indexCompany(ctx, companyId);
            ctx.logger.info(`[migrations] 026 ${companyId}: ${JSON.stringify(names)}`);
            return names;
        });
    },
};
