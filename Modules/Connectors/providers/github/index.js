/* GitHub through its own MCP server (task 075). GitHub's server does not sign clients up itself, so this needs a
 * GitHub App registered once: the shared sign-in service's on hosted instances, the instance's or the company's
 * elsewhere (docs/connectors/github.md). A GitHub App's user tokens expire and refresh, which the module needs, and
 * carry the app's permissions rather than scopes, so no scope is asked for. A member may paste a fine-grained
 * personal token instead. GitHub has no per-app revoke the module can call; disconnect retires the tokens here. */
module.exports = {
    id: 'github',
    name: 'GitHub',
    transport: 'mcp',
    mcp: { url: 'https://api.githubcopilot.com/mcp/' },
    auth: {
        authorizeUrl: 'https://github.com/login/oauth/authorize',
        tokenUrl: 'https://github.com/login/oauth/access_token',
        pkce: 'S256',
        personalToken: true,
    },
    products: { repos: [] },
    account: { url: 'https://api.github.com/user', read: (body) => ({ id: body.id, label: body.login }) },
    egressHosts: ['github.com', 'api.github.com', 'api.githubcopilot.com'],
    rateLimit: { statuses: [403, 429] },
    deadGrantErrors: ['bad_refresh_token', 'invalid_grant'],
};
