/* Tasks carried the web app's session token as their drag-update marker. The app now
 * sends a per-tab id and the server stores nothing else there, so every stored marker
 * is removed; the next drag writes a fresh one. There is no down(): nothing to restore. */

const ID = '028-clear-task-update-tokens';

async function clearCompany(ctx, companyId) {
    const result = await ctx.company(companyId, {
        type: ctx.SCHEMA_TYPE.TASKS,
        data: [{ updateToken: { $exists: true } }, { $unset: { updateToken: '' } }],
    }, 'updateMany');
    return { cleared: (result && result.modifiedCount) || 0 };
}

module.exports = {
    id: ID,
    scope: 'company',
    async up(ctx) {
        await ctx.forEachCompany(async (companyId) => {
            const counts = await clearCompany(ctx, companyId);
            ctx.logger.info(`[migrations] 028 ${companyId}: ${JSON.stringify(counts)}`);
            return counts;
        });
    },
};
