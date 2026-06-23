const ctrl = require('./controller');

exports.init = (app) => {
    // JWT + companyId (setMiddleware protects /api/v1/automations). /preview before :id.
    app.post('/api/v1/automations/preview', ctrl.preview);
    app.post('/api/v1/automations', ctrl.createRule);
    app.get('/api/v1/automations', ctrl.listRules);
    app.post('/api/v1/automations/:id/apply', ctrl.applyRule);
    app.put('/api/v1/automations/:id', ctrl.updateRule);
    app.delete('/api/v1/automations/:id', ctrl.deleteRule);
};
