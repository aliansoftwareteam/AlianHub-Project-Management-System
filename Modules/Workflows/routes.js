const ctrl = require('./controller');
const { setByPerson } = require('../Agents/personDecides');
const { agentsRefused } = require('../Agents/guard');

exports.init = (app) => {
    // JWT + companyId: setMiddleware lists the /api/v2/workflows prefix, so every
    // route below has a verified caller and a verified company before it runs.
    app.get('/api/v2/workflows/step-types', ctrl.getStepTypes);
    app.post('/api/v2/workflows/dry-run', ctrl.dryRun);
    app.get('/api/v2/workflows/definitions', ctrl.listDefinitions);
    app.post('/api/v2/workflows/definitions', setByPerson('workflow.definition.create'), ctrl.createDefinition);
    app.put('/api/v2/workflows/definitions/:id', setByPerson('workflow.definition.update'), ctrl.updateDefinition);
    app.patch('/api/v2/workflows/definitions/:id/enabled', setByPerson('workflow.definition.enable'), ctrl.setDefinitionEnabled);
    app.delete('/api/v2/workflows/definitions/:id', setByPerson('workflow.definition.delete'), ctrl.deleteDefinition);
    app.get('/api/v2/workflows/approvals', ctrl.listApprovals);
    app.get('/api/v2/workflows/runs', ctrl.listRuns);
    app.post('/api/v2/workflows/runs', agentsRefused('workflow.run.start'), ctrl.startRun);
    app.get('/api/v2/workflows/runs/:id', ctrl.getRun);
    app.post('/api/v2/workflows/runs/:id/steps/:stepId/retry', setByPerson('workflow.step.retry'), ctrl.retryStep);
    app.post('/api/v2/workflows/runs/:id/steps/:stepId/skip', setByPerson('workflow.step.skip'), ctrl.skipStep);
    app.post('/api/v2/workflows/runs/:id/steps/:stepId/resume', setByPerson('workflow.step.resume'), ctrl.resumeStep);
    app.post('/api/v2/workflows/runs/:id/steps/:stepId/compensate', setByPerson('workflow.step.compensate'), ctrl.compensateStep);
    app.post('/api/v2/workflows/runs/:id/steps/:stepId/decide', ctrl.decideApproval);
    app.post('/api/v2/workflows/runs/:id/steps/:stepId/reassign', setByPerson('workflow.approval.reassign'), ctrl.reassignApproval);
};
