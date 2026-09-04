const schedule = require("node-schedule");
const logger = require("./Config/loggerConfig");
const { recordCronRun } = require("./Config/instanceState");
const taskIndexRef = require("./Modules/taskIndex/controller");
const { handleBucketSizeUpdateCron } = require(`./common-storage/common-${process.env.STORAGE_TYPE}.js`);
const aiRef = require("./Modules/AI/controller");
const screenshotRetention = require("./Modules/ScreenshotRetention/helper");
const autoArchive = require("./Modules/projectSetting/autoArchive");
const projectClose = require("./Modules/projectClose/helper");
const recurringTasks = require("./Modules/RecurringTasks/controller");
const reminders = require("./Modules/Reminders/controller");
const timeReminders = require("./Modules/TimeSheet/controller/timeReminders");
const auditRecorder = require("./Modules/Audit/recorder");
const scheduledReports = require("./Modules/ScheduledReports/controller");

// UTC unless the operator pins another zone: the only choice that survives a DST
// switch, a container reboot or a base-image swap without shifting schedules.
const CRON_TZ = process.env.CRON_TZ || 'UTC';

const job = (name, rule, run) => schedule.scheduleJob({ rule, tz: CRON_TZ }, async () => {
    logger.info(`[Cron] ${name}`);
    try {
        await run();
        recordCronRun(name);
    } catch (err) {
        recordCronRun(name, { ok: false, error: err });
        logger.error(`[Cron] ${name} failed: ${err && err.message ? err.message : err}`);
    }
});

// Off-peak spread: the heavy cleanups sit at 00:30, 01:00, 02:00 and 03:00 so they
// never stack on the midnight jobs.
job('bucketSize', '0 0 * * *', () => handleBucketSizeUpdateCron());
job('aiRequestCountReset', '0 0 * * *', () => aiRef.resetAiRequestCount());
job('screenshotRetention', '30 0 * * *', () => screenshotRetention.runRetentionForAllCompanies());
job('autoArchive', '0 1 * * *', () => autoArchive.runAutoArchiveForAllCompanies());
job('auditRetention', '0 2 * * *', () => auditRecorder.runAuditRetentionForAllCompanies());
job('projectAutoClose', '0 3 * * *', () => projectClose.runAutoCloseForAllCompanies());
job('taskIndex', '0 * * * *', () => taskIndexRef.createUnIndexTask());
job('scheduledReports', '0 * * * *', () => scheduledReports.runScheduledReportsForAllCompanies());
job('recurringTasks', '*/15 * * * *', () => recurringTasks.runRecurringForAllCompanies());
job('reminders', '* * * * *', () => reminders.runRemindersForAllCompanies());
job('timeReminders', '0 17 * * *', () => timeReminders.runRemindersForAllCompanies());

module.exports = { job, CRON_TZ };
