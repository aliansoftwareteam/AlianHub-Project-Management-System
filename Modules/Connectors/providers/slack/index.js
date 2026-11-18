/* Scopes and limits are the ones read in task 074 (056 resources/research-matrix.md, section 9). User scopes only,
 * and the Slack app must have token rotation on: without it Slack sends no refresh token and the connection is
 * refused. No im:* or mpim:* scope, so no direct message is ever listed or read. */
module.exports = {
    id: 'slack',
    name: 'Slack',
    auth: {
        authorizeUrl: 'https://slack.com/oauth/v2/authorize',
        tokenUrl: 'https://slack.com/api/oauth.v2.access',
        revokeUrl: 'https://slack.com/api/auth.revoke',
        scopeParam: 'user_scope',
        scopeSeparator: ',',
        revokeWith: 'access',
        tokenAnswer: (body) => (body && body.authed_user && body.authed_user.access_token ? body.authed_user : body),
    },
    products: {
        messages: ['channels:read', 'groups:read', 'channels:history', 'groups:history', 'chat:write'],
    },
    readAccount: ({ tokenResponse }) => {
        const team = (tokenResponse && tokenResponse.team) || {};
        const user = (tokenResponse && tokenResponse.authed_user) || {};
        if (!team.id || !user.id) throw new Error('slack token response names no workspace or user');
        // A Slack user id is unique only inside its workspace.
        return { id: `${team.id}:${user.id}`, label: team.name || team.id };
    },
    answerError: (body) => (body && body.ok === false ? String(body.error || 'unknown_error') : ''),
    egressHosts: ['slack.com'],
    rateLimit: { statuses: [429] },
    deadGrantErrors: ['invalid_code', 'invalid_grant', 'invalid_refresh_token', 'invalid_auth', 'token_revoked', 'token_expired', 'not_authed', 'account_inactive'],
};
