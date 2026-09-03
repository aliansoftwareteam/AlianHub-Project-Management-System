const server = require('./server');
const tools = require('./tools');
const registry = require('../Agents/registry');

exports.init = (app) => {
    // The MCP endpoint authenticates its own scoped bearer PAT, so it is
    // deliberately outside the cookie/JWT middleware.
    app.post('/mcp', server.post);
    app.get('/mcp', server.get);

    // Unauthenticated, secret-free: what a CLI agent may and may not do here.
    app.get('/mcp/manifest', (req, res) => res.send({
        status: true,
        data: {
            protocolVersion: server.PROTOCOL_VERSION,
            tools: tools.manifest(),
            never: registry.NEVER,
        },
    }));
};
