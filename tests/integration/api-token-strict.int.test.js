const path = require('node:path');
const { MongoClient } = require('mongodb');
const { createApiClient } = require('../../e2e/support/api');
const { STATE_DIR, resolveMongoUrl } = require('../../e2e/support/env');
const { emailFor, login, readState, uniqueSuffix } = require('../../e2e/support/fixtures');
const { startServer } = require('../../e2e/support/server');
const { generateToken, hashToken, tokenPrefixOf } = require('../../Modules/ApiTokens/helpers/apiTokenRules');

const state = readState();
const DAY = 24 * 60 * 60 * 1000;
const BOOT_TIMEOUT_MS = 180000;

const withDb = async (fn) => {
    const client = new MongoClient(resolveMongoUrl(), { serverSelectionTimeoutMS: 5000 });
    try {
        await client.connect();
        return await fn(client);
    } finally {
        await client.close();
    }
};

const graceStart = () => withDb(async (client) => {
    const doc = await client.db('global').collection('instance_settings').findOne({ _id: 'instance' });
    return doc && doc.apiTokenStrictSince ? new Date(doc.apiTokenStrictSince) : null;
});

const setGraceStart = (value) => withDb((client) => client.db('global').collection('instance_settings')
    .updateOne({ _id: 'instance' }, value ? { $set: { apiTokenStrictSince: value } } : { $unset: { apiTokenStrictSince: '' } }, { upsert: Boolean(value) }));

/* A token minted before strict mode: no expiry and no scopes, written the way the old routes wrote it. */
const insertLegacyToken = async () => {
    const raw = generateToken();
    const name = `[QA strict] legacy ${uniqueSuffix()}`;
    await withDb((client) => client.db(state.companyId).collection('apiTokens').insertOne({
        name, tokenHash: hashToken(raw), prefix: tokenPrefixOf(raw), scopes: [], userId: state.users.owner.userId,
        active: true, createdAt: new Date(Date.now() - 400 * DAY), updatedAt: new Date(Date.now() - 400 * DAY),
    }));
    return { raw, name };
};

const removeTokens = () => withDb((client) => client.db(state.companyId).collection('apiTokens').deleteMany({ name: /^\[QA strict\]/ }));

const startStrictServer = (label) => startServer({
    mongoUrl: resolveMongoUrl(),
    logFile: path.join(STATE_DIR, `api-token-strict-${label}-server.log`),
    env: { API_TOKEN_STRICT: 'true' },
});

const ownerOn = async (baseURL) => {
    const session = await login(baseURL, emailFor('owner'));
    return createApiClient({ baseURL, accessToken: session.accessToken, companyId: state.companyId });
};

const tokenClient = (baseURL, raw) => createApiClient({ baseURL, accessToken: raw, companyId: state.companyId });

describe('API tokens under API_TOKEN_STRICT', () => {
    let server = null;
    let legacy;
    let minted;

    beforeAll(async () => {
        await setGraceStart(null);
        legacy = await insertLegacyToken();
        server = await startStrictServer('first');
    }, BOOT_TIMEOUT_MS);

    afterAll(async () => {
        if (server) await server.stop();
        await removeTokens();
        await setGraceStart(null);
    }, BOOT_TIMEOUT_MS);

    it('records the grace start when a strict server boots', async () => {
        const started = await graceStart();
        expect(started).toBeInstanceOf(Date);
        expect(Date.now() - started.getTime()).toBeLessThan(10 * 60 * 1000);
    });

    it('refuses a token without an expiry or without scopes through the real routes', async () => {
        const owner = await ownerOn(server.baseURL);
        const noExpiry = await owner.post('/api/v2/api-tokens', { name: `[QA strict] ${uniqueSuffix()}`, scopes: ['read'] });
        expect(noExpiry.body.status).toBe(false);
        expect(noExpiry.body.statusText).toMatch(/expir/i);

        const noScopes = await owner.post('/api/v2/api-tokens', { name: `[QA strict] ${uniqueSuffix()}`, expiresInDays: 30 });
        expect(noScopes.body.status).toBe(false);
        expect(noScopes.body.statusText).toMatch(/scope/i);

        const agent = await owner.post('/api/v2/api-tokens/mcp', { name: `[QA strict] ${uniqueSuffix()}`, mode: 'personal' });
        expect(agent.body.status).toBe(false);
        expect(agent.body.statusText).toMatch(/expir/i);
    });

    it('creates a token with an expiry and scopes that works for exactly those scopes', async () => {
        const owner = await ownerOn(server.baseURL);
        const res = await owner.post('/api/v2/api-tokens', { name: `[QA strict] ${uniqueSuffix()}`, scopes: ['read'], expiresInDays: 7 });
        expect(res.body.status).toBe(true);
        minted = res.body.data.token;
        expect(new Date(res.body.data.expiresAt).getTime()).toBeGreaterThan(Date.now() + 6 * DAY);

        const client = tokenClient(server.baseURL, minted);
        const who = await client.get('/api/v2/api-tokens/me');
        expect(who.status).toBe(200);
        expect(who.body.data.scopes).toEqual(['read']);
        expect((await client.get('/api/public-v1/projects')).status).toBe(200);
        const write = await client.post('/api/v1/portfolio', {});
        expect(write.status).toBe(403);
        expect(write.body.error).toMatch(/'write' scope/);
    });

    it('keeps a legacy token working inside the grace, as read and write, and lists its deadline', async () => {
        const client = tokenClient(server.baseURL, legacy.raw);
        const who = await client.get('/api/v2/api-tokens/me');
        expect(who.status).toBe(200);
        expect(who.body.data.scopes).toEqual(['read', 'write']);

        const owner = await ownerOn(server.baseURL);
        const list = await owner.get('/api/v2/api-tokens');
        expect(list.body.policy).toMatchObject({ strict: true, graceDays: 30 });
        const row = list.body.data.find((t) => t.name === legacy.name);
        expect(row.graceState).toBe('grace');
        expect(new Date(row.graceEndsAt).getTime()).toBe((await graceStart()).getTime() + 30 * DAY);
    });

    it('refuses the legacy token once the grace has passed, without moving the recorded start', async () => {
        await server.stop();
        server = null;
        const longAgo = new Date(Date.now() - 31 * DAY);
        await setGraceStart(longAgo);
        server = await startStrictServer('after-grace');
        expect((await graceStart()).getTime()).toBe(longAgo.getTime());

        const refused = await tokenClient(server.baseURL, legacy.raw).get('/api/v2/api-tokens/me');
        expect(refused.status).toBe(401);
        expect(refused.body.error).toMatch(/no expiry/i);

        expect((await tokenClient(server.baseURL, minted).get('/api/v2/api-tokens/me')).status).toBe(200);

        const owner = await ownerOn(server.baseURL);
        const list = await owner.get('/api/v2/api-tokens');
        expect(list.body.data.find((t) => t.name === legacy.name).graceState).toBe('stopped');
    }, BOOT_TIMEOUT_MS);

    it('leaves the default server, with the flag off, accepting the same legacy token', async () => {
        const res = await tokenClient(state.baseURL, legacy.raw).get('/api/v2/api-tokens/me');
        expect(res.status).toBe(200);
        expect(res.body.data.scopes).toEqual([]);
    });
});
