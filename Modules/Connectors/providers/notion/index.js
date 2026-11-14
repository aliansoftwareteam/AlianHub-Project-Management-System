const { accountFromToken } = require('../../tokenAccount');

/* Notion's own MCP server (task 094). It signs clients up itself, so an install sets nothing for it: AlianHub
 * registers once per workspace. Endpoints from its published metadata, read 2026-11-12. */
module.exports = {
    id: 'notion',
    name: 'Notion',
    transport: 'mcp',
    mcp: { url: 'https://mcp.notion.com/mcp' },
    auth: {
        authorizeUrl: 'https://mcp.notion.com/authorize',
        tokenUrl: 'https://mcp.notion.com/token',
        pkce: 'S256',
        registration: 'dynamic',
        registrationUrl: 'https://mcp.notion.com/register',
    },
    products: { workspace: [] },
    readAccount: accountFromToken(['workspace_id', 'bot_id', 'owner.user.id'], ['workspace_name']),
    egressHosts: ['mcp.notion.com'],
    rateLimit: { statuses: [429] },
    deadGrantErrors: ['invalid_grant'],
};
