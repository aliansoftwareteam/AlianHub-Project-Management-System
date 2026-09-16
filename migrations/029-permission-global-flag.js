/* A project whose isGlobalPermission is null is judged on the company rules by the server, while the
 * web app's checkPermission reads null as the project's own rules. A project with no flag at all reads
 * as the company rules on both sides, except where a Vue Boolean prop turns the missing value into false.
 *
 * Both become true, the schema default and the reading the server already enforces, so no server
 * decision changes and the web app stops showing or hiding controls the server judges differently.
 * true and false are left alone. There is no down(): the null and the missing flag are not
 * distinguishable afterwards, and neither was a deliberate setting, since the web app only writes booleans. */

const ID = '029-permission-global-flag';

const UNSET = { $or: [{ isGlobalPermission: { $exists: false } }, { isGlobalPermission: null }] };

async function repairCompany(ctx, companyId) {
    const result = await ctx.company(companyId, {
        type: ctx.SCHEMA_TYPE.PROJECTS,
        data: [UNSET, { $set: { isGlobalPermission: true } }],
    }, 'updateMany');
    return { repaired: (result && result.modifiedCount) || 0 };
}

module.exports = {
    id: ID,
    scope: 'company',
    repairCompany,
    async up(ctx) {
        const { removeCache } = require('../utils/commonFunctions');
        await ctx.forEachCompany(async (companyId) => {
            const counts = await repairCompany(ctx, companyId);
            if (counts.repaired) removeCache(`UserProjectData:${companyId}:`, true);
            ctx.logger.info(`[migrations] 029 ${companyId}: ${JSON.stringify(counts)}`);
            return counts;
        });
    },
};
