const { SCHEMA_TYPE } = require('../../Config/schemaType');

const db = (type, data, method) => {
    const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
    return MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, { type, data }, method);
};

const plain = (doc) => (doc && typeof doc.toObject === 'function' ? doc.toObject() : doc);

const clients = {
    save: async (row) => plain(await db(SCHEMA_TYPE.OAUTH_CLIENTS, row, 'save')),
    find: async (clientId) => plain(await db(SCHEMA_TYPE.OAUTH_CLIENTS, [{ clientId: String(clientId) }], 'findOne')),
    listFor: async (companyId) => ((await db(SCHEMA_TYPE.OAUTH_CLIENTS, [{ companyId: String(companyId) }, { secretHash: 0 }, { sort: { createdAt: -1 } }], 'find')) || []).map(plain),
    revoke: async ({ clientId, companyId, by, at }) => plain(await db(SCHEMA_TYPE.OAUTH_CLIENTS, [
        { clientId: String(clientId), companyId: String(companyId), revokedAt: null },
        { $set: { revokedAt: at, revokedBy: String(by || '') } },
    ], 'findOneAndUpdate')),
};

const grants = {
    save: async (row) => plain(await db(SCHEMA_TYPE.OAUTH_GRANTS, row, 'save')),
    find: async (grantId) => plain(await db(SCHEMA_TYPE.OAUTH_GRANTS, [{ grantId: String(grantId) }], 'findOne')),
    revoke: async (grantId, reason, at) => plain(await db(SCHEMA_TYPE.OAUTH_GRANTS, [
        { grantId: String(grantId), revokedAt: null },
        { $set: { revokedAt: at, revokedReason: String(reason) } },
    ], 'findOneAndUpdate')),
    revokeForClient: (clientId, reason, at) => db(SCHEMA_TYPE.OAUTH_GRANTS, [
        { clientId: String(clientId), revokedAt: null },
        { $set: { revokedAt: at, revokedReason: String(reason) } },
    ], 'updateMany'),
};

const tokens = {
    save: async (row) => plain(await db(SCHEMA_TYPE.OAUTH_TOKENS, row, 'save')),
    find: async (tokenHash, kind) => plain(await db(SCHEMA_TYPE.OAUTH_TOKENS, [{ tokenHash: String(tokenHash), kind }], 'findOne')),
    // Answers the row as it was before, or null when nothing unspent matched: the caller only reads fields the update leaves alone.
    spend: async (tokenHash, kind, at) => plain(await db(SCHEMA_TYPE.OAUTH_TOKENS, [
        { tokenHash: String(tokenHash), kind, spentAt: null, revokedAt: null },
        { $set: { spentAt: at } },
    ], 'findOneAndUpdate')),
    revoke: (tokenHash, at) => db(SCHEMA_TYPE.OAUTH_TOKENS, [{ tokenHash: String(tokenHash), revokedAt: null }, { $set: { revokedAt: at } }], 'updateOne'),
    revokeGrant: (grantId, at) => db(SCHEMA_TYPE.OAUTH_TOKENS, [{ grantId: String(grantId), revokedAt: null }, { $set: { revokedAt: at } }], 'updateMany'),
    revokeClient: (clientId, at) => db(SCHEMA_TYPE.OAUTH_TOKENS, [{ clientId: String(clientId), revokedAt: null }, { $set: { revokedAt: at } }], 'updateMany'),
};

module.exports = { clients, grants, tokens };
