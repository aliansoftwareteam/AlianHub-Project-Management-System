/* The grant an agent token is created with: chosen by the person creating it, stored on the token, never added later. */
const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...args) => mockDb.crud(...args) }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));

const ctrl = require('../Modules/ApiTokens/controller');
const { holdsGrant, GRANT } = require('../Modules/Mcp/manageFlag');
const { schema } = require('../utils/mongo-handler/schema');

const USER_ID = '6f0000000000000000000a01';
const COMPANY = '6f0000000000000000000c01';
const TOKENS = 'apiTokens';
const WRITES = ['task.update', 'task.assign', 'task.field.set', 'task.move', 'task.archive', 'task.restore'];

const call = async (handler, req = {}) => {
    const res = { statusCode: 200, body: undefined };
    res.status = (code) => { res.statusCode = code; return res; };
    res.send = (body) => { res.body = body; return res; };
    res.json = res.send;
    await handler({ headers: { companyid: COMPANY }, body: {}, params: {}, uid: USER_ID, ...req }, res);
    return res;
};
const tokens = () => mockDb.store[TOKENS] || [];
const mint = (body) => call(ctrl.createMcpToken, { body: { name: 'Laptop', ...body } });

beforeEach(() => {
    Object.keys(mockDb.store).forEach((type) => { mockDb.store[type].length = 0; });
    delete process.env.API_TOKEN_STRICT;
    process.env.MCP_TOOLS_MANAGE = 'on';
});
afterAll(() => { delete process.env.MCP_TOOLS_MANAGE; });

describe('creating an agent token', () => {
    it('stores no grant unless it is asked for, so the token lists none of the write tools', async () => {
        const res = await mint({});
        expect(res.body.status).toBe(true);
        expect(tokens()[0].grants).toEqual([]);
        expect(res.body.data.grants).toEqual([]);
        expect(res.body.data.tools.filter((name) => WRITES.includes(name))).toEqual([]);
        expect(holdsGrant(tokens()[0])).toBe(false);
    });

    it('stores the grant when asked, and then lists the write tools', async () => {
        const res = await mint({ grants: [GRANT] });
        expect(res.body.status).toBe(true);
        expect(tokens()[0]).toMatchObject({ grants: [GRANT], scopes: ['read', 'write'], kind: 'agent', userId: USER_ID });
        expect(res.body.data.tools).toEqual(expect.arrayContaining(WRITES));
        expect(holdsGrant(tokens()[0])).toBe(true);
    });

    it.each([
        ['an unknown grant', { grants: ['admin:all'] }, /grants must be a list/],
        ['a grant that is not a list', { grants: GRANT }, /grants must be a list/],
    ])('refuses %s', async (_what, body, message) => {
        const res = await mint(body);
        expect(res.body).toMatchObject({ status: false, statusText: expect.stringMatching(message) });
        expect(tokens()).toHaveLength(0);
    });

    it('refuses the grant while the tools are switched off, and on a token without the write scope', async () => {
        process.env.MCP_TOOLS_MANAGE = 'off';
        expect((await mint({ grants: [GRANT] })).body).toMatchObject({ status: false, statusText: expect.stringMatching(/not switched on/) });
        process.env.MCP_TOOLS_MANAGE = 'on';
        process.env.API_TOKEN_STRICT = 'true';
        expect((await mint({ grants: [GRANT], scopes: ['read'], expiresInDays: 7 })).body).toMatchObject({ status: false, statusText: expect.stringMatching(/write scope/) });
        expect(tokens()).toHaveLength(0);
    });

    it('is refused to an API token, which cannot make a token for itself', async () => {
        const res = await call(ctrl.createMcpToken, { body: { name: 'Laptop', grants: [GRANT] }, apiToken: { _id: 't1' } });
        expect(res.statusCode).toBe(403);
        expect(tokens()).toHaveLength(0);
    });
});

describe('a token keeps the grants it was created with', () => {
    it('reads a token stored before grants existed as holding none', () => {
        expect(holdsGrant({ _id: 't1', userId: USER_ID, scopes: ['read', 'write'] })).toBe(false);
        expect(holdsGrant({ _id: 't1', userId: USER_ID, scopes: [] })).toBe(false);
        expect(holdsGrant({ _id: 't1', scopes: ['read', 'write', GRANT] })).toBe(false);
        expect(holdsGrant({ oauth: true, scopes: ['tasks:write'], grants: [GRANT] })).toBe(false);
    });

    it('cannot be given one by an update, which changes the name and the active flag only', async () => {
        await mint({});
        const id = String(tokens()[0]._id);
        mockDb.store[TOKENS][0]._id = id;
        const res = await call(ctrl.updateToken, { params: { id }, body: { name: 'Renamed', grants: [GRANT], scopes: ['read', 'write', GRANT] } });
        expect(res.body.status).toBe(true);
        expect(tokens()[0]).toMatchObject({ name: 'Renamed', grants: [], scopes: ['read', 'write'] });
    });

    it('declares the field on the token schema, so a strict schema does not drop it', () => {
        expect(schema.apiTokens.grants).toBeDefined();
    });

    it('names the grant in the token policy only while the tools are on', async () => {
        expect((await call(ctrl.listTokens)).body.policy.grants).toEqual([GRANT]);
        process.env.MCP_TOOLS_MANAGE = 'off';
        expect((await call(ctrl.listTokens)).body.policy.grants).toBeUndefined();
    });
});
