const ctrl = require('./controller');
const renderer = require('./publicRenderer');
const rateLimit = require('express-rate-limit');

// Public share pages are unauthenticated — rate-limit by IP so a leaked link
// can't be hammered to scrape data or spam the intake form.
const publicReadLimiter = rateLimit({ windowMs: 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false });
const publicWriteLimiter = rateLimit({ windowMs: 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false });

exports.init = (app) => {
    // Authenticated management endpoints.
    app.post('/api/v2/public-shares', ctrl.createShare);
    app.get('/api/v2/public-shares', ctrl.getShare);
    app.put('/api/v2/public-shares/:id', ctrl.updateShare);
    app.delete('/api/v2/public-shares/:id', ctrl.deleteShare); // hard revoke
    app.get('/api/v2/intake', ctrl.listIntake);
    app.post('/api/v2/intake/review', ctrl.reviewIntake);

    // Unauthenticated public pages (server-rendered HTML), rate-limited by IP.
    app.get('/share/:token', publicReadLimiter, renderer.renderShare);
    app.get('/share/:token/page/:pageId', publicReadLimiter, renderer.renderDocFragment); // in-page navigation
    app.post('/share/:token', publicReadLimiter, renderer.renderShare);        // password unlock (re-renders)
    app.post('/share/:token/intake', publicWriteLimiter, renderer.submitIntake);
}
