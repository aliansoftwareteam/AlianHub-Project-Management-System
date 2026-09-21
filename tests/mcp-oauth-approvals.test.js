const crypto = require('crypto');
const { approveInWorkspace } = require('./fixtures/oauthApproval');
const path = require('path');

const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {} } }));
jest.mock('../Modules/Audit/recorder', () => ({ recordAudit: jest.fn() }));
jest.mock('../Config/jwt', () => ({ verifyCompanyMembership: jest.fn(async () => true) }));
jest.mock('../Modules/ApiTokens/controller', () => ({ verifyToken: jest.fn(), logTokenActivity: jest.fn() }));
jest.mock('../Modules/Agents/actions', () => ({ RefusedError: class RefusedError extends Error {}, rating: () => null }));
jest.mock('../Modules/Mcp/tools', () => ({ manifest: () => [], call: jest.fn(async () => ({ ok: true })) }));
jest.mock('../Modules/Mcp/approvalsHook', () => {
    const actual = jest.requireActual('../Modules/Mcp/approvalsHook');
    return { ...actual, load: jest.fn(actual.load) };
});

const { dbCollections } = require('../Config/collections');
const logger = require('../Config/loggerConfig');
const tools = require('../Modules/Mcp/tools');
const server = require('../Modules/Mcp/server');
const grants = require('../Modules/OAuthServer/grants');
const clients = require('../Modules/OAuthServer/clients');
const approvalsHook = require('../Modules/Mcp/approvalsHook');

/* Slice S3's per-workspace client approval is optional until S3 lands, and must fail closed once it is there. */

const FIXTURES = path.join(__dirname, 'fixtures', 'mcp-approvals');
const ISSUER = 'https://hub.s10s4.test';
const RESOURCE = `${ISSUER}/mcp`;
const C = '6f0000000000000000000c61';
const USER = '6f0000000000000000000a61';
const REDIRECT = 'http://127.0.0.1:41416/callback';

const ENV_KEYS = ['MCP_OAUTH', 'APIURL', 'JWT_SECRET'];
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
afterAll(() => { ENV_KEYS.forEach((k) => { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }); });

const challengeParams = (header) => Object.fromEntries([...String(header).matchAll(/(\w+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));

const mint = async () => {
    const { client } = await clients.register({ kind: 'dynamic', name: 'S10S4 Approvals', redirectUris: [REDIRECT], tokenEndpointAuthMethod: 'none' });
    approveInWorkspace(mockDb, C, client.clientId);
    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    const { code } = await grants.issueCode({ client, companyId: C, userId: USER, scopes: ['tasks:read'], redirectUri: REDIRECT, codeChallenge: challenge });
    const issued = await grants.exchangeCode({ client, code, codeVerifier: verifier, redirectUri: REDIRECT, resource: RESOURCE });
    return { client, raw: issued.access_token };
};

const post = async (raw) => {
    const res = { statusCode: 200, headers: {}, body: undefined };
    res.set = jest.fn((k, v) => { res.headers[k] = v; return res; });
    res.status = jest.fn((code) => { res.statusCode = code; return res; });
    res.json = jest.fn((body) => { res.body = body; return res; });
    res.end = jest.fn(() => res);
    await server.post({ headers: { authorization: `Bearer ${raw}` }, query: {}, body: { jsonrpc: '2.0', id: 1, method: 'ping' }, ip: '10.3.3.3' }, res);
    return res;
};

const expectRefusedAndLogged = (res, raw) => {
    expect(res.statusCode).toBe(401);
    expect(challengeParams(res.headers['WWW-Authenticate'])).toMatchObject({ error: 'invalid_token' });
    expect(tools.call).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalled();
    const logged = JSON.stringify(logger.error.mock.calls);
    expect(logged).toMatch(/approval/);
    expect(logged).not.toContain(raw);
    expect(logged).not.toContain(raw.slice(5));
};

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    jest.clearAllMocks();
    approvalsHook.load.mockImplementation(jest.requireActual('../Modules/Mcp/approvalsHook').load);
    process.env.MCP_OAUTH = 'both';
    process.env.APIURL = `${ISSUER}/`;
    process.env.JWT_SECRET = 's10s4-approvals-secret';
    mockDb.seed(dbCollections.USERS, { _id: USER, Employee_Name: 'Priya', AssignCompany: C });
});

describe('loading the approval module', () => {
    it('answers null only when that exact module is not installed', () => {
        expect(approvalsHook.load(path.join(FIXTURES, 'absent', 'approvals'))).toBeNull();
    });

    it('throws when the module is there but one of its own dependencies is missing', () => {
        expect(() => approvalsHook.load(path.join(FIXTURES, 'broken', 'approvals'))).toThrow(/alianhub-dependency-that-is-not-installed/);
    });

    it('answers the exports of a module that loads', () => {
        expect(typeof approvalsHook.load(path.join(FIXTURES, 'working', 'approvals')).isClientApproved).toBe('function');
    });

    it('looks for Modules/OAuthServer/approvals by default', () => {
        expect(approvalsHook.MODULE_PATH).toBe(path.join(__dirname, '..', 'Modules', 'OAuthServer', 'approvals'));
    });
});

describe('/mcp and the approval module', () => {
    it('lets an OAuth token through while the module is not installed', async () => {
        const { raw } = await mint();
        approvalsHook.load.mockImplementation(() => jest.requireActual('../Modules/Mcp/approvalsHook').load(path.join(FIXTURES, 'absent', 'approvals')));
        expect((await post(raw)).statusCode).toBe(200);
    });

    it('refuses when the module is there but fails to load (a missing dependency)', async () => {
        const { raw } = await mint();
        approvalsHook.load.mockImplementation(() => jest.requireActual('../Modules/Mcp/approvalsHook').load(path.join(FIXTURES, 'broken', 'approvals')));
        expectRefusedAndLogged(await post(raw), raw);
    });

    it('refuses when the module loads without isClientApproved', async () => {
        const { raw } = await mint();
        approvalsHook.load.mockImplementation(() => jest.requireActual('../Modules/Mcp/approvalsHook').load(path.join(FIXTURES, 'bare', 'approvals')));
        expectRefusedAndLogged(await post(raw), raw);
    });

    it('refuses when isClientApproved throws', async () => {
        const { raw } = await mint();
        approvalsHook.load.mockReturnValue({ isClientApproved: async () => { throw new Error('approvals store unavailable'); } });
        expectRefusedAndLogged(await post(raw), raw);
    });

    it('refuses anything but a plain yes', async () => {
        const { raw, client } = await mint();
        const isClientApproved = jest.fn(async () => 'yes');
        approvalsHook.load.mockReturnValue({ isClientApproved, approvedScopes: async () => ['tasks:read'] });
        expect((await post(raw)).statusCode).toBe(401);
        expect(isClientApproved).toHaveBeenCalledWith(C, client.clientId);
        isClientApproved.mockResolvedValue(true);
        expect((await post(raw)).statusCode).toBe(200);
    });
});
