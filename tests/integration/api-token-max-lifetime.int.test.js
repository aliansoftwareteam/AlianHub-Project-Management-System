const path = require('node:path');
const { MongoClient } = require('mongodb');
const { createApiClient } = require('../../e2e/support/api');
const { STATE_DIR, resolveMongoUrl } = require('../../e2e/support/env');
const { emailFor, login, loginAs, readState, uniqueSuffix } = require('../../e2e/support/fixtures');
const { startServer } = require('../../e2e/support/server');
const { generateToken, hashToken, tokenPrefixOf } = require('../../Modules/ApiTokens/helpers/apiTokenRules');

const state = readState();
const DAY = 24 * 60 * 60 * 1000;
const BOOT_TIMEOUT_MS = 180000;
const FIELD = 'apiTokenMaxLifetimeSince';
const QA = /^\[QA lifetime\]/;

const withDb = async (fn) => {
    const client = new MongoClient(resolveMongoUrl(), { serverSelectionTimeoutMS: 5000 });
    try {
        await client.connect();
        return await fn(client);
    } finally {
        await client.close();
    }
};

const capStart = () => withDb(async (client) => {
    const doc = await client.db('global').collection('instance_settings').findOne({ _id: 'instance' });
    return doc && doc[FIELD] ? new Date(doc[FIELD]) : null;
});

const setCapStart = (value) => withDb((client) => client.db('global').collection('instance_settings')
    .updateOne({ _id: 'instance' }, value ? { $set: { [FIELD]: value } } : { $unset: { [FIELD]: '' } }, { upsert: Boolean(value) }));

const insertToken = async (label, expiresAt, createdAt) => {
    const raw = generateToken();
    const name = `[QA lifetime] ${label} ${uniqueSuffix()}`;
    await withDb((client) => client.db(state.companyId).collection('apiTokens').insertOne({
        name, tokenHash: hashToken(raw), prefix: tokenPrefixOf(raw), scopes: ['read'], userId: state.users.owner.userId,
        active: true, expiresAt, createdAt, updatedAt: createdAt,
    }));
    return { raw, name };
};

const removeTokens = () => withDb((client) => client.db(state.companyId).collection('apiTokens').deleteMany({ name: QA }));

const startCappedServer = (label) => startServer({
    mongoUrl: resolveMongoUrl(),
    logFile: path.join(STATE_DIR, `api-token-max-lifetime-${label}-server.log`),
    env: { API_TOKEN_STRICT: 'true', API_TOKEN_MAX_DAYS: '90' },
});

const ownerOn = async (baseURL) => {
    const session = await login(baseURL, emailFor('owner'));
    return createApiClient({ baseURL, accessToken: session.accessToken, companyId: state.companyId });
};

const tokenClient = (baseURL, raw) => createApiClient({ baseURL, accessToken: raw, companyId: state.companyId });

describe('the maximum API token lifetime under API_TOKEN_STRICT', () => {
    let server = null;
    let long;
    let short;

    beforeAll(async () => {
        await setCapStart(null);
        long = await insertToken('long', new Date(Date.now() + 600 * DAY), new Date(Date.now() - 200 * DAY));
        short = await insertToken('short', new Date(Date.now() + 60 * DAY), new Date(Date.now() - 20 * DAY));
        server = await startCappedServer('first');
    }, BOOT_TIMEOUT_MS);

    afterAll(async () => {
        if (server) await server.stop();
        await removeTokens();
        await setCapStart(null);
    }, BOOT_TIMEOUT_MS);

    it('refuses a token asked to last longer than the maximum with a stable code, through both create routes', async () => {
        const owner = await ownerOn(server.baseURL);
        const personal = await owner.post('/api/v2/api-tokens', { name: `[QA lifetime] ${uniqueSuffix()}`, scopes: ['read'], expiresInDays: 180 });
        expect(personal.body).toMatchObject({ status: false, code: 'API_TOKEN_EXPIRY_OVER_MAX', maxExpiryDays: 90 });
        const agent = await owner.post('/api/v2/api-tokens/mcp', { name: `[QA lifetime] ${uniqueSuffix()}`, mode: 'personal', expiresInDays: 91 });
        expect(agent.body).toMatchObject({ status: false, code: 'API_TOKEN_EXPIRY_OVER_MAX', maxExpiryDays: 90 });
        const ok = await owner.post('/api/v2/api-tokens', { name: `[QA lifetime] ${uniqueSuffix()}`, scopes: ['read'], expiresInDays: 90 });
        expect(ok.body.status).toBe(true);
    });

    it('keeps an existing long-lived token working and lists it with its deadline', async () => {
        expect((await tokenClient(server.baseURL, long.raw).get('/api/v2/api-tokens/me')).status).toBe(200);
        const started = await capStart();
        expect(started).toBeInstanceOf(Date);

        const owner = await ownerOn(server.baseURL);
        const list = await owner.get('/api/v2/api-tokens/needing-expiry');
        expect(list.body.policy).toMatchObject({ strict: true, maxExpiryDays: 90 });
        const row = list.body.data.find((t) => t.name === long.name);
        expect(row).toMatchObject({ reason: 'over-max-lifetime', stopped: false });
        expect(new Date(row.deadline).getTime()).toBe(started.getTime() + 90 * DAY);
        expect(list.body.data.find((t) => t.name === short.name)).toBeUndefined();

        const mine = await owner.get('/api/v2/api-tokens');
        expect(mine.body.policy.maxExpiryDays).toBe(90);
        expect(mine.body.data.find((t) => t.name === long.name).lifetimeState).toBe('capped');
    });

    it('refuses the long-lived token once its deadline has passed, and still accepts the short one', async () => {
        await server.stop();
        server = null;
        await setCapStart(new Date(Date.now() - 91 * DAY));
        server = await startCappedServer('after-cap');

        const refused = await tokenClient(server.baseURL, long.raw).get('/api/v2/api-tokens/me');
        expect(refused.status).toBe(401);
        expect(refused.body.error).toMatch(/maximum/i);
        expect((await tokenClient(server.baseURL, short.raw).get('/api/v2/api-tokens/me')).status).toBe(200);
    }, BOOT_TIMEOUT_MS);

    it('leaves the default server, with the flag off, accepting the long-lived token and a 180-day expiry', async () => {
        expect((await tokenClient(state.baseURL, long.raw).get('/api/v2/api-tokens/me')).status).toBe(200);
        const { api } = await loginAs('owner');
        const res = await api.post('/api/v2/api-tokens', { name: `[QA lifetime] ${uniqueSuffix()}`, expiresInDays: 180 });
        expect(res.body.status).toBe(true);
        expect(res.body.code).toBeUndefined();
    });
});
