const server = require('./server');
const tools = require('./tools');
const registry = require('../Agents/registry');
const mcpOAuth = require('../../Config/mcpOAuth');

/* RFC 9728 §2 and §3.2. Public and secret-free: a client reads it before it holds a token. */
const protectedResourceMetadata = (env) => (req, res) => res.json({
    resource: mcpOAuth.resource(env),
    authorization_servers: [mcpOAuth.issuer(env)],
    scopes_supported: [...mcpOAuth.SCOPES],
    bearer_methods_supported: ['header'],
    resource_name: 'AlianHub MCP',
});

exports.init = (app, env = process.env) => {
    if (mcpOAuth.isOn(env)) {
        const metadata = protectedResourceMetadata(env);
        app.get('/.well-known/oauth-protected-resource', metadata);
        app.get('/.well-known/oauth-protected-resource/mcp', metadata);
    }

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
