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
    revokeForClient: (clientId, reason, at, companyId) => db(SCHEMA_TYPE.OAUTH_GRANTS, [
        { clientId: String(clientId), ...(companyId ? { companyId: String(companyId) } : {}), revokedAt: null },
        { $set: { revokedAt: at, revokedReason: String(reason) } },
    ], 'updateMany'),
    liveForClient: async (clientId, companyId) => ((await db(SCHEMA_TYPE.OAUTH_GRANTS, [
        { clientId: String(clientId), companyId: String(companyId), revokedAt: null },
    ], 'find')) || []).map(plain),
    setScopes: (grantId, scopes) => db(SCHEMA_TYPE.OAUTH_GRANTS, [{ grantId: String(grantId), revokedAt: null }, { $set: { scopes } }], 'updateOne'),
    touch: (grantId, at) => db(SCHEMA_TYPE.OAUTH_GRANTS, [{ grantId: String(grantId) }, { $set: { lastUsedAt: at } }], 'updateOne'),
    liveForUser: async (userId, now) => ((await db(SCHEMA_TYPE.OAUTH_GRANTS, [
        { userId: String(userId), revokedAt: null, expiresAt: { $gt: now } },
        {},
        { sort: { createdAt: -1 }, limit: 200 },
    ], 'find')) || []).map(plain),
};

/* A consent request is answered once: its nonce is recorded under the token hash index, so a second answer to
 * the same request collides with the first one. The row expires with the request. */
const consents = {
    spend: async ({ nonce, clientId, companyId, userId, scopes, resource, now, expiresAt }) => plain(await db(SCHEMA_TYPE.OAUTH_TOKENS, {
        tokenHash: require('./tokenHash').hashOf(`consent-spent:${nonce}`),
        kind: 'consent', grantId: 'none', clientId: String(clientId), companyId: String(companyId || 'none'), userId: String(userId),
        scopes: [...scopes], resource: String(resource), createdAt: now, expiresAt, purgeAt: expiresAt, spentAt: now, revokedAt: null,
    }, 'save')),
};

const approvals = {
    find: async (companyId, clientId) => plain(await db(SCHEMA_TYPE.OAUTH_CLIENT_APPROVALS, [{ companyId: String(companyId), clientId: String(clientId) }], 'findOne')),
    save: async (row) => plain(await db(SCHEMA_TYPE.OAUTH_CLIENT_APPROVALS, row, 'save')),
    // Moves a row on only from the status it was read in, so two admins acting at once cannot both win.
    transition: async (companyId, clientId, fromStatus, set) => plain(await db(SCHEMA_TYPE.OAUTH_CLIENT_APPROVALS, [
        { companyId: String(companyId), clientId: String(clientId), status: fromStatus },
        { $set: set },
        { new: true },
    ], 'findOneAndUpdate')),
    countRequestedBy: async (userId, since) => Number(await db(SCHEMA_TYPE.OAUTH_CLIENT_APPROVALS, [
        { requestedBy: String(userId), requestedAt: { $gte: since } },
    ], 'countDocuments')) || 0,
    listFor: async (companyId) => ((await db(SCHEMA_TYPE.OAUTH_CLIENT_APPROVALS, [{ companyId: String(companyId) }, {}, { sort: { updatedAt: -1 }, limit: 500 }], 'find')) || []).map(plain),
    namesFor: async (pairs) => {
        if (!pairs.length) return [];
        return ((await db(SCHEMA_TYPE.OAUTH_CLIENT_APPROVALS, [{ $or: pairs.map(({ companyId, clientId }) => ({ companyId: String(companyId), clientId: String(clientId) })) }, { companyId: 1, clientId: 1, clientName: 1 }], 'find')) || []).map(plain);
    },
    revokeForClient: (clientId, by, at) => db(SCHEMA_TYPE.OAUTH_CLIENT_APPROVALS, [
        { clientId: String(clientId), status: { $in: ['pending', 'approved'] } },
        { $set: { status: 'revoked', revokedBy: String(by || ''), revokedAt: at, updatedAt: at } },
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
    liveForGrant: async (grantId) => ((await db(SCHEMA_TYPE.OAUTH_TOKENS, [
        { grantId: String(grantId), kind: { $in: ['access', 'refresh'] }, revokedAt: null },
    ], 'find')) || []).map(plain),
    setScopes: (tokenHash, scopes) => db(SCHEMA_TYPE.OAUTH_TOKENS, [{ tokenHash: String(tokenHash) }, { $set: { scopes } }], 'updateOne'),
    revokeGrant: (grantId, at) => db(SCHEMA_TYPE.OAUTH_TOKENS, [{ grantId: String(grantId), revokedAt: null }, { $set: { revokedAt: at } }], 'updateMany'),
    revokeClient: (clientId, at, companyId) => db(SCHEMA_TYPE.OAUTH_TOKENS, [
        { clientId: String(clientId), ...(companyId ? { companyId: String(companyId) } : {}), revokedAt: null },
        { $set: { revokedAt: at } },
    ], 'updateMany'),
};

module.exports = { clients, grants, tokens, approvals, consents };
