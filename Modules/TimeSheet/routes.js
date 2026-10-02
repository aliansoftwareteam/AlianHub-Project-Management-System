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
const reminderctrl = require('./controller/timeReminders');
const billingctrl = require('./controller/billing');
const weekctrl = require('./controller/weekTimesheet');
const gridctrl = require('./controller/workloadGrid');
const hoursctrl = require('./controller/hoursBySource');
const taskentriesctrl = require('./controller/taskEntries');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { READ, requireProjectAccess, projectIdsFrom } = require('../../Config/projectAccess');
const { requireMovedTaskFields } = require('./helpers/planMoveAccess');

const ofTask = projectIdsFrom({ records: [[SCHEMA_TYPE.TASKS, (req) => req.params.taskId]] });
const { agentsRefused } = require('../Agents/guard');

exports.init = (app) => {
    app.post('/api/v1/timesheet/user',userctrl.getUserTimeSheet);
    app.get('/api/v1/timesheet/week', weekctrl.getWeekTimesheet);
    app.get('/api/v1/timesheet/task/:taskId', requireProjectAccess({ mode: READ, projectIds: ofTask }), taskentriesctrl.getTaskEntries);
    app.get('/api/v1/timesheet/hours-by-source', hoursctrl.getHoursBySource);
    app.put('/api/v1/timesheet/entries/billable', agentsRefused('billing.entries'), weekctrl.setEntriesBillable);
    app.post('/api/v1/timesheet/workload-grid', gridctrl.getWorkloadGrid);
    app.post('/api/v1/timesheet/workload-move', agentsRefused('workload.move'), requireMovedTaskFields, gridctrl.moveWorkloadChip);
    app.put('/api/v1/timesheet/workload-capacity', gridctrl.saveWorkloadCapacity);
    app.post('/api/v1/timesheet/billable-summary', billablectrl.getBillableSummary);
    app.post('/api/v1/timesheet/export-csv', csvctrl.exportTimesheetCsv);
    app.post('/api/v1/timesheet/send-reminders', agentsRefused('email.send'), reminderctrl.triggerReminders);
    app.get('/api/v1/timesheet/reminder-settings', reminderctrl.getReminderSettings);
    app.put('/api/v1/timesheet/reminder-settings', agentsRefused('workspace.settings'), reminderctrl.updateReminderSettings);
    app.post('/api/v1/timesheet/rates', agentsRefused('billing.rates'), billingctrl.setRate);
    app.get('/api/v1/timesheet/rates', billingctrl.listRates);
    app.post('/api/v1/timesheet/generate-invoice', billingctrl.generateInvoice);
    app.post('/api/v1/timesheet/workload',workloadctrl.getWorkloadTimeSheet);
    app.post('/api/v1/timesheet/project',projectctrl.getProjectTimeSheet);
    app.post('/api/v1/timesheet/tracker',trackerctrl.getTrackerTimeSheet);
    app.post('/api/v1/timesheet/timelog',timelogctrl.getTimeLogTimeSheet);
    app.post('/api/v1/timesheet/logDetail',logDetailctrl.getlogDetailTimeSheet);
    app.post('/api/v1/timesheet/milestone',milestonectrl.getTimeSheetForMilestone);
    app.post('/api/v1/timesheet',getTimeSheetByAggregate.getTimeSheetByAggregate);
}