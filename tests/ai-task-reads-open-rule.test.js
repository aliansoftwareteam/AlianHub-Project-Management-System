jest.setTimeout(30000);
const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (companyId, q, method) => mockDb.crud(companyId, q, method),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0, flushAll: () => {} } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));

const world = require('./fixtures/accessWorld');
const { visibleTask, visibleTasks } = require('../Modules/AI/taskAccess');

const { CID, OWNER, ADMIN, INSIDER, OUTSIDER, GUEST, T_OPEN, T_SECRET, T_PRIVATE, T_PERSONAL, OPENS } = world;
const { seed } = world.create(mockDb);

const EVERYONE = [['the owner', OWNER], ['an admin', ADMIN], ['a member on the private list', INSIDER], ['a member', OUTSIDER], ['a guest', GUEST]];
const TASKS = [T_OPEN, T_SECRET, T_PRIVATE, T_PERSONAL];

beforeEach(() => { jest.clearAllMocks(); seed(); });

describe('the task an assistant feature is asked about', () => {
    it.each(EVERYONE)('is there for %s when they can open it, one at a time', async (who, uid) => {
        const found = [];
        for (const taskId of TASKS) {
            const task = await visibleTask({ companyId: CID, uid, taskId, projection: { TaskName: 1 } });
            if (task) found.push(String(task._id));
        }
        expect(found.sort()).toEqual([...OPENS[uid]].sort());
    });

    it.each(EVERYONE)('is there for %s when they can open it, many at once', async (who, uid) => {
        const tasks = await visibleTasks({ companyId: CID, uid, taskIds: TASKS, projection: { TaskName: 1 } });
        expect(tasks.map((task) => String(task._id)).sort()).toEqual([...OPENS[uid]].sort());
        expect(tasks.every((task) => typeof task.TaskName === 'string')).toBe(true);
    });
});
