const GRAPH_RESOURCE = 'https://graph.microsoft.com/';
const BASE_SCOPES = Object.freeze(['openid', 'profile', 'offline_access']);
/* Drafting a reply (createReply) needs Mail.ReadWrite at the least; Mail.Read cannot make a draft, and Mail.Send is
 * never asked for, so nothing can be sent. Creating an event needs Calendars.ReadWrite. */
const PRODUCTS = Object.freeze({
    mail: ['Mail.ReadWrite'],
    calendar: ['Calendars.ReadWrite'],
});
const KNOWN_SCOPES = Object.freeze([...BASE_SCOPES, ...Object.values(PRODUCTS).flat()]);

const decoded = (text) => {
    try { return decodeURIComponent(text); } catch (e) { return text; }
};

/* Microsoft names a granted Graph scope in the form and case it was consented in, sometimes as a full
 * https://graph.microsoft.com/ URI, where a tool names the short form. */
const canonicalScope = (granted) => {
    const text = decoded(String(granted));
    const short = text.toLowerCase().startsWith(GRAPH_RESOURCE) ? text.slice(GRAPH_RESOURCE.length) : text;
    return KNOWN_SCOPES.find((known) => known.toLowerCase() === short.toLowerCase()) || short;
};

const claimsOf = (idToken) => {
    try {
        return JSON.parse(Buffer.from(String(idToken || '').split('.')[1] || '', 'base64url').toString('utf8')) || {};
    } catch (e) {
        return {};
    }
};

/* Scopes and limits are the ones in 056 resources/research-matrix.md, section 5. The app is multi-tenant and takes
 * personal accounts, so the common endpoint serves both. Microsoft has no per-app revoke endpoint: a disconnect
 * retires the tokens here, and the person removes the app at account.microsoft.com or myapps.microsoft.com. */
module.exports = {
    id: 'outlook',
    name: 'Outlook',
    auth: {
        authorizeUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
        tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
        pkce: 'S256',
        baseScopes: [...BASE_SCOPES],
        tokenAnswer: (body) => (body && typeof body.scope === 'string'
            ? { ...body, scope: body.scope.split(/\s+/).filter(Boolean).map(canonicalScope).join(' ') }
            : body),
    },
    products: PRODUCTS,
    readAccount: ({ tokenResponse }) => {
        const claims = claimsOf(tokenResponse && tokenResponse.id_token);
        // `sub` differs per app, so a company app and the instance app would see one person as two; tid:oid does not.
        if (typeof claims.tid !== 'string' || typeof claims.oid !== 'string' || !claims.tid || !claims.oid) {
            throw new Error('outlook token response has no id_token tenant and object id');
        }
        const label = [claims.preferred_username, claims.email, claims.name].find((value) => typeof value === 'string' && value.trim()) || '';
        return { id: `${claims.tid}:${claims.oid}`, label: label.trim().slice(0, 254) };
    },
    egressHosts: ['login.microsoftonline.com', 'graph.microsoft.com'],
    rateLimit: { statuses: [429] },
    // interaction_required on a refresh means the person must sign in again (MFA, a password change, a new policy).
    deadGrantErrors: ['invalid_grant', 'interaction_required'],
};
