const path = require('node:path');
const { MongoClient } = require('mongodb');
const { createApiClient } = require('../../e2e/support/api');
const { STATE_DIR, resolveMongoUrl } = require('../../e2e/support/env');
const { emailFor, login, loginAs, readState, uniqueSuffix } = require('../../e2e/support/fixtures');
const { startServer } = require('../../e2e/support/server');

const state = readState();
const DAY = 24 * 60 * 60 * 1000;
const BOOT_TIMEOUT_MS = 180000;
const ROUTE = '/api/v2/api-tokens/needing-expiry';
const QA = /^\[QA expiry\]/;

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

const clearGraceStart = () => withDb((client) => client.db('global').collection('instance_settings')
    .updateOne({ _id: 'instance' }, { $unset: { apiTokenStrictSince: '' } }));

const removeTokens = () => withDb((client) => client.db(state.companyId).collection('apiTokens').deleteMany({ name: QA }));

const clientFor = async (baseURL, role) => {
    const session = await login(baseURL, emailFor(role));
    return createApiClient({ baseURL, accessToken: session.accessToken, companyId: state.companyId });
};

/* Made through the real create route on the default server, where the flag is off: the
 * same call every token without an expiry was made with before strict mode existed. */
const mintWithoutExpiry = async (role, label) => {
    const { api } = await loginAs(role);
    const name = `[QA expiry] ${label} ${uniqueSuffix()}`;
    const res = await api.post('/api/v2/api-tokens', { name });
    expect(res.body.status).toBe(true);
    return { name, id: String(res.body.data._id), token: res.body.data.token, prefix: res.body.data.prefix };
};

describe('the workspace list of tokens that still need an expiry', () => {
    let server = null;
    let ownerLegacy;
    let memberLegacy;
    let expiring;

    beforeAll(async () => {
        await clearGraceStart();
        ownerLegacy = await mintWithoutExpiry('owner', 'owner legacy');
        memberLegacy = await mintWithoutExpiry('member', 'member legacy');
        const { api } = await loginAs('owner');
        const res = await api.post('/api/v2/api-tokens', { name: `[QA expiry] expiring ${uniqueSuffix()}`, expiresInDays: 30 });
        expect(res.body.status).toBe(true);
        expiring = { name: res.body.data.name };
        server = await startServer({ mongoUrl: resolveMongoUrl(), logFile: path.join(STATE_DIR, 'api-token-expiry-list-server.log'), env: { API_TOKEN_STRICT: 'true' } });
    }, BOOT_TIMEOUT_MS);

    afterAll(async () => {
        if (server) await server.stop();
        await removeTokens();
        await clearGraceStart();
    }, BOOT_TIMEOUT_MS);

    it('shows the owner every token without an expiry, who owns it and when it stops, and nothing secret', async () => {
        const owner = await clientFor(server.baseURL, 'owner');
        const res = await owner.get(ROUTE);
        expect(res.status).toBe(200);
        expect(res.body.status).toBe(true);
        expect(res.body.policy).toMatchObject({ strict: true, graceDays: 30 });

        const since = await graceStart();
        const mine = res.body.data.find((t) => t.name === ownerLegacy.name);
        expect(mine).toMatchObject({ _id: ownerLegacy.id, kind: 'personal', stopped: false, owner: { id: state.users.owner.userId } });
        expect(mine.owner.name).toMatch(/Olivia/);
        expect(new Date(mine.deadline).getTime()).toBe(since.getTime() + 30 * DAY);

        const theirs = res.body.data.find((t) => t.name === memberLegacy.name);
        expect(theirs.owner).toMatchObject({ id: state.users.member.userId });
        expect(theirs.owner.name).toMatch(/Max/);
        expect(res.body.data.find((t) => t.name === expiring.name)).toBeUndefined();

        const text = JSON.stringify(res.body);
        [ownerLegacy, memberLegacy].forEach((made) => {
            expect(text).not.toContain(made.token);
            expect(text).not.toContain(made.prefix);
        });
        expect(text).not.toMatch(/tokenHash|"prefix"|ahp_/);
    });

    it('answers an admin the same list', async () => {
        const owner = await clientFor(server.baseURL, 'owner');
        const admin = await clientFor(server.baseURL, 'admin');
        const [ownerRes, adminRes] = await Promise.all([owner.get(ROUTE), admin.get(ROUTE)]);
        expect(adminRes.status).toBe(200);
        expect(adminRes.body.data).toEqual(ownerRes.body.data);
    });

    it('refuses a member, whose own legacy token is on the list', async () => {
        const member = await clientFor(server.baseURL, 'member');
        const res = await member.get(ROUTE);
        expect(res.status).toBe(403);
        expect(res.body.status).toBe(false);
        expect(res.body.data).toBeUndefined();
    });

    it('refuses an API token, even the owner\'s', async () => {
        const res = await createApiClient({ baseURL: server.baseURL, accessToken: ownerLegacy.token, companyId: state.companyId }).get(ROUTE);
        expect(res.status).toBe(403);
        expect(res.body.status).toBe(false);
    });

    it('answers the default server, with the flag off, with strict false and no tokens', async () => {
        const { api } = await loginAs('owner');
        const res = await api.get(ROUTE);
        expect(res.status).toBe(200);
        expect(res.body.policy).toMatchObject({ strict: false });
        expect(res.body.data).toEqual([]);
    });
});
