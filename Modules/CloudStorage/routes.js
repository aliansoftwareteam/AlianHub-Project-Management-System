const rateLimit = require('express-rate-limit');
const logger = require('../../Config/loggerConfig');
const ctrl = require('./controller');

// The OAuth callback is public (see controller.oauthCallback), so it gets its own
// limiter — signature verification is cheap but not free, and this endpoint is
// reachable without a token.
const callbackLimiter = rateLimit({ windowMs: 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false });
// Importing streams bytes from a third party; keep it modest per user.
const importLimiter = rateLimit({ windowMs: 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false });

/**
 * Error boundary for every handler in this module. NOTHING here may take the
 * server down.
 *
 * index.js registers `process.on('unhandledRejection', … process.exit(1))`, so a
 * single throw inside an async Express handler kills the whole process — Express 4
 * does not catch async rejections. That is exactly what happened once already: a
 * `provider` reference in a catch block was out of scope, the ReferenceError
 * rejected, and the server died on the first failing thumbnail lookup.
 *
 * Auditing each handler is necessary but not sufficient — it only holds until the
 * next edit. This wrapper makes the guarantee structural: whatever a handler does,
 * the rejection is contained here, logged with a stack, and turned into a normal
 * error response. Attachments are not worth an outage.
 */
const safe = (name, handler) => async (req, res, next) => {
    try {
        await handler(req, res, next);
    } catch (e) {
        logger.error(`[cloud-storage] unhandled error in ${name}: ${(e && e.stack) || e}`);
        // A handler may already have responded before throwing.
        if (res.headersSent) return;
        try {
            res.status(200).send({
                status: false,
                statusText: (e && e.message) || 'Unexpected error.',
            });
        } catch (sendError) {
            logger.error(`[cloud-storage] could not send error response for ${name}: ${sendError.message}`);
        }
    }
};

exports.init = (app) => {
    // PUBLIC — a browser redirect from the provider, so no JWT and no companyid
    // header exist; the signed `state` is the identity.
    //
    // It lives OUTSIDE /api/v1/cloud-storage on purpose. setMiddleware protects
    // that prefix, and Express `app.use` is prefix-matching, so any path under it
    // would demand a JWT the provider cannot send. Same reason the Slack webhook
    // sits at /api/v1/slack/command rather than under /api/v1/integrations.
    app.get('/api/v1/cloud-oauth/callback', callbackLimiter, safe('oauthCallback', ctrl.oauthCallback));

    // JWT + companyId (setMiddleware protects /api/v1/cloud-storage).
    //
    // The /settings routes are registered BEFORE the /:provider ones so
    // "settings" is never captured as a provider name.
    app.get('/api/v1/cloud-storage/settings', safe('getSettings', ctrl.getSettings));
    app.put('/api/v1/cloud-storage/settings/:provider', safe('saveSettings', ctrl.saveSettings));
    app.delete('/api/v1/cloud-storage/settings/:provider', safe('clearSettings', ctrl.clearSettings));

    app.get('/api/v1/cloud-storage/providers', safe('listProviders', ctrl.listProviders));
    app.get('/api/v1/cloud-storage/:provider/auth-url', safe('authUrl', ctrl.authUrl));
    app.get('/api/v1/cloud-storage/:provider/token', safe('pickerToken', ctrl.pickerToken));
    app.get('/api/v1/cloud-storage/:provider/thumbnail', safe('thumbnail', ctrl.thumbnail));
    app.post('/api/v1/cloud-storage/:provider/import', importLimiter, safe('importFile', ctrl.importFile));
    app.delete('/api/v1/cloud-storage/:provider', safe('disconnect', ctrl.disconnect));
};

exports.__test__ = { safe };
