const ctrl = require('./controller');
const aiDraft = require('./aiDraft');
const { setByPerson } = require('../Agents/personDecides');
const { agentsRefused } = require('../Agents/guard');

exports.init = (app) => {
    // JWT + companyId: setMiddleware protects the /api/v1/automations and
    // /api/v2/automations prefixes. /registry and /preview come before /:id so a
    // literal path is never swallowed by the param route.
    app.get('/api/v2/automations/registry', ctrl.getRegistry);
    app.post('/api/v2/automations/compile', ctrl.compileSentence);
    app.post('/api/v2/automations/draft', aiDraft.draftHandler);
    app.post('/api/v2/automations/backtest', ctrl.backtest);
    app.get('/api/v2/automations', ctrl.listRulesV2);
    app.post('/api/v2/automations', setByPerson('automation.create'), ctrl.createRuleV2);
    app.put('/api/v2/automations/:id', setByPerson('automation.update'), ctrl.updateRuleV2);
    app.patch('/api/v2/automations/:id/enabled', setByPerson('automation.enable'), ctrl.setRuleEnabled);
    app.get('/api/v2/automations/:id/runs', ctrl.listRuns);
    app.post('/api/v2/automations/:id/dry-run', ctrl.dryRun);
    app.delete('/api/v2/automations/:id', setByPerson('automation.delete'), ctrl.deleteRule);

    app.post('/api/v1/automations/preview', ctrl.preview);
    app.post('/api/v1/automations', setByPerson('automation.create'), ctrl.createRule);
    app.get('/api/v1/automations', ctrl.listRules);
    app.post('/api/v1/automations/:id/apply', agentsRefused('automation.apply'), ctrl.applyRule);
    app.put('/api/v1/automations/:id', setByPerson('automation.update'), ctrl.updateRule);
    app.delete('/api/v1/automations/:id', setByPerson('automation.delete'), ctrl.deleteRule);
};
