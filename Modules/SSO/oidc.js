const { SCHEMA_TYPE } = require("../../Config/schemaType");
const { MongoDbCrudOpration } = require("../../utils/mongo-handler/mongoQueries");
const { myCache } = require("../../Config/config");
const logger = require("../../Config/loggerConfig");
const { extractIdentity } = require("./helpers/ssoRules");
const { jitProvisionUser } = require("./provisioning");
const { finalizeSsoSession } = require("./ssoSession");

// `openid-client` is lazy-required so app load never breaks before `npm install`.
const apiBase = () => String(process.env.APIURL || '').replace(/\/$/, '');
const REDIRECT_URI = () => `${apiBase()}/api/v2/sso/oidc/callback`;

const loadConfig = async (companyId) => MongoDbCrudOpration(companyId, {
    type: SCHEMA_TYPE.SSO_CONFIGS, data: [{ deletedStatusKey: 0, isEnabled: true }],
}, 'findOne');

const buildClient = async (cfg) => {
    const { Issuer } = require('openid-client');
    const o = cfg.oidc || {};
    const issuer = o.discoveryUrl
        ? await Issuer.discover(o.discoveryUrl)
        : new Issuer({
            issuer: o.issuer,
            authorization_endpoint: o.authorizationEndpoint,
            token_endpoint: o.tokenEndpoint,
            jwks_uri: o.jwksUri,
            userinfo_endpoint: o.userinfoEndpoint,
        });
    return new issuer.Client({
        client_id: o.clientId,
        client_secret: o.clientSecret,
        redirect_uris: [REDIRECT_URI()],
        response_types: ['code'],
    });
};

/* GET /api/v2/sso/oidc/initiate?companyId= — redirect the user to the IdP. */
exports.oidcInitiate = async (req, res) => {
    try {
        const companyId = req.query.companyId || req.headers['companyid'];
        if (!companyId) return res.status(400).send('companyId is required');
        const cfg = await loadConfig(companyId);
        if (!cfg || cfg.provider !== 'oidc') return res.status(404).send('OIDC SSO is not configured for this company');
        const { generators } = require('openid-client');
        const client = await buildClient(cfg);
        const state = generators.state();
        const nonce = generators.nonce();
        const codeVerifier = generators.codeVerifier();
        const codeChallenge = generators.codeChallenge(codeVerifier);
        // CSRF (state) + nonce + PKCE verifier, consumed once on callback (5 min TTL).
        myCache.set(`sso:oidc:${state}`, { companyId: String(companyId), nonce, codeVerifier }, 300);
        const url = client.authorizationUrl({
            scope: (cfg.oidc && cfg.oidc.scopes) || 'openid email profile',
            state,
            nonce,
            code_challenge: codeChallenge,
            code_challenge_method: 'S256',
        });
        return res.redirect(url);
    } catch (error) {
        logger.error(`oidcInitiate: ${error.message || error}`);
        return res.redirect('/login?ssoError=initiate');
    }
};

/* GET /api/v2/sso/oidc/callback — validate, JIT-provision, establish session. */
exports.oidcCallback = async (req, res) => {
    try {
        const params = req.query || {};
        const cached = params.state ? myCache.get(`sso:oidc:${params.state}`) : null;
        if (!cached) return res.redirect('/login?ssoError=state');
        myCache.del(`sso:oidc:${params.state}`); // single-use → replay protection
        const { companyId, nonce, codeVerifier } = cached;
        const cfg = await loadConfig(companyId);
        if (!cfg || cfg.provider !== 'oidc') return res.redirect('/login?ssoError=config');
        const client = await buildClient(cfg);
        const tokenSet = await client.callback(REDIRECT_URI(), params, { state: params.state, nonce, code_verifier: codeVerifier });
        const id = extractIdentity(tokenSet.claims(), (cfg.oidc && cfg.oidc.claimMap) || {});
        if (!id.valid) return res.redirect('/login?ssoError=identity');
        const uid = await jitProvisionUser({
            companyId,
            email: id.email,
            firstName: id.firstName,
            lastName: id.lastName,
            externalId: id.externalId,
            defaultRoleType: cfg.defaultRoleType,
            autoProvision: cfg.autoProvisionUsers !== false,
        });
        return finalizeSsoSession(req, res, uid, `/${companyId}`);
    } catch (error) {
        logger.error(`oidcCallback: ${error.message || error}`);
        return res.redirect('/login?ssoError=callback');
    }
};
