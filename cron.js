const schedule = require("node-schedule");
const logger = require("./Config/loggerConfig");
const taskIndexRef = require("./Modules/taskIndex/controller");
const { handleBucketSizeUpdateCron } = require(`./common-storage/common-${process.env.STORAGE_TYPE}.js`);
const aiRef = require("./Modules/AI/controller")

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

schedule.scheduleJob({ rule: '0 0 * * *', tz: CRON_TZ }, async () => {
    logger.info(`Enter in cleanup trackshot schedule job`);
    cleanUpTrackshot();
})

// This cron job executes every 1 hour and Make Index for unIndex Task.
schedule.scheduleJob({ rule: '0 * * * *', tz: CRON_TZ }, async () => {
    logger.info(`[Cron] createUnIndexTask`);
    taskIndexRef.createUnIndexTask();
})

// // This cron job executes daily at midnight (12 AM) and remove ai request count.
schedule.scheduleJob({ rule: '0 0 * * *', tz: CRON_TZ }, async () => {
    aiRef.resetAiRequestCount();
})
