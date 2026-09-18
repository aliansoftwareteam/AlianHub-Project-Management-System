const crypto = require('node:crypto');
const path = require('node:path');
const { MongoClient } = require('mongodb');
const { createApiClient } = require('../../e2e/support/api');
const { STATE_DIR, resolveMongoUrl } = require('../../e2e/support/env');
const { emailFor, login, loginAs, readState, uniqueSuffix } = require('../../e2e/support/fixtures');
const { startServer } = require('../../e2e/support/server');

/* Sprint 8 slice 9. A second server runs with SECRETS_STORE on and a test key against the harness database:
 * an owner connects an integration and a webhook through the real routes, sees their secrets as metadata,
 * rotates and revokes one; a member and an API token are refused; the default server keeps the routes closed. */

const state = readState();
const BOOT_TIMEOUT_MS = 180000;
const ROUTE = '/api/v2/secrets';
const KEY = crypto.randomBytes(32).toString('hex');
const GITHUB_TOKEN = `ghp_${crypto.randomBytes(20).toString('hex')}`;
const NEW_TOKEN = `ghp_${crypto.randomBytes(20).toString('hex')}`;

let server;
let client;
let owner;
let member;
let webhookSecret;
let hookId;
let connectionId;

const withDb = async (fn) => {
    const c = new MongoClient(resolveMongoUrl(), { serverSelectionTimeoutMS: 5000 });
    try {
        await c.connect();
        return await fn(c.db(state.companyId));
    } finally {
        await c.close();
    }
};

const clientFor = async (baseURL, role) => {
    const session = await login(baseURL, emailFor(role));
    return createApiClient({ baseURL, accessToken: session.accessToken, companyId: state.companyId });
};

describe('the tenant secrets store through the real routes', () => {
    beforeAll(async () => {
        client = new MongoClient(resolveMongoUrl(), { serverSelectionTimeoutMS: 5000 });
        await client.connect();
        server = await startServer({
            mongoUrl: resolveMongoUrl(),
            logFile: path.join(STATE_DIR, 'secrets-store-server.log'),
            env: { SECRETS_STORE: 'true', SECRETS_KEY: KEY },
        });
        owner = await clientFor(server.baseURL, 'owner');
        member = await clientFor(server.baseURL, 'member');
    }, BOOT_TIMEOUT_MS);

    afterAll(async () => {
        const db = client.db(state.companyId);
        if (connectionId) await db.collection('integration_connections').deleteOne({ _id: connectionId }).catch(() => {});
        if (hookId) await db.collection('webhooks').deleteOne({ _id: hookId }).catch(() => {});
        await db.collection('secrets').deleteMany({}).catch(() => {});
        await client.close();
        if (server) await server.stop();
    }, BOOT_TIMEOUT_MS);

    it('keeps only a handle on an integration connection and a webhook made with the flag on', async () => {
        const connected = await owner.post('/api/v1/integrations/connections', { type: 'github', config: { token: GITHUB_TOKEN, repo: 'acme/app' } });
        expect(connected.status).toBe(200);
        expect(connected.body.status).toBe(true);
        expect(connected.body.data.secrets).toEqual({ token: true });
        expect(JSON.stringify(connected.body)).not.toContain(GITHUB_TOKEN);

        const hook = await owner.post('/api/v2/webhooks', { name: `[QA secrets] ${uniqueSuffix()}`, url: 'https://hooks.example.com/a', events: ['*'] });
        expect(hook.status).toBe(200);
        expect(hook.body.status).toBe(true);
        webhookSecret = hook.body.data.secret;
        expect(webhookSecret).toMatch(/^[a-f0-9]{48}$/);

        await withDb(async (db) => {
            const connection = await db.collection('integration_connections').findOne({ type: 'github', deletedStatusKey: { $ne: 1 } });
            connectionId = connection._id;
            expect(connection.config).toEqual({ repo: 'acme/app' });
            expect(connection.secretHandles.token).toMatch(/^sec_[a-f0-9]{24}$/);
            const stored = await db.collection('webhooks').findOne({ _id: new (require('mongodb').ObjectId)(hook.body.data._id) });
            hookId = stored._id;
            expect(stored.secret).toBeUndefined();
            expect(stored.secretHandle).toMatch(/^sec_[a-f0-9]{24}$/);
            const rows = await db.collection('secrets').find({}).toArray();
            const text = JSON.stringify(rows);
            expect(text).not.toContain(GITHUB_TOKEN);
            expect(text).not.toContain(webhookSecret);
            expect(rows.every((r) => r.keyId && r.iv && r.tag && r.ciphertext)).toBe(true);
        });
    });

    it('shows the owner metadata only, and never a value', async () => {
        const res = await owner.get(ROUTE);
        expect(res.status).toBe(200);
        expect(res.body.status).toBe(true);
        expect(res.body.keyId).toMatch(/^k[a-f0-9]{16}$/);
        const names = res.body.data.map((s) => s.name);
        expect(names).toContain('GitHub: Personal access token');
        expect(names.some((n) => n.startsWith('Webhook: [QA secrets]'))).toBe(true);
        const text = JSON.stringify(res.body);
        expect(text).not.toContain(GITHUB_TOKEN);
        expect(text).not.toContain(webhookSecret);
        expect(text).not.toMatch(/ciphertext|"iv"|"tag"/);
        expect(res.body.data[0]).toEqual(expect.objectContaining({ handle: expect.stringMatching(/^sec_/), kind: expect.any(String), keyId: res.body.keyId, createdAt: expect.any(String), rotatedAt: null, revokedAt: null }));
    });

    it('rotates an integration secret through the route, then the connection uses the new value', async () => {
        const list = await owner.get(ROUTE);
        const github = list.body.data.find((s) => s.name === 'GitHub: Personal access token');
        const rotated = await owner.post(`${ROUTE}/${github.handle}/rotate`, { value: NEW_TOKEN });
        expect(rotated.status).toBe(200);
        expect(rotated.body.status).toBe(true);
        expect(rotated.body.data.handle).toBe(github.handle);
        expect(rotated.body.data.rotatedAt).toEqual(expect.any(String));
        expect(JSON.stringify(rotated.body)).not.toContain(NEW_TOKEN);
        await withDb(async (db) => {
            const row = await db.collection('secrets').findOne({ handle: github.handle });
            expect(row.rotatedAt).toBeInstanceOf(Date);
            expect(JSON.stringify(row)).not.toContain(NEW_TOKEN);
            const audits = await db.collection('audit_logs').find({ action: { $in: ['secret.create', 'secret.rotate'] }, entityId: github.handle }).toArray();
            expect(audits.map((a) => a.action).sort()).toEqual(['secret.create', 'secret.rotate']);
            expect(JSON.stringify(audits)).not.toContain(NEW_TOKEN);
        });
    });

    it('revokes a webhook secret so the webhook can no longer be signed', async () => {
        const list = await owner.get(ROUTE);
        const hook = list.body.data.find((s) => s.name.startsWith('Webhook: [QA secrets]'));
        const revoked = await owner.post(`${ROUTE}/${hook.handle}/revoke`, {});
        expect(revoked.status).toBe(200);
        expect(revoked.body.data.revokedAt).toEqual(expect.any(String));
        expect((await owner.post(`${ROUTE}/${hook.handle}/revoke`, {})).status).toBe(409);
        const after = await owner.get(ROUTE);
        expect(after.body.data.find((s) => s.handle === hook.handle).revokedAt).toEqual(expect.any(String));
    });

    it('refuses a member on every route', async () => {
        const list = await owner.get(ROUTE);
        const { handle } = list.body.data[0];
        expect((await member.get(ROUTE)).status).toBe(403);
        expect((await member.post(`${ROUTE}/${handle}/rotate`, { value: 'x' })).status).toBe(403);
        expect((await member.post(`${ROUTE}/${handle}/revoke`, {})).status).toBe(403);
    });

    it('refuses an API token, even the owner\'s', async () => {
        const { api } = await loginAs('owner');
        const minted = await api.post('/api/v2/api-tokens', { name: `[QA secrets] token ${uniqueSuffix()}`, expiresInDays: 1 });
        expect(minted.body.status).toBe(true);
        const asToken = createApiClient({ baseURL: server.baseURL, accessToken: minted.body.data.token, companyId: state.companyId });
        const res = await asToken.get(ROUTE);
        expect(res.status).toBe(403);
        expect(res.body.status).toBe(false);
        await api.delete(`/api/v2/api-tokens/${minted.body.data._id}`);
    });

    it('keeps the routes closed on the default server, where the flag is off', async () => {
        const { api } = await loginAs('owner');
        const res = await api.get(ROUTE);
        expect(res.status).toBe(404);
        expect(res.body.status).toBe(false);
    });
});
