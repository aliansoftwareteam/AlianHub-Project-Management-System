/* A stand-in for the GitHub connector of task 075, so the AI chat's pull request rule is tested before that exists. */
module.exports = {
    id: 'github',
    name: 'GitHub',
    auth: {
        authorizeUrl: 'https://github.test/login/oauth/authorize',
        tokenUrl: 'https://github.test/login/oauth/access_token',
        pkce: 'S256',
    },
    products: { repos: ['repo'] },
    readAccount: ({ tokenResponse }) => ({ id: String(tokenResponse.account_id), label: String(tokenResponse.login || '') }),
    egressHosts: ['github.test', 'api.github.test'],
    rateLimit: { statuses: [403, 429] },
};
