const { TERMINAL, RETENTION_SECONDS } = require('../Modules/Agents/runs');

/* agent_runs had a TTL on createdAt, so a run waiting on a person for longer
 * than the retention period was deleted under its proposal (defect 16). The
 * schema now carries the TTL on expiresAt, which only a terminal status sets.
 * syncIndexes drops the createdAt TTL index and builds the expiresAt one from
 * the schema; the backfill gives every already-finished run its expiry, from
 * finishedAt (or createdAt for the few rows without one). */

const RUNS = (ctx) => ctx.SCHEMA_TYPE.AGENT_RUNS;

const expiryFrom = (row) => new Date(new Date(row.finishedAt || row.createdAt || Date.now()).getTime() + RETENTION_SECONDS * 1000);

module.exports = {
    id: '008-agent-run-expiry',
    scope: 'company',
    async up(ctx) {
        await ctx.forEachCompany(async (companyId) => {
            const droppedIndexes = (await ctx.company(companyId, { type: RUNS(ctx), data: [] }, 'syncIndexes')) || [];
            const terminal = await ctx.company(companyId, { type: RUNS(ctx), data: [{ status: { $in: TERMINAL } }, '_id status finishedAt createdAt expiresAt'] }, 'find') || [];
            const counts = { droppedIndexes, backfilled: 0, skipped: 0 };
            for (const row of terminal) {
                if (row.expiresAt) { counts.skipped += 1; continue; }
                await ctx.company(companyId, { type: RUNS(ctx), data: [{ _id: row._id }, { $set: { expiresAt: expiryFrom(row) } }] }, 'updateOne');
                counts.backfilled += 1;
            }
            ctx.logger.info(`[migrations] 008 ${companyId}: ${JSON.stringify(counts)}`);
            return counts;
        });
    },
};
