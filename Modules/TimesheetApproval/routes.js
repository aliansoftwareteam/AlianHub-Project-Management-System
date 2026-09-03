const ctrl = require('./controller');

exports.init = (app) => {
    app.post('/api/v2/timesheet-approval/submit', ctrl.submitTimesheet);
    app.get('/api/v2/timesheet-approval/status', ctrl.getStatus);
    app.get('/api/v2/timesheet-approval/mine', ctrl.listMine);
    app.get('/api/v2/timesheet-approval/pending', ctrl.listPending);
    app.get('/api/v2/timesheet-approval/queue', ctrl.listQueue);
    app.post('/api/v2/timesheet-approval/:id/review', ctrl.reviewTimesheet);
}
