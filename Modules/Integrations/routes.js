const ctrl = require('./controller');

exports.init = (app) => {
    // JWT + companyId (setMiddleware protects /api/v1/integrations).
    app.get('/api/v1/integrations/catalog', ctrl.listCatalog);
    app.get('/api/v1/integrations/connections', ctrl.listConnections);
    app.post('/api/v1/integrations/connections', ctrl.connect);
    app.put('/api/v1/integrations/connections/:id', ctrl.updateConnection);
    app.delete('/api/v1/integrations/connections/:id', ctrl.disconnect);
};
