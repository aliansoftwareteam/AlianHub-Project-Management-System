/* Builds in every workspace the two indexes the tasks a person's notices and mentions name are read
 * through, which utils/mongo-handler/createSchema.js declares for a workspace made afterwards. No row
 * is rewritten. createIndexes builds only what is missing, so a second run changes nothing; it is not
 * syncIndexes, which would drop any index the schema does not declare.
 * The indexes are not read back: a read after the write would stop the dry run from planning, and a
 * failed build already rejects. No verify(): `migrate verify` has to pass on a database this has not
 * reached and on a workspace made after it ran. */

const ID = '072-reader-row-indexes';

const NOTICES_BY_READER = { receiverID: 1, taskId: 1 };
const MENTIONS_BY_READER = { mentionIds: 1, taskId: 1 };

async function indexCompany(ctx, companyId) {
    await ctx.company(companyId, { type: ctx.SCHEMA_TYPE.NOTIFICATIONS, data: [] }, 'createIndexes');
    await ctx.company(companyId, { type: ctx.SCHEMA_TYPE.MENTIONS, data: [] }, 'createIndexes');
    return { indexes: 2 };
}

module.exports = {
    id: ID,
    scope: 'company',
    NOTICES_BY_READER,
    MENTIONS_BY_READER,
    indexCompany,
    async up(ctx) {
        await ctx.forEachCompany(async (companyId) => {
            const built = await indexCompany(ctx, companyId);
            ctx.logger.info(`[migrations] 072 ${companyId}: ${JSON.stringify(built)}`);
            return built;
        });
    },
};
