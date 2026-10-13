/* Builds the MCP authorization server's indexes in the global database before the first client registers: unique
 * keys on client ids, grant ids and token hashes (a code or token is looked up by its hash and spent atomically), and
 * the TTL indexes on purgeAt, the only thing that removes expired codes, tokens and grants.
 * createIndexes, not syncIndexes, which would drop any index the schema does not declare. */

const ID = '040-oauth-server';

const UNIQUE = { OAUTH_CLIENTS: 'client_id', OAUTH_GRANTS: 'grant_id', OAUTH_TOKENS: 'token_hash' };

module.exports = {
    id: ID,
    scope: 'global',
    async up(ctx) {
        const built = {};
        for (const [name, unique] of Object.entries(UNIQUE)) {
            const type = ctx.SCHEMA_TYPE[name];
            await ctx.global({ type, data: [] }, 'createIndexes');
            const indexes = await ctx.global({ type, data: [] }, 'listIndexes') || [];
            if (!indexes.some((index) => index && index.name === unique && index.unique)) throw new Error(`${type} unique index ${unique} missing after createIndexes`);
            built[type] = indexes.map((index) => index.name);
            if (name !== 'OAUTH_CLIENTS') {
                const ttl = indexes.find((index) => index && index.key && index.key.purgeAt === 1 && index.expireAfterSeconds === 0);
                if (!ttl) throw new Error(`${type} TTL index missing after createIndexes`);
            }
        }
        ctx.logger.info(`[migrations] 040 global: ${JSON.stringify(built)}`);
    },
};
