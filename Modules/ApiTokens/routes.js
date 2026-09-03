const ctrl = require('./controller');
const publicApi = require('./publicApi');

exports.init = (app) => {
    // whoami — the one api-tokens route PAT auth may call (see Config/jwt.js).
    app.get('/api/v2/api-tokens/me', ctrl.whoami);
    app.get('/api/v2/api-tokens/:id/logs', ctrl.listTokenLogs);
    // Mints the scoped token a CLI agent pastes into its MCP client. Before /:id
    // so "mcp" is never read as a token id.
    app.post('/api/v2/api-tokens/mcp', ctrl.createMcpToken);
    app.get('/api/v2/api-tokens', ctrl.listTokens);
    app.post('/api/v2/api-tokens', ctrl.createToken);
    app.put('/api/v2/api-tokens/:id', ctrl.updateToken);
    app.delete('/api/v2/api-tokens/:id', ctrl.deleteToken);

    // Token-authenticated public REST namespace.
    publicApi.init(app);
}
