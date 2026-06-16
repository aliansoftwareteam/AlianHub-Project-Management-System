const { SCHEMA_TYPE } = require("../../Config/schemaType");
const { dbCollections } = require("../../Config/collections");
const { MongoDbCrudOpration } = require("../../utils/mongo-handler/mongoQueries");
const mongoose = require("mongoose");
const logger = require("../../Config/loggerConfig");
const { myCache } = require("../../Config/config");
const { generateToken, hashToken, tokenPrefixOf, looksLikeToken, validateCreateInput, isExpired } = require('./helpers/apiTokenRules');

// Resolve the acting user. These routes now sit behind the JWT middleware
// (Config/setMiddleware.js) which populates req.uid; the body userData
// fallback keeps older clients working until the frontend catches up.
const actingUserId = (req) => {
    if (req.uid) return String(req.uid);
    const userData = req.body && req.body.userData;
    return userData && (userData.id || userData._id) ? String(userData.id || userData._id) : '';
};

// Personal API tokens. The raw token is shown exactly once at creation;
// only its sha256 hash is stored. The prefix (first 12 chars) stays
// visible so users can match a token in hand against the list.

const maskToken = (doc) => ({
    _id: doc._id,
    name: doc.name,
    prefix: doc.prefix,
    scopes: doc.scopes || [],
    active: doc.active !== false,
    userId: doc.userId,
    expiresAt: doc.expiresAt || null,
    lastUsedAt: doc.lastUsedAt || null,
    createdAt: doc.createdAt,
});

/* POST /api/v2/api-tokens  body: { name, scopes?, expiresInDays?, userData } */
exports.createToken = async (req, res) => {
    try {
        const companyId = req.headers['companyid'] || '';
        const { name, scopes, expiresInDays } = req.body || {};
        const userId = actingUserId(req);
        if (!companyId || !userId) {
            return res.send({ status: false, statusText: 'companyId and userId are required.' });
        }
        const check = validateCreateInput({ name, scopes, expiresInDays });
        if (!check.valid) {
            return res.send({ status: false, statusText: check.reason });
        }

        const rawToken = generateToken();
        const doc = {
            name: String(name).trim(),
            tokenHash: hashToken(rawToken),
            prefix: tokenPrefixOf(rawToken),
            scopes: scopes || [],
            userId,
            active: true,
        };
        if (expiresInDays) {
            doc.expiresAt = new Date(Date.now() + Number(expiresInDays) * 24 * 60 * 60 * 1000);
        }
        const created = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.API_TOKENS, data: doc }, 'save');

        // The only time the raw token is ever returned.
        return res.send({ status: true, statusText: 'Token created. Copy it now — it is not shown again.', data: { ...maskToken(created), token: rawToken } });
    } catch (error) {
        logger.error(`ERROR in create api token: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};

/* GET /api/v2/api-tokens */
exports.listTokens = async (req, res) => {
    try {
        const companyId = req.headers['companyid'] || '';
        const userId = actingUserId(req);
        if (!companyId || !userId) {
            return res.send({ status: false, statusText: 'companyId and userId are required.' });
        }
        // Own tokens only — a user must not see (or learn prefixes of)
        // other users' tokens.
        const tokens = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.API_TOKENS,
            data: [{ userId }, null, { sort: { createdAt: -1 } }],
        }, 'find');
        return res.send({ status: true, statusText: 'Tokens fetched.', data: (tokens || []).map(maskToken) });
    } catch (error) {
        logger.error(`ERROR in list api tokens: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};

/* PUT /api/v2/api-tokens/:id  body: { name?, active? } */
exports.updateToken = async (req, res) => {
    try {
        const companyId = req.headers['companyid'] || '';
        const userId = actingUserId(req);
        const { id } = req.params;
        if (!companyId || !userId || !/^[0-9a-fA-F]{24}$/.test(String(id))) {
            return res.send({ status: false, statusText: 'companyId and a valid token id are required.' });
        }
        const { name, active } = req.body || {};
        const update = {};
        if (name !== undefined) {
            if (!String(name).trim()) return res.send({ status: false, statusText: 'name cannot be empty.' });
            update.name = String(name).trim();
        }
        if (active !== undefined) update.active = active === true;
        if (!Object.keys(update).length) {
            return res.send({ status: false, statusText: 'Nothing to update.' });
        }
        const updated = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.API_TOKENS,
            data: [{ _id: new mongoose.Types.ObjectId(id), userId }, { $set: update }, { returnDocument: 'after' }],
        }, 'findOneAndUpdate');
        if (!updated) {
            return res.send({ status: false, statusText: 'Token not found.' });
        }
        return res.send({ status: true, statusText: 'Token updated.', data: maskToken(updated) });
    } catch (error) {
        logger.error(`ERROR in update api token: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};

/* DELETE /api/v2/api-tokens/:id */
exports.deleteToken = async (req, res) => {
    try {
        const companyId = req.headers['companyid'] || '';
        const userId = actingUserId(req);
        const { id } = req.params;
        if (!companyId || !userId || !/^[0-9a-fA-F]{24}$/.test(String(id))) {
            return res.send({ status: false, statusText: 'companyId and a valid token id are required.' });
        }
        const tokenObjId = new mongoose.Types.ObjectId(id);
        // Ownership check before deletion — only the owner may revoke.
        const owned = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.API_TOKENS,
            data: [{ _id: tokenObjId, userId }],
        }, 'findOne');
        if (!owned) {
            return res.send({ status: false, statusText: 'Token not found.' });
        }
        await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.API_TOKENS, data: [{ _id: tokenObjId }] }, 'deleteOne');
        await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.API_ACTIVITY_LOGS, data: [{ tokenId: tokenObjId }] }, 'deleteMany').catch(() => {});
        return res.send({ status: true, statusText: 'Token deleted.' });
    } catch (error) {
        logger.error(`ERROR in delete api token: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};

/* GET /api/v2/api-tokens/:id/logs — newest 50 calls. */
exports.listTokenLogs = async (req, res) => {
    try {
        const companyId = req.headers['companyid'] || '';
        const userId = actingUserId(req);
        const { id } = req.params;
        if (!companyId || !userId || !/^[0-9a-fA-F]{24}$/.test(String(id))) {
            return res.send({ status: false, statusText: 'companyId and a valid token id are required.' });
        }
        // Only the token's owner may read its activity log.
        const owned = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.API_TOKENS,
            data: [{ _id: new mongoose.Types.ObjectId(id), userId }],
        }, 'findOne');
        if (!owned) {
            return res.send({ status: false, statusText: 'Token not found.' });
        }
        const logs = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.API_ACTIVITY_LOGS,
            data: [{ tokenId: new mongoose.Types.ObjectId(id) }, null, { sort: { createdAt: -1 }, limit: 50 }],
        }, 'find');
        return res.send({ status: true, statusText: 'Activity fetched.', data: logs || [] });
    } catch (error) {
        logger.error(`ERROR in list api token logs: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};

/* Resolve a raw token to its document — used by the public-API middleware.
 * Returns the token doc or null. Bumps lastUsedAt fire-and-forget. */
exports.verifyToken = async (companyId, rawToken) => {
    if (!companyId || !looksLikeToken(rawToken)) return null;
    try {
        const doc = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.API_TOKENS,
            data: [{ tokenHash: hashToken(rawToken), active: true }],
        }, 'findOne');
        if (!doc || isExpired(doc)) return null;
        // Throttled lastUsedAt bump: at most one write per token per minute,
        // so high-frequency API clients don't turn every request into a
        // Mongo write. (Cache miss after restart just means one extra write.)
        const throttleKey = `patLastUsed:${companyId}:${doc._id}`;
        if (!myCache.get(throttleKey)) {
            myCache.set(throttleKey, true, 60);
            MongoDbCrudOpration(companyId, {
                type: SCHEMA_TYPE.API_TOKENS,
                data: [{ _id: doc._id }, { $set: { lastUsedAt: new Date() } }],
            }, 'updateOne').catch(() => {});
        }
        return doc;
    } catch (error) {
        logger.error(`ERROR in verify api token: ${error.message}`);
        return null;
    }
};

/* GET /api/v2/api-tokens/me — whoami for API clients (PAT or JWT).
 * The MCP server calls this once after connect to resolve the identity
 * behind a token: { userId, companyId, name, email, scopes }. */
exports.whoami = async (req, res) => {
    try {
        const companyId = req.headers['companyid'] || '';
        const userId = actingUserId(req);
        if (!companyId || !userId) {
            return res.status(401).send({ status: false, statusText: 'Unauthorized.' });
        }
        let user = null;
        try {
            user = await MongoDbCrudOpration(dbCollections.GLOBAL, {
                type: dbCollections.USERS,
                data: [{ _id: new mongoose.Types.ObjectId(userId) }],
            }, 'findOne');
        } catch (lookupError) {
            logger.error(`ERROR in whoami user lookup: ${lookupError.message}`);
        }
        // Effective permission map so MCP clients can enforce every tool
        // against the user's role/permissions (read-only; no side effects).
        let roleType = null;
        let permissions = {};
        try {
            const { evaluateMany } = require('../../Config/permissionGuard');
            const result = await evaluateMany(companyId, userId);
            roleType = result.roleType;
            permissions = result.permissions;
        } catch (permError) {
            logger.error(`ERROR in whoami permission eval: ${permError.message}`);
        }
        return res.send({
            status: true,
            statusText: 'Identity resolved.',
            data: {
                userId,
                companyId,
                name: (user && user.Employee_Name) || '',
                email: (user && user.Employee_Email) || '',
                timeZone: (user && user.Time_Zone) || '',
                roleType,
                permissions,
                scopes: (req.apiToken && req.apiToken.scopes) || [],
                tokenName: (req.apiToken && req.apiToken.name) || null,
            },
        });
    } catch (error) {
        logger.error(`ERROR in whoami: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};

/* Fire-and-forget per-call audit row. */
exports.logTokenActivity = (companyId, tokenId, { method, path, statusCode, durationMs, ip }) => {
    MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.API_ACTIVITY_LOGS,
        data: { tokenId, method, path, statusCode, durationMs, ip },
    }, 'save').catch((error) => {
        logger.error(`ERROR in api token activity log: ${error.message}`);
    });
};
