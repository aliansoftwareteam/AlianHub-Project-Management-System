module.exports = {
    id: 'selfreg',
    name: 'Selfreg',
    transport: 'mcp',
    mcp: { url: 'https://mcp.selfreg.test/mcp' },
    auth: {
        authorizeUrl: 'https://auth.selfreg.test/authorize',
        tokenUrl: 'https://auth.selfreg.test/token',
        pkce: 'S256',
        registration: 'dynamic',
        registrationUrl: 'https://auth.selfreg.test/register',
    },
    products: { workspace: [] },
    account: { url: 'https://api.selfreg.test/me', read: (body) => ({ id: body.id, label: body.name }) },
    egressHosts: ['mcp.selfreg.test', 'auth.selfreg.test', 'api.selfreg.test'],
};
