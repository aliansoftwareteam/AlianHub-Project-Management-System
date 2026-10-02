const ctrl = require('./controller');
const { agentsRefused } = require('../Agents/guard');

/* A schedule mails a report to whoever it names, so a person sets it and sends it. */
const scheduledByPeople = agentsRefused('report.schedule');

exports.init = (app) => {
    // JWT + companyId enforced in setMiddleware (prefix /api/v1/reports/schedules).
    app.get('/api/v1/reports/schedules', ctrl.listSchedules);
    app.post('/api/v1/reports/schedules/run-due', scheduledByPeople, ctrl.triggerDue);          // dev trigger (mirrors prod cron)
    app.post('/api/v1/reports/schedules', scheduledByPeople, ctrl.createSchedule);
    app.post('/api/v1/reports/schedules/:id/run-now', scheduledByPeople, ctrl.runScheduleNow);
    app.put('/api/v1/reports/schedules/:id', scheduledByPeople, ctrl.updateSchedule);
    app.delete('/api/v1/reports/schedules/:id', ctrl.deleteSchedule);
};
