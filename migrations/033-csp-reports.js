/* Builds the csp_reports indexes in the global database before the first violation report: the unique key keeps
 * concurrent first reports on one row, and the TTL index is the only thing that expires rows.
 * createIndexes, not syncIndexes, which would drop any index the schema does not declare. */

const ID = '033-csp-reports';

module.exports = {
    id: ID,
    scope: 'global',
    async up(ctx) {
        const type = ctx.SCHEMA_TYPE.CSP_REPORTS;
        await ctx.global({ type, data: [] }, 'createIndexes');
        const indexes = await ctx.global({ type, data: [] }, 'listIndexes') || [];
        const ttl = indexes.find((index) => index && index.key && index.key.day === 1 && Object.keys(index.key).length === 1 && index.expireAfterSeconds !== undefined);
        if (!ttl) throw new Error('csp_reports TTL index missing after createIndexes');
        ctx.logger.info(`[migrations] 033 global: ${JSON.stringify({ ttlIndex: ttl.name, expireAfterSeconds: ttl.expireAfterSeconds })}`);
    },
};
