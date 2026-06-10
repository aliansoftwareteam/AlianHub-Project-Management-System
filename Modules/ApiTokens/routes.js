const ctrl = require('./controller');
const publicApi = require('./publicApi');

exports.init = (app) => {
    app.get('/api/v2/api-tokens/:id/logs', ctrl.listTokenLogs);
    app.get('/api/v2/api-tokens', ctrl.listTokens);
    app.post('/api/v2/api-tokens', ctrl.createToken);
    app.put('/api/v2/api-tokens/:id', ctrl.updateToken);
    app.delete('/api/v2/api-tokens/:id', ctrl.deleteToken);

    // Token-authenticated public REST namespace.
    publicApi.init(app);
}
