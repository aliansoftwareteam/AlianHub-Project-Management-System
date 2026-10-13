/* Task 046: builds in every workspace the two task indexes the Everything view pages on, which
 * utils/mongo-handler/createSchema.js declares for a workspace made afterwards. createIndexes
 * builds only what is missing, so a second run changes nothing; it is not syncIndexes, which would
 * drop any index the schema does not declare.
 * The indexes are not read back: a read after the write would stop the dry run from planning, and
 * a failed build already rejects. No verify(): `migrate verify` has to pass on a database this
 * has not reached and on a workspace made after it ran. */

const ID = '067-everything-indexes';

const PAGED_BY = [
    { ProjectID: 1, deletedStatusKey: 1, updatedAt: -1, _id: 1 },
    { ProjectID: 1, deletedStatusKey: 1, DueDate: 1, _id: 1 },
];

async function indexCompany(ctx, companyId) {
    await ctx.company(companyId, { type: ctx.SCHEMA_TYPE.TASKS, data: [] }, 'createIndexes');
    return { indexes: PAGED_BY.length };
}

module.exports = {
    id: ID,
    scope: 'company',
    PAGED_BY,
    indexCompany,
    async up(ctx) {
        await ctx.forEachCompany(async (companyId) => {
            const built = await indexCompany(ctx, companyId);
            ctx.logger.info(`[migrations] 067 ${companyId}: ${JSON.stringify(built)}`);
            return built;
        });
    },
};
