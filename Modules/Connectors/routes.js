const rateLimit = require('express-rate-limit');
const flag = require('../Agents/connectors/flag');
const ctrl = require('./controller');

// Saving a token and refreshing the channel list each call the provider.
const providerLimiter = rateLimit({ windowMs: 60 * 1000, limit: 12, standardHeaders: true, legacyHeaders: false });

exports.init = (app) => {
    if (!flag.requested().includes('slack')) return;
    // Owners and admins only, never an API token; the handlers check the seat themselves. No route returns a token.
    app.get('/api/v2/connectors/slack', ctrl.getSlack);
    app.put('/api/v2/connectors/slack/secrets', providerLimiter, ctrl.saveSlackSecrets);
    app.delete('/api/v2/connectors/slack/secrets/:key', ctrl.removeSlackSecret);
    app.post('/api/v2/connectors/slack/channels/refresh', providerLimiter, ctrl.refreshSlackChannels);
    app.put('/api/v2/connectors/slack/channels', ctrl.setSlackChannels);
};
