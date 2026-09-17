const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Modules/Agents/actions', () => ({ authorizeRead: jest.fn(async () => true), perform: jest.fn(async () => ({ auditId: 'a1' })), RefusedError: class RefusedError extends Error {} }));
jest.mock('../Modules/Automations/engine/tools', () => ({ oid: (id) => (/^[0-9a-fA-F]{24}$/.test(String(id)) ? String(id) : null) }));
jest.mock('../Modules/Mcp/brief', () => ({ buildBrief: jest.fn(async () => ({ task: 'brief' })) }));

const actions = require('../Modules/Agents/actions');
const tools = require('../Modules/Mcp/tools');

const C = '6f0000000000000000000c01';
const TASK = '6f0000000000000000000d01';
const token = (scopes) => ({ _id: '6f0000000000000000000101', name: 'Laptop', userId: 'u1', scopes, active: true });
const ctxFor = (scopes, canWrite = scopes.length === 0 || scopes.includes('write')) => ({
    companyId: C, userId: 'u1', actor: { kind: 'agent', userId: 'u1' }, ip: '1.1.1.1', projectIds: [], token: token(scopes), canWrite,
});

const readTools = tools.TOOLS.filter((tool) => tool.run).map((tool) => tool.name);

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    jest.clearAllMocks();
});

afterEach(() => { delete process.env.API_TOKEN_STRICT; });

describe.each([['off', undefined], ['on', 'true']])('MCP reads need the read scope, with API_TOKEN_STRICT %s', (label, flag) => {
    beforeEach(() => {
        if (flag) process.env.API_TOKEN_STRICT = flag;
    });

    it.each(readTools)('refuses %s to a token that only has write, before anything is read', async (name) => {
        await expect(tools.call(ctxFor(['write']), name, { taskId: TASK })).rejects.toMatchObject({ code: -32004, message: expect.stringMatching(/read/) });
        expect(actions.authorizeRead).not.toHaveBeenCalled();
        expect(mockDb.crud).not.toHaveBeenCalled();
    });

    it('answers a read for a token with read, and for one with empty scopes', async () => {
        expect(await tools.call(ctxFor(['read']), 'task.get', { taskId: TASK })).toEqual({ task: 'brief' });
        expect(await tools.call(ctxFor([]), 'task.get', { taskId: TASK })).toEqual({ task: 'brief' });
        expect(actions.authorizeRead).toHaveBeenCalledTimes(2);
    });

    it('still lets a write-only token write', async () => {
        const writeTool = tools.TOOLS.find((tool) => !tool.run);
        const out = await tools.call(ctxFor(['write']), writeTool.name, { taskId: TASK, body: 'hello', reason: 'test' }).catch((error) => error);
        expect(out.code).not.toBe(-32004);
        expect(actions.perform).toHaveBeenCalledTimes(1);
    });
});
