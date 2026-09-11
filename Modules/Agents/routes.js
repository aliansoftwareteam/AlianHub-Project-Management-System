const ctrl = require('./controller');
const memoryCtrl = require('./memoryController');
const skillsCtrl = require('./skillsController');
const metricsCtrl = require('./metricsController');
const { agentPerimeter } = require('./guard');

exports.init = (app) => {
    // The perimeter runs for every request an agent token makes, before any module
    // route: the routes the registry does not name refuse and audit the attempt.
    app.use(agentPerimeter);

    // JWT + companyId: setMiddleware lists the /api/v2/agents prefix. Literal paths
    // come before /:id so they are never swallowed by the param route.
    app.get('/api/v2/agents/registry', ctrl.getRegistry);
    app.get('/api/v2/agents/manifest', skillsCtrl.agentManifest);
    app.get('/api/v2/agents/spend', ctrl.spend);
    app.get('/api/v2/agents/team', ctrl.teamBoard);
    app.get('/api/v2/agents/routable', ctrl.routableTasks);
    app.get('/api/v2/agents/pipeline', ctrl.pipelineTasks);
    app.get('/api/v2/agents/release', ctrl.releaseCandidate);
    app.post('/api/v2/agents/pause-all', ctrl.pauseAll);
    app.get('/api/v2/agents/settings', ctrl.getSettings);
    app.put('/api/v2/agents/settings', ctrl.putSettings);
    app.get('/api/v2/agents/budget', ctrl.getBudget);
    app.get('/api/v2/agents/metrics', metricsCtrl.getMetrics);

    app.get('/api/v2/agents/skills/catalogues', skillsCtrl.getCatalogues);
    app.get('/api/v2/agents/skills', skillsCtrl.listSkills);
    app.post('/api/v2/agents/skills', skillsCtrl.createSkill);
    app.get('/api/v2/agents/skills/:key', skillsCtrl.getSkill);
    app.put('/api/v2/agents/skills/:key', skillsCtrl.updateSkill);
    app.delete('/api/v2/agents/skills/:key', skillsCtrl.retireSkill);

    app.get('/api/v2/agents/memory/project/:projectId', memoryCtrl.getProjectMemory);
    app.post('/api/v2/agents/memory/project/:projectId', memoryCtrl.addProjectMemory);
    app.put('/api/v2/agents/memory/:id', memoryCtrl.updateMemory);
    app.get('/api/v2/agents/preferences', memoryCtrl.getPreferences);
    app.put('/api/v2/agents/preferences', memoryCtrl.putPreferences);

    app.get('/api/v2/agents/runs/summary', ctrl.runSummary);
    app.get('/api/v2/agents/runs', ctrl.listRuns);
    app.post('/api/v2/agents/runs', ctrl.startRun);
    app.get('/api/v2/agents/runs/:id', ctrl.getRun);
    app.get('/api/v2/agents/runs/:id/replay', ctrl.getRunReplay);
    app.post('/api/v2/agents/runs/:id/stop', ctrl.stopRun);
    app.post('/api/v2/agents/runs/:id/revert', ctrl.revertRun);

    app.get('/api/v2/agents/proposals', ctrl.listProposals);
    app.post('/api/v2/agents/proposals', ctrl.createProposal);
    app.post('/api/v2/agents/proposals/:id/approve', ctrl.approveProposal);
    app.post('/api/v2/agents/proposals/:id/decline', ctrl.declineProposal);
    app.post('/api/v2/agents/proposals/:id/undo', ctrl.undoProposal);

    app.get('/api/v2/agents/account', ctrl.getAccount);
    app.put('/api/v2/agents/account', ctrl.linkAccount);
    app.delete('/api/v2/agents/account', ctrl.unlinkAccount);
    app.get('/api/v2/agents/policy', ctrl.getPolicy);
    app.put('/api/v2/agents/policy', ctrl.setPolicy);

    app.get('/api/v2/agents', ctrl.listAgents);
    app.post('/api/v2/agents', ctrl.createAgent);
    app.put('/api/v2/agents/:id', ctrl.updateAgent);
    app.delete('/api/v2/agents/:id', ctrl.deleteAgent);
    app.post('/api/v2/agents/:id/pause', ctrl.setPaused(true));
    app.post('/api/v2/agents/:id/resume', ctrl.setPaused(false));
    app.get('/api/v2/agents/:id/revisions', ctrl.listRevisions);
    app.post('/api/v2/agents/:id/revisions', ctrl.createRevision);
    app.get('/api/v2/agents/:id/revisions/:n', ctrl.getRevision);
    app.post('/api/v2/agents/:id/revisions/:n/promote', ctrl.promoteRevision);
    app.post('/api/v2/agents/:id/revisions/:n/rollback', ctrl.rollbackRevision);
};
