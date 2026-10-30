/* Builds in every workspace the indexes task 064 declares in utils/mongo-handler/createSchema.js: the live-only
 * unique index on connector_connections, and the indexes of the new connector_apps and connector_usage
 * collections. Mongoose builds them only in the background on first use, so without this a workspace that
 * already has connector_connections could take the same account twice before the index exists.
 * createIndexes builds only what is missing, so the indexes the Google and Slack code reads by stay, and a
 * second run changes nothing. The unique index is partial on `provider` being a string, a field no row from
 * before the module carries, so it cannot collide with data already written.
 * A database that built this branch's first indexes still has `one_live_per_provider`, which would hold a person
 * to one account per provider, and a `one_live_per_account` without the `companyId` filter, which createIndexes
 * refuses to replace. Both are dropped first.
 * No verify(): `migrate verify` has to pass on a database this has not reached. */

const ID = '079-connector-indexes';
const NAMESPACE_NOT_FOUND = 26;

const TYPES = (ctx) => [ctx.SCHEMA_TYPE.CONNECTOR_CONNECTIONS, ctx.SCHEMA_TYPE.CONNECTOR_APPS, ctx.SCHEMA_TYPE.CONNECTOR_USAGE];
const UNIQUE = Object.freeze({
    connector_connections: ['one_live_per_account'],
    connector_apps: ['one_per_provider'],
    connector_usage: ['one_per_caller_day'],
});

const isOutdated = (index) => index.name === 'one_live_per_provider'
    || (index.name === 'one_live_per_account' && !(index.partialFilterExpression && index.partialFilterExpression.companyId));

async function dropOutdated(ctx, companyId) {
    const type = ctx.SCHEMA_TYPE.CONNECTOR_CONNECTIONS;
    let indexes;
    try {
        indexes = await ctx.company(companyId, { type, data: [] }, 'listIndexes') || [];
    } catch (error) {
        if (error && error.code === NAMESPACE_NOT_FOUND) return [];
        throw error;
    }
    const outdated = indexes.filter(isOutdated).map((index) => index.name);
    for (const name of outdated) {
        // eslint-disable-next-line no-await-in-loop
        await ctx.company(companyId, { type, data: [name] }, 'dropIndex');
    }
    return outdated;
}

async function indexCompany(ctx, companyId) {
    const dropped = await dropOutdated(ctx, companyId);
    for (const type of TYPES(ctx)) {
        // eslint-disable-next-line no-await-in-loop
        await ctx.company(companyId, { type, data: [] }, 'createIndexes');
    }
    return { indexes: UNIQUE, dropped };
}

module.exports = {
    id: ID,
    scope: 'company',
    UNIQUE,
    indexCompany,
    async up(ctx) {
        await ctx.forEachCompany(async (companyId) => {
            const built = await indexCompany(ctx, companyId);
            ctx.logger.info(`[migrations] 079 ${companyId}: connector indexes ensured${built.dropped.length ? `, dropped ${built.dropped.join(', ')}` : ''}`);
            return built;
        });
    },
};
