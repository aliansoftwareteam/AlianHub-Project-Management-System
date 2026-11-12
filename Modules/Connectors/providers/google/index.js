const SCOPE = 'https://www.googleapis.com/auth/';

/* The ID token came straight from Google's token endpoint over TLS, in answer to this server's own client
 * secret, so its claims are read without checking a signature (OpenID Connect Core 3.1.3.7). */
const accountOf = (idToken) => {
    try {
        const claims = JSON.parse(Buffer.from(String(idToken || '').split('.')[1] || '', 'base64url').toString('utf8'));
        const email = typeof claims.email === 'string' && claims.email_verified !== false ? claims.email.slice(0, 254) : '';
        return { email, sub: typeof claims.sub === 'string' ? claims.sub.slice(0, 64) : '' };
    } catch (e) {
        return { email: '', sub: '' };
    }
};

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
        extraParams: { access_type: 'offline' },
        baseScopes: ['openid', 'email'],
    },
    products: {
        calendar: [`${SCOPE}calendar.events.readonly`, `${SCOPE}calendar.events.owned`, `${SCOPE}calendar.app.created`],
        meet: [`${SCOPE}meetings.space.created`, `${SCOPE}meetings.space.readonly`],
        drive: [`${SCOPE}drive.file`],
    },
    readAccount: ({ tokenResponse }) => {
        const { sub, email } = accountOf(tokenResponse && tokenResponse.id_token);
        // Without `sub` every account would be stored as id '', and the unique index would treat them as one.
        if (!sub) throw new Error('google token response has no id_token subject');
        return { id: sub, label: email };
    },
    egressHosts: ['accounts.google.com', 'oauth2.googleapis.com', 'www.googleapis.com', 'meet.googleapis.com'],
    rateLimit: { statuses: [403, 429] },
    deadGrantErrors: ['invalid_grant'],
};
