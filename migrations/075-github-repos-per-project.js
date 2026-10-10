/* Task 049: a GitHub connection maps repositories to projects (`repos: [{ repo, projectIds, sync }]`) in place of one
 * `config.repo` feeding `projectIds`. Up turns the old pair into one entry and keeps its cursor, so nothing is read twice
 * or skipped; a row already mapped, or with no repository or no project, is left alone (the app reads it the old way),
 * so a second run changes nothing. Down puts a one-entry mapping back; a row mapping several repositories cannot be said the old way and is left mapped and counted. */

const ID = '075-github-repos-per-project';

const repoMap = () => require('../Modules/Integrations/appConnections/github/repoMap');

async function upCompany(ctx, companyId) {
    const type = ctx.SCHEMA_TYPE.INTEGRATION_CONNECTIONS;
    const rows = await ctx.company(companyId, { type, data: [{ type: 'github', repos: { $exists: false } }] }, 'find') || [];
    const counts = { mapped: 0, skipped: 0 };
    for (const row of rows) {
        const entries = repoMap().stored(repoMap().reposOf(row));
        if (!entries.length) { counts.skipped += 1; continue; }
        await ctx.company(companyId, { type, data: [{ _id: row._id, repos: { $exists: false } }, repoMap().mappingUpdate(entries)] }, 'updateOne');
        counts.mapped += 1;
    }
    return counts;
}

async function downCompany(ctx, companyId) {
    const type = ctx.SCHEMA_TYPE.INTEGRATION_CONNECTIONS;
    const rows = await ctx.company(companyId, { type, data: [{ type: 'github', repos: { $exists: true } }] }, 'find') || [];
    const counts = { restored: 0, kept: 0 };
    for (const row of rows) {
        const entries = repoMap().reposOf(row);
        if (entries.length > 1) { counts.kept += 1; continue; }
        const [entry] = entries;
        const sync = { ...(row.sync || {}), ...(entry && entry.sync.cursor ? { cursor: entry.sync.cursor } : {}) };
        await ctx.company(companyId, {
            type,
            data: [{ _id: row._id }, { $set: entry ? { 'config.repo': entry.repo, projectIds: entry.projectIds, sync } : { sync }, $unset: { repos: '' } }],
        }, 'updateOne');
        counts.restored += 1;
    }
    return counts;
}

module.exports = {
    id: ID,
    scope: 'company',
    upCompany,
    downCompany,
    async up(ctx) {
        await ctx.forEachCompany(async (companyId) => {
            const counts = await upCompany(ctx, companyId);
            ctx.logger.info(`[migrations] ${ID} ${companyId}: ${JSON.stringify(counts)}`);
            return counts;
        });
    },
    async down(ctx) {
        await ctx.forEachCompany(async (companyId) => {
            const counts = await downCompany(ctx, companyId);
            ctx.logger.info(`[migrations] ${ID} down ${companyId}: ${JSON.stringify(counts)}`);
            return counts;
        });
    },
};
