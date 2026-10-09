const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({ ROLE_OWNER: 1, ROLE_ADMIN: 2, getRoleType: jest.fn(async () => 1), isPrivileged: (r) => r === 1 || r === 2 }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Modules/notification/prepare-notification-data/controllerV2', () => ({ handleNotificationtFun: jest.fn(async () => ({ status: true })) }));
jest.mock('../Modules/AICore/llmProvider/openaiProvider', () => {
    const adapter = { name: 'openai', model: 'gpt-4.1', isConfigured: true, chat: jest.fn() };
    return adapter;
});
jest.mock('../Modules/AICore/llmProvider/anthropicProvider', () => ({ name: 'anthropic', model: null, isConfigured: false, chat: jest.fn() }));
jest.mock('../Modules/AICore/llmProvider/deepseekProvider', () => ({ name: 'deepseek', model: null, isConfigured: false, chat: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { dbCollections } = require('../Config/collections');
const logger = require('../Config/loggerConfig');
const adapter = require('../Modules/AICore/llmProvider/openaiProvider');
const { getProvider } = require('../Modules/AICore/llmProvider');
const { FEATURES, FEATURE_LIST } = require('../Modules/AICore/features');
const usage = require('../Modules/AICore/usage');
const { handleNotificationtFun } = require('../Modules/notification/prepare-notification-data/controllerV2');
const runs = require('../Modules/Agents/runs');
const budget = require('../Modules/Agents/budget');
const { generateMeetingNotes } = require('../Modules/AI/meetingNotes');

const C = '6f0000000000000000000c01';
const AGENT_ID = '6f0000000000000000000a01';
const MESSAGES = [{ role: 'user', content: 'hello' }];
const ledger = () => mockDb.store[SCHEMA_TYPE.AI_USAGE] || [];
const answer = (over = {}) => ({ content: '{"summary":"s","actionItems":[]}', inputTokens: 1000, outputTokens: 500, totalTokens: 1500, model: adapter.model, ...over });
const agent = (over = {}) => ({ _id: AGENT_ID, name: 'Reviewer', autonomy: 1, allowedActions: [], account: 'workspace', spendCapUsd: 0, paused: false, deletedStatusKey: 0, ...over });
const seedCompany = (over = {}) => mockDb.seed(dbCollections.COMPANIES, { _id: C, ...over });

/* gpt-4.1 lists at $2 in / $8 out per 1M: 1000 in + 500 out = $0.006. */
const CALL_USD = 0.006;

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.calls.length = 0;
    jest.clearAllMocks();
    delete process.env.LLM_PROVIDER;
    delete process.env.LLM_PRICING;
    adapter.model = 'gpt-4.1';
    adapter.chat.mockImplementation(async () => answer());
    mockDb.seed(SCHEMA_TYPE.AGENTS, agent());
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: 'owner1', roleType: 1 });
});

describe('the feature enum', () => {
    it('is closed and covers every feature that spends tokens', () => {
        expect(FEATURE_LIST).toEqual(expect.arrayContaining(['agent_run', 'project_plan', 'clarifier', 'meeting_notes', 'task_summary', 'description', 'task_category', 'ask', 'project_template', 'guide', 'mcp_brief']));
        expect(Object.isFrozen(FEATURES)).toBe(true);
        expect(new Set(FEATURE_LIST).size).toBe(FEATURE_LIST.length);
    });
});

describe('spend is booked at the core boundary', () => {
    it('a non-agent feature call books one priced row with the feature, tenant and user', async () => {
        const result = await getProvider().chat({ messages: MESSAGES, spend: { feature: FEATURES.ASK, companyId: C, userId: 'u1' } });
        expect(result.content).toBe('{"summary":"s","actionItems":[]}');
        expect(adapter.chat).toHaveBeenCalledTimes(1);
        expect(ledger()).toHaveLength(1);
        expect(ledger()[0]).toMatchObject({
            companyId: C, feature: 'ask', model: 'gpt-4.1', provider: 'openai',
            inputTokens: 1000, outputTokens: 500, totalTokens: 1500, costUsd: CALL_USD, priced: true, billedToWorkspace: true,
            runId: null, userId: 'u1', at: expect.any(Date),
        });
        expect(mockDb.calls.find((c) => c.type === SCHEMA_TYPE.AI_USAGE).companyId).toBe(C);
    });

    it('a real consumer (meeting notes) reaches the ledger through the shim path with its own tag', async () => {
        const out = await generateMeetingNotes({ transcript: 'We agreed to ship on Friday and Sam owns the release notes.', companyId: C, userId: 'u2' });
        expect(out.status).toBe(true);
        expect(ledger()).toHaveLength(1);
        expect(ledger()[0]).toMatchObject({ feature: 'meeting_notes', companyId: C, userId: 'u2', costUsd: CALL_USD });
    });

    it('a call without a feature tag is a hard error under test, before any token is bought', async () => {
        await expect(getProvider().chat({ messages: MESSAGES, spend: { companyId: C } })).rejects.toThrow('without a known feature tag');
        await expect(getProvider().chat({ messages: MESSAGES, spend: { feature: 'banana', companyId: C } })).rejects.toThrow('without a known feature tag ("banana")');
        await expect(getProvider().chat({ messages: MESSAGES })).rejects.toThrow('without a known feature tag');
        await expect(getProvider().chat({ messages: MESSAGES, spend: { feature: FEATURES.ASK } })).rejects.toThrow('without a companyId');
        expect(adapter.chat).not.toHaveBeenCalled();
        expect(ledger()).toHaveLength(0);
    });

    it('outside tests the same call warns and is still booked, as "unknown"', async () => {
        const env = process.env.NODE_ENV;
        process.env.NODE_ENV = 'production';
        try {
            await getProvider().chat({ messages: MESSAGES, spend: { companyId: C } });
        } finally { process.env.NODE_ENV = env; }
        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('booked as "unknown"'));
        expect(ledger()).toHaveLength(1);
        expect(ledger()[0]).toMatchObject({ feature: 'unknown', companyId: C, costUsd: CALL_USD });
    });

    it('a call without a tenant is booked against the global database outside tests', async () => {
        const env = process.env.NODE_ENV;
        process.env.NODE_ENV = 'production';
        try {
            await getProvider().chat({ messages: MESSAGES, spend: { feature: FEATURES.DESCRIPTION } });
        } finally { process.env.NODE_ENV = env; }
        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('without a companyId'));
        expect(mockDb.calls.find((c) => c.type === SCHEMA_TYPE.AI_USAGE).companyId).toBe(dbCollections.GLOBAL);
        expect(ledger()[0]).toMatchObject({ feature: 'description', companyId: null });
    });

    it('a booking failure outside tests is logged with the tokens it lost, never swallowed', async () => {
        const env = process.env.NODE_ENV;
        process.env.NODE_ENV = 'production';
        const real = mockDb.crud.getMockImplementation();
        mockDb.crud.mockImplementation(async (...a) => {
            if (a[1] && a[1].type === SCHEMA_TYPE.AI_USAGE && a[2] === 'save') throw new Error('mongo down');
            return real(...a);
        });
        try {
            const result = await getProvider().chat({ messages: MESSAGES, spend: { feature: FEATURES.ASK, companyId: C } });
            expect(result.content).toBeTruthy();
        } finally { process.env.NODE_ENV = env; mockDb.crud.mockImplementation(real); }
        expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('ask spent 1500 tokens that could not be booked: mongo down'));
    });

    it('exposes the adapter\'s live name, model and configuration through the meter', () => {
        const provider = getProvider();
        expect(provider).toMatchObject({ name: 'openai', model: 'gpt-4.1', isConfigured: true });
        adapter.model = 'gpt-4o';
        expect(provider.model).toBe('gpt-4o');
        expect(getProvider()).toBe(provider);
    });
});

describe('the pricing gate applies to every feature', () => {
    it('refuses an unpriced model on a non-agent feature before the vendor call, with the unpriced_model reason', async () => {
        adapter.model = 'gpt-9-mystery';
        const call = getProvider().chat({ messages: MESSAGES, spend: { feature: FEATURES.PROJECT_PLAN, companyId: C, userId: 'u1' } });
        await expect(call).rejects.toMatchObject({ code: usage.UNPRICED_MODEL, feature: 'project_plan', message: usage.unpricedMessage('gpt-9-mystery') });
        expect(adapter.chat).not.toHaveBeenCalled();
        expect(ledger()).toHaveLength(0);
    });

    it('an explicit zero price in LLM_PRICING is a price and books a $0 row', async () => {
        adapter.model = 'my-local-llama';
        process.env.LLM_PRICING = JSON.stringify({ 'my-local-llama': { input: 0, output: 0 } });
        await getProvider().chat({ messages: MESSAGES, spend: { feature: FEATURES.TASK_SUMMARY, companyId: C } });
        expect(ledger()[0]).toMatchObject({ feature: 'task_summary', costUsd: 0, priced: true, billedToWorkspace: true });
    });

    it.each(['local', 'personal'])('a %s account calling the server key is priced like any other call', async (account) => {
        adapter.model = 'gpt-9-mystery';
        const call = getProvider().chat({ messages: MESSAGES, spend: { feature: FEATURES.AGENT_RUN, companyId: C, account, runId: 'r1' } });
        await expect(call).rejects.toMatchObject({ code: usage.UNPRICED_MODEL });
        expect(adapter.chat).not.toHaveBeenCalled();
    });
});

describe('a personal or local account calling the server key is billed to the workspace', () => {
    it.each(['local', 'personal'])('a %s call over the daily cap is refused and the vendor is not called', async (account) => {
        seedCompany({ agentDailyBudgetUsd: 0.01 });
        mockDb.seed(SCHEMA_TYPE.AI_USAGE, { feature: 'ask', costUsd: 0.011, totalTokens: 10, priced: true, billedToWorkspace: true, at: new Date() });
        const call = getProvider().chat({ messages: MESSAGES, spend: { feature: FEATURES.AGENT_RUN, companyId: C, account, runId: 'r1' } });
        await expect(call).rejects.toMatchObject({ code: 'ai_budget_exhausted', period: 'daily' });
        expect(adapter.chat).not.toHaveBeenCalled();
        expect(ledger()).toHaveLength(1);
    });

    it.each(['local', 'personal'])('a %s call under the cap is booked to the workspace and counts toward the day', async (account) => {
        seedCompany({ agentDailyBudgetUsd: 1 });
        await getProvider().chat({ messages: MESSAGES, spend: { feature: FEATURES.AGENT_RUN, companyId: C, account, runId: 'r1' } });
        expect(adapter.chat).toHaveBeenCalledTimes(1);
        expect(ledger()[0]).toMatchObject({ billedToWorkspace: true, priced: true, costUsd: CALL_USD, runId: 'r1' });
        expect(await budget.status(C)).toMatchObject({ usedUsd: CALL_USD, daily: { usedUsd: CALL_USD } });
    });
});

describe('a budget that cannot be read refuses the call', () => {
    const failing = (type, op) => {
        const real = mockDb.crud.getMockImplementation();
        mockDb.crud.mockImplementation(async (...a) => {
            if (a[1] && a[1].type === type && (!op || a[2] === op)) throw new Error('mongo down');
            return real(...a);
        });
        return () => mockDb.crud.mockImplementation(real);
    };

    it('a failed company settings read refuses as budget_unavailable, logs it, and the vendor is not called', async () => {
        seedCompany({ agentDailyBudgetUsd: 5 });
        const restore = failing(dbCollections.COMPANIES, 'findOne');
        try {
            const call = getProvider().chat({ messages: MESSAGES, spend: { feature: FEATURES.ASK, companyId: C, userId: 'u1' } });
            await expect(call).rejects.toMatchObject({ code: 'budget_unavailable', message: expect.stringMatching(/^budget_unavailable: /) });
        } finally { restore(); }
        expect(adapter.chat).not.toHaveBeenCalled();
        expect(ledger()).toHaveLength(0);
        expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('the workspace AI budget settings could not be read'));
    });

    it('a failed ledger read refuses as budget_unavailable and leaves no hold behind', async () => {
        seedCompany({ agentMonthlyBudgetUsd: 5 });
        const restore = failing(SCHEMA_TYPE.AI_USAGE, 'aggregate');
        try {
            const call = getProvider().chat({ messages: MESSAGES, spend: { feature: FEATURES.ASK, companyId: C, userId: 'u1' } });
            await expect(call).rejects.toMatchObject({ code: 'budget_unavailable' });
        } finally { restore(); }
        expect(adapter.chat).not.toHaveBeenCalled();
        expect((mockDb.store[SCHEMA_TYPE.AI_RESERVATIONS] || []).filter((r) => r.state === 'held')).toHaveLength(0);
        expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('the AI spend ledger could not be read'));
    });

    it('a new agent run is refused with the same code', async () => {
        seedCompany({ agentMonthlyBudgetUsd: 5 });
        const restore = failing(SCHEMA_TYPE.AI_USAGE, 'find');
        let out;
        try { out = await runs.canStart(agent(), { companyId: C }); } finally { restore(); }
        expect(out).toMatchObject({ ok: false, code: 'budget_unavailable' });
    });
});

describe('the reservation reads the billed total with one aggregate', () => {
    it('matches the per-feature view for the month and the day', async () => {
        const spend = require('../Modules/AICore/spend');
        await getProvider().chat({ messages: MESSAGES, spend: { feature: FEATURES.ASK, companyId: C, userId: 'u1' } });
        await getProvider().chat({ messages: MESSAGES, spend: { feature: FEATURES.PROJECT_PLAN, companyId: C, userId: 'u1' } });
        mockDb.seed(SCHEMA_TYPE.AI_USAGE, { feature: 'guide', costUsd: 0.0125, totalTokens: 10, billedToWorkspace: true, at: new Date() });
        mockDb.seed(SCHEMA_TYPE.AI_USAGE, { feature: 'guide', costUsd: null, priced: false, totalTokens: 10, billedToWorkspace: true, at: new Date() });
        mockDb.seed(SCHEMA_TYPE.AI_USAGE, { feature: 'guide', costUsd: 9, totalTokens: 10, billedToWorkspace: false, at: new Date() });
        const month = runs.monthKey();
        expect(await spend.monthlyTotal(C, month)).toEqual({ usedUsd: (await spend.monthly(C, month)).usedUsd });
        expect(await spend.dailyTotal(C)).toEqual({ usedUsd: (await spend.daily(C)).usedUsd });
        expect((await spend.monthlyTotal(C, month)).usedUsd).toBe(0.0245);
    });
});

describe('the budget reads every feature', () => {
    it('sums this month across features, per feature largest first, and leaves unbilled and last-month rows out', async () => {
        seedCompany({ agentMonthlyBudgetUsd: 1 });
        await getProvider().chat({ messages: MESSAGES, spend: { feature: FEATURES.ASK, companyId: C, userId: 'u1' } });
        await getProvider().chat({ messages: MESSAGES, spend: { feature: FEATURES.PROJECT_PLAN, companyId: C, userId: 'u1' } });
        await getProvider().chat({ messages: MESSAGES, spend: { feature: FEATURES.PROJECT_PLAN, companyId: C, userId: 'u1' } });
        mockDb.seed(SCHEMA_TYPE.AI_USAGE, { feature: 'meeting_notes', costUsd: 3, totalTokens: 10, billedToWorkspace: false, at: new Date() });
        const lastMonth = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1) - 36e5);
        mockDb.seed(SCHEMA_TYPE.AI_USAGE, { feature: 'guide', costUsd: 5, totalTokens: 10, billedToWorkspace: true, at: lastMonth });

        const status = await budget.status(C);
        expect(status).toMatchObject({ usedUsd: 0.018, budgetUsd: 1, percent: 2 });
        expect(status.features).toEqual([
            { feature: 'project_plan', usd: 0.012, calls: 2, tokens: 3000 },
            { feature: 'ask', usd: 0.006, calls: 1, tokens: 1500 },
        ]);
    });

    it('refuses a new agent run once other features have used the budget up', async () => {
        seedCompany({ agentMonthlyBudgetUsd: 0.01 });
        await getProvider().chat({ messages: MESSAGES, spend: { feature: FEATURES.DESCRIPTION, companyId: C } });
        expect(await runs.canStart(agent(), { companyId: C })).toEqual({ ok: true, reason: '' });
        await getProvider().chat({ messages: MESSAGES, spend: { feature: FEATURES.TASK_CATEGORY, companyId: C } });
        expect(await runs.canStart(agent(), { companyId: C })).toEqual({ ok: false, reason: 'Company agent budget reached ($0.01 of $0.01 this month).' });
    });

    it('a non-agent feature announces the 80% and 100% levels once each, naming the feature', async () => {
        seedCompany({ agentMonthlyBudgetUsd: 0.012 });
        await getProvider().chat({ messages: MESSAGES, spend: { feature: FEATURES.ASK, companyId: C, userId: 'u1' } });
        expect(handleNotificationtFun).not.toHaveBeenCalled();
        await getProvider().chat({ messages: MESSAGES, spend: { feature: FEATURES.PAGE_COMPOSE, companyId: C, userId: 'u2' } });
        expect(handleNotificationtFun).toHaveBeenCalledTimes(1);
        expect(handleNotificationtFun.mock.calls[0][0].body).toMatchObject({
            changeType: 'agent_budget', userId: 'u2', projectId: '', taskId: '', assigneeUsers: ['owner1'],
            message: 'AI budget reached: $0.01 of $0.012 used this month — new AI calls are refused until the budget is raised or the month ends.',
            changeData: { level: '100', feature: 'page_compose', usedUsd: 0.012, percent: 100 },
        });
        adapter.chat.mockImplementation(async () => answer({ inputTokens: 5, outputTokens: 0, totalTokens: 5 }));
        await getProvider().chat({ messages: MESSAGES, spend: { feature: FEATURES.ASK, companyId: C, userId: 'u1' } });
        expect(adapter.chat).toHaveBeenCalledTimes(3);
        expect(ledger()).toHaveLength(3);
        expect(handleNotificationtFun).toHaveBeenCalledTimes(1);
    });
});

describe('agent runs are booked once', () => {
    it('the core row carries the runId; the run keeps its own spend fields; the budget counts the row only', async () => {
        seedCompany({ agentMonthlyBudgetUsd: 0.007 });
        const run = await runs.create(C, { agent: agent(), taskId: 't1', projectId: 'p1', skill: 'qa-review', startedBy: 'u1' });
        const spend = { feature: FEATURES.AGENT_RUN, companyId: C, runId: String(run._id), userId: 'u1', account: run.viaAccount };
        const result = await getProvider().chat({ messages: MESSAGES, spend });
        expect(handleNotificationtFun).not.toHaveBeenCalled();

        const recorded = await runs.recordSpend(C, run, usage.usageFromResult(result), result.model);
        expect(recorded).toMatchObject({ usd: CALL_USD, tokens: 1500 });
        expect(ledger()).toHaveLength(1);
        expect(ledger()[0]).toMatchObject({ feature: 'agent_run', runId: String(run._id), costUsd: CALL_USD });
        expect((await runs.get(C, run._id)).spend).toMatchObject({ usd: CALL_USD, tokens: 1500, model: 'gpt-4.1', billedToWorkspace: true });
        expect(await budget.status(C)).toMatchObject({ usedUsd: CALL_USD, percent: 86, features: [{ feature: 'agent_run', usd: CALL_USD, calls: 1, tokens: 1500 }] });

        expect(handleNotificationtFun).toHaveBeenCalledTimes(1);
        expect(handleNotificationtFun.mock.calls[0][0].body).toMatchObject({ projectId: 'p1', taskId: 't1', userId: AGENT_ID, changeData: { level: '80', runId: String(run._id), feature: 'agent_run' } });
        expect(mockDb.store[SCHEMA_TYPE.AGENTS][0].spendMonth).toMatchObject({ usd: CALL_USD, tokens: 1500, runs: 1 });
    });
});
