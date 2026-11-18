/* Dropbox as a module provider (076, FR-39). It backs the attachment picker's "import a copy" and
 * disconnect-revoke, and later its own tools; the pick itself still runs in the Dropbox Chooser, which
 * takes the app key (this provider's OAuth client id) in the browser and needs no token.
 *
 * Dropbox returns the account id in the token response itself, so readAccount needs no extra call. Its
 * revoke endpoint authenticates with the token in the Authorization header rather than a form field
 * (unlike Google's), so the definition marks `revokeAuth: 'bearer'` — see providerApi.revoke.
 *
 * Its AI tools (task 095) go through Dropbox's own MCP server, which takes the same Dropbox OAuth token, so one
 * connection backs both the picker and the AI. */
module.exports = {
    id: 'dropbox',
    name: 'Dropbox',
    transport: 'mcp',
    mcp: { url: 'https://mcp.dropbox.com/mcp' },
    auth: {
        authorizeUrl: 'https://www.dropbox.com/oauth2/authorize',
        tokenUrl: 'https://api.dropboxapi.com/oauth2/token',
        revokeUrl: 'https://api.dropboxapi.com/2/auth/token/revoke',
        // Dropbox revokes an access token (revokeWith) sent in the Authorization header (revokeAuth), not a refresh
        // token in a form field — see connection.revokeToken and providerApi.revoke.
        revokeWith: 'access',
        revokeAuth: 'bearer',
        pkce: 'S256',
        // Without offline access Dropbox returns only a short-lived token and no refresh token.
        extraParams: { token_access_type: 'offline' },
    },
    products: {
        files: ['files.content.read', 'files.metadata.read', 'account_info.read'],
    },
    readAccount: ({ tokenResponse }) => {
        const id = tokenResponse && (tokenResponse.account_id || tokenResponse.uid);
        // The unique index keys on the account id, so a response without one would collapse every account into ''.
        if (!id) throw new Error('dropbox token response has no account_id');
        return { id: String(id), label: '' };
    },
    egressHosts: ['www.dropbox.com', 'api.dropboxapi.com', 'content.dropboxapi.com', 'mcp.dropbox.com'],
    rateLimit: { statuses: [429] },
    deadGrantErrors: ['invalid_grant'],
};
