/* The grant an agent token is created with: chosen by the person creating it, stored on the token, never added later. */
const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...args) => mockDb.crud(...args) }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));

const ctrl = require('../Modules/ApiTokens/controller');
const { holdsGrant, mayUse, managesTasks, GRANT, DOCS_GRANT } = require('../Modules/Mcp/manageFlag');
const { grantedScopes } = require('../Modules/Mcp/scopes');
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
    delete process.env.MCP_TOOLS_DATA;
});
afterAll(() => { delete process.env.MCP_TOOLS_MANAGE; delete process.env.MCP_TOOLS_DATA; });

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

    it('stores the docs grant on its own, which lists the doc tools and none of the task tools', async () => {
        const res = await mint({ grants: [DOCS_GRANT] });
        expect(tokens()[0].grants).toEqual([DOCS_GRANT]);
        expect(res.body.data.tools).toEqual(expect.arrayContaining(['page.create', 'page.update']));
        expect(res.body.data.tools.filter((name) => WRITES.includes(name))).toEqual([]);
        expect([holdsGrant(tokens()[0], DOCS_GRANT), holdsGrant(tokens()[0], GRANT)]).toEqual([true, false]);
    });

    it('stores both when both are asked for, in one order', async () => {
        await mint({ grants: [DOCS_GRANT, GRANT, GRANT] });
        expect(tokens()[0].grants).toEqual([GRANT, DOCS_GRANT]);
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
        expect((await mint({ grants: [DOCS_GRANT] })).body).toMatchObject({ status: false, statusText: expect.stringMatching(/not switched on/) });
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
        expect((await call(ctrl.listTokens)).body.policy.grants).toEqual([GRANT, DOCS_GRANT]);
        process.env.MCP_TOOLS_MANAGE = 'off';
        expect((await call(ctrl.listTokens)).body.policy.grants).toBeUndefined();
    });
});

describe('who holds a grant', () => {
    const personal = (over = {}) => ({ _id: 't1', userId: USER_ID, scopes: ['read', 'write'], ...over });
    const outside = (scopes) => ({ oauth: true, scopes });

    it('is read from the grants of a personal token and from the scopes of an OAuth token, never the other way round', () => {
        expect(holdsGrant(personal({ grants: [GRANT] }))).toBe(true);
        expect(holdsGrant(personal({ scopes: ['read', 'write', GRANT] }))).toBe(false);
        expect(holdsGrant(outside(['tasks:read', GRANT]))).toBe(true);
        expect(holdsGrant({ oauth: true, scopes: ['tasks:read', 'tasks:write'], grants: [GRANT, DOCS_GRANT] })).toBe(false);
        expect(holdsGrant(outside([DOCS_GRANT]))).toBe(false);
        expect(holdsGrant(outside([DOCS_GRANT]), DOCS_GRANT)).toBe(true);
    });

    it('is not what the write scope gives: a personal token\'s write reaches no manage scope', () => {
        expect(grantedScopes(personal())).toEqual(['tasks:read', 'tasks:write', 'projects:read', 'docs:read', 'time:read', 'time:write']);
        expect(grantedScopes(personal({ scopes: [] }))).not.toEqual(expect.arrayContaining([GRANT]));
        expect(grantedScopes(personal({ scopes: ['read', 'write', GRANT, DOCS_GRANT] }))).not.toEqual(expect.arrayContaining([GRANT]));
        expect(grantedScopes(personal({ grants: [GRANT] }))).toEqual(expect.arrayContaining([GRANT]));
        expect(grantedScopes(personal({ grants: [GRANT] }))).not.toEqual(expect.arrayContaining([DOCS_GRANT]));
        expect(grantedScopes(outside(['tasks:read', 'tasks:write']))).toEqual(['tasks:read', 'tasks:write']);
    });

    it('lets a caller use it only with the write scope on a personal token, and only while the tools are on', () => {
        const ctx = (token, canWrite) => ({ token, canWrite });
        expect(mayUse(ctx(personal({ grants: [GRANT] }), true), GRANT)).toBe(true);
        expect(mayUse(ctx(personal({ grants: [GRANT] }), false), GRANT)).toBe(false);
        expect(mayUse(ctx(outside(['tasks:read', GRANT]), false), GRANT)).toBe(true);
        expect(mayUse(ctx(outside(['tasks:read', 'tasks:write']), true), GRANT)).toBe(false);
        expect(managesTasks(ctx(outside(['tasks:read', GRANT]), false))).toBe(true);
        process.env.MCP_TOOLS_MANAGE = 'off';
        expect(managesTasks(ctx(outside(['tasks:read', GRANT]), false))).toBe(false);
    });
});

describe('a token created to read chat', () => {
    const CHAT = 'chat:read';
    const CHAT_TOOLS = ['chat.channels.list', 'chat.messages.list'];
    const policy = async () => (await call(ctrl.listTokens)).body.policy;

    beforeEach(() => { process.env.MCP_TOOLS_DATA = 'on'; });

    it('reads no chat unless the grant is asked for by name, whatever else the token holds', async () => {
        const plain = await mint({});
        const manager = await mint({ grants: [GRANT, DOCS_GRANT] });
        [plain, manager].forEach((res) => {
            expect(res.body.status).toBe(true);
            expect(res.body.data.tools).toEqual(expect.arrayContaining(['projects.list', 'comments.list']));
            expect(res.body.data.tools.filter((name) => CHAT_TOOLS.includes(name))).toEqual([]);
        });
        tokens().forEach((token) => expect(grantedScopes(token)).not.toContain(CHAT));
    });

    it('stores the grant when asked, lists both chat tools, and holds the chat scope', async () => {
        const res = await mint({ grants: [CHAT] });
        expect(res.body.status).toBe(true);
        expect(tokens()[0].grants).toEqual([CHAT]);
        expect(res.body.data.tools).toEqual(expect.arrayContaining(CHAT_TOOLS));
        expect(grantedScopes(tokens()[0])).toContain(CHAT);
        expect(grantedScopes(tokens()[0])).not.toContain(GRANT);
    });

    it('is not held by a token that only carries the name in its scope list', () => {
        expect(grantedScopes({ _id: 't1', userId: USER_ID, scopes: ['read', 'write', CHAT] })).not.toContain(CHAT);
        expect(grantedScopes({ _id: 't1', userId: USER_ID, scopes: [] })).not.toContain(CHAT);
    });

    it('is given to a token that only reads, and refused to one that cannot read', async () => {
        process.env.API_TOKEN_STRICT = 'true';
        expect((await mint({ grants: [CHAT], scopes: ['read'], expiresInDays: 7 })).body.status).toBe(true);
        expect(tokens()[0]).toMatchObject({ grants: [CHAT], scopes: ['read'] });
        expect((await mint({ grants: [CHAT], scopes: ['write'], expiresInDays: 7 })).body).toMatchObject({ status: false, statusText: expect.stringMatching(/read scope/) });
        expect(tokens()).toHaveLength(1);
    });

    it('is refused while the read tools are switched off, and offered by the token form only while they are on', async () => {
        expect((await policy()).grants).toEqual([GRANT, DOCS_GRANT, CHAT]);
        process.env.MCP_TOOLS_MANAGE = 'off';
        expect((await policy()).grants).toEqual([CHAT]);
        delete process.env.MCP_TOOLS_DATA;
        expect(await policy()).not.toHaveProperty('grants');
        expect((await mint({ grants: [CHAT] })).body).toMatchObject({ status: false, statusText: expect.stringMatching(/MCP_TOOLS_DATA/) });
        expect(tokens()).toHaveLength(0);
    });
});
