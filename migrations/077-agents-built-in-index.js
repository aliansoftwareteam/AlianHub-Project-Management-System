/* Builds in every workspace the unique { builtIn } index on agents that utils/mongo-handler/createSchema.js
 * declares. Mongoose builds it only in the background on first use, so without this two concurrent
 * "Add the Workspace Guide" calls on an existing workspace could each save a Guide
 * (Modules/Agents/workspaceGuide.js relies on the duplicate-key error). No row is rewritten.
 * createIndexes builds only what is missing and drops nothing, so a second run changes nothing.
 * No verify(): `migrate verify` has to pass on a database this has not reached. */

const ID = '077-agents-built-in-index';

const INDEX = 'builtIn_1';
const BUILT_IN = { builtIn: 1 };

async function indexCompany(ctx, companyId) {
    await ctx.company(companyId, { type: ctx.SCHEMA_TYPE.AGENTS, data: [] }, 'createIndexes');
    return { index: INDEX };
}

module.exports = {
    id: ID,
    scope: 'company',
    INDEX,
    BUILT_IN,
    indexCompany,
    async up(ctx) {
        await ctx.forEachCompany(async (companyId) => {
            const built = await indexCompany(ctx, companyId);
            ctx.logger.info(`[migrations] 077 ${companyId}: ${JSON.stringify(built)}`);
            return built;
        });
    },
};
