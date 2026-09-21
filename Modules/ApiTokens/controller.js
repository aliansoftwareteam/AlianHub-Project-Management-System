const { SCHEMA_TYPE } = require("../../Config/schemaType");
const { dbCollections } = require("../../Config/collections");
const { MongoDbCrudOpration } = require("../../utils/mongo-handler/mongoQueries");
const mongoose = require("mongoose");
const logger = require("../../Config/loggerConfig");
const { myCache } = require("../../Config/config");
const {
    SCOPES, MIN_EXPIRY_DAYS, STRICT_GRACE_DAYS, LAST_USED_WRITE_INTERVAL_MS,
    generateToken, hashToken, tokenPrefixOf, looksLikeToken, isStrict, validateCreateInput, isExpired, effectiveScopes, graceStanding, lastUsedIsStale,
    maxLifetimeDays, maxExpiryDaysFor, mayExceedMaxLifetime, lifetimeStanding,
} = require('./helpers/apiTokenRules');
const { strictSince } = require('./helpers/strictSince');
const { maxLifetimeSince } = require('./helpers/maxLifetimeSince');
const { stepCredentialsEnabled } = require('../Agents/serviceIdentity');

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

const maskToken = (doc, standing = null, lifetime = null) => ({
    _id: doc._id,
    name: doc.name,
    prefix: doc.prefix,
    scopes: effectiveScopes(doc),
    active: doc.active !== false,
    userId: doc.userId,
    kind: doc.kind || 'personal',
    agentAccount: doc.agentAccount || null,
    projectIds: doc.projectIds || [],
    expiresAt: doc.expiresAt || null,
    lastUsedAt: doc.lastUsedAt || null,
    createdAt: doc.createdAt,
    graceState: standing && standing.state !== 'ok' ? standing.state : null,
    graceEndsAt: standing && standing.state !== 'ok' ? standing.deadline : null,
    ...(lifetime && lifetime.state !== 'ok' ? { lifetimeState: lifetime.state, lifetimeEndsAt: lifetime.deadline } : {}),
});

const refuseInput = (res, check) => res.send({
    status: false, statusText: check.reason,
    ...(check.code ? { code: check.code, maxExpiryDays: check.maxExpiryDays } : {}),
});

/* The cap's start is read only when some token could be over the maximum. */
const lifetimeStandings = async (docs, { strict, now }) => {
    const maxDays = maxLifetimeDays();
    const since = docs.some((doc) => mayExceedMaxLifetime(doc, { strict, maxDays })) ? await maxLifetimeSince(now) : null;
    return docs.map((doc) => lifetimeStanding(doc, { strict, maxLifetimeSince: since, now, maxDays }));
};

const ymd = (date) => new Date(date).toISOString().slice(0, 10);

const NO_EXPIRY_UPDATE = 'Under the token expiry rule a token without an expiry cannot be changed, only revoked. Create a new token with an expiry.';

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
        if (!check.valid) return refuseInput(res, check);

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

/* POST /api/v2/api-tokens/mcp  body: { name, mode?, provider?, projectIds?, expiresInDays?, scopes? (strict mode only) }
 * Mints a token for a CLI/coding agent: kind 'agent', read+write scopes, and the
 * account mode the run is attributed to. Returns the MCP URL to paste. */
exports.createMcpToken = async (req, res) => {
    try {
        const companyId = req.headers['companyid'] || '';
        const userId = actingUserId(req);
        const { name, mode, provider, projectIds, expiresInDays, label, scopes: askedScopes } = req.body || {};
        if (!companyId || !userId) return res.send({ status: false, statusText: 'companyId and userId are required.' });
        if (req.apiToken) return res.status(403).send({ status: false, statusText: 'API tokens cannot mint tokens.' });
        const scopes = isStrict() && askedScopes !== undefined ? askedScopes : ['read', 'write'];
        const check = validateCreateInput({ name: name || 'CLI agent', scopes, expiresInDays });
        if (!check.valid) return refuseInput(res, check);
        const accounts = require('../Agents/accounts');
        const policy = await accounts.getPolicy(companyId);
        const wanted = accounts.MODES.includes(mode) ? mode : 'personal';
        if (!policy.allowedModes.includes(wanted)) {
            return res.status(403).send({ status: false, statusText: `This workspace requires ${policy.allowedModes.join(' or ')} accounts — ${wanted} is not allowed by your admin.` });
        }
        const rawToken = generateToken();
        const doc = {
            name: String(name || 'CLI agent').trim(), tokenHash: hashToken(rawToken), prefix: tokenPrefixOf(rawToken),
            scopes, userId, active: true, kind: 'agent',
            agentAccount: { mode: wanted, provider: accounts.PROVIDERS.includes(provider) ? provider : 'claude-code', linkedAt: new Date(), label: String(label || name || '').slice(0, 80) },
            projectIds: Array.isArray(projectIds) ? projectIds.filter((id) => /^[0-9a-fA-F]{24}$/.test(String(id))).map(String) : [],
        };
        if (expiresInDays) doc.expiresAt = new Date(Date.now() + Number(expiresInDays) * 24 * 60 * 60 * 1000);
        const created = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.API_TOKENS, data: doc }, 'save');
        const base = String(process.env.APIURL || '').replace(/\/$/, '');
        return res.send({
            status: true, statusText: 'Token created. Copy it now — it is not shown again.',
            data: { ...maskToken(created), kind: 'agent', agentAccount: doc.agentAccount, projectIds: doc.projectIds, token: rawToken,
                    mcpUrl: `${base}/mcp?companyId=${companyId}`, tools: require('../Mcp/tools').names() },
        });
    } catch (error) {
        logger.error(`ERROR in create mcp token: ${error.message}`);
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
        const strict = isStrict();
        const since = strict ? await strictSince() : null;
        const now = new Date();
        // The flag is named only while it is on, so the answer with it off is the one
        // given before it existed; the screen asks for the credential list on seeing it.
        const policy = {
            strict, minExpiryDays: MIN_EXPIRY_DAYS, maxExpiryDays: maxExpiryDaysFor({ strict }), scopes: [...SCOPES], graceDays: STRICT_GRACE_DAYS,
            strictSince: since,
            ...(stepCredentialsEnabled() ? { stepCredentials: true } : {}),
        };
        const lifetimes = await lifetimeStandings(tokens || [], { strict, now });
        const data = (tokens || []).map((doc, i) => maskToken(doc, graceStanding(doc, { strict, strictSince: since, now }), lifetimes[i]));
        return res.send({ status: true, statusText: 'Tokens fetched.', data, policy });
    } catch (error) {
        logger.error(`ERROR in list api tokens: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};

const byDeadline = (a, b) => {
    const x = a.deadline ? new Date(a.deadline).getTime() : 0;
    const y = b.deadline ? new Date(b.deadline).getTime() : 0;
    return x - y || String(a.name).localeCompare(String(b.name));
};

const displayNamesOf = async (userIds) => {
    const ids = [...new Set(userIds.filter((id) => /^[0-9a-fA-F]{24}$/.test(id)))];
    if (!ids.length) return {};
    const users = await MongoDbCrudOpration(dbCollections.GLOBAL, {
        type: SCHEMA_TYPE.USERS,
        data: [{ _id: { $in: ids.map((id) => new mongoose.Types.ObjectId(id)) } }, { Employee_Name: 1, Employee_Email: 1 }],
    }, 'find').catch(() => []);
    return Object.fromEntries((users || []).map((user) => [String(user._id), user.Employee_Name || user.Employee_Email || '']));
};

/* GET /api/v2/api-tokens/needing-expiry — every active token in the company with no
 * expiry or with one past the maximum lifetime, for owners and admins, so they can see
 * who has to replace what before it stops. Never the token, its hash or its prefix:
 * only its owner can replace it. */
exports.listTokensNeedingExpiry = async (req, res) => {
    try {
        const companyId = req.headers['companyid'] || '';
        const userId = actingUserId(req);
        if (!companyId || !userId) {
            return res.send({ status: false, statusText: 'companyId and userId are required.' });
        }
        if (req.apiToken) return res.status(403).send({ status: false, statusText: 'API tokens cannot list tokens.' });
        const { getRoleType, isPrivileged } = require('../../Config/permissionGuard');
        if (!isPrivileged(await getRoleType(companyId, userId))) {
            return res.status(403).send({ status: false, statusText: 'Only an owner or an admin can see which tokens still need an expiry.' });
        }
        const strict = isStrict();
        const policy = { strict, graceDays: STRICT_GRACE_DAYS, strictSince: null };
        if (!strict) return res.send({ status: true, statusText: 'Tokens fetched.', data: [], policy });
        const now = new Date();
        const maxDays = maxLifetimeDays();
        policy.strictSince = await strictSince(now);
        policy.maxExpiryDays = maxDays;
        const capSince = await maxLifetimeSince(now);
        // Any token over the maximum expires after the cap's start plus the maximum; with no known start, after now.
        const overMaxBound = capSince ? new Date(capSince.getTime() + maxDays * 24 * 60 * 60 * 1000) : now;
        const tokens = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.API_TOKENS,
            data: [
                { active: true, $or: [{ expiresAt: { $exists: false } }, { expiresAt: null }, { expiresAt: { $gt: overMaxBound } }] },
                { name: 1, userId: 1, kind: 1, createdAt: 1, lastUsedAt: 1, expiresAt: 1 },
            ],
        }, 'find');
        const rows = (tokens || []).map((doc) => {
            if (!doc.expiresAt) return { doc, reason: 'no-expiry', standing: graceStanding(doc, { strict, strictSince: policy.strictSince, now }) };
            const standing = lifetimeStanding(doc, { strict, maxLifetimeSince: capSince, now, maxDays });
            return standing.state === 'ok' ? null : { doc, reason: 'over-max-lifetime', standing };
        }).filter(Boolean);
        const names = await displayNamesOf(rows.map(({ doc }) => String(doc.userId || '')));
        const data = rows.map(({ doc, reason, standing }) => ({
            _id: doc._id,
            name: doc.name,
            kind: doc.kind || 'personal',
            owner: { id: String(doc.userId || ''), name: names[String(doc.userId)] || '' },
            createdAt: doc.createdAt,
            lastUsedAt: doc.lastUsedAt || null,
            reason,
            ...(doc.expiresAt ? { expiresAt: doc.expiresAt } : {}),
            deadline: standing.deadline,
            stopped: standing.state === 'stopped',
        })).sort(byDeadline);
        return res.send({ status: true, statusText: 'Tokens fetched.', data, policy });
    } catch (error) {
        logger.error(`ERROR in list api tokens needing expiry: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};

/* GET /api/v2/api-tokens/step-credentials — the live step-scoped credentials of the
 * workspace's workflow runs, as their own kind: every run's for an owner or admin,
 * only the runs they started for anyone else. The run, the step and the expiry;
 * never the credential, which is not stored, nor its id. */
exports.listStepCredentials = async (req, res) => {
    try {
        const companyId = req.headers['companyid'] || '';
        const userId = actingUserId(req);
        if (!companyId || !userId) {
            return res.send({ status: false, statusText: 'companyId and userId are required.' });
        }
        if (req.apiToken) return res.status(403).send({ status: false, statusText: 'API tokens cannot list credentials.' });
        const stepCredential = require('../Workflows/stepCredential');
        const policy = { stepCredentials: stepCredential.enabled() };
        if (!policy.stepCredentials) return res.send({ status: true, statusText: 'Credentials fetched.', data: [], policy });
        const { getRoleType, isPrivileged } = require('../../Config/permissionGuard');
        const roleType = await getRoleType(companyId, userId);
        if (roleType === null || roleType === undefined) {
            return res.status(403).send({ status: false, statusText: 'Only a member of this workspace can see its step-scoped credentials.' });
        }
        const rows = await stepCredential.listActive(companyId, { userId, privileged: isPrivileged(roleType) });
        const names = await displayNamesOf(rows.map((row) => row.startedBy.id));
        const data = rows.map((row) => ({ ...row, startedBy: { ...row.startedBy, name: names[row.startedBy.id] || '' } }));
        return res.send({ status: true, statusText: 'Credentials fetched.', data, policy });
    } catch (error) {
        logger.error(`ERROR in list step credentials: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};

/* PUT /api/v2/api-tokens/:id  body: { name?, active? }. Under strict mode a token
 * without an expiry may only be revoked, so it is replaced rather than kept. */
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
        const filter = { _id: new mongoose.Types.ObjectId(id), userId };
        const onlyRevoking = Object.keys(update).length === 1 && update.active === false;
        if (isStrict() && !onlyRevoking) {
            const owned = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.API_TOKENS, data: [filter] }, 'findOne');
            if (owned && !owned.expiresAt) return res.send({ status: false, statusText: NO_EXPIRY_UPDATE });
        }
        const updated = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.API_TOKENS,
            data: [filter, { $set: update }, { returnDocument: 'after' }],
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

/* Resolve a raw token for the token middlewares: { token, refusal }. `refusal` is
 * set only when the caller should be told why, never for an unknown token. */
exports.resolveToken = async (companyId, rawToken) => {
    if (!companyId || !looksLikeToken(rawToken)) return { token: null, refusal: null };
    try {
        const doc = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.API_TOKENS,
            data: [{ tokenHash: hashToken(rawToken), active: true }],
        }, 'findOne');
        const now = new Date();
        if (!doc || isExpired(doc, now)) return { token: null, refusal: null };
        if (isStrict() && !doc.expiresAt) {
            const standing = graceStanding(doc, { strict: true, strictSince: await strictSince(now), now });
            if (standing.state === 'stopped') {
                const when = standing.deadline ? `stopped working on ${ymd(standing.deadline)}` : 'cannot be checked against its grace period right now';
                return { token: null, refusal: `This API token has no expiry and ${when}. Create a new token with an expiry.` };
            }
        }
        if (isStrict() && doc.expiresAt) {
            const maxDays = maxLifetimeDays();
            const standing = lifetimeStanding(doc, { strict: true, maxLifetimeSince: await maxLifetimeSince(now), now, maxDays });
            if (standing.state === 'stopped') {
                const when = standing.deadline ? `stopped working on ${ymd(standing.deadline)}` : 'cannot be checked against the maximum right now';
                return { token: null, refusal: `This API token expires later than the maximum lifetime of ${maxDays} days allows and ${when}. Create a new token with a shorter expiry.` };
            }
        }
        recordLastUsed(companyId, doc, now);
        return { token: doc, refusal: null };
    } catch (error) {
        logger.error(`ERROR in verify api token: ${error.message}`);
        return { token: null, refusal: null };
    }
};

/* The stored value is the throttle, so a restart or a second server does not add
 * writes; the cache only collapses a burst that arrives before the first write lands. */
const recordLastUsed = (companyId, doc, now) => {
    const throttleKey = `patLastUsed:${companyId}:${doc._id}`;
    if (!lastUsedIsStale(doc, now) || myCache.get(throttleKey)) return;
    myCache.set(throttleKey, true, LAST_USED_WRITE_INTERVAL_MS / 1000);
    const staleBefore = new Date(now.getTime() - LAST_USED_WRITE_INTERVAL_MS);
    MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.API_TOKENS,
        data: [{ _id: doc._id, $or: [{ lastUsedAt: { $exists: false } }, { lastUsedAt: { $lte: staleBefore } }] }, { $set: { lastUsedAt: now } }],
    }, 'updateOne').catch(() => {});
};

exports.verifyToken = async (companyId, rawToken) => (await exports.resolveToken(companyId, rawToken)).token;

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
                scopes: req.apiToken ? effectiveScopes(req.apiToken) : [],
                tokenName: (req.apiToken && req.apiToken.name) || null,
            },
        });
    } catch (error) {
        logger.error(`ERROR in whoami: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};

/* Fire-and-forget per-call audit row. */
exports.logTokenActivity = (companyId, tokenId, { method, path, statusCode, durationMs, ip, clientId, grantId, userId }) => {
    MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.API_ACTIVITY_LOGS,
        data: { ...(tokenId ? { tokenId } : {}), method, path, statusCode, durationMs, ip, ...(clientId ? { clientId, grantId, userId } : {}) },
    }, 'save').catch((error) => {
        logger.error(`ERROR in api token activity log: ${error.message}`);
    });
};
