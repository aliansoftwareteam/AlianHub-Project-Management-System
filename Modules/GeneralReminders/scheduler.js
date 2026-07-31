// Self-contained every-minute scheduler for general-purpose reminders.
//
// The shared cron.js is only loaded when NODE_ENV === "production"
// (index.js), which means reminders would never fire on a dev server. This
// module owns its own node-schedule job so the feature behaves identically in
// dev and production, without switching on every other unrelated cron.
//
// Registration is idempotent — start() is a no-op if already scheduled — so
// there is no double-firing if it is ever also wired from cron.js.
const schedule = require('node-schedule');
const helper = require('./helper');
const logger = require('../../Config/loggerConfig');

const LOG_PREFIX = '[general-reminders]';
const CRON_TZ = process.env.CRON_TZ || 'UTC';

let job = null;

function isDisabled() {
    const raw = String(process.env.GENERAL_REMINDERS_CRON ?? '').trim().toLowerCase();
    return ['0', 'off', 'false', 'no', 'disabled'].includes(raw);
}

function start() {
    if (job) return job;
    if (isDisabled()) {
        logger.info(`${LOG_PREFIX} scheduler disabled via GENERAL_REMINDERS_CRON`);
        return null;
    }
    job = schedule.scheduleJob({ rule: '* * * * *', tz: CRON_TZ }, async () => {
        try {
            await helper.runGeneralRemindersForAllCompanies();
        } catch (err) {
            logger.error(`${LOG_PREFIX} scheduled run failed: ${err && err.message ? err.message : err}`);
        }
    });
    logger.info(`${LOG_PREFIX} scheduler started (every minute, tz=${CRON_TZ})`);
    return job;
}

function stop() {
    if (job) {
        job.cancel();
        job = null;
    }
}

module.exports = { start, stop };
