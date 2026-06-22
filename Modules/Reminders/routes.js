const controller = require('./controller');
const logger = require('../../Config/loggerConfig');

exports.init = (app) => {
    // Create a personal reminder.
    app.post('/api/v1/reminders', controller.createReminder);
    // List the caller's own reminders (current company).
    app.get('/api/v1/reminders', controller.listMine);
    // Edit a reminder (text / time). Re-arms it if the time changes.
    app.patch('/api/v1/reminders/:id', controller.updateReminder);
    // Soft-delete a reminder.
    app.delete('/api/v1/reminders/:id', controller.deleteReminder);
    // Process every due reminder for the caller's company (manual; cron does this in prod).
    app.post('/api/v1/reminders/run-due', controller.runDueForCompany);
    // Fire one reminder now (testing).
    app.post('/api/v1/reminders/:id/run-now', controller.runNow);
    logger.info('Reminders routes initialised');
};
