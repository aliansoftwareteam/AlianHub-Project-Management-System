const ctrl = require('./controller');
const { decidedByPerson } = require('../Agents/personDecides');
const { agentsRefused } = require('../Agents/guard');

const reviewedByPerson = decidedByPerson('timesheet.review');

exports.init = (app) => {
    app.post('/api/v2/timesheet-approval/submit', agentsRefused('timesheet.submit'), ctrl.submitTimesheet);
    app.get('/api/v2/timesheet-approval/status', ctrl.getStatus);
    app.get('/api/v2/timesheet-approval/mine', ctrl.listMine);
    app.get('/api/v2/timesheet-approval/pending', ctrl.listPending);
    app.get('/api/v2/timesheet-approval/queue', ctrl.listQueue);
    app.post('/api/v2/timesheet-approval/:id/review', reviewedByPerson, ctrl.reviewTimesheet);
    app.post('/api/v2/timesheet-approval/bulk-review', reviewedByPerson, ctrl.reviewTimesheetsBulk);
}
