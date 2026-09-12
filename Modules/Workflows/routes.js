const ctrl = require('./controller');

exports.init = (app) => {
    // JWT + companyId: setMiddleware lists the /api/v2/workflows prefix, so every
    // route below has a verified caller and a verified company before it runs.
    app.get('/api/v2/workflows/runs', ctrl.listRuns);
    app.post('/api/v2/workflows/runs', ctrl.startRun);
    app.get('/api/v2/workflows/runs/:id', ctrl.getRun);
    app.post('/api/v2/workflows/runs/:id/steps/:stepId/retry', ctrl.retryStep);
    app.post('/api/v2/workflows/runs/:id/steps/:stepId/skip', ctrl.skipStep);
    app.post('/api/v2/workflows/runs/:id/steps/:stepId/resume', ctrl.resumeStep);
    app.post('/api/v2/workflows/runs/:id/steps/:stepId/compensate', ctrl.compensateStep);
};
