/* The area column's model call goes through the real meter and reservation, with only the vendor mocked:
 * it is booked to the workspace like a task summary, held to the same budget, and leaves no timer behind. */
const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({ ROLE_OWNER: 1, ROLE_ADMIN: 2, getRoleType: jest.fn(async () => 1), isPrivileged: (r) => r === 1 || r === 2 }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../utils/companyMembers', () => ({ memberProfiles: jest.fn(async () => []) }));
jest.mock('../Modules/notification/prepare-notification-data/controllerV2', () => ({ handleNotificationtFun: jest.fn(async () => ({ status: true })) }));
jest.mock('../Modules/Agents/scope', () => ({ visibleProjectIds: jest.fn(async () => ['6f0000000000000000000a01']), visibleProjects: jest.fn(async () => []) }));
jest.mock('../Modules/AICore/llmProvider/openaiProvider', () => ({ name: 'openai', model: 'gpt-4.1', isConfigured: true, chat: jest.fn() }));
jest.mock('../Modules/AICore/llmProvider/anthropicProvider', () => ({ name: 'anthropic', model: null, isConfigured: false, chat: jest.fn() }));
jest.mock('../Modules/AICore/llmProvider/deepseekProvider', () => ({ name: 'deepseek', model: null, isConfigured: false, chat: jest.fn() }));

const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { dbCollections } = require('../Config/collections');
const adapter = require('../Modules/AICore/llmProvider/openaiProvider');
const { categoriseTask } = require('../Modules/AI/taskCategory');
const { summarizeTask } = require('../Modules/AI/taskSummary');
const { generateDescription } = require('../Modules/AI/aiDescriptionWriter');

const C = '6f0000000000000000000c01';
const ME = '6f0000000000000000000001';
const PROJECT = '6f0000000000000000000a01';
const TASK = '6f0000000000000000000b01';
const ROUTER = process.env.AI_MODEL_ROUTER;

const oid = (id) => new mongoose.Types.ObjectId(id);
const ledger = () => mockDb.store[SCHEMA_TYPE.AI_USAGE] || [];
const kept = () => mockDb.store[SCHEMA_TYPE.TASK_AI_VALUES] || [];
const spent = (usd) => mockDb.seed(SCHEMA_TYPE.AI_USAGE, { companyId: C, feature: 'ask', model: 'gpt-4.1', costUsd: usd, totalTokens: 1, billedToWorkspace: true, at: new Date() });
const reply = (content) => ({ content, inputTokens: 1000, outputTokens: 500, totalTokens: 1500, model: adapter.model });
const answering = () => adapter.chat.mockImplementation(async ({ messages }) => reply(messages[0].content.includes('Labels')
    ? '{"category":"Bug","confidence":0.9,"reason":"a defect"}'
    : '{"summary":"Shipping on Friday."}'));

const area = () => categoriseTask({ companyId: C, uid: ME, taskId: TASK });
const summary = () => summarizeTask({ companyId: C, uid: ME, taskId: TASK });

beforeAll(() => {
    jest.useFakeTimers();
    process.env.AI_MODEL_ROUTER = 'on';
});
afterAll(() => {
    jest.useRealTimers();
    if (ROUTER === undefined) delete process.env.AI_MODEL_ROUTER;
    else process.env.AI_MODEL_ROUTER = ROUTER;
});

beforeEach(() => {
    Object.keys(mockDb.store).forEach((key) => { mockDb.store[key].length = 0; });
    jest.clearAllMocks();
    jest.clearAllTimers();
    delete process.env.LLM_PROVIDER;
    delete process.env.LLM_PRICING;
    answering();
    mockDb.seed(dbCollections.COMPANIES, { _id: C, agentMonthlyBudgetUsd: 1 });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: ME, roleType: 1, status: 2 });
    mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: oid(PROJECT), ProjectName: 'Web', tagsArray: [{ tagName: 'Bug' }, { tagName: 'Feature' }] });
    mockDb.seed(SCHEMA_TYPE.TASKS, { _id: oid(TASK), TaskName: 'Fix the login page', rawDescription: 'People cannot sign in', ProjectID: PROJECT, deletedStatusKey: 0 });
    mockDb.seed(SCHEMA_TYPE.COMMENTS, { taskId: oid(TASK), userId: ME, message: 'Shipping on Friday', type: 'text', createdAt: new Date() });
});

describe('what an area costs is booked to the workspace', () => {
    it('as its own feature, for the workspace and the person who asked, as a summary is', async () => {
        expect((await area()).data).toMatchObject({ category: 'Bug', cached: false });
        expect((await summary()).data).toMatchObject({ summary: 'Shipping on Friday.', cached: false });

        expect(ledger().map((row) => row.feature)).toEqual(['task_category', 'task_summary']);
        ledger().forEach((row) => expect(row).toMatchObject({ companyId: C, userId: ME, billedToWorkspace: true, priced: true, costUsd: 0.006 }));
    });

    it('books nothing for a kept area that is read again', async () => {
        await area();
        await area();
        expect(adapter.chat).toHaveBeenCalledTimes(1);
        expect(ledger()).toHaveLength(1);
    });
});

describe('once the workspace budget is spent', () => {
    beforeEach(() => spent(1.5));

    it('an area is refused before the model is called, with the refusal a summary gets', async () => {
        const refusedArea = await area();
        const refusedSummary = await summary();

        expect(adapter.chat).not.toHaveBeenCalled();
        expect(refusedArea.status).toBe(false);
        expect(refusedArea.reason).toMatch(/^ai_budget_exhausted: /);
        expect(refusedSummary.status).toBe(false);
        expect(refusedSummary.reason).toMatch(/^ai_budget_exhausted: /);
        expect(refusedArea.reason.replace(/\$[\d.]+/g, '$')).toBe(refusedSummary.reason.replace(/\$[\d.]+/g, '$'));
        expect(kept()).toHaveLength(0);
        expect(ledger()).toHaveLength(1);
    });

    it('the two routes answer the refusal in the same shape', async () => {
        const ctrl = require('../Modules/AI/controller');
        const send = async (handler) => {
            const res = { statusCode: 200, body: null };
            res.status = (code) => { res.statusCode = code; return res; };
            res.send = (body) => { res.body = body; return res; };
            await handler({ uid: ME, headers: { companyid: C }, body: { taskId: TASK } }, res);
            return res;
        };
        const areaRes = await send(ctrl.categoriseTask);
        const summaryRes = await send(ctrl.summarizeTask);
        expect(areaRes.statusCode).toBe(summaryRes.statusCode);
        expect(Object.keys(areaRes.body).sort()).toEqual(Object.keys(summaryRes.body).sort());
        expect(areaRes.body).toMatchObject({ status: false, statusText: expect.stringMatching(/^ai_budget_exhausted: /) });
        expect(summaryRes.body).toMatchObject({ status: false, statusText: expect.stringMatching(/^ai_budget_exhausted: /) });
    });
});

describe('a model call leaves no timer behind', () => {
    it.each([
        ['an area', area],
        ['a summary', summary],
        ['a description', () => generateDescription({ companyId: C, userId: ME, name: 'Fix the login page', type: 'task', intent: 'Write it' })],
    ])('%s that was answered has cleared its timeout', async (_name, call) => {
        adapter.chat.mockImplementation(async ({ messages }) => reply(messages[0].content.includes('Labels')
            ? '{"category":"Bug","confidence":0.9,"reason":"a defect"}'
            : '{"summary":"Shipping on Friday.","description":"<p>Done</p>"}'));
        await call();
        expect(adapter.chat).toHaveBeenCalledTimes(1);
        expect(jest.getTimerCount()).toBe(0);
    });

    it.each([['an area', area], ['a summary', summary]])('%s that failed has cleared its timeout', async (_name, call) => {
        adapter.chat.mockRejectedValue(new Error('vendor down'));
        expect((await call()).status).toBe(false);
        expect(jest.getTimerCount()).toBe(0);
    });

    it('a call that never answers is still ended by its timeout', async () => {
        adapter.chat.mockImplementation(() => new Promise(() => {}));
        const pending = area();
        for (let i = 0; i < 20; i += 1) await Promise.resolve();
        await jest.advanceTimersByTimeAsync(60000);
        expect(await pending).toMatchObject({ status: false, reason: 'AI category request timed out' });
        expect(jest.getTimerCount()).toBe(0);
    });
});
