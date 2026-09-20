const crypto = require('node:crypto');
const path = require('node:path');
const { MongoClient, ObjectId } = require('mongodb');
const { createApiClient } = require('../../e2e/support/api');
const { STATE_DIR, resolveMongoUrl } = require('../../e2e/support/env');
const { emailFor, login, loginAs, readState, uniqueSuffix } = require('../../e2e/support/fixtures');
const { startServer } = require('../../e2e/support/server');

/* Sprint 8 slice 9b. A second server runs with TENANT_PROVIDER_KEYS on over a
 * working secrets store: an owner sets, replaces and clears a workspace key
 * through the real routes, sees metadata only, and the company row keeps the
 * handle; a member and an API token are refused; the default server reports
 * the flag off. */

const state = readState();
const BOOT_TIMEOUT_MS = 180000;
const ROUTE = '/api/v2/provider-keys';
const KEY = crypto.randomBytes(32).toString('hex');
const FIRST = `sk-ws-${crypto.randomBytes(20).toString('hex')}`;
const SECOND = `sk-ws-${crypto.randomBytes(20).toString('hex')}`;

let server;
let client;
let owner;
let member;

const withDb = async (fn) => {
    const c = new MongoClient(resolveMongoUrl(), { serverSelectionTimeoutMS: 5000 });
    try {
        await c.connect();
        return await fn(c.db(state.companyId));
    } finally {
        await c.close();
    }
};

const withGlobalDb = async (fn) => {
    const c = new MongoClient(resolveMongoUrl(), { serverSelectionTimeoutMS: 5000 });
    try {
        await c.connect();
        return await fn(c.db('global'));
    } finally {
        await c.close();
    }
};

const clientFor = async (baseURL, role) => {
    const session = await login(baseURL, emailFor(role));
    return createApiClient({ baseURL, accessToken: session.accessToken, companyId: state.companyId });
};

const mappingOf = async () => withGlobalDb(async (db) => {
    const company = await db.collection('companies').findOne({ _id: new ObjectId(state.companyId) });
    return (company && company.aiProviderKeys) || {};
});

describe('workspace provider keys through the real routes', () => {
    beforeAll(async () => {
        client = new MongoClient(resolveMongoUrl(), { serverSelectionTimeoutMS: 5000 });
        await client.connect();
        server = await startServer({
            mongoUrl: resolveMongoUrl(),
            logFile: path.join(STATE_DIR, 'provider-keys-server.log'),
            env: { SECRETS_STORE: 'true', SECRETS_KEY: KEY, TENANT_PROVIDER_KEYS: 'on' },
        });
        owner = await clientFor(server.baseURL, 'owner');
        member = await clientFor(server.baseURL, 'member');
    }, BOOT_TIMEOUT_MS);

    afterAll(async () => {
        await withGlobalDb((db) => db.collection('companies').updateOne(
            { _id: new ObjectId(state.companyId) }, { $unset: { aiProviderKeys: '' } },
        )).catch(() => {});
        await withDb((db) => db.collection('secrets').deleteMany({})).catch(() => {});
        await client.close();
        if (server) await server.stop();
    }, BOOT_TIMEOUT_MS);

    it('sets a key by handle on the company row and never returns the value', async () => {
        const saved = await owner.put(`${ROUTE}/openai`, { value: FIRST });
        expect(saved.status).toBe(200);
        expect(saved.body.status).toBe(true);
        expect(saved.body.data).toMatchObject({ provider: 'openai', set: true, keyId: expect.any(String) });
        expect(JSON.stringify(saved.body)).not.toContain(FIRST);
        expect(await mappingOf()).toMatchObject({ openai: expect.stringMatching(/^sec_[a-f0-9]{24}$/) });
        await withDb(async (db) => {
            const rows = await db.collection('secrets').find({}).toArray();
            expect(rows).toHaveLength(1);
            expect(rows[0]).toMatchObject({ kind: 'provider' });
            expect(JSON.stringify(rows)).not.toContain(FIRST);
        });
    });

    it('replaces onto the same handle and lists metadata only', async () => {
        const before = await mappingOf();
        const replaced = await owner.put(`${ROUTE}/openai`, { value: SECOND });
        expect(replaced.status).toBe(200);
        expect(replaced.body.data).toMatchObject({ provider: 'openai', set: true, rotatedAt: expect.any(String) });
        expect(await mappingOf()).toMatchObject({ openai: before.openai });
        const listed = await owner.get(ROUTE);
        expect(listed.status).toBe(200);
        expect(listed.body.data.map((row) => row.provider).sort()).toEqual(['anthropic', 'deepseek', 'google', 'openai']);
        expect(JSON.stringify(listed.body)).not.toContain(SECOND);
        await withDb(async (db) => {
            expect(JSON.stringify(await db.collection('secrets').find({}).toArray())).not.toContain(SECOND);
        });
    });

    it('clears a key by revoking its secret and dropping the mapping', async () => {
        const cleared = await owner.delete(`${ROUTE}/openai`);
        expect(cleared.status).toBe(200);
        expect(cleared.body).toMatchObject({ status: true, data: { provider: 'openai', set: false } });
        expect(await mappingOf()).toEqual({});
        await withDb(async (db) => {
            const rows = await db.collection('secrets').find({}).toArray();
            expect(rows[0].revokedAt).toBeInstanceOf(Date);
            expect(rows[0].ciphertext).toBe('');
        });
    });

    it('refuses a member on every route', async () => {
        expect((await member.get(ROUTE)).status).toBe(403);
        expect((await member.put(`${ROUTE}/openai`, { value: FIRST })).status).toBe(403);
        expect((await member.delete(`${ROUTE}/openai`)).status).toBe(403);
    });

    it('refuses an API token, even the owner\'s', async () => {
        const { api } = await loginAs('owner');
        const minted = await api.post('/api/v2/api-tokens', { name: `[QA provider keys] token ${uniqueSuffix()}`, expiresInDays: 1 });
        expect(minted.body.status).toBe(true);
        const asToken = createApiClient({ baseURL: server.baseURL, accessToken: minted.body.data.token, companyId: state.companyId });
        const res = await asToken.get(ROUTE);
        expect(res.status).toBe(403);
        expect(res.body.status).toBe(false);
        await api.delete(`/api/v2/api-tokens/${minted.body.data._id}`);
    });

    it('reports the flag off on the default server', async () => {
        const { api } = await loginAs('owner');
        const res = await api.get(ROUTE);
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ status: false, statusText: 'Workspace provider keys are off.', storeOff: true });
        expect((await api.put(`${ROUTE}/openai`, { value: FIRST })).status).toBe(404);
    });
});
