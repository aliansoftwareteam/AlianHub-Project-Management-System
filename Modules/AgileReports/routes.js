const { getSprintBurndown } = require('../Sprints/burndown');
const velocity = require('./velocity');
const cfd = require('./cfd');
const sprintInsights = require('./sprintInsights');
const milestones = require('./milestones');
const provenance = require('./provenance');
const { requireSprintAccess } = require('../Sprints/helpers/sprintVisibility');
const { requireProjectAccess, READ } = require('../../Config/projectAccess');

exports.init = (app) => {
    // Unified agile-reports read API (S4). Burndown reuses the existing Sprints
    // handler (now query-param aware); velocity + CFD are computed in this module.
    // All read-only; auth/companyId come from the global middleware like other routes.
    const onSprint = requireSprintAccess((req) => (req.query || {}).sprintId);
    /* The project-addressed reports answer 404 for a project the caller cannot open; the
     * ones that also take no projectId narrow to the visible projects in the handler. */
    const onProject = requireProjectAccess({ mode: READ, projectIds: (req) => (req.query || {}).projectId });
    app.get('/api/v1/agile/burndown', onSprint, getSprintBurndown);
    app.get('/api/v1/agile/velocity', onProject, velocity.getVelocity);
    app.get('/api/v1/agile/cfd', onProject, cfd.getCFD);
    app.get('/api/v1/agile/sprint-insights', onSprint, sprintInsights.getSprintInsights);
    app.get('/api/v1/agile/milestones', onProject, milestones.getMilestones);
    app.get('/api/v1/agile/provenance', onSprint, provenance.getProvenance);
};
