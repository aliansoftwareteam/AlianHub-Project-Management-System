const mockDb = require('./fixtures/fakeMongo').create();
const mockChat = jest.fn();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Modules/Agents/scope', () => ({ visibleProjectIds: jest.fn() }));
jest.mock('../Modules/AICore/llmProvider', () => ({
    isAnyProviderConfigured: () => true,
    getProvider: () => ({ name: 'fake', chat: (...a) => mockChat(...a) }),
}));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { myCache } = require('../Config/config');
const scope = require('../Modules/Agents/scope');
const { summarizeTask } = require('../Modules/AI/taskSummary');
const { categoriseTask } = require('../Modules/AI/taskCategory');

const C = '6f0000000000000000000c01';
const OPEN = '6f0000000000000000000a01';
const PRIVATE = '6f0000000000000000000a02';
const GUEST = '6f0000000000000000000004';

const seedTask = (ProjectID, over = {}) => mockDb.seed(SCHEMA_TYPE.TASKS, { TaskName: 'zebraquokka', ProjectID, deletedStatusKey: 0, ...over });

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockChat.mockReset();
    myCache.flushAll();
    scope.visibleProjectIds.mockResolvedValue([OPEN]);
});

describe('AUT-06 AI task summary and category only read tasks the caller can open', () => {
    it('answers not found for a task in a private project, before any model call', async () => {
        const task = seedTask(PRIVATE);
        const out = await summarizeTask({ companyId: C, uid: GUEST, taskId: task._id });
        expect(out).toEqual({ status: false, notFound: true, reason: 'task not found' });
        expect(scope.visibleProjectIds).toHaveBeenCalledWith(C, GUEST);
        expect(mockChat).not.toHaveBeenCalled();
    });

    it('does not serve a cached summary of a hidden task', async () => {
        const task = seedTask(PRIVATE);
        myCache.set(`taskSummary:${C}:${task._id}:1`, { summary: 'secret', commentCount: 1 });
        const out = await summarizeTask({ companyId: C, uid: GUEST, taskId: task._id });
        expect(out.notFound).toBe(true);
        expect(JSON.stringify(out)).not.toContain('secret');
    });

    it('categorises nothing for a task in a private project', async () => {
        const task = seedTask(PRIVATE);
        const out = await categoriseTask({ companyId: C, uid: GUEST, taskId: task._id });
        expect(out).toEqual({ status: false, notFound: true, reason: 'task not found' });
        expect(mockChat).not.toHaveBeenCalled();
    });

    it('answers not found without a caller, and for a deleted task', async () => {
        const task = seedTask(OPEN);
        expect((await summarizeTask({ companyId: C, taskId: task._id })).notFound).toBe(true);
        const deleted = seedTask(OPEN, { deletedStatusKey: 1 });
        expect((await categoriseTask({ companyId: C, uid: GUEST, taskId: deleted._id })).notFound).toBe(true);
    });

    it('still summarises a visible task', async () => {
        const task = seedTask(OPEN);
        const out = await summarizeTask({ companyId: C, uid: GUEST, taskId: task._id });
        expect(out).toMatchObject({ status: true, data: { commentCount: 0 } });
    });
});
