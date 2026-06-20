const { SCHEMA_TYPE } = require("../../Config/schemaType");
const { MongoDbCrudOpration } = require("../../utils/mongo-handler/mongoQueries");
const logger = require("../../Config/loggerConfig");
const { extractIdentity } = require("./helpers/ssoRules");
const { jitProvisionUser } = require("./provisioning");
const { finalizeSsoSession } = require("./ssoSession");

// `samlify` (+ its schema validator) are lazy-required so app load never breaks
// before `npm install`. SAML responses MUST be signature-validated — samlify
// requires a schema validator to be registered before parseLoginResponse.
const apiBase = () => String(process.env.APIURL || '').replace(/\/$/, '');

let validatorReady = false;
const ensureValidator = () => {
    if (validatorReady) return;
    const samlify = require('samlify');
    try {
        samlify.setSchemaValidator(require('@authenio/samlify-node-saml2'));
    } catch (e) {
        logger.error(`samlify schema validator missing — install @authenio/samlify-node-saml2: ${e.message || e}`);
        throw new Error('SAML validator not available on the server');
    }
    validatorReady = true;
};

const loadConfig = async (companyId) => MongoDbCrudOpration(companyId, {
    type: SCHEMA_TYPE.SSO_CONFIGS, data: [{ deletedStatusKey: 0, isEnabled: true }],
}, 'findOne');

const buildSp = (companyId) => {
    const samlify = require('samlify');
    return samlify.ServiceProvider({
        entityID: `${apiBase()}/api/v2/sso/saml/metadata?companyId=${companyId}`,
        assertionConsumerService: [{
            Binding: samlify.Constants.namespace.binding.post,
            Location: `${apiBase()}/api/v2/sso/saml/acs?companyId=${companyId}`,
        }],
        wantAssertionsSigned: true,
        allowCreate: true,
    });
};

const buildIdp = (cfg) => {
    const samlify = require('samlify');
    const s = cfg.saml || {};
    return samlify.IdentityProvider({
        entityID: s.entityId || s.entryPoint,
        singleSignOnService: [{ Binding: samlify.Constants.namespace.binding.redirect, Location: s.entryPoint }],
        signingCert: s.idpCert,
    });
};

/* GET /api/v2/sso/saml/initiate?companyId= — redirect to the IdP. */
exports.samlInitiate = async (req, res) => {
    try {
        const companyId = req.query.companyId || req.headers['companyid'];
        if (!companyId) return res.status(400).send('companyId is required');
        const cfg = await loadConfig(companyId);
        if (!cfg || cfg.provider !== 'saml') return res.status(404).send('SAML SSO is not configured for this company');
        const sp = buildSp(companyId);
        const idp = buildIdp(cfg);
        const { context } = sp.createLoginRequest(idp, 'redirect');
        return res.redirect(context);
    } catch (error) {
        logger.error(`samlInitiate: ${error.message || error}`);
        return res.redirect('/login?ssoError=initiate');
    }
};

/* POST /api/v2/sso/saml/acs?companyId= — IdP posts the signed assertion here. */
exports.samlAcs = async (req, res) => {
    try {
        const companyId = req.query.companyId || (req.body && req.body.companyId);
        if (!companyId) return res.redirect('/login?ssoError=config');
        const cfg = await loadConfig(companyId);
        if (!cfg || cfg.provider !== 'saml') return res.redirect('/login?ssoError=config');
        ensureValidator();
        const sp = buildSp(companyId);
        const idp = buildIdp(cfg);
        const { extract } = await sp.parseLoginResponse(idp, 'post', req); // validates signature
        const claims = { ...(extract.attributes || {}), nameID: extract.nameID };
        const id = extractIdentity(claims, (cfg.saml && cfg.saml.attributeMap) || {});
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
        logger.error(`samlAcs: ${error.message || error}`);
        return res.redirect('/login?ssoError=callback');
    }
};

/* GET /api/v2/sso/saml/metadata?companyId= — SP metadata for the IdP admin. */
exports.samlMetadata = async (req, res) => {
    try {
        const companyId = req.query.companyId || req.headers['companyid'];
        if (!companyId) return res.status(400).send('companyId is required');
        const sp = buildSp(companyId);
        res.type('application/xml');
        return res.status(200).send(sp.getMetadata());
    } catch (error) {
        logger.error(`samlMetadata: ${error.message || error}`);
        return res.status(500).send('metadata error');
    }
};
