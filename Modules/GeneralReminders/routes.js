const controller = require('./controller');
const logger = require('../../Config/loggerConfig');

// General-purpose (standalone) reminders. Namespaced under /general-reminders so
// it never collides with /api/v1/reminders, which is the task-scoped flow.
exports.init = (app) => {
    // Create a standalone reminder.
    app.post('/api/v1/general-reminders', controller.createReminder);
    // List the caller's own reminders (?filter=upcoming|done).
    app.get('/api/v1/general-reminders', controller.listMine);
    // Process every due reminder for the caller's company (manual; cron does this too).
    app.post('/api/v1/general-reminders/run-due', controller.runDueForCompany);
    // Fire one reminder now (testing).
    app.post('/api/v1/general-reminders/:id/run-now', controller.runNow);
    // Edit a reminder. Re-arms it when the time or lead time changes.
    app.patch('/api/v1/general-reminders/:id', controller.updateReminder);
    // Soft-delete a reminder.
    app.delete('/api/v1/general-reminders/:id', controller.deleteReminder);
    logger.info('General reminders routes initialised');
};
