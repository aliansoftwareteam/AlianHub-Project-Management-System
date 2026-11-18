/* Task 047 T-2: builds in every workspace the index the work queue reads a person's waiting questions
 * through (Modules/Agents/manager/chatQuestions.js), which utils/mongo-handler/createSchema.js declares
 * for a workspace made afterwards. No row is rewritten. createIndexes builds only what is missing, so a
 * second run changes nothing; it is not syncIndexes, which would drop any index the schema does not declare.
 * Each workspace answers with the index's name, so a dry run says what it would build there.
 * The index is not read back: a read after the write would stop the dry run from planning, and a
 * failed build already rejects. No verify(): `migrate verify` has to pass on a database this has
 * not reached and on a workspace made after it ran. */

const ID = '073-asked-in-chat-index';

const INDEX = 'asked_in_chat_by_person';
const BY_PERSON = { userId: 1, status: 1, openedAt: 1 };

async function indexCompany(ctx, companyId) {
    await ctx.company(companyId, { type: ctx.SCHEMA_TYPE.PROJECT_FINDINGS, data: [] }, 'createIndexes');
    return { index: INDEX };
}

module.exports = {
    id: ID,
    scope: 'company',
    INDEX,
    BY_PERSON,
    indexCompany,
    async up(ctx) {
        await ctx.forEachCompany(async (companyId) => {
            const built = await indexCompany(ctx, companyId);
            ctx.logger.info(`[migrations] 073 ${companyId}: ${JSON.stringify(built)}`);
            return built;
        });
    },
};
