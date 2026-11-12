const rateLimit = require('express-rate-limit');
const flag = require('../Agents/connectors/flag');
const ctrl = require('./controller');
const providers = require('./connectorsController');
const picker = require('./pickerController');
const registry = require('./registry');
const { agentsRefused } = require('../Agents/guard');

// Connecting or ending a connection calls the provider.
const providerLimiter = rateLimit({ windowMs: 60 * 1000, limit: 12, standardHeaders: true, legacyHeaders: false });
// Reachable without a session, so it has a limiter of its own.
const callbackLimiter = rateLimit({ windowMs: 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false });
// The attachment picker: a token or a thumbnail per pick/render, so looser than a provider call; an import streams bytes, so it is kept modest.
const pickerLimiter = rateLimit({ windowMs: 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false });
const importLimiter = rateLimit({ windowMs: 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false });

const appRoutes = (app) => {
    // Owners and admins only, never an API token; the handlers check the seat themselves. No route returns a client secret.
    // Under /apps, not /:provider/app, so the provider segment never collides with a provider's own routes.
    app.get('/api/v2/connectors/apps', ctrl.getApps);
    app.put('/api/v2/connectors/apps/:provider', providerLimiter, ctrl.setApp);
    app.delete('/api/v2/connectors/apps/:provider', providerLimiter, ctrl.removeApp);
};

/* The one lifecycle for every registry provider (066). `connections` and `apps` are literal segments, so a
 * provider id in `/:provider/connect` never collides with them. */
const genericRoutes = (app) => {
    // Outside the /api/v2/connectors prefix on purpose: a provider's redirect carries no session.
    app.get('/api/v1/connector-oauth/:provider/callback', callbackLimiter, providers.callback);
    // A person's own connections and the providers offered to the workspace: any member with a seat, never a guest or an API token. No route returns a token.
    app.get('/api/v2/connectors', providers.list);
    app.get('/api/v2/connectors/members', providers.members);
    // A person connects their own account; an agent or automation never may, so the write routes refuse one.
    app.post('/api/v2/connectors/:provider/connect', agentsRefused('connector.connect'), providerLimiter, providers.connect);
    app.post('/api/v2/connectors/:provider/complete', agentsRefused('connector.connect'), providerLimiter, providers.complete);
    app.post('/api/v2/connectors/:provider/token', agentsRefused('connector.connect'), providerLimiter, providers.saveToken);
    app.put('/api/v2/connectors/connections/:id/products', agentsRefused('connector.products_changed'), providerLimiter, providers.setProducts);
    app.delete('/api/v2/connectors/connections/:id', agentsRefused('connector.revoke'), providerLimiter, providers.disconnect);
    // Owners and admins look again at a tool an app changed; an agent never approves its own tools.
    app.get('/api/v2/connectors/admin/tools/:provider', providers.tools);
    app.put('/api/v2/connectors/admin/tools/:provider/:tool', agentsRefused('connector.tool_reviewed'), providerLimiter, providers.reviewTool);
};

/* The Drive/Dropbox attachment picker (076). `picker` is a literal segment, so `:source` never collides with a
 * provider's own /:provider routes. Every handler takes the person from the session, never the body, so no route
 * reaches another person's account. Agents never pick files, so these stay human-only (the handlers refuse an API
 * token and a guest). */
const pickerRoutes = (app) => {
    app.get('/api/v2/connectors/picker/:source/token', pickerLimiter, picker.token);
    app.get('/api/v2/connectors/picker/:source/thumbnail', pickerLimiter, picker.thumbnail);
    app.post('/api/v2/connectors/picker/:source/import', importLimiter, picker.importFile);
};

exports.init = (app) => {
    // Owners and admins only, never an API token; the handlers check the seat themselves.
    if (flag.named().length) {
        app.get('/api/v2/connectors/admin/quotas', ctrl.getQuotas);
        app.put('/api/v2/connectors/admin/quotas', ctrl.setQuotas);
    }
    if (registry.list().some((definition) => flag.named().includes(definition.id))) {
        genericRoutes(app);
        pickerRoutes(app);
        appRoutes(app);
    }
};
