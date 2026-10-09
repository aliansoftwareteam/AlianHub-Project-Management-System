const controller = require('./controller');
const logger = require('../../Config/loggerConfig');
const { limitRemindersForOthers } = require('./remindOthersLimit');
const { agentsRefused } = require('../Agents/guard');
const { requireCompanyAdmin } = require('../../Config/permissionGuard');

/* A reminder may be raised for another member, who is then mailed. */
const remindersByPeople = agentsRefused('reminder.manage');

// General-purpose (standalone) reminders. Namespaced under /general-reminders so
// it never collides with /api/v1/reminders, which is the task-scoped flow.
exports.init = (app) => {
    app.post('/api/v1/general-reminders', remindersByPeople, limitRemindersForOthers, controller.createReminder);
    // List the caller's own reminders (?filter=upcoming|done).
    app.get('/api/v1/general-reminders', controller.listMine);
    app.post('/api/v1/general-reminders/run-due', remindersByPeople, requireCompanyAdmin(), controller.runDueForCompany);
    // Fire one reminder now (testing).
    app.post('/api/v1/general-reminders/:id/run-now', remindersByPeople, controller.runNow);
    // Re-arms the reminder when the time or lead time changes.
    app.patch('/api/v1/general-reminders/:id', remindersByPeople, limitRemindersForOthers, controller.updateReminder);
    app.delete('/api/v1/general-reminders/:id', controller.deleteReminder);
    logger.info('General reminders routes initialised');
};
