const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Modules/Agents/scope', () => ({ visibleProjectIds: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { visibleProjectIds } = require('../Modules/Agents/scope');
const { recordVisit, listVisits } = require('../Modules/RecentVisits/controller');

const C = '6f0000000000000000000c01';
const PROJECT = '6f0000000000000000000a01';
const LOST_PROJECT = '6f0000000000000000000a02';
const ME = '6f0000000000000000000001';
const OTHER = '6f0000000000000000000002';
const TASK = '6f0000000000000000000b01';

const reply = () => {
    const res = { statusCode: 200 };
    res.status = (code) => { res.statusCode = code; return res; };
    res.send = (body) => { res.body = body; return res; };
    return res;
};

const call = async (handler, { body, query = {} } = {}) => {
    const res = reply();
    await handler({ headers: { companyid: C }, uid: ME, body, query }, res);
    return res;
};

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    jest.clearAllMocks();
    visibleProjectIds.mockResolvedValue([PROJECT]);
});

describe('TSK-08 recent visits belong to the signed-in user', () => {
    it('records a visit for the caller', async () => {
        const res = await call(recordVisit, { body: { entityType: 'task', entityId: TASK } });
        expect(res.body.status).toBe(true);
        expect(mockDb.calls[0].data[0]).toMatchObject({ userId: ME, entityType: 'task' });
    });

    it('refuses to record a visit as another user', async () => {
        const res = await call(recordVisit, { body: { entityType: 'task', entityId: TASK, userData: { id: OTHER } } });
        expect(res.statusCode).toBe(403);
        expect(res.body.status).toBe(false);
        expect(mockDb.crud).not.toHaveBeenCalled();
    });

    it('refuses to read another user\'s visits', async () => {
        mockDb.seed(SCHEMA_TYPE.RECENTVISITS, { userId: OTHER, entityType: 'task', entityId: TASK, visitedAt: new Date() });
        const res = await call(listVisits, { query: { uid: OTHER } });
        expect(res.statusCode).toBe(403);
        expect(res.body.data).toBeUndefined();
        expect(mockDb.crud).not.toHaveBeenCalled();
    });

    it('lists the caller\'s own visits, ignoring nobody else\'s, and drops tasks they can no longer open', async () => {
        const kept = mockDb.seed(SCHEMA_TYPE.TASKS, { TaskName: 'Still mine', ProjectID: PROJECT, deletedStatusKey: 0 });
        const lost = mockDb.seed(SCHEMA_TYPE.TASKS, { TaskName: 'Moved away', ProjectID: LOST_PROJECT, deletedStatusKey: 0 });
        const theirs = mockDb.seed(SCHEMA_TYPE.TASKS, { TaskName: 'Their visit', ProjectID: PROJECT, deletedStatusKey: 0 });
        mockDb.seed(SCHEMA_TYPE.RECENTVISITS, { userId: ME, entityType: 'task', entityId: kept._id, visitedAt: new Date(2) });
        mockDb.seed(SCHEMA_TYPE.RECENTVISITS, { userId: ME, entityType: 'task', entityId: lost._id, visitedAt: new Date(1) });
        mockDb.seed(SCHEMA_TYPE.RECENTVISITS, { userId: OTHER, entityType: 'task', entityId: theirs._id, visitedAt: new Date(3) });

        const res = await call(listVisits, { query: { uid: ME } });
        expect(res.body.status).toBe(true);
        expect(res.body.data.map((row) => row.task.TaskName)).toEqual(['Still mine']);
        expect((await call(listVisits)).body.data.map((row) => row.task.TaskName)).toEqual(['Still mine']);
    });
});
