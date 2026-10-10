const express = require('express');
const rateLimit = require('express-rate-limit');
const ctrl = require('./controller');
const { agentsRefused } = require('../Agents/guard');
const hub = require('./appConnections/controller');
const github = require('./appConnections/githubConnect');
const { CALLBACK_PATH } = require('./appConnections/github/oauth');

const githubCallbackLimiter = rateLimit({ windowMs: 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false });
const slackLimiter = rateLimit({ windowMs: 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false });

exports.init = (app) => {
    // JWT + companyId (setMiddleware protects /api/v1/integrations).
    app.get('/api/v1/integrations/catalog', ctrl.listCatalog);
    app.get('/api/v1/integrations/connections', ctrl.listConnections);
    app.post('/api/v1/integrations/connections', agentsRefused('integration.connect'), ctrl.connect);
    app.put('/api/v1/integrations/connections/:id', agentsRefused('integration.update'), ctrl.updateConnection);
    app.delete('/api/v1/integrations/connections/:id', agentsRefused('integration.disconnect'), ctrl.disconnect);
    app.get('/api/v1/integrations/app-connections', hub.hub);
    app.put('/api/v1/integrations/connections/:id/projects', agentsRefused('integration.update'), hub.setProjects);
    app.get('/api/v1/integrations/github/authorize', agentsRefused('integration.connect'), github.authorize);
    app.post('/api/v1/integrations/github/complete', agentsRefused('integration.connect'), github.complete);
    app.get('/api/v1/integrations/connections/:id/github-repos', agentsRefused('integration.update'), github.repos);
    app.post('/api/v1/integrations/connections/:id/repos', agentsRefused('integration.update'), github.addRepo);
    app.delete('/api/v1/integrations/connections/:id/repos/:projectId', agentsRefused('integration.update'), github.removeRepo);
    app.get('/api/v1/integrations/github/projects/:projectId', github.projectView);
    app.get(CALLBACK_PATH, githubCallbackLimiter, github.callback);

    // AUTO-06 — PUBLIC Slack slash-command webhook (NOT under /api/v1/integrations,
    // so it bypasses JWT; the verification token authenticates it). companyId in
    // the URL is not secret. Own urlencoded parser so Slack's form body is read.
    app.post('/api/v1/slack/command/:companyId', slackLimiter, express.urlencoded({ extended: false }), ctrl.slackCommand);
};
