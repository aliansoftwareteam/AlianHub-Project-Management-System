const mockDb = require('./fixtures/fakeMongo').create();

const mockRoles = {};
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0 } }));
jest.mock('../Modules/Agents/permissions', () => ({ holderMay: jest.fn(async () => ({ allowed: true, reason: '', permission: null })), REASON: 'permission_denied' }));
jest.mock('../Config/permissionGuard', () => ({
    getRoleType: jest.fn(async (companyId, uid) => { const roles = mockRoles[companyId] || {}; return uid in roles ? roles[uid] : null; }),
    isPrivileged: (roleType) => roleType === 1 || roleType === 2,
    evaluatePermission: jest.fn(async () => true), isWritable: (p) => p === true || p === 1 || p === 2, isReadable: (p) => p !== null && p !== undefined && p !== 0,
}));
jest.mock('../Modules/Inbox/helpers/workspaceNotice', () => ({ ownersAndAdmins: jest.fn(async () => ['owner-1', 'admin-1']), sendNotice: jest.fn(async () => {}) }));
jest.mock('../Modules/Connectors/tools', () => {
    const real = jest.requireActual('../Modules/Connectors/tools');
    return { ...real, ...real.make(require('path').join(__dirname, 'fixtures', 'connectors-mcp')) };
});
jest.mock('../Modules/Connectors/registry', () => {
    const actual = jest.requireActual('../Modules/Connectors/registry');
    return { ...actual.createRegistry({ dir: require('path').join(__dirname, 'fixtures', 'connectors-mcp') }), createRegistry: actual.createRegistry, SIGN_IN: actual.SIGN_IN };
});
jest.mock('../Modules/Connectors/resolveConnection', () => ({ resolveConnection: jest.fn(), markBroken: jest.fn(async () => {}), markBackoff: jest.fn(async () => {}) }));
jest.mock('../Modules/Agents/engine/safeFetch', () => ({
    ...jest.requireActual('../Modules/Agents/engine/safeFetch'),
    safeFetch: jest.fn(),
}));

const verified = require('./fixtures/verifiedRequest');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { safeFetch } = require('../Modules/Agents/engine/safeFetch');
const connections = require('../Modules/Connectors/resolveConnection');
const { sendNotice } = require('../Modules/Inbox/helpers/workspaceNotice');
const runner = require('../Modules/Connectors/toolRunner');
const mcpClient = require('../Modules/Connectors/mcpClient');
const ctrl = require('../Modules/Connectors/connectorsController');
const fakeMcpServer = require('./fixtures/fakeMcpServer');

/* A tool the app changed after it was reviewed: off for the workspace, owners and admins told once, and back on
 * only when one of them looks at it again. */

const C = '6f0000000000000000000c31';
const OWNER = '6f0000000000000000000a31';
const MEMBER = '6f0000000000000000000a32';
const ENV = { CONNECTORS: 'notesmcp', AGENT_TAINT_ROUTING: 'on' };
const before = Object.fromEntries(Object.keys(ENV).map((k) => [k, process.env[k]]));

let server;
const read = () => runner.read({ companyId: C, userId: MEMBER, via: runner.VIA.MCP, callerId: 'oauth:claude', key: 'notesmcp.notes.search', input: { query: 'bank' } });
const reviewRow = () => (mockDb.store[SCHEMA_TYPE.CONNECTOR_TOOLS] || []).find((r) => r.tool === 'search_notes');
const res = () => {
    const r = { code: 200, body: null };
    r.status = (c) => { r.code = c; return r; };
    r.send = (b) => { r.body = b; return r; };
    return r;
};
const call = async (handler, uid, { body = {}, params = {} } = {}) => {
    const r = res();
    await handler(verified({ headers: { companyid: C }, uid, sessionId: `6e00000000000000000000${uid.slice(-2)}`, body, params, query: {} }), r);
    return r;
};
const changeTheTool = () => { server.tools.search_notes.description = 'Search the notes, now with a different promise.'; };

beforeEach(() => {
    Object.assign(process.env, ENV);
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    jest.clearAllMocks();
    mcpClient.forget();
    server = fakeMcpServer.create();
    safeFetch.mockImplementation((url, opts) => server.handle(url, opts));
    connections.resolveConnection.mockResolvedValue({ connectionId: 'conn-1', scopes: [], getAccessToken: async () => 'member-token' });
    mockRoles[C] = { [OWNER]: 1, [MEMBER]: 3 };
});

afterAll(() => Object.entries(before).forEach(([k, v]) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; }));

describe('a tool the app changed', () => {
    it('is refused, recorded as changed and off, and owners and admins are told once', async () => {
        changeTheTool();
        await expect(read()).rejects.toMatchObject({ code: 'tool_changed' });
        await expect(read()).rejects.toMatchObject({ code: 'tool_changed' });
        expect(reviewRow()).toMatchObject({ state: 'changed', enabled: false, shape: expect.stringMatching(/^[a-f0-9]{64}$/) });
        expect(sendNotice).toHaveBeenCalledTimes(1);
        expect(sendNotice).toHaveBeenCalledWith(C, ['owner-1', 'admin-1'], expect.objectContaining({ key: 'connector_tool_changed', changeData: { provider: 'notesmcp', name: 'Notes', tool: 'search_notes' } }));
        expect(server.calls).toEqual([]);
    });

    it('is listed for an owner as changed and off, and a member cannot see or approve it', async () => {
        changeTheTool();
        await expect(read()).rejects.toMatchObject({ code: 'tool_changed' });
        const listed = await call(ctrl.tools, OWNER, { params: { provider: 'notesmcp' } });
        expect(listed.body.data.tools).toEqual(expect.arrayContaining([
            expect.objectContaining({ key: 'notesmcp.notes.search', tool: 'search_notes', state: 'changed', on: false }),
            expect.objectContaining({ key: 'notesmcp.notes.archive', state: 'unreviewed', on: false }),
            expect.objectContaining({ key: 'notesmcp.note.create', state: 'reviewed', on: true }),
        ]));
        expect((await call(ctrl.tools, MEMBER, { params: { provider: 'notesmcp' } })).code).toBe(403);
        expect((await call(ctrl.reviewTool, MEMBER, { params: { provider: 'notesmcp', tool: 'search_notes' }, body: { enabled: true } })).code).toBe(403);
    });

    it('is called again, as the app describes it now, once an owner approves it', async () => {
        changeTheTool();
        await expect(read()).rejects.toMatchObject({ code: 'tool_changed' });
        const approved = await call(ctrl.reviewTool, OWNER, { params: { provider: 'notesmcp', tool: 'search_notes' }, body: { enabled: true } });
        expect(approved.code).toBe(200);
        expect(reviewRow()).toMatchObject({ state: 'reviewed', enabled: true, reviewedBy: OWNER });
        expect((await read()).text).toContain('Found 2 notes');
        expect((mockDb.store[SCHEMA_TYPE.AUDIT_LOGS] || []).some((a) => a.action === 'connector.tool_reviewed')).toBe(true);
    });

    it('stays off when an owner keeps it off, and nothing unchanged can be approved', async () => {
        expect((await call(ctrl.reviewTool, OWNER, { params: { provider: 'notesmcp', tool: 'search_notes' }, body: { enabled: true } })).body.code).toBe('nothing_to_review');
        changeTheTool();
        await expect(read()).rejects.toMatchObject({ code: 'tool_changed' });
        await call(ctrl.reviewTool, OWNER, { params: { provider: 'notesmcp', tool: 'search_notes' }, body: { enabled: false } });
        await expect(read()).rejects.toMatchObject({ code: 'tool_changed' });
        expect(reviewRow()).toMatchObject({ state: 'reviewed', enabled: false });
        expect(sendNotice).toHaveBeenCalledTimes(1);
    });

    it('refuses a tool name the catalog does not have', async () => {
        expect((await call(ctrl.reviewTool, OWNER, { params: { provider: 'notesmcp', tool: 'drop_everything' }, body: { enabled: true } })).code).toBe(404);
    });
});
