/* Task 046 M3: builds in every workspace the two indexes the task panel finds a task's goals
 * through, which utils/mongo-handler/createSchema.js declares for a workspace made afterwards. No
 * goal is rewritten. createIndexes builds only what is missing, so a second run changes nothing; it
 * is not syncIndexes, which would drop any index the schema does not declare.
 * The indexes are not read back: a read after the write would stop the dry run from planning, and
 * a failed build already rejects. No verify(): `migrate verify` has to pass on a database this has
 * not reached and on a workspace made after it ran. */

const ID = '070-goal-source-indexes';

const BY_TASK = { 'targets.sources.taskIds': 1 };
const BY_LIST = { 'targets.sources.sprintIds': 1 };

async function indexCompany(ctx, companyId) {
    await ctx.company(companyId, { type: ctx.SCHEMA_TYPE.GOALS, data: [] }, 'createIndexes');
    return { indexes: 2 };
}

module.exports = {
    id: ID,
    scope: 'company',
    BY_TASK,
    BY_LIST,
    indexCompany,
    async up(ctx) {
        await ctx.forEachCompany(async (companyId) => {
            const built = await indexCompany(ctx, companyId);
            ctx.logger.info(`[migrations] 070 ${companyId}: ${JSON.stringify(built)}`);
            return built;
        });
    },
};
