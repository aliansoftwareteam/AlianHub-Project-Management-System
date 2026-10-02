const rateLimit = require('express-rate-limit');
const { sendSupportMail } = require('./supportMail');

const supportMailLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => String(req.uid || req.ip),
    message: { status: false, statusText: 'Too many support mails. Try again later.' },
});
const { agentsRefused } = require('../Agents/guard');

exports.init = (app) => {
    app.post('/api/v2/support-mail', agentsRefused('email.send'), supportMailLimiter, sendSupportMail);
};
