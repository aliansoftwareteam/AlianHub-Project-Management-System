const schedule = require("node-schedule");
const logger = require("./Config/loggerConfig");
const taskIndexRef = require("./Modules/taskIndex/controller");
const { handleBucketSizeUpdateCron } = require(`./common-storage/common-${process.env.STORAGE_TYPE}.js`);
const aiRef = require("./Modules/AI/controller")
const screenshotRetention = require("./Modules/ScreenshotRetention/helper");
const autoArchive = require("./Modules/projectSetting/autoArchive");
const recurringTasks = require("./Modules/RecurringTasks/controller");

// BUG-035 / #89 — pin every cron to a known timezone so schedules don't
// shift when the server's local tz changes (DST transition, container
// host reboot, base-image swap). The default is UTC because that's the
// only tz that's stable everywhere; operators can override via
// CRON_TZ for accounting/billing crons that need calendar-day cuts in
// a specific region.
const CRON_TZ = process.env.CRON_TZ || 'UTC';

// // This cron job executes daily at midnight (12 AM) and retrieves the file size from Wasabi storage
schedule.scheduleJob({ rule: '0 0 * * *', tz: CRON_TZ }, async () => {
    logger.info(`Enter in schedule job`);
    handleBucketSizeUpdateCron();
})

// Screenshot retention — daily at 00:30 UTC, off-peak vs the other midnight
// jobs so a heavy cleanup doesn't compound with bucket-size + AI-reset on the
// same minute. Iterates every company that has the per-tenant policy
// enabled, deletes trackshots older than `maxAgeMonths` from both Wasabi and
// the tenant's TimeSheet.trackShots subdoc, then stamps run stats on the
// master companies doc. Replaces the previous `cleanUpTrackshot()` call that
// referenced an unimported binding and never actually ran.
schedule.scheduleJob({ rule: '30 0 * * *', tz: CRON_TZ }, async () => {
    logger.info(`[Cron] screenshotRetention.runRetentionForAllCompanies`);
    try {
        await screenshotRetention.runRetentionForAllCompanies();
    } catch (err) {
        logger.error(`[Cron] screenshotRetention failed: ${err && err.message ? err.message : err}`);
    }
})

// This cron job executes every 1 hour and Make Index for unIndex Task.
schedule.scheduleJob({ rule: '0 * * * *', tz: CRON_TZ }, async () => {
    logger.info(`[Cron] createUnIndexTask`);
    taskIndexRef.createUnIndexTask();
})

// Auto-archive — daily at 01:00 UTC (off-peak vs the midnight jobs). For
// every project with `autoArchive.enabled`, archives completed tasks
// (status type 'close') untouched for `afterDays` days.
schedule.scheduleJob({ rule: '0 1 * * *', tz: CRON_TZ }, async () => {
    logger.info(`[Cron] autoArchive.runAutoArchiveForAllCompanies`);
    try {
        await autoArchive.runAutoArchiveForAllCompanies();
    } catch (err) {
        logger.error(`[Cron] autoArchive failed: ${err && err.message ? err.message : err}`);
    }
})

// Recurring tasks — every 15 minutes, instantiate any definition whose nextRunAt
// has passed, across all companies. Advancement of nextRunAt makes it idempotent;
// the /run-due and /run-now endpoints exercise the same path in dev (cron is prod-only).
schedule.scheduleJob({ rule: '*/15 * * * *', tz: CRON_TZ }, async () => {
    logger.info(`[Cron] recurringTasks.runRecurringForAllCompanies`);
    try {
        await recurringTasks.runRecurringForAllCompanies();
    } catch (err) {
        logger.error(`[Cron] recurringTasks failed: ${err && err.message ? err.message : err}`);
    }
})

// // This cron job executes daily at midnight (12 AM) and remove ai request count.
schedule.scheduleJob({ rule: '0 0 * * *', tz: CRON_TZ }, async () => {
    aiRef.resetAiRequestCount();
})
