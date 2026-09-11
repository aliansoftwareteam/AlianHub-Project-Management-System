const ctrl = require('./controller');
const rateLimit = require('express-rate-limit');

const icsLimiter = rateLimit({ windowMs: 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false });

exports.init = (app) => {
    app.post('/api/v1/calendar/feeds', ctrl.createFeed);
    app.get('/api/v1/calendar/feeds', ctrl.listFeeds);
    app.post('/api/v1/calendar/feeds/:id/regenerate', ctrl.regenerateFeed);
    app.delete('/api/v1/calendar/feeds/:id', ctrl.deleteFeed);
    // Deliberately outside the JWT prefixes in Config/setMiddleware.js: the token in the URL is the credential.
    app.get('/api/v1/calendar/ics/:token', icsLimiter, ctrl.getIcs);
};
