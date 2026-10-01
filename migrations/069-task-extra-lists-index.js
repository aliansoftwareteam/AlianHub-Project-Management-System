/* Task 046 M3: builds in every workspace the index a list reads its extra tasks through, which
 * utils/mongo-handler/createSchema.js declares for a workspace made afterwards. No task is
 * rewritten: a task without `extraLists` is in no extra list. createIndexes builds only what is
 * missing, so a second run changes nothing; it is not syncIndexes, which would drop any index the
 * schema does not declare.
 * The index is not read back: a read after the write would stop the dry run from planning, and a
 * failed build already rejects. No verify(): `migrate verify` has to pass on a database this has
 * not reached and on a workspace made after it ran. */

const ID = '069-task-extra-lists-index';

const LISTED_BY = { 'extraLists.sprintId': 1, deletedStatusKey: 1 };

async function indexCompany(ctx, companyId) {
    await ctx.company(companyId, { type: ctx.SCHEMA_TYPE.TASKS, data: [] }, 'createIndexes');
    return { indexes: 1 };
}

module.exports = {
    id: ID,
    scope: 'company',
    LISTED_BY,
    indexCompany,
    async up(ctx) {
        await ctx.forEachCompany(async (companyId) => {
            const built = await indexCompany(ctx, companyId);
            ctx.logger.info(`[migrations] 069 ${companyId}: ${JSON.stringify(built)}`);
            return built;
        });
    },
};
