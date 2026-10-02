const controller = require('./controller');
const logger = require('../../Config/loggerConfig');
const { agentsRefused } = require('../Agents/guard');
const { requireCompanyAdmin } = require('../../Config/permissionGuard');

/* A reminder may be raised for another member, who is then mailed. */
const remindersByPeople = agentsRefused('reminder.manage');

// General-purpose (standalone) reminders. Namespaced under /general-reminders so
// it never collides with /api/v1/reminders, which is the task-scoped flow.
exports.init = (app) => {
    // Create a standalone reminder.
    app.post('/api/v1/general-reminders', remindersByPeople, controller.createReminder);
    // List the caller's own reminders (?filter=upcoming|done).
    app.get('/api/v1/general-reminders', controller.listMine);
    app.post('/api/v1/general-reminders/run-due', remindersByPeople, requireCompanyAdmin(), controller.runDueForCompany);
    // Fire one reminder now (testing).
    app.post('/api/v1/general-reminders/:id/run-now', remindersByPeople, controller.runNow);
    // Edit a reminder. Re-arms it when the time or lead time changes.
    app.patch('/api/v1/general-reminders/:id', remindersByPeople, controller.updateReminder);
    // Soft-delete a reminder.
    app.delete('/api/v1/general-reminders/:id', controller.deleteReminder);
    logger.info('General reminders routes initialised');
};
