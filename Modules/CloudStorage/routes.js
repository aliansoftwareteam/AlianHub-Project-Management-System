const rateLimit = require('express-rate-limit');
const ctrl = require('./controller');

// The OAuth callback is public (see controller.oauthCallback), so it gets its own
// limiter — signature verification is cheap but not free, and this endpoint is
// reachable without a token.
const callbackLimiter = rateLimit({ windowMs: 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false });
// Importing streams bytes from a third party; keep it modest per user.
const importLimiter = rateLimit({ windowMs: 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false });

exports.init = (app) => {
    // PUBLIC — a browser redirect from the provider, so no JWT and no companyid
    // header exist; the signed `state` is the identity.
    //
    // It lives OUTSIDE /api/v1/cloud-storage on purpose. setMiddleware protects
    // that prefix, and Express `app.use` is prefix-matching, so any path under it
    // would demand a JWT the provider cannot send. Same reason the Slack webhook
    // sits at /api/v1/slack/command rather than under /api/v1/integrations.
    app.get('/api/v1/cloud-oauth/callback', callbackLimiter, ctrl.oauthCallback);

    // JWT + companyId (setMiddleware protects /api/v1/cloud-storage).
    //
    // The /settings routes are registered BEFORE the /:provider ones so
    // "settings" is never captured as a provider name.
    app.get('/api/v1/cloud-storage/settings', ctrl.getSettings);
    app.put('/api/v1/cloud-storage/settings/:provider', ctrl.saveSettings);
    app.delete('/api/v1/cloud-storage/settings/:provider', ctrl.clearSettings);

    app.get('/api/v1/cloud-storage/providers', ctrl.listProviders);
    app.get('/api/v1/cloud-storage/:provider/auth-url', ctrl.authUrl);
    app.get('/api/v1/cloud-storage/:provider/token', ctrl.pickerToken);
    app.post('/api/v1/cloud-storage/:provider/import', importLimiter, ctrl.importFile);
    app.delete('/api/v1/cloud-storage/:provider', ctrl.disconnect);
};
