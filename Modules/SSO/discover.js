const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { dbCollections } = require('../../Config/collections');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const logger = require('../../Config/loggerConfig');
const { domainOfEmail, isVerifiedDomain } = require('./helpers/ssoRules');

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

/* GET /api/v2/sso/discover?email= — unauthenticated. Answers from the email's domain alone, and only for a
 * domain a company verified, so the reply is the same for every address on it, registered or not. */
exports.discover = async (req, res) => {
    try {
        const email = String((req.query && req.query.email) || '').trim().toLowerCase();
        const domain = domainOfEmail(email);
        if (!email || !domain) return res.status(400).json({ status: false, message: 'email is required' });

        const companies = await MongoDbCrudOpration('global', {
            type: dbCollections.COMPANIES,
            data: [{ isDisable: { $in: [false, undefined] } }, {}, { limit: MAX_COMPANIES }]
        }, 'find');
        for (const company of companies || []) {
            const cfg = await loadEnabledConfig(company._id);
            if (cfg && isVerifiedDomain(cfg, domain)) return res.send({ status: true, data: describe(company, cfg) });
        }
        return res.status(404).json({ status: false, message: 'No SSO provider is configured for this email.' });
    } catch (error) {
        logger.error(`sso discover: ${error.message || error}`);
        return res.status(500).json({ status: false, message: error.message });
    }
};
