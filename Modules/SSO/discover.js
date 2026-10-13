const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { dbCollections } = require('../../Config/collections');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { myCache } = require('../../Config/config');
const { removeCache } = require('../../utils/commonFunctions');
const logger = require('../../Config/loggerConfig');
const { domainOfEmail, isVerifiedDomain, verifiedDomainsOf } = require('./helpers/ssoRules');

const MAX_COMPANIES = 200;
const SSO_ON_INSTANCE_KEY = 'sso:instance-has-connection';
const SSO_ON_INSTANCE_TTL_SECONDS = 60;

const loadEnabledConfig = async (companyId) => {
    try {
        return await MongoDbCrudOpration(String(companyId), {
            type: SCHEMA_TYPE.SSO_CONFIGS, data: [{ deletedStatusKey: 0, isEnabled: true }]
        }, 'findOne');
    } catch {
        return null;
    }
};

const searchableCompanies = async () => (await MongoDbCrudOpration('global', {
    type: dbCollections.COMPANIES,
    data: [{ isDisable: { $in: [false, undefined] } }, {}, { limit: MAX_COMPANIES }]
}, 'find')) || [];

const anyDiscoverableConnection = async () => {
    for (const company of await searchableCompanies()) {
        if (verifiedDomainsOf(await loadEnabledConfig(company._id)).length) return true;
    }
    return false;
};

let scan = null;

/* Whether discovery can answer for any address at all. The configs live one per tenant database and the login page
 * asks on every load, so the answer is cached, and a scan cleared mid-flight by a save never writes its stale result. */
const ssoOnInstance = () => {
    const cached = myCache.get(SSO_ON_INSTANCE_KEY);
    if (typeof cached === 'boolean') return Promise.resolve(cached);
    if (!scan) {
        const current = anyDiscoverableConnection()
            .then((found) => {
                if (scan === current) myCache.set(SSO_ON_INSTANCE_KEY, found, SSO_ON_INSTANCE_TTL_SECONDS);
                return found;
            })
            .finally(() => { if (scan === current) scan = null; });
        scan = current;
    }
    return scan;
};

const forgetSsoOnInstance = () => {
    scan = null;
    removeCache(SSO_ON_INSTANCE_KEY);
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

        for (const company of await searchableCompanies()) {
            const cfg = await loadEnabledConfig(company._id);
            if (cfg && isVerifiedDomain(cfg, domain)) return res.send({ status: true, data: describe(company, cfg) });
        }
        return res.status(404).json({ status: false, message: 'No SSO provider is configured for this email.' });
    } catch (error) {
        logger.error(`sso discover: ${error.message || error}`);
        return res.status(500).json({ status: false, message: error.message });
    }
};

exports.ssoOnInstance = ssoOnInstance;
exports.forgetSsoOnInstance = forgetSsoOnInstance;
