jest.setTimeout(30000);
const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (companyId, q, method) => mockDb.crud(companyId, q, method),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0, flushAll: () => {} } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../Modules/Workflows/queue');
jest.mock('../Modules/Workflows/store');

const verified = require('./fixtures/verifiedRequest');
const world = require('./fixtures/accessWorld');
const store = require('../Modules/Workflows/store');
const controller = require('../Modules/Workflows/controller');

const { CID, OWNER, ADMIN, INSIDER, OUTSIDER, GUEST, P_OPEN, T_OPEN, T_SECRET, OPENS } = world;
const { seed } = world.create(mockDb);

const EVERYONE = [['the owner', OWNER], ['an admin', ADMIN], ['a member on the private list', INSIDER], ['a member', OUTSIDER], ['a guest', GUEST]];
const RUNS = {
    '6f0000000000000000000e01': { name: 'On the open task', projectId: P_OPEN, taskId: T_OPEN, startedBy: OWNER },
    '6f0000000000000000000e02': { name: 'On the task of a private list', projectId: P_OPEN, taskId: T_SECRET, startedBy: OWNER },
};
const rowOf = (id) => ({ _id: id, status: 'running', definition: { steps: [] }, ...RUNS[id] });

const answered = async (handler, req) => {
    const res = { statusCode: 200, body: null };
    res.status = (code) => { res.statusCode = code; return res; };
    res.send = (answer) => { res.body = answer; return res; };
    await handler(verified({ headers: { companyid: CID }, params: {}, query: {}, body: {}, ip: '', ...req }), res);
    return res;
};

const savedFlag = process.env.WORKFLOW_ENGINE;
beforeEach(() => {
    jest.clearAllMocks();
    process.env.WORKFLOW_ENGINE = 'on';
    seed();
    store.getRun.mockImplementation(async (companyId, id) => (RUNS[id] ? rowOf(id) : null));
    store.listRuns.mockImplementation(async () => Object.keys(RUNS).map(rowOf));
    store.listSteps.mockResolvedValue([]);
});
afterAll(() => { if (savedFlag === undefined) delete process.env.WORKFLOW_ENGINE; else process.env.WORKFLOW_ENGINE = savedFlag; });

describe('a workflow run on a task', () => {
    it.each(EVERYONE)('is read by %s, one at a time and in the list, when they can open the task or started the run', async (who, uid) => {
        const reads = Object.keys(RUNS).filter((id) => uid === RUNS[id].startedBy || OPENS[uid].includes(RUNS[id].taskId));
        const one = [];
        for (const id of Object.keys(RUNS)) {
            if ((await answered(controller.getRun, { uid, params: { id } })).statusCode === 200) one.push(id);
        }
        const listed = (await answered(controller.listRuns, { uid })).body.data.map((run) => String(run._id));

        expect(one).toEqual(reads);
        expect(listed.sort()).toEqual(reads);
    });
});
