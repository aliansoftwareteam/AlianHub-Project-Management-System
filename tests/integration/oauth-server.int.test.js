const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { MongoClient } = require('mongodb');
const { STATE_DIR, resolveMongoUrl } = require('../../e2e/support/env');
const { emailFor, login, readState } = require('../../e2e/support/fixtures');
const { startServer } = require('../../e2e/support/server');
const consentFlow = require('../fixtures/oauthConsent');

/* Sprint 10 slices S2 and S3: the MCP authorization server through the real app and a real database. A scripted
 * client in plain HTTP runs discovery, dynamic registration, authorize with PKCE and resource, token, refresh and
 * revoke; a signed-in person answers on the consent screen's endpoints, after a workspace owner approved the client. */

const state = readState();
const BOOT_TIMEOUT_MS = 180000;
const REDIRECT = 'http://127.0.0.1:47291/callback';
const TEST_ENV = { MCP_OAUTH: 'on', MCP_OAUTH_DCR: 'on', NODE_ENV: 'test', MCP_OAUTH_RATE_LIMIT_PER_MIN: '1000', CSP_MODE: 'enforce' };

const newVerifier = () => crypto.randomBytes(32).toString('base64url');
const challengeOf = (verifier) => crypto.createHash('sha256').update(verifier).digest('base64url');
const filesUnder = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? filesUnder(path.join(dir, entry.name)) : [path.join(dir, entry.name)])) : []);

const startWith = (label, env) => startServer({ mongoUrl: resolveMongoUrl(), logFile: path.join(STATE_DIR, `oauth-${label}-server.log`), env });

const scriptedClient = (baseURL) => {
    const form = (body) => new URLSearchParams(Object.entries(body).filter(([, v]) => v !== undefined)).toString();
    const post = async (url, body, headers = {}) => {
        const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers }, body: form(body) });
        const text = await res.text();
        return { status: res.status, body: text ? JSON.parse(text) : null };
    };
    return {
        async discover() {
            const res = await fetch(`${baseURL}/.well-known/oauth-authorization-server`, { headers: { accept: 'application/json' } });
            return { status: res.status, body: res.status === 200 ? await res.json() : null };
        },
        async register(registrationEndpoint, metadata) {
            const res = await fetch(registrationEndpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(metadata) });
            return { status: res.status, body: await res.json() };
        },
        async authorize(authorizationEndpoint, params, person) {
            const url = `${authorizationEndpoint}?${new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined))}`;
            return person ? consentFlow.consentThrough(url, person) : consentFlow.startAuthorization(url);
        },
        token: (tokenEndpoint, body, headers) => post(tokenEndpoint, body, headers),
        revoke: (revocationEndpoint, body, headers) => post(revocationEndpoint, body, headers),
    };
};

let mongo;
let globalDb;

beforeAll(async () => {
    mongo = await MongoClient.connect(resolveMongoUrl());
    globalDb = mongo.db('global');
});

afterAll(async () => { if (mongo) await mongo.close(); });

describe('with MCP_OAUTH unset (the shared server)', () => {
    it('answers none of the new routes, as beta does', async () => {
        const owner = await login(state.baseURL, emailFor('owner'));
        const json = { accept: 'application/json' };
        expect((await fetch(`${state.baseURL}/.well-known/oauth-authorization-server`, { headers: json })).status).toBe(404);
        expect((await fetch(`${state.baseURL}/oauth/authorize?client_id=x`, { headers: json, redirect: 'manual' })).status).toBe(404);
        expect((await fetch(`${state.baseURL}/oauth/token`, { method: 'POST', headers: json })).status).toBe(404);
        expect((await fetch(`${state.baseURL}/oauth/revoke`, { method: 'POST', headers: json })).status).toBe(404);
        expect((await fetch(`${state.baseURL}/oauth/register`, { method: 'POST', headers: json })).status).toBe(404);
        const signedIn = { ...json, authorization: `Bearer ${owner.accessToken}`, companyid: state.companyId };
        expect((await fetch(`${state.baseURL}/api/v2/oauth-clients`, { headers: signedIn })).status).toBe(404);
    });

    it('ran migration 040 at boot', async () => {
        const migration = await globalDb.collection('schema_versions').findOne({ _id: '040-oauth-server' });
        expect(migration && migration.ok).toBe(true);
    });
});

describe('with MCP_OAUTH on in a test process', () => {
    let server;
    let owner;
    let consent;
    const secrets = [];

    const approve = async (clientId) => {
        const res = await fetch(`${server.baseURL}/api/v2/oauth-client-approvals/approve`, {
            method: 'POST',
            headers: { authorization: `Bearer ${owner.accessToken}`, companyid: state.companyId, 'content-type': 'application/json' },
            body: JSON.stringify({ clientId }),
        });
        expect(res.status).toBe(200);
    };

    beforeAll(async () => {
        server = await startWith('on', TEST_ENV);
        owner = await login(server.baseURL, emailFor('owner'));
        consent = { session: `accessToken=${owner.accessToken}`, workspace: state.companyId };
    }, BOOT_TIMEOUT_MS);

    afterAll(async () => { if (server) await server.stop(); }, BOOT_TIMEOUT_MS);

    const flow = async (client, meta, { clientId, headers = {}, extra = {} } = {}) => {
        const verifier = newVerifier();
        const authorized = await client.authorize(meta.authorization_endpoint, {
            response_type: 'code', client_id: clientId, redirect_uri: REDIRECT, scope: 'tasks:read projects:read', state: 's10s2-state',
            code_challenge: challengeOf(verifier), code_challenge_method: 'S256', resource: `${server.baseURL}/mcp`,
        }, consent);
        expect(authorized.status).toBe(303);
        expect(authorized.location.searchParams.get('state')).toBe('s10s2-state');
        expect(authorized.location.searchParams.get('iss')).toBe(meta.issuer);
        const code = authorized.location.searchParams.get('code');
        secrets.push(code, verifier);
        const tokens = await client.token(meta.token_endpoint, {
            grant_type: 'authorization_code', client_id: headers.authorization ? undefined : clientId, code, code_verifier: verifier, redirect_uri: REDIRECT, resource: `${server.baseURL}/mcp`, ...extra,
        }, headers);
        return { code, verifier, tokens };
    };

    it('runs discovery, registration, authorize, token, refresh and revoke end to end', async () => {
        const client = scriptedClient(server.baseURL);
        const discovered = await client.discover();
        expect(discovered.status).toBe(200);
        const meta = discovered.body;
        expect(meta.issuer).toBe(server.baseURL);
        expect(meta.code_challenge_methods_supported).toEqual(['S256']);
        expect(meta.client_id_metadata_document_supported).toBe(true);

        const registered = await client.register(meta.registration_endpoint, { client_name: 'S10S2 scripted client', redirect_uris: [REDIRECT], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'] });
        expect(registered.status).toBe(201);
        const clientId = registered.body.client_id;
        await approve(clientId);

        const { tokens, code, verifier } = await flow(client, meta, { clientId });
        expect(tokens.status).toBe(200);
        expect(tokens.body).toMatchObject({ token_type: 'Bearer', expires_in: 900, scope: 'tasks:read projects:read' });
        secrets.push(tokens.body.access_token, tokens.body.refresh_token);

        const refreshed = await client.token(meta.token_endpoint, { grant_type: 'refresh_token', client_id: clientId, refresh_token: tokens.body.refresh_token, resource: `${server.baseURL}/mcp` });
        expect(refreshed.status).toBe(200);
        secrets.push(refreshed.body.access_token, refreshed.body.refresh_token);

        const rows = await globalDb.collection('oauth_tokens').find({ clientId }).toArray();
        expect(rows.map((row) => row.kind).sort()).toEqual(['access', 'access', 'code', 'consent', 'refresh', 'refresh']);
        const codeRow = rows.find((row) => row.kind === 'code');
        expect(codeRow).toMatchObject({ redirectUri: REDIRECT, codeChallenge: challengeOf(verifier), resource: `${server.baseURL}/mcp`, companyId: state.companyId, userId: owner.uid });
        expect(codeRow.spentAt).toBeInstanceOf(Date);
        expect(codeRow.purgeAt.getTime()).toBeGreaterThan(codeRow.expiresAt.getTime());
        expect(rows.find((row) => row.kind === 'refresh' && row.spentAt)).toBeTruthy();
        const grant = await globalDb.collection('oauth_grants').findOne({ clientId });
        expect(grant).toMatchObject({ companyId: state.companyId, userId: owner.uid, scopes: ['tasks:read', 'projects:read'], resource: `${server.baseURL}/mcp`, revokedAt: null });
        expect(grant.expiresAt.getTime() - grant.createdAt.getTime()).toBe(90 * 24 * 60 * 60 * 1000);
        expect(grant.purgeAt.getTime() - grant.expiresAt.getTime()).toBe(30 * 24 * 60 * 60 * 1000);
        const stored = JSON.stringify(rows);
        for (const value of [code, tokens.body.access_token, tokens.body.refresh_token]) expect(stored).not.toContain(value);

        const revoked = await client.revoke(meta.revocation_endpoint, { client_id: clientId, token: refreshed.body.refresh_token, token_type_hint: 'refresh_token' });
        expect(revoked.status).toBe(200);
        expect(await globalDb.collection('oauth_grants').findOne({ clientId })).toMatchObject({ revokedReason: 'revoked_by_client' });
        const live = await globalDb.collection('oauth_tokens').countDocuments({ clientId, kind: { $in: ['access', 'refresh'] }, revokedAt: null });
        expect(live).toBe(0);
        const after = await client.token(meta.token_endpoint, { grant_type: 'refresh_token', client_id: clientId, refresh_token: refreshed.body.refresh_token, resource: `${server.baseURL}/mcp` });
        expect(after.body.error).toBe('invalid_grant');

        // Checked here, where the rows live: other suites may reset global collections after boot.
        expect(await globalDb.collection('oauth_tokens').indexes()).toEqual(expect.arrayContaining([
            expect.objectContaining({ name: 'token_hash', unique: true }),
            expect.objectContaining({ name: 'purge_at', expireAfterSeconds: 0 }),
        ]));
        expect(await globalDb.collection('oauth_grants').indexes()).toEqual(expect.arrayContaining([
            expect.objectContaining({ name: 'grant_id', unique: true }),
            expect.objectContaining({ name: 'purge_at', expireAfterSeconds: 0 }),
        ]));
    });

    it('spends a code once on a real database, and a replay revokes the grant', async () => {
        const client = scriptedClient(server.baseURL);
        const meta = (await client.discover()).body;
        const clientId = (await client.register(meta.registration_endpoint, { client_name: 'S10S2 replay', redirect_uris: [REDIRECT], token_endpoint_auth_method: 'none' })).body.client_id;
        await approve(clientId);
        const { code, verifier, tokens } = await flow(client, meta, { clientId });
        secrets.push(tokens.body.access_token, tokens.body.refresh_token);
        const replays = await Promise.all([1, 2].map(() => client.token(meta.token_endpoint, { grant_type: 'authorization_code', client_id: clientId, code, code_verifier: verifier, redirect_uri: REDIRECT, resource: `${server.baseURL}/mcp` })));
        expect(replays.map((r) => r.body.error)).toEqual(['invalid_grant', 'invalid_grant']);
        expect(await globalDb.collection('oauth_grants').findOne({ clientId })).toMatchObject({ revokedReason: 'code_reuse' });
    });

    it('refuses plain PKCE and a wrong resource at both endpoints', async () => {
        const client = scriptedClient(server.baseURL);
        const meta = (await client.discover()).body;
        const clientId = (await client.register(meta.registration_endpoint, { client_name: 'S10S2 refusals', redirect_uris: [REDIRECT], token_endpoint_auth_method: 'none' })).body.client_id;
        await approve(clientId);
        const base = { response_type: 'code', client_id: clientId, redirect_uri: REDIRECT, scope: 'tasks:read', state: 'x', resource: `${server.baseURL}/mcp` };
        const plain = await client.authorize(meta.authorization_endpoint, { ...base, code_challenge: newVerifier(), code_challenge_method: 'plain' }, consent);
        expect(plain.location.searchParams.get('error')).toBe('invalid_request');
        const wrongTarget = await client.authorize(meta.authorization_endpoint, { ...base, code_challenge: challengeOf(newVerifier()), code_challenge_method: 'S256', resource: 'https://elsewhere.example/mcp' }, consent);
        expect(wrongTarget.location.searchParams.get('error')).toBe('invalid_target');
        const { tokens } = await flow(client, meta, { clientId, extra: { resource: `${server.baseURL}/mcp/` } });
        expect(tokens.body.error).toBe('invalid_target');
    });

    it('lets a workspace owner pre-register a confidential client, audited, that authenticates with its secret', async () => {
        const client = scriptedClient(server.baseURL);
        const meta = (await client.discover()).body;
        const api = { authorization: `Bearer ${owner.accessToken}`, companyid: state.companyId, 'content-type': 'application/json' };
        const res = await fetch(`${server.baseURL}/api/v2/oauth-clients`, { method: 'POST', headers: api, body: JSON.stringify({ name: 'S10S2 CI', redirectUris: [REDIRECT], tokenEndpointAuthMethod: 'client_secret_basic', scopes: ['tasks:read', 'projects:read'] }) });
        expect(res.status).toBe(201);
        const { data } = await res.json();
        secrets.push(data.clientSecret);
        const row = await globalDb.collection('oauth_clients').findOne({ clientId: data.clientId });
        expect(row).toMatchObject({ kind: 'preregistered', companyId: state.companyId, tokenEndpointAuthMethod: 'client_secret_basic', createdBy: owner.uid });
        expect(row.secretHash).toMatch(/^[a-f0-9]{64}$/);
        expect(JSON.stringify(row)).not.toContain(data.clientSecret);
        let audit = null;
        for (let tries = 0; !audit && tries < 20; tries += 1) {
            audit = await mongo.db(state.companyId).collection('audit_logs').findOne({ action: 'oauth.client_registered', entityId: data.clientId });
            if (!audit) await new Promise((resolve) => setTimeout(resolve, 100));
        }
        expect(audit).toMatchObject({ actorId: owner.uid, entityType: 'oauth_client' });

        const basic = `Basic ${Buffer.from(`${data.clientId}:${data.clientSecret}`).toString('base64')}`;
        const { tokens } = await flow(client, meta, { clientId: data.clientId, headers: { authorization: basic } });
        expect(tokens.status).toBe(200);
        secrets.push(tokens.body.access_token, tokens.body.refresh_token);

        const member = await login(server.baseURL, emailFor('member'));
        const refused = await fetch(`${server.baseURL}/api/v2/oauth-clients`, { headers: { authorization: `Bearer ${member.accessToken}`, companyid: state.companyId } });
        expect(refused.status).toBe(403);
    });

    it('writes no code, token, verifier or secret to any log', () => {
        expect(secrets.filter(Boolean).length).toBeGreaterThan(10);
        const logs = [server.logFile, ...filesUnder(server.logDir)];
        const text = logs.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
        expect(text).toContain('/oauth/token');
        for (const value of secrets.filter(Boolean)) expect(text).not.toContain(value);
    });
});


describe('the consent screen and workspace approval on the real app', () => {
    let server;
    let owner;
    let member;
    const ownerApi = () => ({ authorization: `Bearer ${owner.accessToken}`, companyid: state.companyId, 'content-type': 'application/json' });

    beforeAll(async () => {
        server = await startWith('consent', TEST_ENV);
        owner = await login(server.baseURL, emailFor('owner'));
        member = await login(server.baseURL, emailFor('member'));
    }, BOOT_TIMEOUT_MS);
    afterAll(async () => { if (server) await server.stop(); }, BOOT_TIMEOUT_MS);

    const register = async (name) => {
        const client = scriptedClient(server.baseURL);
        const meta = (await client.discover()).body;
        const clientId = (await client.register(meta.registration_endpoint, { client_name: name, redirect_uris: [REDIRECT], token_endpoint_auth_method: 'none' })).body.client_id;
        return { client, meta, clientId };
    };
    const authorizeUrl = (clientId, verifier) => `${server.baseURL}/oauth/authorize?${new URLSearchParams({
        response_type: 'code', client_id: clientId, redirect_uri: REDIRECT, scope: 'tasks:read', state: 's10s3', code_challenge: challengeOf(verifier), code_challenge_method: 'S256', resource: `${server.baseURL}/mcp`,
    })}`;
    const auditRow = async (action, entityId) => {
        for (let tries = 0; tries < 20; tries += 1) {
            const row = await mongo.db(state.companyId).collection('audit_logs').findOne({ action, entityId });
            if (row) return row;
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
        return null;
    };
    const directive = (policy, name) => (String(policy || '').split(';').map((part) => part.trim()).find((part) => part.split(/\s+/)[0] === name) || '');

    it('ignores a test consent header in a test process and sends the person to the consent page', async () => {
        const { clientId } = await register('S10S3 header');
        const res = await fetch(authorizeUrl(clientId, newVerifier()), { redirect: 'manual', headers: { authorization: `Bearer ${owner.accessToken}`, companyid: state.companyId, 'x-oauth-test-consent': 'approve' } });
        expect(res.status).toBe(302);
        expect(new URL(res.headers.get('location'), server.baseURL).pathname).toBe('/oauth/consent');
        expect(await globalDb.collection('oauth_grants').countDocuments({ clientId })).toBe(0);
    });

    it('serves the consent page with its own policy under CSP_MODE=enforce', async () => {
        const { clientId } = await register('S10S3 page');
        const started = await consentFlow.startAuthorization(authorizeUrl(clientId, newVerifier()));
        const res = await fetch(`${server.baseURL}/oauth/consent?request=${encodeURIComponent(started.consent.request)}`, { headers: { accept: 'text/html' } });
        const policy = res.headers.get('content-security-policy');
        expect(directive(policy, 'form-action')).toBe(`form-action 'self' ${REDIRECT}`);
        expect(directive(policy, 'frame-ancestors')).toBe("frame-ancestors 'none'");
        expect(directive(policy, 'script-src')).toMatch(/^script-src 'self'/);
        expect(res.headers.get('content-security-policy-report-only')).toBeNull();
        expect(res.headers.get('x-frame-options')).toBe('DENY');
    });

    it('refuses an unapproved client, records the request, and binds the grant to the workspace once approved', async () => {
        const { clientId, client, meta } = await register('S10S3 approval');
        const refused = await consentFlow.consentThrough(authorizeUrl(clientId, newVerifier()), { session: `accessToken=${member.accessToken}`, workspace: state.companyId });
        expect(refused.status).toBe(403);
        expect(await globalDb.collection('oauth_client_approvals').findOne({ clientId })).toMatchObject({ companyId: state.companyId, status: 'pending', requestedBy: member.uid, privateSprints: false });
        expect(await auditRow('oauth.client_approval_requested', clientId)).toMatchObject({ actorId: member.uid });

        const approved = await fetch(`${server.baseURL}/api/v2/oauth-client-approvals/approve`, { method: 'POST', headers: ownerApi(), body: JSON.stringify({ clientId, privateSprints: true }) });
        expect(approved.status).toBe(200);
        expect(await globalDb.collection('oauth_client_approvals').findOne({ clientId })).toMatchObject({ status: 'approved', privateSprints: true, decidedBy: owner.uid });
        expect(await auditRow('oauth.client_approved', clientId)).toMatchObject({ actorId: owner.uid });

        const verifier = newVerifier();
        const done = await consentFlow.consentThrough(authorizeUrl(clientId, verifier), { session: `accessToken=${member.accessToken}`, workspace: state.companyId });
        expect(done.status).toBe(303);
        const tokens = await client.token(meta.token_endpoint, { grant_type: 'authorization_code', client_id: clientId, code: done.location.searchParams.get('code'), code_verifier: verifier, redirect_uri: REDIRECT, resource: `${server.baseURL}/mcp` });
        expect(tokens.status).toBe(200);
        expect(await globalDb.collection('oauth_grants').findOne({ clientId })).toMatchObject({ companyId: state.companyId, userId: member.uid, scopes: ['tasks:read'] });

        const mine = await (await fetch(`${server.baseURL}/api/v2/oauth-grants`, { headers: { authorization: `Bearer ${member.accessToken}`, companyid: state.companyId } })).json();
        expect(mine.data).toEqual([expect.objectContaining({ clientId, clientName: 'S10S3 approval', companyId: state.companyId, scopes: ['tasks:read'] })]);

        const revoked = await fetch(`${server.baseURL}/api/v2/oauth-client-approvals/revoke`, { method: 'POST', headers: ownerApi(), body: JSON.stringify({ clientId }) });
        expect(revoked.status).toBe(200);
        expect(await globalDb.collection('oauth_grants').findOne({ clientId })).toMatchObject({ revokedReason: 'approval_revoked' });
        expect(await globalDb.collection('oauth_tokens').countDocuments({ clientId, kind: { $in: ['access', 'refresh'] }, revokedAt: null })).toBe(0);
        const refreshed = await client.token(meta.token_endpoint, { grant_type: 'refresh_token', client_id: clientId, refresh_token: tokens.body.refresh_token, resource: `${server.baseURL}/mcp` });
        expect(refreshed.body.error).toBe('invalid_grant');
        expect(await auditRow('oauth.client_approval_revoked', clientId)).toMatchObject({ actorId: owner.uid });
    });

    it('refuses the approval routes to a member', async () => {
        const res = await fetch(`${server.baseURL}/api/v2/oauth-client-approvals`, { headers: { authorization: `Bearer ${member.accessToken}`, companyid: state.companyId } });
        expect(res.status).toBe(403);
    });

    it('built the approval index with migration 041', async () => {
        const migration = await globalDb.collection('schema_versions').findOne({ _id: '041-oauth-client-approvals' });
        expect(migration && migration.ok).toBe(true);
        expect(await globalDb.collection('oauth_client_approvals').indexes()).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'company_client', unique: true })]));
    });
});
