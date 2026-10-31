module.exports = {
    id: 'fake',
    name: 'Fake',
    auth: {
        authorizeUrl: 'https://auth.fake.test/authorize',
        tokenUrl: 'https://api.fake.test/token',
        pkce: 'S256',
        baseScopes: ['profile'],
    },
    products: {
        notes: ['notes.read', 'notes.write'],
        files: ['files.read', 'notes.read'],
    },
    readAccount: ({ tokenResponse }) => ({ id: String(tokenResponse.account_id), label: String(tokenResponse.email || '') }),
    egressHosts: ['auth.fake.test', 'api.fake.test'],
    rateLimit: { statuses: [403, 429] },
};
