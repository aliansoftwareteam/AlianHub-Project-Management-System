jest.mock('../Modules/AI/helper', () => ({ pushChat: jest.fn(), addChat: jest.fn(), getChat: jest.fn(() => []), deleteChat: jest.fn(), removeChat: jest.fn() }));
jest.mock('../Modules/AI/taskSummary', () => ({ summarizeTask: jest.fn() }));
jest.mock('../Modules/AI/taskCategory', () => ({ categoriseTask: jest.fn() }));
jest.mock('../Modules/AICore/llmProvider', () => ({ isAnyProviderConfigured: () => false, getProvider: jest.fn() }));
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));

const helper = require('../Modules/AI/helper');
const { summarizeTask } = require('../Modules/AI/taskSummary');
const { categoriseTask } = require('../Modules/AI/taskCategory');
const ctrl = require('../Modules/AI/controller');

const C = '6f0000000000000000000c01';
const ME = '6f0000000000000000000001';
const TASK = '6f0000000000000000000b01';

const res = () => {
    const r = { statusCode: 200, body: null };
    r.status = (code) => { r.statusCode = code; return r; };
    r.send = (body) => { r.body = body; return r; };
    return r;
};
const req = (body) => ({ uid: ME, headers: { companyid: C }, body });

beforeEach(() => jest.clearAllMocks());

describe('AUT-02 legacy AI-Assist routes act for the session user only', () => {
    it('deletes the caller\'s own chat, whatever user id the body names', () => {
        const out = res();
        ctrl.deleteUserChat(req({ userId: 'someone-else' }), out);
        expect(helper.deleteChat).toHaveBeenCalledWith(`${ME}:someone-else`);
        expect(out.body.status).toBe(true);
    });
});

describe('AUT-06 task summary and category answer 404 for a task the caller cannot open', () => {
    it.each([
        ['summarizeTask', summarizeTask],
        ['categoriseTask', categoriseTask],
    ])('%s passes the session user and maps not found to 404', async (name, helperFn) => {
        helperFn.mockResolvedValue({ status: false, notFound: true, reason: 'task not found' });
        const out = res();
        await ctrl[name](req({ taskId: TASK }), out);
        expect(helperFn).toHaveBeenCalledWith(expect.objectContaining({ companyId: C, uid: ME, taskId: TASK }));
        expect(out.statusCode).toBe(404);
        expect(out.body).toEqual({ status: false, statusText: 'task not found' });
    });
});
