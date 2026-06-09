/**
 * Screenshot Retention — HTTP layer.
 *
 * Identity sources:
 *   - companyId: the `companyid` request header, validated against the
 *     token's `aud` claim by Config/jwt.js#verifyJWTTokenWithCV2.
 *   - userId: `req.uid`, set by Config/jwt.js#checkToken (line 137) from
 *     the verified token's `uid` claim. NEVER trust `req.body.userId` for
 *     authorisation — a non-owner could pass the owner's userId in the
 *     body and bypass the role check below.
 *
 * The routes are listed in Config/setMiddleware.js#verifyJWTTokenWithCRoute
 * so the JWT middleware fires before any handler here runs.
 *
 * Mutation endpoints (preview, update) require the caller to be a company
 * owner (`roleType === 1` in the per-tenant `company_users` collection).
 * The frontend hides the card from non-owners; this is the defence-in-depth
 * server check.
 */

const helper = require('./helper');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const logger = require('../../Config/loggerConfig');

const ROLE_TYPE_COMPANY_OWNER = 1;

// ----- Common helpers ---------------------------------------------------

function getCallerContext(req) {
    const companyId = req.headers && (req.headers.companyid || req.headers.companyId);
    // `req.uid` is set by Config/jwt.js#checkToken from the verified token.
    // This is the only trustworthy userId source — anything pulled from
    // req.body / req.query / req.params can be forged by the caller.
    const userId = req && req.uid;
    return { companyId, userId };
}

/**
 * Confirm the caller is the company owner. Looks up the per-tenant
 * `company_users` record by userId and checks roleType. Returns true /
 * false; on lookup failure logs and returns false (deny on doubt).
 */
async function isCompanyOwner(companyId, userId) {
    if (!companyId || !userId) return false;
    try {
        const query = {
            type: SCHEMA_TYPE.COMPANY_USERS,
            data: [
                { userId: String(userId) },
                { _id: 1, roleType: 1, userId: 1 }
            ]
        };
        const record = await MongoDbCrudOpration(companyId, query, 'findOne');
        return !!record && Number(record.roleType) === ROLE_TYPE_COMPANY_OWNER;
    } catch (err) {
        logger.error(`[ScreenshotRetention] role check failed companyId=${companyId} userId=${userId} ${err && err.message}`);
        return false;
    }
}

function sendErr(res, statusCode, message) {
    return res.status(statusCode).send({
        status: false,
        statusText: message,
        message
    });
}

// ----- Endpoints --------------------------------------------------------

/**
 * GET /api/v1/screenshot-retention
 * Returns the current policy for the caller's company. Any authenticated
 * caller in the company can read it (the frontend needs to render the
 * current state even for non-owners so they can see whether the policy is
 * active — they just can't change it).
 */
exports.getSettings = async (req, res) => {
    try {
        const { companyId } = getCallerContext(req);
        if (!companyId) return sendErr(res, 400, 'companyId header is required');

        const policy = await helper.getCompanyPolicy(companyId);
        return res.send({
            status: true,
            statusText: 'OK',
            data: {
                policy,
                validMaxAgeMonths: helper.VALID_MAX_AGE_MONTHS
            }
        });
    } catch (err) {
        logger.error(`[ScreenshotRetention] getSettings error: ${err && err.message}`);
        return sendErr(res, 500, err && err.message ? err.message : 'Failed to load settings');
    }
};

/**
 * GET /api/v1/screenshot-retention/preview?maxAgeMonths=N&userId=...
 * Returns { estimatedDeleteCount }. Used to surface a number in the
 * confirmation dialog before flipping the toggle on. Owner-only because
 * counting old trackshots involves a tenant DB aggregation and is non-trivial.
 */
exports.previewDeletion = async (req, res) => {
    try {
        const { companyId, userId } = getCallerContext(req);
        if (!companyId) return sendErr(res, 400, 'companyId header is required');
        if (!userId) return sendErr(res, 401, 'authentication required');

        const ownerOk = await isCompanyOwner(companyId, userId);
        if (!ownerOk) return sendErr(res, 403, 'Only the company owner can preview screenshot retention');

        const requested = Number(req.query && req.query.maxAgeMonths);
        const maxAgeMonths = helper.VALID_MAX_AGE_MONTHS.includes(requested)
            ? requested
            : helper.DEFAULT_MAX_AGE_MONTHS;

        const cutoff = helper.computeCutoff(maxAgeMonths);
        const estimatedDeleteCount = await helper.countOldTrackshots(companyId, cutoff);

        return res.send({
            status: true,
            statusText: 'OK',
            data: {
                maxAgeMonths,
                cutoffIso: cutoff.toISOString(),
                estimatedDeleteCount
            }
        });
    } catch (err) {
        logger.error(`[ScreenshotRetention] previewDeletion error: ${err && err.message}`);
        return sendErr(res, 500, err && err.message ? err.message : 'Failed to preview');
    }
};

/**
 * PUT /api/v1/screenshot-retention
 * Body: { enabled?: boolean, maxAgeMonths?: number, userId: string }
 *
 * Updates the policy. Owner-only. When flipping from disabled→enabled we
 * also stamp `enabledAt` / `enabledBy` so the audit trail is intact.
 */
exports.updateSettings = async (req, res) => {
    try {
        const { companyId, userId } = getCallerContext(req);
        if (!companyId) return sendErr(res, 400, 'companyId header is required');
        if (!userId) return sendErr(res, 401, 'authentication required');

        const ownerOk = await isCompanyOwner(companyId, userId);
        if (!ownerOk) return sendErr(res, 403, 'Only the company owner can change screenshot retention');

        const body = req.body || {};
        const patch = {};
        if (typeof body.enabled === 'boolean') patch.enabled = body.enabled;
        if (body.maxAgeMonths !== undefined) {
            const n = Number(body.maxAgeMonths);
            if (!helper.VALID_MAX_AGE_MONTHS.includes(n)) {
                return sendErr(res, 400, `maxAgeMonths must be one of ${helper.VALID_MAX_AGE_MONTHS.join(', ')}`);
            }
            patch.maxAgeMonths = n;
        }
        if (Object.keys(patch).length === 0) {
            return sendErr(res, 400, 'No supported fields in body');
        }

        // Determine whether we're flipping from disabled → enabled so we can
        // stamp enabledAt / enabledBy. Reading the prior state first is a
        // small extra round-trip but worth the audit clarity.
        const prior = await helper.getCompanyPolicy(companyId);
        const markEnabled = patch.enabled === true && !prior.enabled;

        const updated = await helper.updateCompanyPolicy(companyId, patch, { markEnabled, userId });

        return res.send({
            status: true,
            statusText: 'Screenshot retention updated',
            data: { policy: updated }
        });
    } catch (err) {
        logger.error(`[ScreenshotRetention] updateSettings error: ${err && err.message}`);
        return sendErr(res, 500, err && err.message ? err.message : 'Failed to update settings');
    }
};
