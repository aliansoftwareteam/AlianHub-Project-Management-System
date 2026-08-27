const ctrl = require('./controller');

exports.init = (app) => {
    app.post('/api/v1/automations/preview', ctrl.preview);
    app.get('/api/v1/automations/writeback', ctrl.listWriteback);
    app.put('/api/v1/automations/writeback/:projectId', ctrl.setWriteback);
    app.post('/api/v1/automations', ctrl.createRule);
    app.get('/api/v1/automations', ctrl.listRules);
    app.post('/api/v1/automations/:id/apply', ctrl.applyRule);
    app.put('/api/v1/automations/:id', ctrl.updateRule);
    app.delete('/api/v1/automations/:id', ctrl.deleteRule);
};
