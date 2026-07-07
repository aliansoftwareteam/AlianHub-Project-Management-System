/**
 * Auto-close inactive projects — HTTP layer (AHE-3798).
 *
 * Mirrors ScreenshotRetention/controller.js:
 *   - companyId from the `companyid` header (validated against the token aud
 *     by Config/jwt.js).
 *   - userId from req.uid (set by the JWT middleware) — never trust the body.
 *   - GET is readable by any authenticated member; PUT is company-owner-only
 *     (roleType 1 in the per-tenant company_users collection). The frontend
 *     hides the card from non-owners; this is the defence-in-depth check.
 */

const helper = require('./helper');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const logger = require('../../Config/loggerConfig');

function getCallerContext(req) {
    const companyId = req.headers && (req.headers.companyid || req.headers.companyId);
    const userId = req && req.uid; // set by Config/jwt.js — the only trustworthy source
    return { companyId, userId };
}

async function isCompanyOwner(companyId, userId) {
    if (!companyId || !userId) return false;
    try {
        const record = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.COMPANY_USERS,
            data: [{ userId: String(userId) }, { _id: 1, roleType: 1 }],
        }, 'findOne');
        // Owner (1) or Admin (2) may manage this setting.
        return !!record && [1, 2].includes(Number(record.roleType));
    } catch (err) {
        logger.error(`[autoCloseProjects] role check failed companyId=${companyId} userId=${userId} ${err && err.message}`);
        return false;
    }
}

function sendErr(res, statusCode, message) {
    return res.status(statusCode).send({ status: false, statusText: message, message });
}

/* GET /api/v1/project-close — current policy (any authenticated member). */
exports.getSettings = async (req, res) => {
    try {
        const { companyId } = getCallerContext(req);
        if (!companyId) return sendErr(res, 400, 'companyId header is required');
        const policy = await helper.getCompanyPolicy(companyId);
        return res.send({
            status: true,
            statusText: 'OK',
            data: { policy, validInactiveMonths: helper.VALID_INACTIVE_MONTHS },
        });
    } catch (err) {
        logger.error(`[autoCloseProjects] getSettings error: ${err && err.message}`);
        return sendErr(res, 500, err && err.message ? err.message : 'Failed to load settings');
    }
};

/* PUT /api/v1/project-close  body: { enabled?, inactiveMonths?, userId } — owner-only. */
exports.updateSettings = async (req, res) => {
    try {
        const { companyId, userId } = getCallerContext(req);
        if (!companyId) return sendErr(res, 400, 'companyId header is required');
        if (!userId) return sendErr(res, 401, 'authentication required');

        const ownerOk = await isCompanyOwner(companyId, userId);
        if (!ownerOk) return sendErr(res, 403, 'Only an owner or admin can change auto-close settings');

        const body = req.body || {};
        const patch = {};
        if (typeof body.enabled === 'boolean') patch.enabled = body.enabled;
        if (body.inactiveMonths !== undefined) {
            const n = Number(body.inactiveMonths);
            if (!helper.VALID_INACTIVE_MONTHS.includes(n)) {
                return sendErr(res, 400, `inactiveMonths must be one of ${helper.VALID_INACTIVE_MONTHS.join(', ')}`);
            }
            patch.inactiveMonths = n;
        }
        if (Object.keys(patch).length === 0) return sendErr(res, 400, 'No supported fields in body');

        const prior = await helper.getCompanyPolicy(companyId);
        const markEnabled = patch.enabled === true && !prior.enabled;
        const updated = await helper.updateCompanyPolicy(companyId, patch, { markEnabled, userId });
        return res.send({ status: true, statusText: 'Auto-close settings updated', data: { policy: updated } });
    } catch (err) {
        logger.error(`[autoCloseProjects] updateSettings error: ${err && err.message}`);
        return sendErr(res, 500, err && err.message ? err.message : 'Failed to update settings');
    }
};
