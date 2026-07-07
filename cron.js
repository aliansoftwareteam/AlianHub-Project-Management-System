const schedule = require("node-schedule");
const logger = require("./Config/loggerConfig");
const taskIndexRef = require("./Modules/taskIndex/controller");
const { handleBucketSizeUpdateCron } = require(`./common-storage/common-${process.env.STORAGE_TYPE}.js`);
const aiRef = require("./Modules/AI/controller")
const screenshotRetention = require("./Modules/ScreenshotRetention/helper");
const autoArchive = require("./Modules/projectSetting/autoArchive");
const projectClose = require("./Modules/projectClose/helper");
const recurringTasks = require("./Modules/RecurringTasks/controller");
const reminders = require("./Modules/Reminders/controller");
const timeReminders = require("./Modules/TimeSheet/controller/timeReminders");
const auditRecorder = require("./Modules/Audit/recorder");
const scheduledReports = require("./Modules/ScheduledReports/controller");

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

// Auto-close inactive projects (AHE-3798) — daily at 03:00 UTC (off-peak).
// For every company with `autoCloseProjects.enabled`, closes projects with no
// logged time AND no task activity for `inactiveMonths` months (reversible —
// sets the project's close-type status, never deletes).
schedule.scheduleJob({ rule: '0 3 * * *', tz: CRON_TZ }, async () => {
    logger.info(`[Cron] projectClose.runAutoCloseForAllCompanies`);
    try {
        await projectClose.runAutoCloseForAllCompanies();
    } catch (err) {
        logger.error(`[Cron] projectClose failed: ${err && err.message ? err.message : err}`);
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

// Personal reminders (COLLAB-03) — every minute, fire any reminder whose
// reminderAt has passed and that hasn't fired yet, across all companies. The
// fired flag makes it idempotent; the /run-due and /run-now endpoints exercise
// the same path in dev (cron is prod-only).
schedule.scheduleJob({ rule: '* * * * *', tz: CRON_TZ }, async () => {
    logger.info(`[Cron] reminders.runRemindersForAllCompanies`);
    try {
        await reminders.runRemindersForAllCompanies();
    } catch (err) {
        logger.error(`[Cron] reminders failed: ${err && err.message ? err.message : err}`);
    }
})

// // This cron job executes daily at midnight (12 AM) and remove ai request count.
schedule.scheduleJob({ rule: '0 0 * * *', tz: CRON_TZ }, async () => {
    aiRef.resetAiRequestCount();
})

// Time-entry reminders — daily at 17:00, nudge members who haven't logged time
// today. The /api/v1/timesheet/send-reminders endpoint runs the same path in dev.
schedule.scheduleJob({ rule: '0 17 * * *', tz: CRON_TZ }, async () => {
    logger.info(`[Cron] timeReminders.runRemindersForAllCompanies`);
    try {
        await timeReminders.runRemindersForAllCompanies();
    } catch (err) {
        logger.error(`[Cron] timeReminders failed: ${err && err.message ? err.message : err}`);
    }
})

// Audit-log retention — daily at 02:00, prune rows older than AUDIT_RETENTION_DAYS
// (default 365) across all companies.
schedule.scheduleJob({ rule: '0 2 * * *', tz: CRON_TZ }, async () => {
    logger.info(`[Cron] auditRecorder.runAuditRetentionForAllCompanies`);
    try {
        await auditRecorder.runAuditRetentionForAllCompanies();
    } catch (err) {
        logger.error(`[Cron] audit retention failed: ${err && err.message ? err.message : err}`);
    }
})

// Scheduled reports — hourly, email any saved-report schedule whose nextRunAt has
// passed, across all companies. nextRunAt advancement makes it idempotent; the
// /run-due and /run-now endpoints exercise the same path in dev (cron is prod-only).
schedule.scheduleJob({ rule: '0 * * * *', tz: CRON_TZ }, async () => {
    logger.info(`[Cron] scheduledReports.runScheduledReportsForAllCompanies`);
    try {
        await scheduledReports.runScheduledReportsForAllCompanies();
    } catch (err) {
        logger.error(`[Cron] scheduledReports failed: ${err && err.message ? err.message : err}`);
    }
})
