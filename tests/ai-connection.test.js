const { create } = require('./fixtures/fakeMongo');

const mockDbs = {};
const mockDbFor = (companyId) => (mockDbs[companyId] = mockDbs[companyId] || create());
const mockCrud = (companyId, query, method) => mockDbFor(String(companyId)).crud(companyId, query, method);

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...args) => mockCrud(...args) }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { usersSchema } = require('../utils/mongo-handler/createSchema');
const { ONBOARDING_FLAGS, sanitizeOnboardingPatch } = require('../Modules/Users/helpers/onboardingRules');

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date(Date.UTC(2026, 9, 1, 9, 0, 0));
const COMPANY = '6f0000000000000000000c01';
const OTHER_COMPANY = '6f0000000000000000000c02';
const PRIYA = '6f0000000000000000000a01';
const SAM = '6f0000000000000000000a02';

const FLAGS = ['MCP_OAUTH', 'MCP_OAUTH_ISSUER', 'MCP_TOOLS_DATA', 'MCP_TOOLS_MANAGE', 'MCP_TOOLS_WORK'];
const saved = Object.fromEntries(FLAGS.map((name) => [name, process.env[name]]));

const connection = () => require('../Modules/Mcp/connection');
const statusOf = (userId = PRIYA, companyId = COMPANY) => connection().statusFor({ companyId, userId, now: NOW });

const token = (fields, companyId = COMPANY) => mockDbFor(companyId).seed(SCHEMA_TYPE.API_TOKENS, {
    name: 'Claude Code', tokenHash: 'hash', prefix: 'ahp_abc', userId: PRIYA, active: true, kind: 'agent', expiresAt: new Date(NOW.getTime() + 30 * DAY), ...fields,
});

const grant = (fields) => mockDbFor(SCHEMA_TYPE.GOLBAL).seed(SCHEMA_TYPE.OAUTH_GRANTS, {
    grantId: 'a'.repeat(32), clientId: 'https://claude.ai/client', companyId: COMPANY, userId: PRIYA, scopes: ['tasks:read'],
    revokedAt: null, createdAt: new Date(NOW.getTime() - DAY), expiresAt: new Date(NOW.getTime() + 60 * DAY), ...fields,
});

const response = () => {
    const res = { statusCode: 200, body: undefined };
    res.status = (code) => { res.statusCode = code; return res; };
    res.send = (body) => { res.body = body; return res; };
    return res;
};

beforeEach(() => {
    Object.keys(mockDbs).forEach((key) => delete mockDbs[key]);
    FLAGS.forEach((name) => delete process.env[name]);
});

afterAll(() => {
    FLAGS.forEach((name) => {
        if (saved[name] === undefined) delete process.env[name];
        else process.env[name] = saved[name];
    });
});

describe('whether a person\'s own AI has called', () => {
    it('is not connected before anything has called', async () => {
        token({});
        expect(await statusOf()).toMatchObject({ connected: false, lastSeenAt: null, via: null });
    });

    it('is connected once the person\'s agent token has been used', async () => {
        const used = new Date(NOW.getTime() - 60 * 1000);
        token({ lastUsedAt: used });
        expect(await statusOf()).toMatchObject({ connected: true, lastSeenAt: used, via: 'token' });
    });

    it('does not count another person\'s token, or the same person\'s token in another workspace', async () => {
        token({ userId: SAM, lastUsedAt: NOW });
        token({ lastUsedAt: NOW }, OTHER_COMPANY);
        expect((await statusOf()).connected).toBe(false);
        expect((await statusOf(SAM)).connected).toBe(true);
    });

    it('does not count a token that was switched off, has ended, or is not an agent token', async () => {
        token({ lastUsedAt: NOW, active: false });
        token({ lastUsedAt: NOW, expiresAt: new Date(NOW.getTime() - DAY) });
        token({ lastUsedAt: NOW, kind: 'personal' });
        expect((await statusOf()).connected).toBe(false);
    });

    it('counts a connected app that has called, while apps are switched on', async () => {
        const used = new Date(NOW.getTime() - 5000);
        grant({ lastUsedAt: used });

        expect((await statusOf()).connected).toBe(false);

        process.env.MCP_OAUTH = 'on';
        process.env.MCP_OAUTH_ISSUER = 'https://hub.example.com';
        expect(await statusOf()).toMatchObject({ connected: true, lastSeenAt: used, via: 'app' });
    });

    it('does not count an app nobody has used, one that was taken back, another person\'s or another workspace\'s', async () => {
        process.env.MCP_OAUTH = 'on';
        process.env.MCP_OAUTH_ISSUER = 'https://hub.example.com';
        grant({ grantId: 'b'.repeat(32) });
        grant({ grantId: 'c'.repeat(32), lastUsedAt: NOW, revokedAt: NOW });
        grant({ grantId: 'd'.repeat(32), lastUsedAt: NOW, userId: SAM });
        grant({ grantId: 'e'.repeat(32), lastUsedAt: NOW, companyId: OTHER_COMPANY });
        expect((await statusOf()).connected).toBe(false);
    });

    it('stops counting tokens when the install takes only connected apps', async () => {
        token({ lastUsedAt: NOW });
        process.env.MCP_OAUTH = 'only';
        process.env.MCP_OAUTH_ISSUER = 'https://hub.example.com';
        expect(await statusOf()).toMatchObject({ connected: false, tokens: false, apps: true });
    });
});

describe('what this install has switched on', () => {
    it('says tokens work and the extra tools are on by default, and apps wait for an issuer the server can use', async () => {
        expect(await statusOf()).toMatchObject({ apps: false, tokens: true, address: '', tools: { data: true, manage: true, work: true } });
        process.env.MCP_OAUTH_ISSUER = 'https://hub.example.com';
        expect(await statusOf()).toMatchObject({ apps: true, tokens: true, address: 'https://hub.example.com/mcp' });
    });

    it('says apps and the extra tools are off once each is set off', async () => {
        process.env.MCP_OAUTH_ISSUER = 'https://hub.example.com';
        ['MCP_OAUTH', 'MCP_TOOLS_DATA', 'MCP_TOOLS_MANAGE', 'MCP_TOOLS_WORK'].forEach((name) => { process.env[name] = 'off'; });
        expect(await statusOf()).toMatchObject({ apps: false, tokens: true, address: '', tools: { data: false, manage: false, work: false } });
    });

    it('names the address to paste once apps are on', async () => {
        process.env.MCP_OAUTH = 'both';
        process.env.MCP_OAUTH_ISSUER = 'https://hub.example.com';
        expect(await statusOf()).toMatchObject({ apps: true, tokens: true, address: 'https://hub.example.com/mcp' });
    });

    it.each([['MCP_TOOLS_DATA', 'data'], ['MCP_TOOLS_MANAGE', 'manage'], ['MCP_TOOLS_WORK', 'work']])('reports %s on its own', async (name, key) => {
        ['MCP_TOOLS_DATA', 'MCP_TOOLS_MANAGE', 'MCP_TOOLS_WORK'].forEach((flag) => { process.env[flag] = 'off'; });
        process.env[name] = 'on';
        const { tools } = await statusOf();
        expect(tools).toEqual({ data: false, manage: false, work: false, [key]: true });
    });

    it('never answers with a token, its hash or its prefix', async () => {
        token({ lastUsedAt: NOW });
        expect(JSON.stringify(await statusOf())).not.toMatch(/hash|ahp_|prefix/);
    });
});

describe('GET /api/v2/api-tokens/ai-connection', () => {
    const read = async (req) => {
        const res = response();
        await connection().read({ headers: { companyid: COMPANY }, uid: PRIYA, ...req }, res);
        return res;
    };

    it('answers for the signed-in person in the workspace the request names', async () => {
        token({ lastUsedAt: NOW });
        expect((await read({})).body).toMatchObject({ status: true, data: { connected: true } });
        expect((await read({ uid: SAM })).body.data.connected).toBe(false);
    });

    it('refuses an API token and a request with no person', async () => {
        expect((await read({ apiToken: { _id: 't1' } })).statusCode).toBe(403);
        expect((await read({ uid: '' })).statusCode).toBe(403);
    });

    it('is registered under the guarded token prefix', () => {
        const paths = [];
        require('../Modules/ApiTokens/routes').init({ get: (path) => paths.push(path), post: () => {}, put: () => {}, delete: () => {}, use: () => {} });
        expect(paths).toContain('/api/v2/api-tokens/ai-connection');
    });
});

describe('skipping the step is remembered on the person', () => {
    it('keeps connectAiSkipped as a flag the schema stores', () => {
        expect(ONBOARDING_FLAGS).toContain('connectAiSkipped');
        expect(usersSchema.path('homeChecklist.connectAiSkipped').instance).toBe('Boolean');
        expect(sanitizeOnboardingPatch({ connectAiSkipped: true })).toEqual({ ok: true, update: { $set: { 'homeChecklist.connectAiSkipped': true } } });
    });
});
