/* Builds the audit chain indexes in every tenant before its first chained row: the unique chain.seq index is
 * what stops two servers appending the same sequence number, meta.amends serves the fold, and the anchor index
 * keeps one anchor per sequence number. The global database gets the collection the head mirrors live in.
 * createIndexes, not syncIndexes, which would drop any index the schema does not declare. */

const ID = '030-audit-chain';

const hasIndex = (indexes, test) => (indexes || []).some((index) => index && index.key && test(index));

async function indexCompany(ctx, companyId) {
    const { AUDIT_LOGS, AUDIT_CHAIN_HEADS, AUDIT_CHAIN_ANCHORS } = ctx.SCHEMA_TYPE;
    for (const type of [AUDIT_LOGS, AUDIT_CHAIN_ANCHORS, AUDIT_CHAIN_HEADS]) {
        await ctx.company(companyId, { type, data: [] }, 'createCollection');
        await ctx.company(companyId, { type, data: [] }, 'createIndexes');
    }
    const logs = await ctx.company(companyId, { type: AUDIT_LOGS, data: [] }, 'listIndexes');
    if (!hasIndex(logs, (index) => index.key['chain.seq'] === 1 && index.unique)) throw new Error('audit_logs unique chain.seq index missing after createIndexes');
    if (!hasIndex(logs, (index) => index.key['meta.amends'] === 1)) throw new Error('audit_logs meta.amends index missing after createIndexes');
    const anchors = await ctx.company(companyId, { type: AUDIT_CHAIN_ANCHORS, data: [] }, 'listIndexes');
    if (!hasIndex(anchors, (index) => index.key.seq === -1 && index.unique)) throw new Error('audit_chain_anchors unique seq index missing after createIndexes');
    return { chainSeqIndex: true, amendsIndex: true, anchorSeqIndex: true };
}

module.exports = {
    id: ID,
    scope: 'company',
    indexCompany,
    async up(ctx) {
        await ctx.global({ type: ctx.SCHEMA_TYPE.AUDIT_CHAIN_HEADS, data: [] }, 'createCollection');
        await ctx.forEachCompany(async (companyId) => {
            const counts = await indexCompany(ctx, companyId);
            ctx.logger.info(`[migrations] 030 ${companyId}: ${JSON.stringify(counts)}`);
            return counts;
        });
    },
};
