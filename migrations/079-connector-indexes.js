/* Builds in every workspace the indexes task 064 declares in utils/mongo-handler/createSchema.js: the two
 * live-only unique indexes on connector_connections, and the indexes of the new connector_apps and
 * connector_usage collections. Mongoose builds them only in the background on first use, so without this a
 * workspace that already has connector_connections could take a second live connection for the same person
 * and provider before the index exists.
 * createIndexes builds only what is missing and drops nothing, so the indexes the Google and Slack code reads
 * by stay, and a second run changes nothing. The unique indexes are partial on `provider` being a string, a
 * field no row from before the module carries, so they cannot collide with data already written.
 * No verify(): `migrate verify` has to pass on a database this has not reached. */

const ID = '079-connector-indexes';

const TYPES = (ctx) => [ctx.SCHEMA_TYPE.CONNECTOR_CONNECTIONS, ctx.SCHEMA_TYPE.CONNECTOR_APPS, ctx.SCHEMA_TYPE.CONNECTOR_USAGE];
const UNIQUE = Object.freeze({
    connector_connections: ['one_live_per_account', 'one_live_per_provider'],
    connector_apps: ['one_per_provider'],
    connector_usage: ['one_per_caller_day'],
});

async function indexCompany(ctx, companyId) {
    for (const type of TYPES(ctx)) {
        // eslint-disable-next-line no-await-in-loop
        await ctx.company(companyId, { type, data: [] }, 'createIndexes');
    }
    return { indexes: UNIQUE };
}

module.exports = {
    id: ID,
    scope: 'company',
    UNIQUE,
    indexCompany,
    async up(ctx) {
        await ctx.forEachCompany(async (companyId) => {
            const built = await indexCompany(ctx, companyId);
            ctx.logger.info(`[migrations] 079 ${companyId}: connector indexes ensured`);
            return built;
        });
    },
};
