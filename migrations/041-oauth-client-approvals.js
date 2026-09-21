/* Builds the per-workspace client approval indexes before the first approval is written: one approval per client per
 * workspace, which the approve and request upserts rely on to never create a second row. Also adds the grant indexes
 * that revoking an approval (client and workspace) and a person's grant list (user) read by.
 * createIndexes, not syncIndexes, which would drop any index the schema does not declare. */

const ID = '041-oauth-client-approvals';
const UNIQUE = 'company_client';

module.exports = {
    id: ID,
    scope: 'global',
    async up(ctx) {
        const approvals = ctx.SCHEMA_TYPE.OAUTH_CLIENT_APPROVALS;
        await ctx.global({ type: approvals, data: [] }, 'createIndexes');
        const indexes = await ctx.global({ type: approvals, data: [] }, 'listIndexes') || [];
        if (!indexes.some((index) => index && index.name === UNIQUE && index.unique)) throw new Error(`${approvals} unique index ${UNIQUE} missing after createIndexes`);
        await ctx.global({ type: ctx.SCHEMA_TYPE.OAUTH_GRANTS, data: [] }, 'createIndexes');
        ctx.logger.info(`[migrations] 041 global: ${JSON.stringify({ [approvals]: indexes.map((index) => index.name) })}`);
    },
};
