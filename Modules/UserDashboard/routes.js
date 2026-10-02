const ctrl = require('./controller');
const atRisk = require('./atRisk');
const { agentsRefused } = require('../Agents/guard');
const { limitCallerBody } = require('../Company/helpers/callerQueryRules');

const cardsByPeople = agentsRefused('dashboard.card.add');

exports.init = (app) => {
    app.get('/api/v1/dashboard/:id', ctrl.getDashboard);
    app.post('/api/v1/dashboard', cardsByPeople, ctrl.updateDashboard);
    app.get('/api/v1/cardcomponent',ctrl.getCardComponent);
    // EmployeeWorkloadReportCard data endpoint — pure filter-driven
    // report. All thresholds (active/idle/overloaded) come from the
    // caller's request body. POST (not GET) because the filter
    // payload is structured.
    app.post('/api/v1/dashboard/employee-workload', limitCallerBody, ctrl.getEmployeeWorkloadReport);
    // Resource Utilization & Consumption cards.
    // ProjectPulseCard — active projects, working-today, and type mix.
    app.post('/api/v1/dashboard/project-utilization-summary', limitCallerBody, ctrl.getProjectUtilizationSummary);
    // TeamCategoryBreakdownCard — team → task type → user logged time.
    app.post('/api/v1/dashboard/team-tasktype-breakdown', limitCallerBody, ctrl.getTeamTaskTypeBreakdown);
    // TeamLoggedVsEtaCard — per-team logged vs estimated.
    app.post('/api/v1/dashboard/team-logged-vs-eta', limitCallerBody, ctrl.getTeamLoggedVsEta);
    // AHE-3789 — project-progress & resource cards (running projects,
    // live work, users-by-task-type). Additive, read-only, companyId-scoped.
    app.post('/api/v1/dashboard/project-metrics', limitCallerBody, ctrl.getProjectProgressMetric);
    // OnLeaveCard — approved leave tickets from the configured HR project
    // that overlap the selected window, plus AB/PR headcounts.
    app.post('/api/v1/dashboard/on-leave', limitCallerBody, ctrl.getOnLeaveBoard);
    // MilestoneReportCard — company-wide billing-milestone summary
    // (totals by currency/status + recent list). Owner/Admin only.
    app.post('/api/v1/dashboard/milestone-summary', limitCallerBody, ctrl.getMilestoneSummary);
    // Member self-view cards (caller = req.uid).
    app.post('/api/v1/dashboard/my-next-tasks', limitCallerBody, ctrl.getMyNextTasks);
    app.post('/api/v1/dashboard/my-achievements', limitCallerBody, ctrl.getMyAchievements);
    app.post('/api/v1/dashboard/my-leave', limitCallerBody, ctrl.getMyLeave);
    app.post('/api/v1/dashboard/my-due-soon', limitCallerBody, ctrl.getMyDueSoon);
    app.post('/api/v1/dashboard/my-time', limitCallerBody, ctrl.getMyTime);
    app.post('/api/v1/dashboard/at-risk', limitCallerBody, atRisk.getAtRisk);
    // TaskStatusSummaryCard — task counts per status for the window, plus the task rows
    // behind one status. Owner/Admin see the company; everyone else sees their own work
    // (resolved server-side from company_users, not from the body).
    app.post('/api/v1/dashboard/tasks-by-status', limitCallerBody, ctrl.getTasksByStatus);

    // Shared dashboards (redesign 12d) — a dashboard is an owned object with a
    // visibility, not a per-user blob. Same collection as above; the legacy
    // per-user document is read as its owner's private dashboard.
    app.get('/api/v1/dashboards', ctrl.listDashboards);
    app.post('/api/v1/dashboards', ctrl.createSharedDashboard);
    app.get('/api/v1/dashboards/:id', ctrl.getSharedDashboard);
    app.put('/api/v1/dashboards/:id', ctrl.updateSharedDashboard);
    app.put('/api/v1/dashboards/:id/cards', cardsByPeople, ctrl.updateSharedDashboardCards);
    app.post('/api/v1/dashboards/:id/duplicate', ctrl.duplicateSharedDashboard);
    app.delete('/api/v1/dashboards/:id', ctrl.deleteSharedDashboard);
}