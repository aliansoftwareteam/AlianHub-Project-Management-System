const ctrl = require('./controller');

exports.init = (app) => {
    // Owners and admins only, never an API token; the handlers check the seat themselves. Metadata only: no route returns a key.
    app.get('/api/v2/provider-keys', ctrl.listProviderKeys);
    app.put('/api/v2/provider-keys/:provider', ctrl.setProviderKey);
    app.delete('/api/v2/provider-keys/:provider', ctrl.clearProviderKey);
};
