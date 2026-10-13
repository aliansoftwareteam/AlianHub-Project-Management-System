const { getSprintBurndown } = require('../Sprints/burndown');
const velocity = require('./velocity');
const cfd = require('./cfd');
const sprintInsights = require('./sprintInsights');
const milestones = require('./milestones');
const provenance = require('./provenance');
const { requireSprintAccess } = require('../Sprints/helpers/sprintVisibility');
const { requireProjectAccess, projectIdsFrom, READ } = require('../../Config/projectAccess');
const { SCHEMA_TYPE } = require('../../Config/schemaType');

exports.init = (app) => {
    const onSprint = requireSprintAccess((req) => (req.query || {}).sprintId);
    /* The project-addressed reports answer 404 for a project the caller cannot open; the
     * ones that also take no projectId narrow to the visible projects in the handler. */
    const onProject = requireProjectAccess({ mode: READ, projectIds: (req) => (req.query || {}).projectId });
    /* The sprint rule alone lets any member into a sprint that is not private, so a
     * sprint-addressed report is bound to the sprint's project first. */
    const onSprintProject = requireProjectAccess({
        mode: READ,
        projectIds: projectIdsFrom({ records: [[SCHEMA_TYPE.SPRINTS, (req) => (req.query || {}).sprintId]], direct: (req) => (req.query || {}).projectId }),
    });
    app.get('/api/v1/agile/burndown', onSprintProject, onSprint, getSprintBurndown);
    app.get('/api/v1/agile/velocity', onProject, velocity.getVelocity);
    app.get('/api/v1/agile/cfd', onProject, cfd.getCFD);
    app.get('/api/v1/agile/sprint-insights', onSprintProject, onSprint, sprintInsights.getSprintInsights);
    app.get('/api/v1/agile/milestones', onProject, milestones.getMilestones);
    app.get('/api/v1/agile/provenance', onSprintProject, onSprint, provenance.getProvenance);
};
