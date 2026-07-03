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
    // Resource Utilization & Consumption cards.
    // ProjectPulseCard — active projects, working-today, and type mix.
    app.post('/api/v1/dashboard/project-utilization-summary', ctrl.getProjectUtilizationSummary);
    // TeamCategoryBreakdownCard — team → task type → user logged time.
    app.post('/api/v1/dashboard/team-tasktype-breakdown', ctrl.getTeamTaskTypeBreakdown);
    // TeamLoggedVsEtaCard — per-team logged vs estimated.
    app.post('/api/v1/dashboard/team-logged-vs-eta', ctrl.getTeamLoggedVsEta);
}