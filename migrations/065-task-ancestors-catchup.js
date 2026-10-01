/* Task 046: migration 064 ran before the create paths stored `ancestors`, so a subtask created in
 * between holds the schema's empty default. Runs 064's plan once more, which writes only the rows
 * whose chain is not the one their parents give. No verify(), for the reason 064 has none. */

const { convertCompany } = require('./064-task-ancestors');

const ID = '065-task-ancestors-catchup';

module.exports = {
    id: ID,
    scope: 'company',
    async up(ctx) {
        await ctx.forEachCompany(async (companyId) => {
            const counts = await convertCompany(ctx, companyId);
            ctx.logger.info(`[migrations] 065 ${companyId}: ${JSON.stringify(counts)}`);
            return counts;
        });
    },
};
