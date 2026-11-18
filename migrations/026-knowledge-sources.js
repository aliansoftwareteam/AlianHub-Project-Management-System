/* Builds in every tenant the two task keys the knowledge indexer reads by: the chunk store's, which
 * a task that is deleted, restored or moved looks its comment chunks up by, and the comments'
 * own, which a restore reads the task's comments by. createIndexes, not syncIndexes, which would
 * drop any index the schema does not declare. */

const ID = '026-knowledge-sources';

const keyed = (fields) => (index) => Boolean(index && index.key)
    && Object.keys(index.key).length === Object.keys(fields).length
    && Object.entries(fields).every(([field, direction]) => index.key[field] === direction);

async function built(ctx, companyId, type, fields, label) {
    await ctx.company(companyId, { type, data: [] }, 'createIndexes');
    const indexes = await ctx.company(companyId, { type, data: [] }, 'listIndexes') || [];
    const index = indexes.find(keyed(fields));
    if (!index) throw new Error(`${label} index missing after createIndexes`);
    return index.name;
}

async function indexCompany(ctx, companyId) {
    const { KNOWLEDGE_CHUNKS: chunks, COMMENTS: comments } = ctx.SCHEMA_TYPE;
    const taskIndex = await built(ctx, companyId, chunks, { sourceType: 1, taskId: 1 }, 'knowledge_chunks task');
    const commentTaskIndex = await built(ctx, companyId, comments, { taskId: 1 }, 'comments task');
    return { taskIndex, commentTaskIndex };
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
