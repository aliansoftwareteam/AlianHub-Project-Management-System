const controller = require('./controller');
const logger = require('../../Config/loggerConfig');
const { agentsRefused, reminderCreateGuard } = require('../Agents/guard');

/* An agent sets a reminder for its person on a task; changing one and sending one stay a person's. */
const remindersByPeople = agentsRefused('reminder.manage');

exports.init = (app) => {
    // Create a personal reminder.
    app.post('/api/v1/reminders', reminderCreateGuard, controller.createReminder);
    // List the caller's own reminders (current company).
    app.get('/api/v1/reminders', controller.listMine);
    // Edit a reminder (text / time). Re-arms it if the time changes.
    app.patch('/api/v1/reminders/:id', remindersByPeople, controller.updateReminder);
    // Soft-delete a reminder.
    app.delete('/api/v1/reminders/:id', controller.deleteReminder);
    // Process every due reminder for the caller's company (manual; cron does this in prod).
    app.post('/api/v1/reminders/run-due', remindersByPeople, controller.runDueForCompany);
    // Fire one reminder now (testing).
    app.post('/api/v1/reminders/:id/run-now', remindersByPeople, controller.runNow);
    logger.info('Reminders routes initialised');
};
