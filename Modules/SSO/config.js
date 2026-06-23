const { SCHEMA_TYPE } = require("../../Config/schemaType");
const { MongoDbCrudOpration } = require("../../utils/mongo-handler/mongoQueries");
const { getRoleType, isPrivileged } = require("../../Config/permissionGuard");
const { validateSsoConfig, publicSsoView } = require("./helpers/ssoRules");
const logger = require("../../Config/loggerConfig");

const companyOf = (req) => req.headers['companyid'] || (req.body && req.body.companyId) || (req.query && req.query.companyId);

// SSO config holds IdP secrets — only owner/admin may read/write it.
const callerIsAdmin = async (req) => {
    const roleType = await getRoleType(companyOf(req), req.uid);
    return isPrivileged(roleType);
};

/* GET /api/v2/sso/config — owner/admin: the full config (incl. secrets they own). */
exports.getSsoConfig = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId) return res.send({ status: false, statusText: 'companyId is required.' });
        if (!(await callerIsAdmin(req))) return res.status(403).json({ status: false, statusText: 'Owner/admin only.' });
        const cfg = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.SSO_CONFIGS, data: [{ deletedStatusKey: 0 }] }, 'findOne');
        return res.send({ status: true, statusText: 'OK', data: cfg || null });
    } catch (error) {
        logger.error(`getSsoConfig: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};

/* PUT /api/v2/sso/config — owner/admin: upsert the config. */
exports.setSsoConfig = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId) return res.send({ status: false, statusText: 'companyId is required.' });
        if (!(await callerIsAdmin(req))) return res.status(403).json({ status: false, statusText: 'Owner/admin only.' });
        const { provider, oidc, saml, isEnabled, autoProvisionUsers, defaultRoleType } = req.body || {};
        const check = validateSsoConfig({ provider, oidc, saml });
        if (!check.valid) return res.send({ status: false, statusText: check.reason });
        const actor = String(req.uid || '');
        const set = {
            provider: String(provider),
            oidc: provider === 'oidc' ? (oidc || {}) : {},
            saml: provider === 'saml' ? (saml || {}) : {},
            isEnabled: isEnabled !== false,
            autoProvisionUsers: autoProvisionUsers !== false,
            defaultRoleType: Number(defaultRoleType) || 3,
            updatedBy: actor,
            deletedStatusKey: 0,
        };
        const saved = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.SSO_CONFIGS,
            data: [
                { deletedStatusKey: 0 },
                { $set: set, $setOnInsert: { createdBy: actor } },
                { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
            ],
        }, 'findOneAndUpdate');
        // SEC-04: audit SSO config changes.
        try {
            require('../Audit/recorder').recordAuditFromReq(req, {
                action: 'sso.config_update', entityType: 'sso', meta: { provider: set.provider, isEnabled: set.isEnabled },
            });
        } catch (e) { /* audit is best-effort */ }
        return res.send({ status: true, statusText: 'SSO config saved.', data: saved });
    } catch (error) {
        logger.error(`setSsoConfig: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};

/* GET /api/v2/sso/public?companyId= — unauthenticated; login page only. No secrets. */
exports.getPublicSsoConfig = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId) return res.send({ status: false, statusText: 'companyId is required.' });
        const cfg = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.SSO_CONFIGS, data: [{ deletedStatusKey: 0, isEnabled: true }],
        }, 'findOne');
        return res.send({ status: true, statusText: 'OK', data: publicSsoView(cfg) });
    } catch (error) {
        return res.send({ status: false, statusText: error.message });
    }
};
