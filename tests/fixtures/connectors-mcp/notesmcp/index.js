module.exports = {
    id: 'notesmcp',
    name: 'Notes',
    transport: 'mcp',
    mcp: { url: 'https://mcp.notes.test/mcp' },
    auth: {
        authorizeUrl: 'https://mcp.notes.test/authorize',
        tokenUrl: 'https://mcp.notes.test/token',
        pkce: 'S256',
    },
    products: { notes: [] },
    readAccount: ({ tokenResponse }) => ({ id: String(tokenResponse.account_id), label: '' }),
    egressHosts: ['mcp.notes.test'],
    rateLimit: { statuses: [429] },
};
