const ctrl = require('./controller');
const config = require('./config');

/* JWT and companyId come from setMiddleware's /api/v2/agent-sessions prefix. With the flag off nothing is registered. */
exports.init = (app, env = process.env) => {
    if (!config.isOn(env)) return;
    app.get('/api/v2/agent-sessions/endpoints', ctrl.listEndpoints);
    app.put('/api/v2/agent-sessions/endpoints', ctrl.saveEndpoint);
    app.get('/api/v2/agent-sessions', ctrl.listForTask);
    app.post('/api/v2/agent-sessions', ctrl.delegate);
};
