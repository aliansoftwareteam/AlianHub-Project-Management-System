const crypto = require("crypto");
const { SCHEMA_TYPE } = require("../../Config/schemaType");
const { MongoDbCrudOpration } = require("../../utils/mongo-handler/mongoQueries");
const { getRoleType, isPrivileged } = require("../../Config/permissionGuard");
const {
    validateSsoConfig, publicSsoView, normalizeDomain, normalizeDomains, domainTxtRecord, txtRecordsInclude,
    keepVerifications, keepLapses, domainRecordsOf,
} = require("./helpers/ssoRules");
const { resolveTxt } = require("./helpers/dnsTxt");
const logger = require("../../Config/loggerConfig");

const companyOf = (req) => req.headers['companyid'] || (req.body && req.body.companyId) || (req.query && req.query.companyId);

// SSO config holds IdP secrets — only owner/admin may read/write it.
const callerIsAdmin = async (req) => {
    const roleType = await getRoleType(companyOf(req), req.uid);
    return isPrivileged(roleType);
};

const plain = (doc) => (doc && typeof doc.toObject === 'function' ? doc.toObject() : doc);
const newVerificationToken = () => crypto.randomBytes(20).toString('hex');

const loadConfig = async (companyId) => plain(await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.SSO_CONFIGS, data: [{ deletedStatusKey: 0 }] }, 'findOne'));

const updateConfig = async (companyId, set) => plain(await MongoDbCrudOpration(companyId, {
    type: SCHEMA_TYPE.SSO_CONFIGS,
    data: [{ deletedStatusKey: 0 }, { $set: set }, { returnDocument: 'after' }],
}, 'findOneAndUpdate'));

/* Configs saved before domain verification existed get their token on first read. */
const withToken = async (companyId, cfg) => {
    if (!cfg || cfg.domainVerificationToken) return cfg;
    return (await updateConfig(companyId, { domainVerificationToken: newVerificationToken() })) || cfg;
};

const adminView = (cfg) => (cfg ? { ...cfg, domainRecords: domainRecordsOf(cfg) } : null);

/* GET /api/v2/sso/config — owner/admin: the full config (incl. secrets they own). */
exports.getSsoConfig = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId) return res.send({ status: false, statusText: 'companyId is required.' });
        if (!(await callerIsAdmin(req))) return res.status(403).json({ status: false, statusText: 'Owner/admin only.' });
        const cfg = await withToken(companyId, await loadConfig(companyId));
        return res.send({ status: true, statusText: 'OK', data: adminView(cfg) });
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
        const { provider, oidc, saml, isEnabled, autoProvisionUsers, defaultRoleType, displayName, domains, enforcement } = req.body || {};
        const check = validateSsoConfig({ provider, oidc, saml });
        if (!check.valid) return res.send({ status: false, statusText: check.reason });
        const actor = String(req.uid || '');
        const existing = await loadConfig(companyId);
        const listedDomains = normalizeDomains(domains);
        const set = {
            provider: String(provider),
            oidc: provider === 'oidc' ? (oidc || {}) : {},
            saml: provider === 'saml' ? (saml || {}) : {},
            isEnabled: isEnabled !== false,
            autoProvisionUsers: autoProvisionUsers !== false,
            defaultRoleType: Number(defaultRoleType) || 3,
            displayName: String(displayName || '').slice(0, 80),
            domains: listedDomains,
            domainVerificationToken: (existing && existing.domainVerificationToken) || newVerificationToken(),
            verifiedDomains: keepVerifications(existing && existing.verifiedDomains, listedDomains),
            lapsedDomains: keepLapses(existing && existing.lapsedDomains, listedDomains, existing && existing.verifiedDomains),
            enforcement: ['optional', 'required', 'required_except_guests'].includes(enforcement) ? enforcement : 'optional',
            updatedBy: actor,
            deletedStatusKey: 0,
        };
        const saved = plain(await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.SSO_CONFIGS,
            data: [
                { deletedStatusKey: 0 },
                { $set: set, $setOnInsert: { createdBy: actor } },
                { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
            ],
        }, 'findOneAndUpdate'));
        // SEC-04: audit SSO config changes.
        try {
            require('../Audit/recorder').recordAuditFromReq(req, {
                action: 'sso.config_update', entityType: 'sso', meta: { provider: set.provider, isEnabled: set.isEnabled },
            });
        } catch (e) { /* audit is best-effort */ }
        return res.send({ status: true, statusText: 'SSO config saved.', data: adminView(saved) });
    } catch (error) {
        logger.error(`setSsoConfig: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};

/* POST /api/v2/sso/config/verify-domain — owner/admin: check the TXT record of one listed domain. */
exports.verifySsoDomain = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId) return res.send({ status: false, statusText: 'companyId is required.' });
        if (!(await callerIsAdmin(req))) return res.status(403).json({ status: false, statusText: 'Owner/admin only.' });
        const domain = normalizeDomain(req.body && req.body.domain);
        const cfg = await withToken(companyId, await loadConfig(companyId));
        if (!cfg || !normalizeDomains(cfg.domains).includes(domain)) {
            return res.send({ status: false, statusText: 'Add the domain to the SSO config and save it before verifying.' });
        }
        const record = domainTxtRecord(domain, cfg.domainVerificationToken);
        const records = await resolveTxt(record.name).catch(() => []);
        if (!txtRecordsInclude(records, record.value)) {
            return res.send({ status: false, statusText: 'The TXT record was not found. DNS changes can take a while to appear.', data: { domain, ...record } });
        }
        const verifiedAt = new Date();
        const verifiedDomains = [...keepVerifications(cfg.verifiedDomains, cfg.domains).filter((v) => v.domain !== domain), { domain, verifiedAt }];
        const lapsedDomains = keepLapses(cfg.lapsedDomains, cfg.domains, verifiedDomains);
        const saved = await updateConfig(companyId, { verifiedDomains, lapsedDomains });
        try {
            require('../Audit/recorder').recordAuditFromReq(req, { action: 'sso.domain_verified', entityType: 'sso', entityName: domain });
        } catch (e) { /* audit is best-effort */ }
        return res.send({ status: true, statusText: 'Domain verified.', data: adminView(saved) });
    } catch (error) {
        logger.error(`verifySsoDomain: ${error.message}`);
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
