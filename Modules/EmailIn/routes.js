const ctrl = require('./controller');
const rateLimit = require('express-rate-limit');

// The inbound webhook is unauthenticated — rate-limit by IP so a leaked inbox
// address can't be hammered to spam tasks.
const inboundLimiter = rateLimit({ windowMs: 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false });

exports.init = (app) => {
    // Management — JWT + companyId (setMiddleware protects /api/v1/email-in/inboxes).
    // Registered BEFORE the :token route so 'inboxes' is never captured as a token.
    app.post('/api/v1/email-in/inboxes', ctrl.createInbox);
    app.get('/api/v1/email-in/inboxes', ctrl.listInboxes);
    app.put('/api/v1/email-in/inboxes/:id', ctrl.updateInbox);
    app.delete('/api/v1/email-in/inboxes/:id', ctrl.deleteInbox);

    // PUBLIC inbound webhook (token in the path is the secret; rate-limited).
    app.post('/api/v1/email-in/:token', inboundLimiter, ctrl.receiveEmail);
};
