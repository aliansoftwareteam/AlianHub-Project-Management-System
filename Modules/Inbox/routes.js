const logger = require('../../Config/loggerConfig');
const ctrl = require('./controller');

/**
 * Error boundary for every handler in this module.
 *
 * index.js registers `process.on('unhandledRejection', … process.exit(1))`, and Express 4
 * does not catch async rejections — so one throw inside a handler takes the whole server
 * down. Every failure here has to end as a response, not an outage.
 */
const safe = (name, handler) => async (req, res, next) => {
    try {
        await handler(req, res, next);
    } catch (e) {
        logger.error(`[inbox] unhandled error in ${name}: ${(e && e.stack) || e}`);
        if (res.headersSent) return;
        try {
            res.status(200).send({ status: false, statusText: (e && e.message) || 'Unexpected error.' });
        } catch (sendError) {
            logger.error(`[inbox] could not send error response for ${name}: ${sendError.message}`);
        }
    }
};

exports.init = (app) => {
    // JWT + companyId come from setMiddleware, which protects the /api/v1/inbox prefix.
    // The user is taken from req.uid, never the query, so one user cannot read another's.
    app.get('/api/v1/inbox/counts', safe('counts', ctrl.counts));
    app.post('/api/v1/inbox/read-all', safe('markAllRead', ctrl.markAllRead));
    app.post('/api/v1/inbox/read', safe('markRead', ctrl.markRead));

    app.get('/api/v1/inbox', safe('list', ctrl.list));
};
