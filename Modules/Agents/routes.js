const logger = require('../../Config/loggerConfig');
const ctrl = require('./controller');

/**
 * Error boundary for every handler in this module.
 *
 * index.js registers `process.on('unhandledRejection', … process.exit(1))`, and
 * Express 4 does not catch async rejections — so one throw inside a handler takes
 * the whole server down. Agents are the last thing that should be able to do that:
 * they will eventually call a model over the network, on a schedule, with
 * user-authored text as input. Every failure mode there has to end as a response,
 * not an outage.
 */
const safe = (name, handler) => async (req, res, next) => {
    try {
        await handler(req, res, next);
    } catch (e) {
        logger.error(`[agents] unhandled error in ${name}: ${(e && e.stack) || e}`);
        if (res.headersSent) return;
        try {
            res.status(200).send({ status: false, statusText: (e && e.message) || 'Unexpected error.' });
        } catch (sendError) {
            logger.error(`[agents] could not send error response for ${name}: ${sendError.message}`);
        }
    }
};

exports.init = (app) => {
    // JWT + companyId (setMiddleware protects /api/v1/agents).
    //
    // Literal paths are registered BEFORE /:id so "catalogue", "available",
    // "runs", "usage" and "disable-all" are never captured as an agent id.
    app.get('/api/v1/agents/catalogue', safe('catalogue', ctrl.catalogue));
    app.get('/api/v1/agents/available', safe('availableAgents', ctrl.availableAgents));
    app.get('/api/v1/agents/runs', safe('listRuns', ctrl.listRuns));
    // Before /:id so "runs" is never captured as an agent id.
    app.post('/api/v1/agents/runs/:runId/decide', safe('decideRun', ctrl.decideRun));
    app.get('/api/v1/agents/usage', safe('usage', ctrl.usage));
    app.get('/api/v1/agents/scope-options', safe('scopeOptions', ctrl.scopeOptions));
    app.post('/api/v1/agents/disable-all', safe('disableAll', ctrl.disableAll));

    app.get('/api/v1/agents', safe('listAgents', ctrl.listAgents));
    app.post('/api/v1/agents', safe('createAgent', ctrl.createAgent));
    app.post('/api/v1/agents/:id/toggle', safe('toggleAgent', ctrl.toggleAgent));
    app.get('/api/v1/agents/:id/test-targets', safe('testTargets', ctrl.testTargets));
    app.post('/api/v1/agents/:id/assign', safe('assignToTask', ctrl.assignToTask));
    app.post('/api/v1/agents/:id/test-run', safe('testRun', ctrl.testRun));
    app.post('/api/v1/agents/:id/run', safe('runNow', ctrl.runNow));
    app.put('/api/v1/agents/:id', safe('updateAgent', ctrl.updateAgent));
    app.delete('/api/v1/agents/:id', safe('deleteAgent', ctrl.deleteAgent));
};

exports.__test__ = { safe };
