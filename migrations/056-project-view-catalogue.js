const { addMissingViews } = require('../Modules/projectTabs/catalogue');

/* The catalogue import used to wipe project_tab_components and refill it row by row,
 * swallowing every failed save, so some companies were left with a few of the 20 views
 * and Add View could never offer the rest. Only missing views are inserted: a stored row
 * keeps its id, which project view entries point at. No project gains a view. */

const ID = '056-project-view-catalogue';

module.exports = {
    id: ID,
    scope: 'company',
    async up(ctx) {
        const { removeCache } = require('../utils/commonFunctions');
        await ctx.forEachCompany(async (companyId) => {
            const added = await addMissingViews(companyId, ctx.company);
            if (added.length) removeCache(`ProjectTabs:${companyId}`);
            ctx.logger.info(`[migrations] 056 ${companyId}: added ${added.length} views`);
            return { added: added.length };
        });
    },
};
