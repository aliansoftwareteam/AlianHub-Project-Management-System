const mockChat = jest.fn();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn() }));
jest.mock('../Modules/AI/taskAccess', () => ({ visibleTask: jest.fn(), TASK_NOT_FOUND: 'task not found' }));
jest.mock('../utils/companyMembers', () => ({ memberProfiles: jest.fn(() => Promise.resolve([])) }));
jest.mock('../Modules/AICore/llmProvider', () => ({
    isAnyProviderConfigured: () => true,
    getProvider: () => ({ name: 'fake', chat: (...a) => mockChat(...a) }),
}));
jest.mock('../Modules/AI/helper', () => ({ pushChat: jest.fn(), addChat: jest.fn(), getChat: jest.fn(() => []), deleteChat: jest.fn(), removeChat: jest.fn() }));
jest.mock('../Modules/AI/taskCategory', () => ({ categoriseTask: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));

const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const { visibleTask } = require('../Modules/AI/taskAccess');
const { myCache } = require('../Config/config');
const { summarizeTask } = require('../Modules/AI/taskSummary');

const C = '6f0000000000000000000c01';
const ME = '6f0000000000000000000001';
const TASK = '6f0000000000000000000b01';

const thread = (count) => {
    MongoDbCrudOpration.mockImplementation(async (companyId, query) => {
        const pipeline = query.data[0];
        if (pipeline.some((stage) => stage.$count)) return count ? [{ count }] : [];
        return Array.from({ length: count }, (_, i) => ({ message: `Comment ${i + 1}`, userId: ME, createdAt: new Date() }));
    });
};

beforeEach(() => {
    jest.clearAllMocks();
    myCache.flushAll();
    visibleTask.mockResolvedValue({ _id: TASK, TaskName: 'Launch' });
    mockChat.mockResolvedValue({ content: '{"summary":"Shipping on Friday."}' });
    thread(2);
});

describe('a task summary is written when someone asks for it', () => {
    it('answers that none is kept, with the comment count, without calling the model', async () => {
        const out = await summarizeTask({ companyId: C, uid: ME, taskId: TASK, keptOnly: true });
        expect(out).toEqual({ status: true, data: { summary: '', commentCount: 2, updatedAt: '', cached: false, pending: true } });
        expect(mockChat).not.toHaveBeenCalled();
    });

    it('hands back the kept summary to every later open, until the thread changes', async () => {
        const asked = await summarizeTask({ companyId: C, uid: ME, taskId: TASK });
        expect(asked.data).toMatchObject({ summary: 'Shipping on Friday.', commentCount: 2, cached: false });

        const opened = await summarizeTask({ companyId: C, uid: ME, taskId: TASK, keptOnly: true });
        expect(opened.data).toMatchObject({ summary: 'Shipping on Friday.', commentCount: 2, cached: true });
        expect(opened.data.pending).toBeUndefined();

        thread(3);
        const moved = await summarizeTask({ companyId: C, uid: ME, taskId: TASK, keptOnly: true });
        expect(moved.data).toMatchObject({ summary: '', commentCount: 3, pending: true });
        expect(mockChat).toHaveBeenCalledTimes(1);
    });

    it('has nothing pending for a task without comments', async () => {
        thread(0);
        const out = await summarizeTask({ companyId: C, uid: ME, taskId: TASK, keptOnly: true });
        expect(out.data).toMatchObject({ summary: '', commentCount: 0 });
        expect(out.data.pending).toBeUndefined();
        expect(mockChat).not.toHaveBeenCalled();
    });

    it('still refuses a task the caller cannot see', async () => {
        visibleTask.mockResolvedValue(null);
        const out = await summarizeTask({ companyId: C, uid: ME, taskId: TASK, keptOnly: true });
        expect(out).toMatchObject({ status: false, notFound: true });
    });
});

describe('the summary route', () => {
    const res = () => {
        const r = { statusCode: 200, body: null };
        r.status = (code) => { r.statusCode = code; return r; };
        r.send = (body) => { r.body = body; return r; };
        return r;
    };

    it.each([[{ keptOnly: true }, true], [{ keptOnly: 'yes' }, false], [{}, false]])('reads keptOnly from %j as %s', async (extra, keptOnly) => {
        const fake = jest.fn(() => Promise.resolve({ status: true, data: {} }));
        let ctrl;
        jest.isolateModules(() => {
            jest.doMock('../Modules/AI/taskSummary', () => ({ summarizeTask: fake }));
            ctrl = require('../Modules/AI/controller');
        });
        await ctrl.summarizeTask({ uid: ME, headers: { companyid: C }, body: { taskId: TASK, ...extra } }, res());
        expect(fake).toHaveBeenCalledWith({ companyId: C, uid: ME, taskId: TASK, force: false, keptOnly });
    });
});
