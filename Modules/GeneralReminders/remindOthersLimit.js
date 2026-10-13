const rateLimit = require('express-rate-limit');

const HOUR_MS = 60 * 60 * 1000;
const REMINDERS_FOR_OTHERS_PER_HOUR = 20;
const TOO_MANY = 'You have set a lot of reminders for other people in the last hour. Try again later.';

const store = new rateLimit.MemoryStore();

const namesSomeoneElse = (req) => {
    const named = req.body && req.body.assignedTo;
    return Boolean(named) && String(named) !== String(req.uid || '');
};

/* A reminder for someone else ends as a mail to them, so one person sets only so many an hour. Their own
 * reminders, and a request that was refused, are not counted. */
const limitRemindersForOthers = rateLimit({
    windowMs: HOUR_MS,
    limit: REMINDERS_FOR_OTHERS_PER_HOUR,
    standardHeaders: true,
    legacyHeaders: false,
    store,
    keyGenerator: (req) => `${req.headers.companyid || ''}:${req.uid || req.ip}`,
    skip: (req) => !namesSomeoneElse(req),
    skipFailedRequests: true,
    message: { status: false, statusText: TOO_MANY },
});

const forgetRemindersForOthers = () => store.resetAll();

module.exports = { REMINDERS_FOR_OTHERS_PER_HOUR, TOO_MANY, limitRemindersForOthers, forgetRemindersForOthers };
