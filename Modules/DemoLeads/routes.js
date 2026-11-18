const rateLimit = require('express-rate-limit');
const ctrl = require('./controller');

// Per client IP only when TRUST_PROXY is set; otherwise every visitor behind nginx shares one IP and this cap is site-wide.
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
