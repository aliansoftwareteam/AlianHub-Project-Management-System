const express = require('express');
const rateLimit = require('express-rate-limit');
const ctrl = require('./controller');
const { OFF, modeOf } = require('../../Config/contentSecurityPolicy');

const MAX_BODY_BYTES = 8 * 1024;
const REPORTS_PER_MINUTE = 120;
const REPORT_TYPES = ['application/csp-report', 'application/reports+json'];

const reportsOnly = (req, res, next) => (req.is(REPORT_TYPES) ? next() : res.status(415).end());

// Express tells an error handler by its four arguments.
const refuseBody = (err, req, res, next) => res.status(err && err.type === 'entity.too.large' ? 413 : 400).end();

/* No session: a browser sends a violation report without credentials, and before anyone has logged in.
 * While the policy is off no browser has been told to report, so the route does not exist. */
exports.init = (app, env = process.env) => {
    if (modeOf(env) === OFF) return;
    const limiter = rateLimit({ windowMs: 60 * 1000, limit: REPORTS_PER_MINUTE, standardHeaders: true, legacyHeaders: false, handler: (req, res) => res.status(429).end() });
    app.post('/api/v2/csp-report', limiter, reportsOnly, express.raw({ type: REPORT_TYPES, limit: MAX_BODY_BYTES }), ctrl.receive, refuseBody);
};

exports.MAX_BODY_BYTES = MAX_BODY_BYTES;
exports.REPORTS_PER_MINUTE = REPORTS_PER_MINUTE;
exports.MAX_ROWS_PER_DAY = ctrl.MAX_ROWS_PER_DAY;
exports.MAX_NEW_KEYS_PER_ADDRESS = ctrl.MAX_NEW_KEYS_PER_ADDRESS;
