const ctrl = require('./controller');

exports.init = (app) => {
    app.get('/api/v1/dashboard/:id', ctrl.getDashboard);
    app.post('/api/v1/dashboard',ctrl.updateDashboard);
    app.get('/api/v1/cardcomponent',ctrl.getCardComponent);
    // EmployeeWorkloadReportCard data endpoint — pure filter-driven
    // report. All thresholds (active/idle/overloaded) come from the
    // caller's request body. POST (not GET) because the filter
    // payload is structured.
    app.post('/api/v1/dashboard/employee-workload', ctrl.getEmployeeWorkloadReport);
    // AHE-3789 — project-progress & resource cards (running projects,
    // live work, users-by-task-type). Additive, read-only, companyId-scoped.
    app.post('/api/v1/dashboard/project-metrics', ctrl.getProjectProgressMetric);
}