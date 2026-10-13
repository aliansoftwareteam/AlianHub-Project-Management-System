const rateLimit = require('express-rate-limit');
const flag = require('../Agents/connectors/flag');
const ctrl = require('./controller');
const google = require('./googleController');
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

exports.init = (app) => {
    if (flag.requested().includes('slack')) slackRoutes(app);
    if (flag.requestedGoogle().length) googleRoutes(app);
};
