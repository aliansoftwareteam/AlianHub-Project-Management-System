/* Builds in every workspace the { LogStartTime } index on timesheets that utils/mongo-handler/createSchema.js
 * declares (task 086). The Time reports read a date range across the whole workspace for owners and admins;
 * without it that read scans every time log (1.4–3.6 s on a workspace with 264k logs). No row is rewritten.
 * createIndexes builds only what is missing and drops nothing, so a second run changes nothing. */

const ID = '078-timesheet-date-index';

const INDEX = 'LogStartTime_1';

async function indexCompany(ctx, companyId) {
    await ctx.company(companyId, { type: ctx.SCHEMA_TYPE.TIMESHEET, data: [] }, 'createIndexes');
    return { index: INDEX };
}

module.exports = {
    id: ID,
    scope: 'company',
    INDEX,
    indexCompany,
    async up(ctx) {
        await ctx.forEachCompany(async (companyId) => {
            const built = await indexCompany(ctx, companyId);
            ctx.logger.info(`[migrations] 078 ${companyId}: ${JSON.stringify(built)}`);
            return built;
        });
    },
};
