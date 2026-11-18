const crypto = require('node:crypto');
const http = require('node:http');
const jose = require('jose');
const { MongoClient } = require('mongodb');
const { test, expect } = require('../support/test');
const { resolveMongoUrl } = require('../support/env');
const { assertOk, createWorkspace, inviteMember, loginAs, readState, uniqueSuffix } = require('../support/fixtures');

/* Single sign-on in a real browser, from the login page to the workspace (issue 1781: the identity provider's
 * redirect used to end on the login page again). The identity provider is a loopback OIDC server that signs in
 * whoever the test names, so the browser walks every redirect the real flow takes. */

const CLIENT_ID = 'alianhub-e2e-sso';
const IDP_NAME = 'Acme Identity';
const SSO_BUTTON = 'Continue with company sign-in (SAML / OIDC)';
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function startIdp() {
    const { privateKey, publicKey } = await jose.generateKeyPair('RS256');
    const jwk = { ...(await jose.exportJWK(publicKey)), kid: 'e2e-sso', alg: 'RS256', use: 'sig' };
    const codes = new Map();
    const idp = { signInAs: '', loginHints: [] };
    const server = http.createServer((req, res) => {
        const url = new URL(req.url, 'http://127.0.0.1');
        const issuer = `http://127.0.0.1:${server.address().port}`;
        const json = (body) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
        if (url.pathname === '/.well-known/openid-configuration') {
            return json({
                issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/jwks`,
                response_types_supported: ['code'], subject_types_supported: ['public'], id_token_signing_alg_values_supported: ['RS256'],
                token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
            });
        }
        if (url.pathname === '/jwks') return json({ keys: [jwk] });
        if (url.pathname === '/authorize') {
            idp.loginHints.push(url.searchParams.get('login_hint'));
            const code = crypto.randomBytes(12).toString('hex');
            codes.set(code, { email: idp.signInAs, nonce: url.searchParams.get('nonce') });
            const back = new URL(url.searchParams.get('redirect_uri'));
            back.searchParams.set('code', code);
            back.searchParams.set('state', url.searchParams.get('state'));
            res.writeHead(302, { location: back.toString() });
            return res.end();
        }
        if (url.pathname === '/token') {
            let raw = '';
            req.on('data', (chunk) => { raw += chunk; });
            req.on('end', async () => {
                const code = new URLSearchParams(raw).get('code');
                const grant = codes.get(code);
                codes.delete(code);
                if (!grant) { res.writeHead(400, { 'content-type': 'application/json' }); res.end('{"error":"invalid_grant"}'); return; }
                const idToken = await new jose.SignJWT({ email: grant.email, given_name: 'Sam', family_name: 'Signon', nonce: grant.nonce })
                    .setProtectedHeader({ alg: 'RS256', kid: 'e2e-sso' })
                    .setIssuer(issuer).setAudience(CLIENT_ID).setSubject(grant.email)
                    .setIssuedAt().setExpirationTime('5m')
                    .sign(privateKey);
                json({ access_token: 'e2e-sso-access', token_type: 'Bearer', expires_in: 300, id_token: idToken });
            });
            return undefined;
        }
        res.writeHead(404);
        return res.end();
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    idp.issuer = `http://127.0.0.1:${server.address().port}`;
    idp.close = () => new Promise((resolve) => server.close(resolve));
    return idp;
}

// The landing reloads once it has the workspace's address, and only the reloaded page boots the workspace.
const landedIn = async (page, path) => {
    await page.waitForURL(new RegExp(`#${escapeRegex(path)}(/|\\?|$)`), { timeout: 60000 });
    await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible({ timeout: 60000 });
    await page.waitForFunction("window.localStorage.getItem('isLogging') === 'true'");
};

const remembered = (page) => page.evaluate("({ userId: window.localStorage.getItem('userId'), workspace: window.localStorage.getItem('selectedCompany') })");

const continueWithSso = async (page, email) => {
    await page.getByRole('button', { name: SSO_BUTTON }).click();
    await page.locator('#sso-email').fill(email);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.getByRole('link', { name: `Continue to ${IDP_NAME}` }).click();
};

test.describe('single sign-on through a company identity provider', () => {
    test.describe.configure({ mode: 'serial', timeout: 180000 });

    const suffix = uniqueSuffix();
    const domain = `acme-${suffix}.test`;
    const ssoConfig = (idp, isEnabled) => ({
        provider: 'oidc', isEnabled, enforcement: 'optional', autoProvisionUsers: false, defaultRoleType: 3, displayName: IDP_NAME,
        domains: [domain],
        oidc: { discoveryUrl: `${idp.issuer}/.well-known/openid-configuration`, clientId: CLIENT_ID, clientSecret: 'e2e-sso-secret' },
    });
    let state;
    let idp;
    let owner;
    let client;
    let person;

    test.beforeAll(async () => {
        state = readState();
        idp = await startIdp();
        owner = await loginAs('owner', { state });
        client = await MongoClient.connect(resolveMongoUrl());
        const email = `sam.${suffix}@${domain}`;
        person = await inviteMember({ baseURL: state.baseURL, ownerApi: owner.api, companyId: state.companyId, role: 'member', email, firstName: 'Sam', lastName: `Signon${suffix}` });
        await createWorkspace(state.baseURL, { email, name: `Sam's own ${suffix}` });

        assertOk(await owner.api.put('/api/v2/sso/config', ssoConfig(idp, true)), 'save SSO config');
        await client.db(state.companyId).collection('sso_configs').updateOne({ deletedStatusKey: 0 }, { $set: { verifiedDomains: [{ domain, verifiedAt: new Date() }] } });
        assertOk(await owner.api.put('/api/v2/sso/config', ssoConfig(idp, true)), 'save SSO config with its domain verified');
    });

    test.afterAll(async () => {
        if (owner && idp) await owner.api.put('/api/v2/sso/config', ssoConfig(idp, false));
        if (client && state) {
            await client.db(state.companyId).collection('sso_configs').updateOne({ deletedStatusKey: 0 }, { $set: { verifiedDomains: [], isEnabled: false } });
            await client.close();
        }
        if (idp) await idp.close();
    });

    test('opens the workspace whose identity provider signed the person in', async ({ page }) => {
        idp.signInAs = person.email;
        await page.goto('/#/login');

        await continueWithSso(page, person.email);

        await landedIn(page, `/${state.companyId}`);
        expect(await remembered(page)).toEqual({ userId: person.userId, workspace: state.companyId });
        await expect(page.locator('#email')).toHaveCount(0);
        expect(idp.loginHints.at(-1)).toBe(person.email);
    });

    test('comes back to the page the person was opening', async ({ page }) => {
        idp.signInAs = person.email;
        const deepLink = `/${state.companyId}/inbox`;
        await page.goto(`/#${deepLink}`);
        await page.waitForURL(/#\/login\?redirect_url=/);

        await continueWithSso(page, person.email);

        await landedIn(page, deepLink);
        expect(await remembered(page)).toEqual({ userId: person.userId, workspace: state.companyId });
    });

    test('finishes signing in even when the browser still remembers someone else', async ({ page }) => {
        idp.signInAs = person.email;
        await page.goto('/#/login');
        await page.evaluate(`window.localStorage.setItem('userId', ${JSON.stringify(owner.uid)})`);
        const askedAboutOwner = [];
        page.on('request', (request) => { if (request.url().includes(owner.uid)) askedAboutOwner.push(request.url()); });

        await page.goto(`/api/v2/sso/oidc/initiate?companyId=${state.companyId}`);

        await landedIn(page, `/${state.companyId}`);
        expect(await remembered(page)).toEqual({ userId: person.userId, workspace: state.companyId });
        expect(askedAboutOwner).toEqual([]);
    });

    test('says why the workspace refused someone it does not know', async ({ page }) => {
        idp.signInAs = `nobody.${suffix}@elsewhere-${suffix}.test`;

        await page.goto(`/api/v2/sso/oidc/initiate?companyId=${state.companyId}`);

        await page.waitForURL(/#\/login\?ssoError=not_allowed/);
        await expect(page.getByText('This account can\'t join this workspace through single sign-on.')).toBeVisible();
        expect(await remembered(page)).toEqual({ userId: null, workspace: null });
    });

    test('says single sign-on is not set up when the workspace uses another kind', async ({ page }) => {
        await page.goto(`/api/v2/sso/saml/initiate?companyId=${state.companyId}`);

        await page.waitForURL(/#\/login\?ssoError=config/);
        await expect(page.getByText('Single sign-on isn\'t set up for this workspace.')).toBeVisible();
    });
});
