const { accountOf } = require('../../../Agents/connectors/googleApi');

const SCOPE = 'https://www.googleapis.com/auth/';

/* Scopes and limits are the ones confirmed in task 061 (056 resources/research-matrix.md). Meet stays on
 * meeting spaces: recordings and transcripts need restricted Drive scopes. */
module.exports = {
    id: 'google',
    name: 'Google',
    auth: {
        authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
        tokenUrl: 'https://oauth2.googleapis.com/token',
        revokeUrl: 'https://oauth2.googleapis.com/revoke',
        pkce: 'S256',
        extraParams: { access_type: 'offline', include_granted_scopes: 'true' },
        baseScopes: ['openid', 'email'],
    },
    products: {
        calendar: [`${SCOPE}calendar.events.readonly`, `${SCOPE}calendar.events.owned`, `${SCOPE}calendar.app.created`],
        meet: [`${SCOPE}meetings.space.created`, `${SCOPE}meetings.space.readonly`],
        drive: [`${SCOPE}drive.file`],
    },
    readAccount: ({ tokenResponse }) => {
        const { sub, email } = accountOf(tokenResponse && tokenResponse.id_token);
        return { id: sub, label: email };
    },
    egressHosts: ['accounts.google.com', 'oauth2.googleapis.com', 'www.googleapis.com', 'meet.googleapis.com'],
    rateLimit: { statuses: [403, 429] },
    deadGrantErrors: ['invalid_grant'],
};
