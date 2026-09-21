const sdkAuth = require('@modelcontextprotocol/sdk/client/auth.js');

/* How a scripted client gets the person's yes at /oauth/authorize. Until slice S3 (#805) ships the
 * consent screen, the only way through is the server's test-only consent header (NODE_ENV=test,
 * Modules/OAuthServer/consent.js). Once S3 merges, add a CONSENT_FLOWS.CONSENT_SCREEN branch that
 * answers the screen's own endpoints and make it the default here. */
const CONSENT_FLOWS = Object.freeze({ TEST_CONSENT_HEADER: 'test-consent-header' });
const CONSENT_FLOW = process.env.MCP_OAUTH_CONSENT_FLOW || CONSENT_FLOWS.TEST_CONSENT_HEADER;

const consentHeaders = (session, answer = 'approve') => {
    if (CONSENT_FLOW !== CONSENT_FLOWS.TEST_CONSENT_HEADER) throw new Error(`consent flow "${CONSENT_FLOW}" is not wired into the scripted client`);
    return { authorization: `Bearer ${session.accessToken}`, companyid: session.companyId, 'x-oauth-test-consent': answer };
};

/* Plays the browser: follows the authorization URL as the signed-in person and reads where the
 * server sends them back. */
async function answerAuthorization(authorizationUrl, session, answer = 'approve') {
    const res = await fetch(authorizationUrl, { redirect: 'manual', headers: consentHeaders(session, answer) });
    const location = res.headers.get('location');
    const back = location ? new URL(location) : null;
    const text = back ? '' : await res.text();
    return {
        status: res.status,
        location: back,
        code: back ? back.searchParams.get('code') : null,
        error: back ? back.searchParams.get('error') : (text ? JSON.parse(text).error : null),
    };
}

/* An in-memory OAuthClientProvider for the SDK's auth(): the redirect is captured, not opened. */
function memoryProvider({ redirectUrl, clientMetadata, clientMetadataUrl, clientInformation }) {
    const saved = { clientInformation, tokens: undefined, codeVerifier: '', authorizationUrl: null };
    return {
        saved,
        get redirectUrl() { return redirectUrl; },
        clientMetadataUrl,
        get clientMetadata() { return clientMetadata; },
        clientInformation: () => saved.clientInformation,
        saveClientInformation: (info) => { saved.clientInformation = info; },
        tokens: () => saved.tokens,
        saveTokens: (tokens) => { saved.tokens = tokens; },
        redirectToAuthorization: (url) => { saved.authorizationUrl = url; },
        saveCodeVerifier: (verifier) => { saved.codeVerifier = verifier; },
        codeVerifier: () => saved.codeVerifier,
        invalidateCredentials: (scope) => {
            if (scope === 'all' || scope === 'tokens') saved.tokens = undefined;
            if (scope === 'all' || scope === 'verifier') saved.codeVerifier = '';
        },
    };
}

/* The whole authorization code flow through the SDK: discovery, the redirect, consent, the exchange. */
async function authorizeWithSdk(provider, { serverUrl, scope, session }) {
    provider.saved.authorizationUrl = null;
    // With tokens in hand the SDK refreshes instead, which can only keep or narrow the scopes.
    provider.saved.tokens = undefined;
    const started = await sdkAuth.auth(provider, { serverUrl, scope });
    if (started === 'AUTHORIZED') return provider.saved.tokens;
    const answered = await answerAuthorization(provider.saved.authorizationUrl, session);
    if (!answered.code) throw new Error(`authorization refused (${answered.status}): ${answered.error}`);
    await sdkAuth.auth(provider, { serverUrl, authorizationCode: answered.code });
    return provider.saved.tokens;
}

module.exports = { CONSENT_FLOWS, CONSENT_FLOW, consentHeaders, answerAuthorization, memoryProvider, authorizeWithSdk, sdkAuth };
