/* The tenant budget reservation: what a call holds before it is made, what it
 * releases after, what happens when two calls race for the last of a budget,
 * and what happens to a hold whose process died mid-call. No vendor is
 * reached — the adapter is a stub with the registry's shape. */
const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({ ROLE_OWNER: 1, ROLE_ADMIN: 2, getRoleType: jest.fn(async () => 1), isPrivileged: (r) => r === 1 || r === 2 }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Modules/notification/prepare-notification-data/controllerV2', () => ({ handleNotificationtFun: jest.fn(async () => ({ status: true })) }));
jest.mock('../Modules/AICore/llmProvider/openaiProvider', () => ({ name: 'openai', model: 'gpt-4.1', isConfigured: true, capabilities: { structuredOutput: 'json_object', defaultMaxTokens: 128000 }, chat: jest.fn() }));
jest.mock('../Modules/AICore/llmProvider/anthropicProvider', () => ({ name: 'anthropic', model: null, isConfigured: false, chat: jest.fn() }));
jest.mock('../Modules/AICore/llmProvider/deepseekProvider', () => ({ name: 'deepseek', model: null, isConfigured: false, chat: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { dbCollections } = require('../Config/collections');
const adapter = require('../Modules/AICore/llmProvider/openaiProvider');
const { getProvider } = require('../Modules/AICore/llmProvider');
const { FEATURES } = require('../Modules/AICore/features');
const reservation = require('../Modules/AICore/reservation');
const budget = require('../Modules/Agents/budget');
const { AIProviderError, TYPES } = require('../Modules/AICore/providerError');

const C = '6f0000000000000000000c04';
const MESSAGES = [{ role: 'user', content: 'hello' }];

/* gpt-4.1 lists at $8 per 1M output tokens, so a call capped at 100k output is
 * estimated at $0.80 before it is made (the six-token prompt rounds away). The
 * stub answers with 1000 in and 500 out, which the ledger books at $0.006: the
 * gap between the two is the point of reconciling. */
const MAX_TOKENS = 100000;
const ESTIMATE_USD = 0.8;
const ACTUAL_USD = 0.006;

const answer = () => ({ content: '{"ok":true}', inputTokens: 1000, outputTokens: 500, model: 'gpt-4.1' });
const call = (over = {}) => getProvider().chat({ messages: MESSAGES, maxTokens: MAX_TOKENS, spend: { feature: FEATURES.ASK, companyId: C, userId: 'u1' }, ...over });
const holds = () => mockDb.store[SCHEMA_TYPE.AI_RESERVATIONS] || [];
const ledger = () => mockDb.store[SCHEMA_TYPE.AI_USAGE] || [];
const seedCompany = (over = {}) => mockDb.seed(dbCollections.COMPANIES, { _id: C, ...over });

beforeEach(() => {
    jest.clearAllMocks();
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.calls.length = 0;
    delete process.env.AI_MODEL_ROUTER;
    delete process.env.AI_RESERVATION_TTL_MS;
    delete process.env.AI_ROUTER_BACKOFF_MS;
    delete process.env.LLM_PROVIDER;
    adapter.chat.mockImplementation(async () => answer());
});

afterAll(() => { ['AI_MODEL_ROUTER', 'AI_RESERVATION_TTL_MS', 'AI_ROUTER_BACKOFF_MS'].forEach((key) => { delete process.env[key]; }); });

describe('the estimate a reservation is sized from', () => {
    it('reads the prompt as characters and the output at its ceiling, against the task class input budget', () => {
        const { preflight } = require('../Modules/AICore/estimate');
        const small = preflight({ messages: MESSAGES, maxTokens: 100, model: 'gpt-4.1', feature: FEATURES.ASK });
        expect(small).toMatchObject({ taskClass: 'assist', inputBudgetTokens: 16000, overInputBudget: false, outputTokens: 100, priced: true });
        expect(small.inputTokens).toBeGreaterThan(0);

        const huge = preflight({ messages: [{ role: 'user', content: 'x'.repeat(200000) }], maxTokens: 100, model: 'gpt-4.1', feature: FEATURES.TASK_CATEGORY });
        expect(huge).toMatchObject({ taskClass: 'classify', inputBudgetTokens: 4000, overInputBudget: true });
    });
});

describe('with the router flag off', () => {
    it('holds nothing and refuses nothing, however small the budget', async () => {
        seedCompany({ agentMonthlyBudgetUsd: 0.0001 });
        await expect(call()).resolves.toMatchObject({ content: '{"ok":true}' });
        expect(holds()).toHaveLength(0);
        expect(ledger()).toHaveLength(1);
    });
});

describe('with the router flag on', () => {
    beforeEach(() => { process.env.AI_MODEL_ROUTER = 'on'; });

    it('holds nothing when the workspace has no budget', async () => {
        seedCompany({ agentMonthlyBudgetUsd: 0 });
        await call();
        expect(holds()).toHaveLength(0);
    });

    it('holds the estimate before the call and settles it with the real usage after', async () => {
        seedCompany({ agentMonthlyBudgetUsd: 10 });
        let heldDuringCall = null;
        adapter.chat.mockImplementation(async () => {
            heldDuringCall = await reservation.heldUsd(C);
            return answer();
        });

        await call();

        expect(heldDuringCall).toBe(ESTIMATE_USD);
        expect(holds()).toHaveLength(1);
        expect(holds()[0]).toMatchObject({
            companyId: C, feature: 'ask', state: 'settled', amountUsd: ESTIMATE_USD, model: 'gpt-4.1', provider: 'openai',
            taskClass: 'assist', actualInputTokens: 1000, actualOutputTokens: 500, actualUsd: ACTUAL_USD, userId: 'u1',
        });
        expect(await reservation.heldUsd(C)).toBe(0);
        expect(ledger()[0]).toMatchObject({ costUsd: ACTUAL_USD, priced: true });
    });

    it('releases the hold when the vendor call throws, on every attempt, so a failed call costs no budget', async () => {
        seedCompany({ agentMonthlyBudgetUsd: 10 });
        process.env.AI_ROUTER_BACKOFF_MS = '0';
        adapter.chat.mockImplementation(async () => { throw new AIProviderError({ provider: 'openai', model: 'gpt-4.1', type: TYPES.SERVER, message: 'boom' }); });

        await expect(call()).rejects.toThrow('boom');
        expect(holds()).toHaveLength(2);
        expect(holds().every((h) => h.state === 'released' && h.actualUsd === null)).toBe(true);
        expect(await reservation.heldUsd(C)).toBe(0);
    });

    it('refuses the call when what is booked plus what is held would pass the budget', async () => {
        seedCompany({ agentMonthlyBudgetUsd: 1 });
        mockDb.seed(SCHEMA_TYPE.AI_USAGE, { companyId: C, feature: 'ask', costUsd: 0.5, totalTokens: 10, billedToWorkspace: true, at: new Date() });

        await expect(call()).rejects.toMatchObject({ code: reservation.BUDGET_EXHAUSTED });
        expect(adapter.chat).not.toHaveBeenCalled();
        expect(holds()[0]).toMatchObject({ state: 'released' });
        expect(await reservation.heldUsd(C)).toBe(0);
    });

    it('lets two parallel runs that fit alone but not together through one at a time', async () => {
        seedCompany({ agentMonthlyBudgetUsd: 1 });
        const outcomes = await Promise.all([
            call({ spend: { feature: FEATURES.AGENT_RUN, companyId: C, runId: 'run-a' } }).catch((e) => e),
            call({ spend: { feature: FEATURES.AGENT_RUN, companyId: C, runId: 'run-b' } }).catch((e) => e),
        ]);

        const answered = outcomes.filter((o) => !(o instanceof Error));
        const refused = outcomes.filter((o) => o instanceof Error);
        expect(answered).toHaveLength(1);
        expect(refused).toHaveLength(1);
        expect(refused[0].code).toBe(reservation.BUDGET_EXHAUSTED);
        expect(refused[0].message).toContain('ai_budget_exhausted');
        expect(adapter.chat).toHaveBeenCalledTimes(1);
        expect(ledger()).toHaveLength(1);
        expect(holds().map((h) => h.state).sort()).toEqual(['released', 'settled']);
    });

    it('counts a hold from another call in flight, whoever is holding it', async () => {
        seedCompany({ agentMonthlyBudgetUsd: 1 });
        mockDb.seed(SCHEMA_TYPE.AI_RESERVATIONS, { companyId: C, feature: 'agent_run', state: 'held', amountUsd: 0.9, at: new Date(), expiresAt: new Date(Date.now() + 60000) });

        expect(await reservation.heldUsd(C)).toBe(0.9);
        await expect(call()).rejects.toMatchObject({ code: reservation.BUDGET_EXHAUSTED });
    });

    describe('a hold stranded by a crash between reserving and settling', () => {
        const stranded = () => mockDb.seed(SCHEMA_TYPE.AI_RESERVATIONS, {
            companyId: C, feature: 'agent_run', state: 'held', amountUsd: 50,
            at: new Date(Date.now() - 3600000), expiresAt: new Date(Date.now() - 1800000),
        });

        it('stops holding budget once it expires, so it cannot refuse work forever', async () => {
            seedCompany({ agentMonthlyBudgetUsd: 10 });
            stranded();

            expect(await reservation.heldUsd(C)).toBe(0);
            await expect(call()).resolves.toMatchObject({ content: '{"ok":true}' });
            expect(adapter.chat).toHaveBeenCalledTimes(1);
        });

        it('still holds while it is unexpired, so a call in flight is not double-spent', async () => {
            seedCompany({ agentMonthlyBudgetUsd: 10 });
            mockDb.seed(SCHEMA_TYPE.AI_RESERVATIONS, { companyId: C, feature: 'agent_run', state: 'held', amountUsd: 50, at: new Date(), expiresAt: new Date(Date.now() + 60000) });

            expect(await reservation.heldUsd(C)).toBe(50);
            await expect(call()).rejects.toMatchObject({ code: reservation.BUDGET_EXHAUSTED });
        });

        it('is listed for an operator, and carries the expiry the TTL index deletes it on', async () => {
            const row = stranded();
            const rows = await reservation.stranded(C);
            expect(rows.map((r) => String(r._id))).toEqual([String(row._id)]);
            expect(reservation.ttlMs()).toBe(reservation.DEFAULT_TTL_MS);
            process.env.AI_RESERVATION_TTL_MS = '60000';
            expect(reservation.ttlMs()).toBe(60000);
        });
    });

    it('is what the monthly budget reads as in flight, in place of the per-run holds', async () => {
        seedCompany({ agentMonthlyBudgetUsd: 10 });
        mockDb.seed(SCHEMA_TYPE.AGENT_RUNS, { status: 'running', startedAt: new Date(), reservedUsd: 3 });
        mockDb.seed(SCHEMA_TYPE.AI_RESERVATIONS, { companyId: C, feature: 'agent_run', state: 'held', amountUsd: 2, at: new Date(), expiresAt: new Date(Date.now() + 60000) });

        expect(await budget.headroom(C)).toMatchObject({ budgetUsd: 10, usedUsd: 0, reservedUsd: 2, remainingUsd: 8 });

        delete process.env.AI_MODEL_ROUTER;
        expect(await budget.headroom(C)).toMatchObject({ reservedUsd: 3, remainingUsd: 7 });
    });
});
