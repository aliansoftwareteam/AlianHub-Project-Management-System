module.exports = {
    id: 'slowmcp',
    name: 'Slow',
    transport: 'mcp',
    mcp: { url: 'https://mcp.slow.test/mcp' },
    auth: {
        authorizeUrl: 'https://mcp.slow.test/authorize',
        tokenUrl: 'https://mcp.slow.test/token',
        pkce: 'S256',
    },
    products: { notes: [] },
    readAccount: ({ tokenResponse }) => ({ id: String(tokenResponse.account_id), label: '' }),
    egressHosts: ['mcp.slow.test'],
    rateLimit: { statuses: [429] },
};
