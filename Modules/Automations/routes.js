const ctrl = require('./controller');

exports.init = (app) => {
    // JWT + companyId: setMiddleware protects the /api/v1/automations and
    // /api/v2/automations prefixes. /registry and /preview come before /:id so a
    // literal path is never swallowed by the param route.
    app.get('/api/v2/automations/registry', ctrl.getRegistry);
    app.post('/api/v2/automations/compile', ctrl.compileSentence);
    app.post('/api/v2/automations/backtest', ctrl.backtest);
    app.get('/api/v2/automations', ctrl.listRulesV2);
    app.post('/api/v2/automations', ctrl.createRuleV2);
    app.put('/api/v2/automations/:id', ctrl.updateRuleV2);
    app.patch('/api/v2/automations/:id/enabled', ctrl.setRuleEnabled);
    app.get('/api/v2/automations/:id/runs', ctrl.listRuns);
    app.delete('/api/v2/automations/:id', ctrl.deleteRule);

    app.post('/api/v1/automations/preview', ctrl.preview);
    app.post('/api/v1/automations', ctrl.createRule);
    app.get('/api/v1/automations', ctrl.listRules);
    app.post('/api/v1/automations/:id/apply', ctrl.applyRule);
    app.put('/api/v1/automations/:id', ctrl.updateRule);
    app.delete('/api/v1/automations/:id', ctrl.deleteRule);
};
