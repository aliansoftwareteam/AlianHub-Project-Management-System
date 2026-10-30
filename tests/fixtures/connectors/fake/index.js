module.exports = {
    id: 'fake',
    name: 'Fake Notes',
    auth: { authorizeUrl: 'https://auth.fake.test/authorize', tokenUrl: 'https://auth.fake.test/token', pkce: 'S256' },
    products: { notes: ['notes.read'], files: ['files.read'] },
    readAccount: ({ tokenResponse }) => ({ id: String(tokenResponse.sub), label: String(tokenResponse.email) }),
    egressHosts: ['auth.fake.test', 'api.fake.test'],
};
