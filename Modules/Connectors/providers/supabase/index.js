const { accountFromToken } = require('../../tokenAccount');

/* Supabase's own MCP server (task 095). It signs clients up itself, but its token endpoint takes only confidential
 * clients, so the sign-up asks for a secret. Read access only: writing SQL is left out of the first version.
 * Endpoints and scopes from its published metadata, read 2026-11-12. */
module.exports = {
    id: 'supabase',
    name: 'Supabase',
    transport: 'mcp',
    mcp: { url: 'https://mcp.supabase.com/mcp' },
    auth: {
        authorizeUrl: 'https://api.supabase.com/v1/oauth/authorize',
        tokenUrl: 'https://api.supabase.com/v1/oauth/token',
        pkce: 'S256',
        registration: 'dynamic',
        registrationUrl: 'https://api.supabase.com/platform/oauth/apps/register',
        registrationAuth: 'client_secret_post',
    },
    products: { projects: ['organizations:read', 'projects:read', 'database:read'] },
    readAccount: accountFromToken(['user_id', 'organization_id']),
    egressHosts: ['mcp.supabase.com', 'api.supabase.com'],
    rateLimit: { statuses: [429] },
    deadGrantErrors: ['invalid_grant'],
};
