const userctrl = require('./controller/userTimeSheet');
const workloadctrl = require('./controller/workloadTimeSheet');
const projectctrl = require('./controller/projectTimeSheet');
const trackerctrl = require('./controller/trackerTimeSheet');
const timelogctrl = require('./controller/timeLog');
const logDetailctrl = require('./controller/logDetailView');
const milestonectrl = require('./controller/milestone');
const getTimeSheetByAggregate = require('./controller/getTimeSheetByAggregate');
const billablectrl = require('./controller/billableSummary');
const csvctrl = require('./controller/timesheetExport');
exports.init = (app) => {
    app.post('/api/v1/timesheet/user',userctrl.getUserTimeSheet);
    app.post('/api/v1/timesheet/billable-summary', billablectrl.getBillableSummary);
    app.post('/api/v1/timesheet/export-csv', csvctrl.exportTimesheetCsv);
    app.post('/api/v1/timesheet/workload',workloadctrl.getWorkloadTimeSheet);
    app.post('/api/v1/timesheet/project',projectctrl.getProjectTimeSheet);
    app.post('/api/v1/timesheet/tracker',trackerctrl.getTrackerTimeSheet);
    app.post('/api/v1/timesheet/timelog',timelogctrl.getTimeLogTimeSheet);
    app.post('/api/v1/timesheet/logDetail',logDetailctrl.getlogDetailTimeSheet);
    app.post('/api/v1/timesheet/milestone',milestonectrl.getTimeSheetForMilestone);
    app.post('/api/v1/timesheet',getTimeSheetByAggregate.getTimeSheetByAggregate);
}