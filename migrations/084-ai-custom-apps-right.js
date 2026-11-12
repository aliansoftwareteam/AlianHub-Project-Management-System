/* Adds the "Add custom apps" row of Security & Permissions (Config/aiRights.js, task 096) to every company. Nobody is
 * granted it: owners and admins hold every AI row whatever the matrix says, and every other role starts without it.
 * The catalogue repair rewrites the rules collection, which is safe only before the server listens, as here. */

const ID = '084-ai-custom-apps-right';

module.exports = {
    id: ID,
    scope: 'company',
    async up(ctx) {
        const { repairCompanyRules } = require('../Modules/settings/securityPermissions/reconcileRules');
        const { removeCache } = require('../utils/commonFunctions');
        await ctx.forEachCompany(async (companyId) => {
            const repair = await repairCompanyRules(companyId);
            if (repair.repaired) removeCache(`rules:${companyId}`);
            ctx.logger.info(`[migrations] ${ID} ${companyId}: ${JSON.stringify({ repaired: Boolean(repair.repaired), ...(repair.skipped ? { skipped: repair.skipped } : {}) })}`);
            return { repaired: Boolean(repair.repaired) };
        });
    },
};
