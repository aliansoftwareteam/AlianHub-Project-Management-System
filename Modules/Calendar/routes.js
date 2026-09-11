const ctrl = require('./controller');
const rateLimit = require('express-rate-limit');
const { requireProjectAccess } = require('../../Config/projectAccess');

const icsLimiter = rateLimit({ windowMs: 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false });

const feedsIntoProject = requireProjectAccess({
    projectIds: (req) => (req.body && req.body.scope === 'project' ? req.body.projectId : null),
    passMissing: () => true,
});

exports.init = (app) => {
    // Management — JWT + companyId (setMiddleware protects /api/v1/calendar/feeds).
    app.post('/api/v1/calendar/feeds', feedsIntoProject, ctrl.createFeed);
    app.get('/api/v1/calendar/feeds', ctrl.listFeeds);
    app.delete('/api/v1/calendar/feeds/:id', ctrl.deleteFeed);
    // PUBLIC read-only .ics feed (token-authenticated, rate-limited).
    app.get('/api/v1/calendar/ics/:token', icsLimiter, ctrl.getIcs);
};
