const mockChat = jest.fn();
const mockProvider = { configured: true };

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn() }));
jest.mock('../Modules/AI/taskAccess', () => ({ visibleTask: jest.fn(), TASK_NOT_FOUND: 'task not found' }));
jest.mock('../utils/companyMembers', () => ({ memberProfiles: jest.fn(() => Promise.resolve([])) }));
jest.mock('../Modules/AICore/llmProvider', () => ({
    isAnyProviderConfigured: () => mockProvider.configured,
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

const aiOff = (scope) => Object.assign(new Error('AI is turned off.'), { code: 'ai_off', scope });

beforeEach(() => {
    jest.clearAllMocks();
    myCache.flushAll();
    mockProvider.configured = true;
    visibleTask.mockResolvedValue({ _id: TASK, TaskName: 'Launch' });
    MongoDbCrudOpration.mockReset();
    MongoDbCrudOpration
        .mockResolvedValueOnce([{ count: 1 }])
        .mockResolvedValueOnce([{ message: 'Shipping Friday', userId: ME, createdAt: new Date() }]);
});

describe('task summary says why it has no answer in a field, not in English text', () => {
    it('answers unconfigured when no provider is set up, before any model call', async () => {
        mockProvider.configured = false;
        const out = await summarizeTask({ companyId: C, uid: ME, taskId: TASK });
        expect(out).toMatchObject({ status: false, aiState: 'unconfigured' });
        expect(mockChat).not.toHaveBeenCalled();
    });

    it.each([['workspace', 'off_workspace'], ['instance', 'off_instance']])('answers %s off as %s', async (scope, aiState) => {
        mockChat.mockRejectedValue(aiOff(scope));
        const out = await summarizeTask({ companyId: C, uid: ME, taskId: TASK });
        expect(out).toMatchObject({ status: false, aiState });
    });

    it('leaves other failures without an AI state', async () => {
        mockChat.mockRejectedValue(new Error('rate limited'));
        const out = await summarizeTask({ companyId: C, uid: ME, taskId: TASK });
        expect(out.status).toBe(false);
        expect(out.aiState).toBeUndefined();
    });
});

describe('the summary route passes the AI state through', () => {
    const res = () => {
        const r = { statusCode: 200, body: null };
        r.status = (code) => { r.statusCode = code; return r; };
        r.send = (body) => { r.body = body; return r; };
        return r;
    };

    it('adds aiState beside statusText', async () => {
        const fake = jest.fn(() => Promise.resolve({ status: false, aiState: 'unconfigured', reason: 'no LLM provider configured' }));
        let ctrl;
        jest.isolateModules(() => {
            jest.doMock('../Modules/AI/taskSummary', () => ({ summarizeTask: fake }));
            ctrl = require('../Modules/AI/controller');
        });
        const out = res();
        await ctrl.summarizeTask({ uid: ME, headers: { companyid: C }, body: { taskId: TASK } }, out);
        expect(out.body).toEqual({ status: false, statusText: 'no LLM provider configured', aiState: 'unconfigured' });
    });
});
