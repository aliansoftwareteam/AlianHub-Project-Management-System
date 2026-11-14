module.exports = {
    id: 'pat',
    name: 'Pat',
    auth: {
        authorizeUrl: 'https://auth.pat.test/authorize',
        tokenUrl: 'https://auth.pat.test/token',
        pkce: 'S256',
        personalToken: true,
    },
    products: { repos: ['repo'] },
    account: { url: 'https://api.pat.test/user', read: (body) => ({ id: body.id, label: body.login }) },
    egressHosts: ['auth.pat.test', 'api.pat.test'],
};
