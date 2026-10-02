jest.setTimeout(30000);
const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (companyId, q, method) => mockDb.crud(companyId, q, method),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0, flushAll: () => {} } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../Modules/Workflows/queue');

const verified = require('./fixtures/verifiedRequest');
const world = require('./fixtures/accessWorld');
const controller = require('../Modules/Workflows/controller');

const { CID, OWNER, ADMIN, P_OPEN, P_PRIVATE, P_PERSONAL, T_OPEN, T_SECRET, T_PRIVATE, T_PERSONAL } = world;
const { seed } = world.create(mockDb);

const STEPS = [{ id: 'sOne', type: 'tool_call', config: { tool: 'tasks.read', input: {} } }];
const MISSING = '6f0000000000000000000fff';

const tried = async (uid, body) => {
    const res = { statusCode: 200, body: null };
    res.status = (code) => { res.statusCode = code; return res; };
    res.send = (answer) => { res.body = answer; return res; };
    await controller.dryRun(verified({ uid, headers: { companyid: CID }, params: {}, query: {}, ip: '', body: { steps: STEPS, ...body } }), res);
    return res.body.data.input;
};

const savedFlag = process.env.WORKFLOW_ENGINE;
beforeEach(() => { jest.clearAllMocks(); process.env.WORKFLOW_ENGINE = 'on'; seed(); });
afterAll(() => { if (savedFlag === undefined) delete process.env.WORKFLOW_ENGINE; else process.env.WORKFLOW_ENGINE = savedFlag; });

describe('the thing a workflow is tried against', () => {
    it.each([['the owner', OWNER], ['an admin', ADMIN]])('is named for %s when they can open it', async (who, uid) => {
        expect(await tried(uid, { taskId: T_OPEN })).toEqual({ kind: 'task', id: T_OPEN, name: 'Open task', projectId: P_OPEN, found: true });
        expect(await tried(uid, { taskId: T_SECRET })).toMatchObject({ name: 'Secret task', found: true });
        expect(await tried(uid, { taskId: T_PRIVATE })).toMatchObject({ name: 'Private task', found: true });
        expect(await tried(uid, { projectId: P_PRIVATE })).toEqual({ kind: 'project', id: P_PRIVATE, name: 'Private', found: true });
    });

    it.each([['the owner', OWNER], ['an admin', ADMIN]])('reads for %s like a thing that is not there when it is in the personal list of someone else', async (who, uid) => {
        expect(await tried(uid, { taskId: T_PERSONAL })).toEqual(await tried(uid, { taskId: MISSING }).then((input) => ({ ...input, id: T_PERSONAL })));
        expect(await tried(uid, { projectId: P_PERSONAL })).toEqual(await tried(uid, { projectId: MISSING }).then((input) => ({ ...input, id: P_PERSONAL })));
        expect(await tried(uid, { taskId: T_PERSONAL })).toEqual({ kind: 'task', id: T_PERSONAL, found: false });
    });
});
