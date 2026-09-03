const ctrl = require('./controller');
const { agentPerimeter } = require('./guard');

exports.init = (app) => {
    // The perimeter runs for every request an agent token makes, before any module
    // route: the routes the registry does not name refuse and audit the attempt.
    app.use(agentPerimeter);

    // JWT + companyId: setMiddleware lists the /api/v2/agents prefix. Literal paths
    // come before /:id so they are never swallowed by the param route.
    app.get('/api/v2/agents/registry', ctrl.getRegistry);
    app.get('/api/v2/agents/spend', ctrl.spend);
    app.get('/api/v2/agents/team', ctrl.teamBoard);
    app.get('/api/v2/agents/routable', ctrl.routableTasks);
    app.post('/api/v2/agents/pause-all', ctrl.pauseAll);

    app.get('/api/v2/agents/runs/summary', ctrl.runSummary);
    app.get('/api/v2/agents/runs', ctrl.listRuns);
    app.post('/api/v2/agents/runs', ctrl.startRun);
    app.get('/api/v2/agents/runs/:id', ctrl.getRun);
    app.post('/api/v2/agents/runs/:id/stop', ctrl.stopRun);

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
    app.post('/api/v2/agents/:id/pause', ctrl.setPaused(true));
    app.post('/api/v2/agents/:id/resume', ctrl.setPaused(false));
};
