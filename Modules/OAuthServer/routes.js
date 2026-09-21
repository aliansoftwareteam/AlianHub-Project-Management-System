const rateLimit = require('express-rate-limit');
const config = require('./config');
const ctrl = require('./controller');
const admin = require('./admin');

const limiter = (env) => rateLimit({
    windowMs: 60 * 1000,
    limit: config.rateLimitPerMinute(env),
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => res.status(429).json({ error: 'temporarily_unavailable', error_description: 'too many requests, try again in a minute' }),
});

/* The authorization server's endpoints are public by design: a client reaches them before anyone holds a
 * token, and the token and revocation endpoints authenticate the client themselves. The admin routes are
 * the workspace's own and check the session inline, so with MCP_OAUTH off nothing here exists at all and
 * every one of these paths answers as it does on beta. */
exports.init = (app, env = process.env) => {
    if (!config.isOn(env)) return;
    config.assertIssuer(env);
    const { verifyJWTTokenWithCV2 } = require('../../Config/jwt');
    const authorizeLimit = limiter(env);
    const tokenLimit = limiter(env);

    app.get('/.well-known/oauth-authorization-server', ctrl.metadata);
    app.get('/oauth/authorize', authorizeLimit, ctrl.authorize);
    app.post('/oauth/token', tokenLimit, ctrl.token);
    app.post('/oauth/revoke', tokenLimit, ctrl.revoke);
    if (config.dcrOn(env)) app.post('/oauth/register', limiter(env), ctrl.register);

    app.get('/api/v2/oauth-clients', verifyJWTTokenWithCV2, admin.list);
    app.post('/api/v2/oauth-clients', verifyJWTTokenWithCV2, admin.create);
    app.delete('/api/v2/oauth-clients/:clientId', verifyJWTTokenWithCV2, admin.revoke);
};
