const sdkAuth = require('@modelcontextprotocol/sdk/client/auth.js');

const consentFlow = require('../fixtures/oauthConsent');

/* Plays the browser and the person: follows the authorization URL to the consent screen, then answers it the
 * way the screen's form does, with the request's CSRF cookie and token and the person's session cookie, for
 * the person's workspace. A refusal before the screen comes back as the server sent it. */
async function answerAuthorization(authorizationUrl, session, answer = 'approve') {
    const started = await consentFlow.startAuthorization(String(authorizationUrl));
    const out = started.consent
        ? await consentFlow.answer(started.consent, { session: `accessToken=${session.accessToken}`, workspace: session.companyId, decision: answer })
        : started;
    const back = out.location;
    const body = out.body && typeof out.body === 'object' ? out.body : null;
    return {
        status: out.status,
        location: back,
        code: back ? back.searchParams.get('code') : null,
        error: back ? back.searchParams.get('error') : (body ? body.error : null),
    };
}

/* A workspace owner or admin approves the client, as a person's consent needs. */
async function approveClient(baseURL, session, clientId, scopes) {
    const res = await fetch(`${baseURL}/api/v2/oauth-client-approvals/approve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${session.accessToken}`, companyid: session.companyId },
        body: JSON.stringify({ clientId, ...(scopes ? { scopes } : {}) }),
    });
    const body = await res.json();
    if (res.status !== 200) throw new Error(`approving ${clientId} failed (${res.status}): ${JSON.stringify(body).slice(0, 300)}`);
    return body.data;
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

module.exports = { answerAuthorization, approveClient, memoryProvider, authorizeWithSdk, sdkAuth };
