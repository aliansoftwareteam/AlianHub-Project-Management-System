const crypto = require('crypto');
const { approveInWorkspace } = require('./fixtures/oauthApproval');

const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0 } }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Modules/Audit/recorder', () => ({ recordAudit: jest.fn() }));
jest.mock('../Config/jwt', () => ({ verifyCompanyMembership: jest.fn(async () => true) }));
jest.mock('../Modules/ApiTokens/controller', () => ({ verifyToken: jest.fn(), logTokenActivity: jest.fn() }));
jest.mock('../Modules/Tasks/helpers/completionStore', () => ({ recordWork: jest.fn(async () => null) }));
jest.mock('../Modules/Automations/engine/tools', () => {
    const actual = jest.requireActual('../Modules/Automations/engine/tools');
    return { ...actual, addComment: jest.fn(async () => ({ changed: true, commentId: '6f0000000000000000000e71' })) };
});

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { dbCollections } = require('../Config/collections');
const jwt = require('../Config/jwt');
const server = require('../Modules/Mcp/server');
const grants = require('../Modules/OAuthServer/grants');
const clients = require('../Modules/OAuthServer/clients');
const automationTools = require('../Modules/Automations/engine/tools');
const permissions = require('../Modules/Agents/permissions');

/* The person behind a grant is judged on every call by the real permission evaluator: an OAuth token
 * carries their scopes, never their role at the time of consent. */

const ISSUER = 'https://hub.s10s4.test';
const RESOURCE = `${ISSUER}/mcp`;
const C = '6f0000000000000000000c71';
const USER = '6f0000000000000000000a71';
const TASK = '6f0000000000000000000d71';
const PROJECT = '6f0000000000000000000b71';
const REDIRECT = 'http://127.0.0.1:41417/callback';
const ADMIN_ROLE = 2;
const GUEST_ROLE = 0;
const ACTIVE = 2;

const ENV_KEYS = ['MCP_OAUTH', 'APIURL', 'JWT_SECRET'];
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
afterAll(() => { ENV_KEYS.forEach((k) => { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }); });

const mint = async () => {
    const { client } = await clients.register({ kind: 'dynamic', name: 'S10S4 Person', redirectUris: [REDIRECT], tokenEndpointAuthMethod: 'none' });
    approveInWorkspace(mockDb, C, client.clientId);
    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    const { code } = await grants.issueCode({ client, companyId: C, userId: USER, scopes: ['tasks:read', 'tasks:write'], redirectUri: REDIRECT, codeChallenge: challenge });
    return (await grants.exchangeCode({ client, code, codeVerifier: verifier, redirectUri: REDIRECT, resource: RESOURCE })).access_token;
};

const comment = async (raw, id) => {
    const res = { statusCode: 200, headers: {}, body: undefined };
    res.set = jest.fn((k, v) => { res.headers[k] = v; return res; });
    res.status = jest.fn((code) => { res.statusCode = code; return res; });
    res.json = jest.fn((body) => { res.body = body; return res; });
    res.end = jest.fn(() => res);
    const body = { jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'task.comment', arguments: { taskId: TASK, body: `note ${id}` } } };
    await server.post({ headers: { authorization: `Bearer ${raw}` }, query: {}, body, ip: '10.4.4.4' }, res);
    return res;
};
const payloadOf = (res) => JSON.parse(res.body.result.content[0].text);
const seat = () => mockDb.store[SCHEMA_TYPE.COMPANY_USERS].find((row) => row.userId === USER);

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    jest.clearAllMocks();
    jwt.verifyCompanyMembership.mockResolvedValue(true);
    process.env.MCP_OAUTH = 'both';
    process.env.APIURL = `${ISSUER}/`;
    process.env.JWT_SECRET = 's10s4-person-secret';
    mockDb.seed(dbCollections.USERS, { _id: USER, Employee_Name: 'Priya', AssignCompany: C });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: USER, roleType: ADMIN_ROLE, status: ACTIVE, isDelete: false });
    mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: PROJECT, ProjectName: 'Shared', isPrivateSpace: false, deletedStatusKey: 0 });
    mockDb.seed(SCHEMA_TYPE.TASKS, { _id: TASK, ProjectID: PROJECT, CompanyId: C, TaskName: 'Fix it', deletedStatusKey: 0 });
});

it('uses the real permission evaluator, not a stand-in', () => {
    expect(jest.isMockFunction(permissions.holderMay)).toBe(false);
});

it('refuses the same token\'s write once the person behind the grant is demoted', async () => {
    const raw = await mint();
    expect(payloadOf(await comment(raw, 1))).toMatchObject({ ok: true });
    expect(automationTools.addComment).toHaveBeenCalledTimes(1);

    seat().roleType = GUEST_ROLE;
    const res = await comment(raw, 2);
    expect(res.statusCode).toBe(200);
    expect(res.body.result.isError).toBe(true);
    expect(payloadOf(res)).toMatchObject({ refused: true, action: 'task.comment' });
    expect(payloadOf(res).reason).toMatch(/permission_denied/);
    expect(automationTools.addComment).toHaveBeenCalledTimes(1);
});

it('refuses the same token once the person behind the grant is removed from the workspace', async () => {
    const raw = await mint();
    expect(payloadOf(await comment(raw, 1))).toMatchObject({ ok: true });

    seat().isDelete = true;
    const refused = await comment(raw, 2);
    expect(payloadOf(refused)).toMatchObject({ refused: true });
    expect(payloadOf(refused).reason).toMatch(/permission_denied|not_visible/);

    jwt.verifyCompanyMembership.mockResolvedValue(false);
    const cutOff = await comment(raw, 3);
    expect(cutOff.statusCode).toBe(403);
    expect(automationTools.addComment).toHaveBeenCalledTimes(1);
});
