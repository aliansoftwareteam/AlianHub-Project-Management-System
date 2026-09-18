const ctrl = require('./controller');

exports.init = (app) => {
    // Owners and admins only, never an API token; the handlers check the seat themselves. Metadata only: no route returns a value.
    app.get('/api/v2/secrets', ctrl.listSecrets);
    app.post('/api/v2/secrets/:handle/rotate', ctrl.rotateSecret);
    app.post('/api/v2/secrets/:handle/revoke', ctrl.revokeSecret);
};
