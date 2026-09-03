const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { dbCollections } = require('../../Config/collections');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const logger = require('../../Config/loggerConfig');

const MAX_COMPANIES = 200;

const loadEnabledConfig = async (companyId) => {
    try {
        return await MongoDbCrudOpration(String(companyId), {
            type: SCHEMA_TYPE.SSO_CONFIGS, data: [{ deletedStatusKey: 0, isEnabled: true }]
        }, 'findOne');
    } catch {
        return null;
    }
};

const hostOf = (url) => { try { return new URL(url).host; } catch { return ''; } };

const describe = (company, cfg) => {
    const oidc = cfg.oidc || {};
    const saml = cfg.saml || {};
    const issuer = cfg.provider === 'saml' ? (saml.entryPoint || saml.ssoUrl || '') : (oidc.issuer || oidc.discoveryUrl || '');
    return {
        companyId: String(company._id),
        companyName: company.Cst_CompanyName || '',
        provider: cfg.provider,
        providerName: cfg.displayName || hostOf(issuer) || (cfg.provider === 'saml' ? 'SAML' : 'OIDC'),
        issuerHost: hostOf(issuer),
        enforcement: cfg.enforcement || 'optional'
    };
};

const domainMatches = (cfg, domain) => Array.isArray(cfg.domains) && cfg.domains.map((d) => String(d).toLowerCase().trim()).includes(domain);

/* GET /api/v2/sso/discover?email= — unauthenticated. Finds the workspace whose SSO should handle this email. */
exports.discover = async (req, res) => {
    try {
        const email = String((req.query && req.query.email) || '').trim().toLowerCase();
        const domain = email.split('@')[1];
        if (!email || !domain) return res.status(400).json({ status: false, message: 'email is required' });

        const user = await MongoDbCrudOpration('global', { type: dbCollections.USERS, data: [{ Employee_Email: email }] }, 'findOne');
        const candidateIds = [];
        if (user && Array.isArray(user.AssignCompany)) {
            if (user.lastSelectedCompany) candidateIds.push(String(user.lastSelectedCompany));
            user.AssignCompany.forEach((id) => { if (!candidateIds.includes(String(id))) candidateIds.push(String(id)); });
        }
        const companies = await MongoDbCrudOpration('global', {
            type: dbCollections.COMPANIES,
            data: [{ isDisable: { $in: [false, undefined] } }, {}, { limit: MAX_COMPANIES }]
        }, 'find');
        const byId = new Map((companies || []).map((c) => [String(c._id), c]));

        for (const id of candidateIds) {
            const company = byId.get(id);
            if (!company) continue;
            const cfg = await loadEnabledConfig(id);
            if (cfg) return res.send({ status: true, data: describe(company, cfg) });
        }
        for (const company of companies || []) {
            if (candidateIds.includes(String(company._id))) continue;
            const cfg = await loadEnabledConfig(company._id);
            if (cfg && domainMatches(cfg, domain)) return res.send({ status: true, data: describe(company, cfg) });
        }
        return res.status(404).json({ status: false, message: 'No SSO provider is configured for this email.' });
    } catch (error) {
        logger.error(`sso discover: ${error.message || error}`);
        return res.status(500).json({ status: false, message: error.message });
    }
};

exports.objectId = (id) => new mongoose.Types.ObjectId(id);
