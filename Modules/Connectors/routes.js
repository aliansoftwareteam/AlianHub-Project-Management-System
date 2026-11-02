const rateLimit = require('express-rate-limit');
const flag = require('../Agents/connectors/flag');
const ctrl = require('./controller');
const google = require('./googleController');
const providers = require('./connectorsController');
const registry = require('./registry');
const { agentsRefused } = require('../Agents/guard');
const { CALLBACK_PATH } = require('../Agents/connectors/googleConnection');

// Saving a token, refreshing the channel list, and connecting or ending a Google connection each call the provider.
const providerLimiter = rateLimit({ windowMs: 60 * 1000, limit: 12, standardHeaders: true, legacyHeaders: false });
// Reachable without a session, so it has a limiter of its own.
const callbackLimiter = rateLimit({ windowMs: 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false });

const slackRoutes = (app) => {
    // Owners and admins only, never an API token; the handlers check the seat themselves. No route returns a token.
    app.get('/api/v2/connectors/slack', ctrl.getSlack);
    app.put('/api/v2/connectors/slack/secrets', providerLimiter, ctrl.saveSlackSecrets);
    app.delete('/api/v2/connectors/slack/secrets/:key', ctrl.removeSlackSecret);
    app.post('/api/v2/connectors/slack/channels/refresh', providerLimiter, ctrl.refreshSlackChannels);
    app.put('/api/v2/connectors/slack/channels', ctrl.setSlackChannels);
};

const googleRoutes = (app) => {
    // Outside the /api/v2/connectors prefix on purpose: that prefix demands a session, and Google's redirect has none.
    app.get(CALLBACK_PATH, callbackLimiter, google.callback);
    // A person's own connection: any member with a seat, never a guest or an API token. No route returns a token.
    app.get('/api/v2/connectors/google/mine', google.mine);
    app.get('/api/v2/connectors/google/members', google.members);
    app.post('/api/v2/connectors/google/:connector/connect', providerLimiter, google.connect);
    app.post('/api/v2/connectors/google/:connector/complete', providerLimiter, google.complete);
    app.delete('/api/v2/connectors/google/:connector', providerLimiter, google.disconnect);
    app.delete('/api/v2/connectors/google/:connector/members/:userId', providerLimiter, google.disconnectMember);
};

const appRoutes = (app) => {
    // Owners and admins only, never an API token; the handlers check the seat themselves. No route returns a client secret.
    // Under /apps, not /:provider/app, so the provider segment never collides with a provider's own /:connector routes.
    app.get('/api/v2/connectors/apps', ctrl.getApps);
    app.put('/api/v2/connectors/apps/:provider', providerLimiter, ctrl.setApp);
    app.delete('/api/v2/connectors/apps/:provider', providerLimiter, ctrl.removeApp);
};

/* The one lifecycle for every registry provider (066). `connections` and `apps` are literal segments, so a
 * provider id in `/:provider/connect` never collides with them or with the legacy google /:connector routes. */
const genericRoutes = (app) => {
    // Outside the /api/v2/connectors prefix on purpose: a provider's redirect carries no session.
    app.get('/api/v1/connector-oauth/:provider/callback', callbackLimiter, providers.callback);
    // A person's own connections and the providers offered to the workspace: any member with a seat, never a guest or an API token. No route returns a token.
    app.get('/api/v2/connectors', providers.list);
    app.get('/api/v2/connectors/members', providers.members);
    // A person connects their own account; an agent or automation never may, so the write routes refuse one.
    app.post('/api/v2/connectors/:provider/connect', agentsRefused('connector.connect'), providerLimiter, providers.connect);
    app.post('/api/v2/connectors/:provider/complete', agentsRefused('connector.connect'), providerLimiter, providers.complete);
    app.put('/api/v2/connectors/connections/:id/products', agentsRefused('connector.products_changed'), providerLimiter, providers.setProducts);
    app.delete('/api/v2/connectors/connections/:id', agentsRefused('connector.revoke'), providerLimiter, providers.disconnect);
};

exports.init = (app) => {
    // Owners and admins only, never an API token; the handlers check the seat themselves.
    if (flag.named().length) {
        app.get('/api/v2/connectors/admin/quotas', ctrl.getQuotas);
        app.put('/api/v2/connectors/admin/quotas', ctrl.setQuotas);
    }
    if (flag.requested().includes('slack')) slackRoutes(app);
    // Before the legacy google routes: the generic '/:provider/callback' and the legacy google callback share one
    // redirect URI, and the generic handler hands a legacy state back to the legacy handler (coexistence until 073).
    if (registry.list().some((definition) => flag.named().includes(definition.id))) genericRoutes(app);
    if (flag.requestedGoogle().length) googleRoutes(app);
    if (flag.requested().length) appRoutes(app);
};
