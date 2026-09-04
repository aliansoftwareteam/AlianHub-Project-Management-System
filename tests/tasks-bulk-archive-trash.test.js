/* bulkArchive / bulkTrash / bulkRestore over structural.updateArchiveDelete —
   the per-task write is stubbed so the test pins the key each action writes,
   the company scoping of the lookup, and cross-tenant ids ending up in skipped[]. */
const mongoose = require('mongoose');

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Modules/Tasks/helpers/mongo_helper', () => ({ HandleHistory: jest.fn() }));
jest.mock('../Modules/Tasks/helpers/handleNotification', () => ({ HandleBothNotification: jest.fn() }));
jest.mock('../Modules/Tasks/helpers/taskMongo/recordCompletion.js', () => ({ recordCompletion: jest.fn() }));
jest.mock('../Modules/Tasks/helpers/notificationTemplate', () => ({
    taskAssigneeAdd: jest.fn(), taskAssigneeRemove: jest.fn(), taskAssigneeReplace: jest.fn(),
    taskStatusChange: jest.fn(), taskPriorityChange: jest.fn()
}));

const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const socketEmitter = require('../event/socketEventEmitter');
const bulk = require('../Modules/Tasks/helpers/taskMongo/bulk');

const COMPANY = 'c1';
const PROJECT = new mongoose.Types.ObjectId();
const OWN = new mongoose.Types.ObjectId();
const FOREIGN = new mongoose.Types.ObjectId();

function harness() {
    const writes = [];
    const self = { ...bulk, updateArchiveDelete: jest.fn(async (args) => { writes.push(args); return {}; }) };
    return { self, writes };
}

beforeEach(() => {
    jest.clearAllMocks();
    MongoDbCrudOpration.mockImplementation(async (companyId, query, method) => {
        if (query.type === 'tasks' && method === 'find') {
            return [{ _id: OWN, ProjectID: PROJECT, sprintId: 's1', deletedStatusKey: 0 }];
        }
        if (query.type === 'projects' && method === 'findOne') return { _id: PROJECT, ProjectName: 'P' };
        return null;
    });
});

describe('archive / trash / restore keys', () => {
    test.each([
        ['bulkArchive', 2],
        ['bulkTrash', 1],
        ['bulkDelete', 1],
        ['bulkRestore', 0]
    ])('%s writes deletedStatusKey %i through updateArchiveDelete', async (action, key) => {
        const { self, writes } = harness();
        const result = await self[action]({ companyId: COMPANY, userData: { id: 'u' }, taskIds: [String(OWN)] });
        expect(writes).toHaveLength(1);
        expect(writes[0]).toMatchObject({ companyId: COMPANY, deletedStatusKey: key, sprintId: 's1' });
        expect(String(writes[0].task._id)).toBe(String(OWN));
        expect(result.totals).toEqual({ updated: 1, skipped: 0, errors: 0 });
        expect(socketEmitter.emit).toHaveBeenCalledWith('bulkUpdate', expect.objectContaining({ action, deletedStatusKey: key }));
    });
});

describe('scoping', () => {
    test('the lookup is company-scoped and restore reaches archived and trashed tasks', async () => {
        const { self } = harness();
        await self.bulkRestore({ companyId: COMPANY, userData: {}, taskIds: [String(OWN)] });
        const [companyId, query, method] = MongoDbCrudOpration.mock.calls.find(([, q, m]) => q.type === 'tasks' && m === 'find');
        expect(companyId).toBe(COMPANY);
        expect(method).toBe('find');
        expect(query.data[0].deletedStatusKey).toBeUndefined();
    });

    test('archive skips tasks already trashed or archived; trash still reaches archived ones', async () => {
        const { self } = harness();
        await self.bulkArchive({ companyId: COMPANY, userData: {}, taskIds: [String(OWN)] });
        let [, query] = MongoDbCrudOpration.mock.calls.find(([, q, m]) => q.type === 'tasks' && m === 'find');
        expect(query.data[0].deletedStatusKey).toEqual({ $nin: [1, 2] });

        jest.clearAllMocks();
        await self.bulkTrash({ companyId: COMPANY, userData: {}, taskIds: [String(OWN)] });
        [, query] = MongoDbCrudOpration.mock.calls.find(([, q, m]) => q.type === 'tasks' && m === 'find');
        expect(query.data[0].deletedStatusKey).toEqual({ $nin: [1] });
    });

    test('ids the company does not own come back in skipped[] and are never written', async () => {
        const { self, writes } = harness();
        const result = await self.bulkTrash({ companyId: COMPANY, userData: {}, taskIds: [String(OWN), String(FOREIGN), 'not-an-id'] });
        expect(writes).toHaveLength(1);
        expect(result.skipped).toEqual(expect.arrayContaining([
            { taskId: String(FOREIGN), reason: 'not-found-or-cross-tenant' },
            { taskId: 'not-an-id', reason: 'not-found-or-cross-tenant' }
        ]));
    });

    test('companyId is required', async () => {
        const { self } = harness();
        await expect(self.bulkArchive({ taskIds: [String(OWN)] })).rejects.toThrow('companyId required');
    });
});
