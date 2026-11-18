const rateLimit = require('express-rate-limit');
const ctrl = require('./controller');

// 'trust proxy' is off in index.js, so behind nginx every visitor shares the proxy IP and this cap is effectively site-wide.
const leadLimiter = rateLimit({ windowMs: 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false });

const demoModeGuard = (req, res, next) => {
    if (process.env.DEMO_MODE !== 'true') {
        return res.status(404).send('Not found');
    }
    next();
};

exports.init = (app) => {
    app.post('/api/v1/demo-leads', demoModeGuard, leadLimiter, ctrl.createLead);
};
