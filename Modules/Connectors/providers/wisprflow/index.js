const { accountFromToken } = require('../../tokenAccount');

/* Wispr Flow's own MCP server (task 095): the person's Notetaker meeting notes and transcripts, not their
 * dictation. It signs clients up itself; sign-in runs on mcp-auth.wisprflow.com with OpenID, so the account comes
 * from the id token. Endpoints from its published metadata, read 2026-11-12. */
module.exports = {
    id: 'wisprflow',
    name: 'Wispr Flow',
    transport: 'mcp',
    mcp: { url: 'https://api.wisprflow.ai/connect/mcp' },
    auth: {
        authorizeUrl: 'https://mcp-auth.wisprflow.com/oauth2/authorize',
        tokenUrl: 'https://mcp-auth.wisprflow.com/oauth2/token',
        pkce: 'S256',
        registration: 'dynamic',
        registrationUrl: 'https://mcp-auth.wisprflow.com/oauth2/register',
        baseScopes: ['openid', 'email', 'offline_access'],
    },
    products: { meetings: [] },
    readAccount: accountFromToken(['user_id']),
    egressHosts: ['api.wisprflow.ai', 'mcp-auth.wisprflow.com'],
    rateLimit: { statuses: [429] },
    deadGrantErrors: ['invalid_grant'],
};
