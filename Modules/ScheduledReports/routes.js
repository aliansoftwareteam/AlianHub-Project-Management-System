const ctrl = require('./controller');

exports.init = (app) => {
    // JWT + companyId enforced in setMiddleware (prefix /api/v1/reports/schedules).
    app.get('/api/v1/reports/schedules', ctrl.listSchedules);
    app.post('/api/v1/reports/schedules/run-due', ctrl.triggerDue);          // dev trigger (mirrors prod cron)
    app.post('/api/v1/reports/schedules', ctrl.createSchedule);
    app.post('/api/v1/reports/schedules/:id/run-now', ctrl.runScheduleNow);
    app.put('/api/v1/reports/schedules/:id', ctrl.updateSchedule);
    app.delete('/api/v1/reports/schedules/:id', ctrl.deleteSchedule);
};
