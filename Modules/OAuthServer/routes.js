const path = require('path');
const rateLimit = require('express-rate-limit');
const config = require('./config');
const ctrl = require('./controller');
const admin = require('./admin');
const consent = require('./consentController');
const approvalsAdmin = require('./approvalsAdmin');
const personalGrants = require('./personalGrants');

const INDEX_FILE = path.join(__dirname, '..', '..', 'frontend', 'dist', 'index.html');

const limiter = (env) => rateLimit({
    windowMs: 60 * 1000,
    limit: config.rateLimitPerMinute(env),
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => res.status(429).json({ error: 'temporarily_unavailable', error_description: 'too many requests, try again in a minute' }),
});

/* The authorization server's endpoints are public by design: a client reaches them before anyone holds a
 * token, and the token and revocation endpoints authenticate the client themselves. The consent routes take
 * the person's session (the form post carries it as the session cookie, with no companyid header) and check the
 * workspace themselves; the /api/v2 routes are the workspace's or the person's own and check the session inline.
 * With MCP_OAUTH off nothing here exists at all and every one of these paths answers as it does on beta. */
exports.init = (app, env = process.env, { indexFile = INDEX_FILE } = {}) => {
    if (!config.isOn(env)) return;
    config.assertIssuer(env);
    const { verifyJWTTokenWithCV2, verifyJWTTokenV2 } = require('../../Config/jwt');
    const authorizeLimit = limiter(env);
    const tokenLimit = limiter(env);

    app.get('/.well-known/oauth-authorization-server', ctrl.metadata);
    app.get('/oauth/authorize', authorizeLimit, ctrl.authorize);
    app.get('/oauth/consent', authorizeLimit, consent.page(indexFile));
    app.get('/oauth/consent/details', authorizeLimit, verifyJWTTokenV2, consent.details);
    app.post('/oauth/consent', authorizeLimit, verifyJWTTokenV2, consent.answer);
    app.post('/oauth/consent/approval-request', authorizeLimit, verifyJWTTokenV2, consent.requestApproval);
    app.post('/oauth/token', tokenLimit, ctrl.token);
    app.post('/oauth/revoke', tokenLimit, ctrl.revoke);
    if (config.dcrOn(env)) app.post('/oauth/register', limiter(env), ctrl.register);

    app.get('/api/v2/oauth-clients', verifyJWTTokenWithCV2, admin.list);
    app.post('/api/v2/oauth-clients', verifyJWTTokenWithCV2, admin.create);
    app.delete('/api/v2/oauth-clients/:clientId', verifyJWTTokenWithCV2, admin.revoke);

    app.get('/api/v2/oauth-client-approvals', verifyJWTTokenWithCV2, approvalsAdmin.list);
    app.post('/api/v2/oauth-client-approvals/approve', verifyJWTTokenWithCV2, approvalsAdmin.approve);
    app.post('/api/v2/oauth-client-approvals/deny', verifyJWTTokenWithCV2, approvalsAdmin.deny);
    app.post('/api/v2/oauth-client-approvals/revoke', verifyJWTTokenWithCV2, approvalsAdmin.revoke);

    app.get('/api/v2/oauth-grants', verifyJWTTokenWithCV2, personalGrants.list);
    app.delete('/api/v2/oauth-grants/:grantId', verifyJWTTokenWithCV2, personalGrants.revoke);
};
