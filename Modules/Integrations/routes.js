const express = require('express');
const rateLimit = require('express-rate-limit');
const ctrl = require('./controller');

const slackLimiter = rateLimit({ windowMs: 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false });

exports.init = (app) => {
    // JWT + companyId (setMiddleware protects /api/v1/integrations).
    app.get('/api/v1/integrations/catalog', ctrl.listCatalog);
    app.get('/api/v1/integrations/connections', ctrl.listConnections);
    app.post('/api/v1/integrations/connections', ctrl.connect);
    app.put('/api/v1/integrations/connections/:id', ctrl.updateConnection);
    app.delete('/api/v1/integrations/connections/:id', ctrl.disconnect);

    // AUTO-06 — PUBLIC Slack slash-command webhook (NOT under /api/v1/integrations,
    // so it bypasses JWT; the verification token authenticates it). companyId in
    // the URL is not secret. Own urlencoded parser so Slack's form body is read.
    app.post('/api/v1/slack/command/:companyId', slackLimiter, express.urlencoded({ extended: false }), ctrl.slackCommand);
};
