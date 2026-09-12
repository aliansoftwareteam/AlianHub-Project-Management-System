const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const logger = require("./loggerConfig");
const mongoC = require("../utils/mongo-handler/mongoQueries");
const { dbCollections } = require("../Config/collections.js");
const {myCache} = require('./config');
// Personal API token (PAT) support — pure helpers only (node crypto), no
// circular dependency risk. The controller is lazy-required inside
// verifyApiTokenRequest below.
const { looksLikeToken, hasScope } = require('../Modules/ApiTokens/helpers/apiTokenRules');
const { sessionTokenQuery, readAccessSession, sessionCacheKey } = require('../Modules/Auth/helpers/refreshTokenRules');

// Mongo ObjectId pattern — used to reject regex/control characters in the
// `companyid` request header before any token-membership check.
const OBJECT_ID_PATTERN = /^[a-f0-9]{24}$/i;

// Strict membership check against a JWT `aud` claim that may be a comma-joined
// string (current shape — see `generateJWTToken`) or an array. Replaces the
// previous `new RegExp(companyId)` audience option, which let header values
// like `.*` match any audience and cross tenants.
const isCompanyInAudience = (audClaim, companyId) => {
    if (!audClaim || !companyId) return false;
    const list = Array.isArray(audClaim)
        ? audClaim
        : String(audClaim).split(',');
    const target = String(companyId).trim();
    return list.some((entry) => String(entry).trim() === target);
};

// BUG-013 / #67 fix: live membership re-check against MongoDB, cached.
//
// The JWT audience claim is frozen at login and lasts JWT_EXP (24h default),
// so a user removed from a company between login and token expiry still has
// access for up to a day. Re-check the `users.AssignCompany` array on every
// authenticated request, with a short cache TTL (default 60s) so the cost
// is one Mongo lookup per user-company pair per minute, not per request.
//
// Cache invalidation hook `invalidateMembershipCache(uid, companyId?)` is
// exported so the membership-change flows (add/remove member) can wipe the
// cache and apply changes immediately.
const MEMBERSHIP_CACHE_PREFIX = 'membership:';

const getMembershipCacheTtlSeconds = () => {
    const raw = Number(process.env.MEMBERSHIP_CACHE_TTL_SECONDS);
    if (!Number.isFinite(raw) || raw < 0) return 60;
    return raw;
};

const verifyCompanyMembership = async (uid, companyId) => {
    if (!uid || !companyId) return false;
    if (!OBJECT_ID_PATTERN.test(String(uid)) || !OBJECT_ID_PATTERN.test(String(companyId))) {
        return false;
    }
    const cacheKey = `${MEMBERSHIP_CACHE_PREFIX}${uid}:${companyId}`;
    const cached = myCache.get(cacheKey);
    if (cached === true) return true;
    if (cached === false) return false;
    try {
        const obj = {
            type: dbCollections.USERS,
            data: [{
                _id: new mongoose.Types.ObjectId(String(uid)),
                AssignCompany: String(companyId),
            }],
        };
        const resData = await mongoC.MongoDbCrudOpration(dbCollections.GLOBAL, obj, 'findOne');
        const isMember = !!(resData && resData._id);
        myCache.set(cacheKey, isMember, getMembershipCacheTtlSeconds());
        return isMember;
    } catch (error) {
        logger.error(`verifyCompanyMembership error for uid=${uid} companyId=${companyId}: ${error.message || error}`);
        return false;
    }
};

const invalidateMembershipCache = (uid, companyId) => {
    if (!uid) return;
    if (companyId) {
        myCache.del(`${MEMBERSHIP_CACHE_PREFIX}${uid}:${companyId}`);
        return;
    }
    const prefix = `${MEMBERSHIP_CACHE_PREFIX}${uid}:`;
    myCache.keys()
        .filter((k) => k.indexOf(prefix) === 0)
        .forEach((k) => myCache.del(k));
};


// ── Personal API token (PAT) branch ─────────────────────────────────────
// Modules/ApiTokens issues `ahp_…` tokens (sha256-hashed at rest). API
// clients (MCP server, scripts) send them as `Authorization: Bearer ahp_…`
// plus the usual `companyid` header. JWTs keep the exact same code path as
// before — the PAT branch only triggers on the `ahp_` prefix, which can
// never be a valid JWT, so the web app flow is untouched.

const PAT_READONLY_METHODS = ['GET', 'HEAD', 'OPTIONS'];
// PATs must not manage tokens (no token-mints-token escalation). The
// whoami endpoint is the one exception.
const PAT_BLOCKED_PATH_PREFIX = '/api/v2/api-tokens';
const PAT_ALLOWED_EXCEPTIONS = ['/api/v2/api-tokens/me'];

const verifyApiTokenRequest = async (req, res, next, companyId, rawToken) => {
    try {
        // Lazy require keeps Config/jwt.js independent of module load order.
        const { verifyToken: verifyApiToken, logTokenActivity } = require('../Modules/ApiTokens/controller');

        const path = String(req.originalUrl || req.path || '').split('?')[0];
        if (path.startsWith(PAT_BLOCKED_PATH_PREFIX) && !PAT_ALLOWED_EXCEPTIONS.includes(path)) {
            return res.status(403).json({
                status: false,
                error: 'API tokens cannot manage API tokens. Use the web app session instead.',
                statusText: 'Forbidden',
            });
        }

        const tokenDoc = await verifyApiToken(companyId, rawToken);
        if (!tokenDoc) {
            return res.status(401).json({
                status: false,
                error: 'Invalid, expired or revoked API token',
                statusText: 'Unauthorized',
                isJwtError: true,
            });
        }

        // Same live membership re-check the JWT path performs (BUG-013 / #67).
        const isMember = await verifyCompanyMembership(String(tokenDoc.userId), companyId);
        if (!isMember) {
            return res.status(403).json({
                status: false,
                error: 'You are no longer a member of this company',
                statusText: 'Forbidden',
            });
        }

        const requiredScope = PAT_READONLY_METHODS.includes(req.method) ? 'read' : 'write';
        if (!hasScope(tokenDoc, requiredScope)) {
            return res.status(403).json({
                status: false,
                error: `Token lacks the '${requiredScope}' scope.`,
                statusText: 'Forbidden',
            });
        }

        // Same request identity contract the JWT verifiers establish.
        req.uid = String(tokenDoc.userId);
        req.aud = companyId;
        req.apiToken = tokenDoc;

        // Audit trail — same fire-and-forget logging the public-v1 namespace uses.
        const started = Date.now();
        res.on('finish', () => {
            logTokenActivity(companyId, tokenDoc._id, {
                method: req.method,
                path,
                statusCode: res.statusCode,
                durationMs: Date.now() - started,
                ip: req.ip || '',
            });
        });

        return next();
    } catch (error) {
        logger.error(`PAT auth error: ${error.message || error}`);
        return res.status(401).json({
            status: false,
            error: 'Unauthorized',
            statusText: 'Unauthorized',
            isJwtError: true,
        });
    }
};


const generateToken = (time) => {
    return jwt.sign({}, process.env.JWT_SECRET, {
        algorithm: process.env.JWT_ALGORITHM,
        expiresIn: time || process.env.JWT_EXP,
    });
};


/**
 * generate JWT auth token
 * @param {Object} obj 
 * @returns 
 */
const generateJWTToken = (obj) => {
    const companyIds = [...obj.companyIds];
    delete obj.companyIds;
    logger.info(`companyIds ${companyIds.join(',')}`);
    return jwt.sign({...obj}, process.env.JWT_SECRET, {
        audience: companyIds.join(','),
        algorithm: process.env.JWT_ALGORITHM,
        expiresIn: process.env.JWT_EXP,
    });
};

const removeCacheAndCookie = (key, cacheKey, res, refreshToken) => {
    if (key === "accessToken") {
        res.clearCookie('accessToken');
        return;
    }
    myCache.del(cacheKey);
    res.clearCookie('accessToken');
    res.clearCookie('refreshToken');
    if (typeof refreshToken === 'string' && refreshToken) {
        let obj = {
            type: dbCollections.SESSIONS,
            data: [sessionTokenQuery(refreshToken)]
        }
        mongoC.MongoDbCrudOpration(dbCollections.GLOBAL, obj, "deleteMany").then((resData)=>{
            if (!(resData && resData.deletedCount)) {
                logger.error("refresh token not found");
                return;
            }
        }).catch((error)=>{
            logger.error(`Refresh Token Remove Error ${error.message || error}`);
        })
    }
}

const SESSION_CACHE_SECONDS = 600;

// The client still holds a usable refresh token (its session was rotated elsewhere, or the
// access token predates named sessions), so it is sent to refresh instead of being logged out.
const refuseForRefresh = (res) => res.status(401).json({
    status: false,
    error: 'Token has expired',
    statusText: 'Token has expired',
    isJwtError: true
});

const refuseSession = (res, error, statusText = 'Unauthorized') => {
    res.clearCookie('accessToken');
    res.clearCookie('refreshToken');
    return res.status(401).json({
        status: false,
        error,
        statusText,
        isJwtError: true,
        isRefreshTokenError: true,
        isLogout: true
    });
};

const sessionsQuery = (uid, sid, method) => mongoC.MongoDbCrudOpration(dbCollections.GLOBAL, {
    type: dbCollections.SESSIONS,
    data: [{ _id: new mongoose.Types.ObjectId(sid), userId: uid }]
}, method);

const checkToken = async (isValid, req, res, next) => {
    if (!isValid) {
        removeCacheAndCookie("accessToken", "", res);
        return refuseForRefresh(res);
    }
    req.uid = isValid.uid;
    req.aud = isValid.aud;
    const access = readAccessSession(isValid);
    if (access.kind === 'legacy') return refuseForRefresh(res);
    if (access.kind !== 'session') {
        res.clearCookie('accessToken');
        return res.status(401).json({
            status: false,
            error: "Your session is expired",
            statusText: 'Unauthorized',
            isJwtError: true,
            isRefreshTokenError: true,
            isLogout: true
        });
    }
    const { uid, sid, rti, sexp } = access;
    req.sessionId = sid;
    const cacheKey = sessionCacheKey(uid, sid, rti);
    if (sexp * 1000 <= Date.now()) {
        myCache.del(cacheKey);
        sessionsQuery(uid, sid, "deleteMany").catch((error) => logger.error(`Expired session remove error ${error.message || error}`));
        return refuseSession(res, 'Refresh Token has expired', 'Refresh Token has expired');
    }
    if (!myCache.get(cacheKey)) {
        let session;
        try {
            session = await sessionsQuery(uid, sid, "findOne");
        } catch (error) {
            logger.error(`Session lookup error ${error.message || error}`);
            return refuseSession(res, "Your session is expired");
        }
        if (!(session && session._id)) return refuseSession(res, "Your session is expired");
        if (session.refreshTokenJti !== rti) return refuseForRefresh(res);
        myCache.set(cacheKey, JSON.stringify({ _id: session._id, userId: uid }), SESSION_CACHE_SECONDS);
    }
    return next();
}

/**
 * Verify JWT Auth token is valid or not
 * @param {Object} req
 * @param {Object} res
 * @param {Object} next
 * @returns 
 */
const verifyJWTTokenWithC = async (req, res, next) => {
    try {
        let token = req.headers['x-access-token'] || req.headers['authorization']; // Express headers are auto converted to lowercase
        const companyId = req.headers['companyid'] || "";
        if (!companyId) {
            return res.status(401).json({
                status: false,
                error: 'Company id is required',
                statusText: 'Unauthorized',
                isJwtError: true
            });
        }
        if (!OBJECT_ID_PATTERN.test(companyId)) {
            return res.status(401).json({
                status: false,
                error: 'Invalid company id',
                statusText: 'Unauthorized',
                isJwtError: true
            });
        }
        if (token) {
            if (token.startsWith('Bearer ')) {
                // Remove Bearer from string
                token = token.slice(7, token.length);
            }
            const isValid = jwt.verify(token, process.env.JWT_SECRET);
            if (isValid && isCompanyInAudience(isValid.aud, companyId)) {
                const { uid } = isValid;

                // BUG-013 / #67 fix: re-check membership against the DB
                // (cached) so a user removed from this company loses access
                // within the cache TTL instead of at JWT expiry.
                const isMember = await verifyCompanyMembership(uid, companyId);
                if (!isMember) {
                    return res.status(403).json({
                        status: false,
                        error: 'You are no longer a member of this company',
                        statusText: 'Forbidden',
                        isJwtError: true,
                        isLogout: true,
                    });
                }

                req.uid = uid;
                next();
            } else {
                // Access Denied
                return res.status(401).json({
                    status: false,
                    error: 'Token has expired',
                    statusText: 'Token has expired',
                    isJwtError: true
                });
            }
        } else {
            return res.status(401).json({
                status: false,
                error: 'Unauthorized',
                statusText: 'Unauthorized',
                isJwtError: true
            });
        }
    }
    catch (error) {
        return res.status(401).json({
            status: false,
            error: error.message,
            statusText: 'Unauthorized',
            isJwtError: true
        });
    }
}

const verifyJWTTokenWithCV2 = async (req, res, next) => {
    let token = req.headers['x-access-token'] || req.headers['authorization']; // Express headers are auto converted to lowercase
    const companyId = req.headers['companyid'] || "";
    if (!companyId) {
        return res.status(401).json({
            status: false,
            error: 'Company id is required',
            statusText: 'Unauthorized',
            isJwtError: true
        });
    }
    if (!OBJECT_ID_PATTERN.test(companyId)) {
        return res.status(401).json({
            status: false,
            error: 'Invalid company id',
            statusText: 'Unauthorized',
            isJwtError: true
        });
    }
    if (token) {
        try {
            if (token.startsWith('Bearer ')) {
                // Remove Bearer from string
                token = token.slice(7, token.length);
            }
            // PAT branch: `ahp_…` tokens take the API-token path; JWTs
            // continue through the unchanged session flow below.
            if (looksLikeToken(token)) {
                return verifyApiTokenRequest(req, res, next, companyId, token);
            }
            const isValid = jwt.verify(token, process.env.JWT_SECRET);
            if (!isCompanyInAudience(isValid.aud, companyId)) {
                res.clearCookie('accessToken');
                return res.status(401).json({
                    status: false,
                    error: 'Unauthorized',
                    statusText: 'Unauthorized',
                    isJwtError: true
                });
            }

            // BUG-013 / #67 fix: live membership re-check (cached).
            const isMember = await verifyCompanyMembership(isValid.uid, companyId);
            if (!isMember) {
                res.clearCookie('accessToken');
                return res.status(403).json({
                    status: false,
                    error: 'You are no longer a member of this company',
                    statusText: 'Forbidden',
                    isJwtError: true,
                    isLogout: true,
                });
            }

            checkToken(isValid, req, res, next);
        } catch (error) {
            res.clearCookie('accessToken');
            return res.status(401).json({
                status: false,
                error: 'Unauthorized',
                statusText: 'Unauthorized',
                isJwtError: true
            });
        }
    } else {
        return res.status(401).json({
            status: false,
            error: 'Unauthorized',
            statusText: 'Unauthorized',
            isJwtError: true
        });
    }
}

const verifyJWTToken = (req, res, next) => {
    try {
        let token = req.headers['x-access-token'] || req.headers['authorization']; // Express headers are auto converted to lowercase
        
        if (token) {
            if (token.startsWith('Bearer ')) {
                // Remove Bearer from string
                token = token.slice(7, token.length);
            }
            const isValid = jwt.verify(token, process.env.JWT_SECRET);
            if (isValid) {
                const { uid } = isValid;
                
                req.uid = uid;
                next();
            } else {
                // Access Denied
                return res.status(401).json({
                    status: false,
                    error: 'Token has expired',
                    statusText: 'Token has expired',
                    isJwtError: true
                });
            }
        } else {
            return res.status(401).json({
                status: false,
                error: 'Unauthorized',
                statusText: 'Unauthorized',
                isJwtError: true
            });
        }
    }
    catch (error) {
        return res.status(401).json({
            status: false,
            error: error.message,
            statusText: 'Unauthorized',
            isJwtError: true
        });
    }
}

const verifyJWTTokenV2 = (req, res, next) => {
    let token = req.headers['x-access-token'] || req.headers['authorization']; // Express headers are auto converted to lowercase
    
    if (token) {
        if (token.startsWith('Bearer ')) {
            // Remove Bearer from string
            token = token.slice(7, token.length);
        }

        // PAT branch: these routes don't otherwise require a companyid
        // header, but PATs are stored per-company, so one is required here.
        if (looksLikeToken(token)) {
            const companyId = String(req.headers['companyid'] || '');
            if (!OBJECT_ID_PATTERN.test(companyId)) {
                return res.status(401).json({
                    status: false,
                    error: 'A valid companyid header is required for API token authentication',
                    statusText: 'Unauthorized',
                });
            }
            return verifyApiTokenRequest(req, res, next, companyId, token);
        }

        try {
            const isValid = jwt.verify(token, process.env.JWT_SECRET);
            checkToken(isValid, req, res, next);
        } catch (error) {
            res.clearCookie('accessToken');
            return res.status(401).json({
                status: false,
                error: error.message,
                statusText: 'Unauthorized',
                isJwtError: true
            });
        }
    } else {
        return res.status(401).json({
            status: false,
            error: 'Unauthorized',
            statusText: 'Unauthorized',
            isJwtError: true
        });
    }
}

/**
 * Defense-in-depth check: when a request carries a companyId (in body,
 * path params, query, or the `companyid` header), verify it appears in
 * the JWT audience claim. Routes that legitimately operate without a
 * company scope pass through unchanged.
 *
 * Non-ObjectId candidates (e.g. the global "USER_PROFILES" bucket name
 * used for user profile pictures) pass through too — they aren't real
 * company tenants, and the controllers that accept them have their own
 * authorization for that bucket. Forcing them through this check would
 * 400-block legitimate uploads.
 *
 * Every company the request names is checked, the `companyid` header first: this used to judge
 * the body before the header, while `tenantOf` takes the header before the body, so a request
 * could be judged on one company and then served for another.
 *
 * Applied after `verifyJWTTokenV2` so `req.aud` is already populated.
 */
const requireCompanyAud = (req, res, next) => {
    try {
        const candidates = [
            req.headers && req.headers.companyid,
            req.params && req.params.companyId,
            req.query && req.query.companyId,
            req.body && req.body.companyId,
            req.body && req.body.CompanyId,
        ].map((value) => String(value == null ? '' : value).trim())
            // Non-ObjectId values (special buckets like USER_PROFILES) aren't tenants and have
            // controller-level checks; forcing them through here would block legitimate uploads.
            .filter((value) => OBJECT_ID_PATTERN.test(value));

        if (candidates.some((companyId) => !isCompanyInAudience(req.aud, companyId))) {
            return res.status(403).json({
                status: false,
                error: 'You do not have access to this company',
                statusText: 'Forbidden',
                isJwtError: true,
            });
        }
        return next();
    } catch (error) {
        return res.status(401).json({
            status: false,
            error: error.message,
            statusText: 'Unauthorized',
            isJwtError: true,
        });
    }
};

/**
 * The live membership re-check `verifyJWTTokenWithCV2` does, for the company routes that take
 * their company from the request body and so only ever ran `verifyJWTTokenV2` + `requireCompanyAud`.
 * The audience is frozen at login, so without this a caller removed from the company keeps
 * reaching those handlers with the token they already hold.
 *
 * API-token requests are left alone: `verifyApiTokenRequest` has already re-checked membership.
 */
const requireLiveCompanyMembership = async (req, res, next) => {
    if (req.apiToken) return next();
    try {
        const { namedCompanyIds } = require('./tenant');
        const named = namedCompanyIds(req).filter((companyId) => OBJECT_ID_PATTERN.test(companyId));
        for (const companyId of named) {
            if (!(await verifyCompanyMembership(req.uid, companyId))) {
                return res.status(403).json({
                    status: false,
                    error: 'You are no longer a member of this company',
                    statusText: 'Forbidden',
                    isJwtError: true,
                    isLogout: true,
                });
            }
        }
        return next();
    } catch (error) {
        logger.error(`requireLiveCompanyMembership error for uid=${req.uid}: ${error.message || error}`);
        return res.status(403).json({ status: false, error: 'Forbidden', statusText: 'Forbidden' });
    }
};

const verifyToken = (token) => {
        if (token) {
            try {
                const isValid = jwt.verify(token, process.env.JWT_SECRET);
                return {
                    status: true,
                    isValid
                }
            } catch(error) {
                if (error.name === 'TokenExpiredError') {
                    return {
                        status: false,
                        key: 1,
                        error: 'Token has expired',
                        statusText: 'Token has expired',
                        isJwtError: true
                    };
                } else if (error.name === 'JsonWebTokenError') {
                    return {
                        status: false,
                        key: 2,
                        error: 'Invalid token',
                        statusText: 'Invalid token',
                        isJwtError: true
                    };
                } else {
                    return {
                        status: false,
                        key: 3,
                        error: error.message,
                        statusText: 'Unauthorized',
                        isJwtError: true
                    };
                }
            }
        } else {
            return {
                status: false,
                key: 4,
                error: 'Unauthorized',
                statusText: 'Unauthorized',
                isJwtError: true
            };
        }
}

module.exports = {
    generateToken: generateToken,
    generateJWTToken: generateJWTToken,
    verifyJWTTokenWithC: verifyJWTTokenWithC,
    verifyJWTTokenWithCV2: verifyJWTTokenWithCV2,
    verifyJWTToken: verifyJWTToken,
    verifyJWTTokenV2: verifyJWTTokenV2,
    verifyToken: verifyToken,
    removeCacheAndCookie: removeCacheAndCookie,
    requireCompanyAud: requireCompanyAud,
    requireLiveCompanyMembership: requireLiveCompanyMembership,
    // BUG-013 / #67
    verifyCompanyMembership: verifyCompanyMembership,
    invalidateMembershipCache: invalidateMembershipCache,
    getMembershipCacheTtlSeconds: getMembershipCacheTtlSeconds,
}