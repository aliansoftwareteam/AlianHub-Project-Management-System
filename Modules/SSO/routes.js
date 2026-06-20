const config = require('./config');
const oidc = require('./oidc');
const saml = require('./saml');

exports.init = (app) => {
    // Admin config — owner/admin enforced in-controller (holds IdP secrets).
    app.get('/api/v2/sso/config', config.getSsoConfig);
    app.put('/api/v2/sso/config', config.setSsoConfig);

    // Login page — unauthenticated, secret-free (must be auth-exempt).
    app.get('/api/v2/sso/public', config.getPublicSsoConfig);

    // OIDC login flow (pre-auth; must be auth-exempt).
    app.get('/api/v2/sso/oidc/initiate', oidc.oidcInitiate);
    app.get('/api/v2/sso/oidc/callback', oidc.oidcCallback);

    // SAML login flow (pre-auth; must be auth-exempt).
    app.get('/api/v2/sso/saml/initiate', saml.samlInitiate);
    app.post('/api/v2/sso/saml/acs', saml.samlAcs);
    app.get('/api/v2/sso/saml/metadata', saml.samlMetadata);
}
