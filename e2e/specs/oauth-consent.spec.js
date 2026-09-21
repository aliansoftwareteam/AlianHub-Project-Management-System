const crypto = require('node:crypto');
const http = require('node:http');
const path = require('node:path');
const { test, expect } = require('../support/test');
const { STATE_DIR, resolveMongoUrl } = require('../support/env');
const { login } = require('../support/fixtures');
const { startServer } = require('../support/server');
const { signInThroughForm } = require('../support/pages');

/* Chrome applies the consent page's form-action to the redirect that follows the form post, so an app-wide
 * form-action 'self' would stop the browser on its way back to the agent. This drives the consent screen in a
 * real browser under CSP_MODE=enforce and follows the redirect to a loopback callback, as a native agent would. */

const challengeOf = (verifier) => crypto.createHash('sha256').update(verifier).digest('base64url');

const listen = () => new Promise((resolve) => {
    const hits = [];
    const callback = http.createServer((req, res) => {
        hits.push(req.url);
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end('<!doctype html><title>agent callback</title><p>You can close this window.</p>');
    });
    callback.listen(0, '127.0.0.1', () => resolve({ callback, hits, port: callback.address().port }));
});

test.describe('the OAuth consent screen under an enforced content security policy', () => {
    test.describe.configure({ mode: 'serial', timeout: 240000 });

    let server;
    let agent;

    test.beforeAll(async () => {
        server = await startServer({
            mongoUrl: resolveMongoUrl(),
            logFile: path.join(STATE_DIR, 'oauth-consent-server.log'),
            env: { MCP_OAUTH: 'on', MCP_OAUTH_DCR: 'on', MCP_OAUTH_RATE_LIMIT_PER_MIN: '1000', CSP_MODE: 'enforce' },
        });
        agent = await listen();
    });

    test.afterAll(async () => {
        if (agent) await new Promise((resolve) => agent.callback.close(resolve));
        if (server) await server.stop();
    });

    test('approving sends the browser back to the agent with a code, and nothing is blocked', async ({ browser, state }) => {
        const redirectUri = `http://127.0.0.1:${agent.port}/callback`;
        const registered = await (await fetch(`${server.baseURL}/oauth/register`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ client_name: 'E2E consent agent', redirect_uris: [redirectUri], token_endpoint_auth_method: 'none' }),
        })).json();
        const owner = await login(server.baseURL, state.users.owner.email, state.password);
        const approved = await fetch(`${server.baseURL}/api/v2/oauth-client-approvals/approve`, {
            method: 'POST',
            headers: { authorization: `Bearer ${owner.accessToken}`, companyid: state.companyId, 'content-type': 'application/json' },
            body: JSON.stringify({ clientId: registered.client_id }),
        });
        expect(approved.status).toBe(200);

        const context = await browser.newContext({ baseURL: server.baseURL });
        const page = await context.newPage();
        const violations = [];
        page.on('console', (message) => { if (/Content Security Policy/i.test(message.text())) violations.push(message.text()); });
        try {
            await signInThroughForm(page, { email: state.users.owner.email, password: state.password, companyId: state.companyId });
            const verifier = crypto.randomBytes(32).toString('base64url');
            const authorize = `/oauth/authorize?${new URLSearchParams({
                response_type: 'code', client_id: registered.client_id, redirect_uri: redirectUri, scope: 'tasks:read', state: 'e2e-state',
                code_challenge: challengeOf(verifier), code_challenge_method: 'S256', resource: `${server.baseURL}/mcp`,
            })}`;
            await page.goto(authorize);
            await expect(page.locator('[data-test="client-name"]')).toHaveText('E2E consent agent');
            await expect(page.locator('[data-test="redirect-host"]')).toContainText('127.0.0.1');
            await expect(page.locator('[data-test="loopback-warning"]')).toBeVisible();
            await expect(page.locator(`input[name="workspace"][value="${state.companyId}"]`)).toBeChecked();

            await Promise.all([
                page.waitForURL(new RegExp(`^http://127\\.0\\.0\\.1:${agent.port}/callback\\?`), { timeout: 30000 }),
                page.locator('button[data-test="approve"]').click(),
            ]);
            const landed = new URL(page.url());
            expect(landed.searchParams.get('state')).toBe('e2e-state');
            expect(landed.searchParams.get('code')).toMatch(/^ahoc_/);
            expect(agent.hits.some((hit) => hit.startsWith('/callback?'))).toBe(true);
            expect(violations.filter((text) => /form-action|send form data/i.test(text))).toEqual([]);

            const tokens = await (await fetch(`${server.baseURL}/oauth/token`, {
                method: 'POST',
                headers: { 'content-type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({ grant_type: 'authorization_code', client_id: registered.client_id, code: landed.searchParams.get('code'), code_verifier: verifier, redirect_uri: redirectUri, resource: `${server.baseURL}/mcp` }),
            })).json();
            expect(tokens.token_type).toBe('Bearer');
        } finally {
            await context.close();
        }
    });

    test('the consent page cannot be framed', async ({ state }) => {
        const redirectUri = `http://127.0.0.1:${agent.port}/callback`;
        const registered = await (await fetch(`${server.baseURL}/oauth/register`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ client_name: 'E2E frame agent', redirect_uris: [redirectUri], token_endpoint_auth_method: 'none' }),
        })).json();
        const res = await fetch(`${server.baseURL}/oauth/authorize?${new URLSearchParams({
            response_type: 'code', client_id: registered.client_id, redirect_uri: redirectUri, scope: 'tasks:read', state: 'frame',
            code_challenge: challengeOf(crypto.randomBytes(32).toString('base64url')), code_challenge_method: 'S256', resource: `${server.baseURL}/mcp`,
        })}`, { redirect: 'manual' });
        const page = await fetch(new URL(res.headers.get('location'), server.baseURL));
        expect(page.headers.get('content-security-policy')).toMatch(/frame-ancestors 'none'/);
        expect(page.headers.get('x-frame-options')).toBe('DENY');
        expect(state.companyId).toBeTruthy();
    });
});
