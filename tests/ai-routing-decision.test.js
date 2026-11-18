/* The routing decision: which model answered, who was skipped and why, how
 * many attempts it took, and what the estimate turned out to be worth — on the
 * model-call span and in the replay record. No vendor is reached. */
const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Modules/AICore/llmProvider/openaiProvider', () => ({ name: 'openai', model: 'gpt-4.1', isConfigured: true, capabilities: { structuredOutput: 'json_object', defaultMaxTokens: 128000 }, chat: jest.fn() }));
jest.mock('../Modules/AICore/llmProvider/anthropicProvider', () => ({ name: 'anthropic', model: 'claude-sonnet-4-6', isConfigured: true, capabilities: { structuredOutput: 'system_prompt', defaultMaxTokens: 64000 }, chat: jest.fn() }));
jest.mock('../Modules/AICore/llmProvider/deepseekProvider', () => ({ name: 'deepseek', model: null, isConfigured: false, chat: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const telemetry = require('../Config/telemetry');
const openai = require('../Modules/AICore/llmProvider/openaiProvider');
const anthropic = require('../Modules/AICore/llmProvider/anthropicProvider');
const { getProvider } = require('../Modules/AICore/llmProvider');
const health = require('../Modules/AICore/llmProvider/health');
const rateLimit = require('../Modules/AICore/llmProvider/rateLimit');
const { FEATURES } = require('../Modules/AICore/features');
const { AIProviderError, TYPES } = require('../Modules/AICore/providerError');
const { askModel } = require('../Modules/AICore/modelCall');

const C = '6f0000000000000000000c05';
const PROMPT = 'the quarterly plan for the Helios rollout';
const SPEND = { feature: FEATURES.ASK, companyId: C, userId: 'u1' };
const ENV = ['AI_MODEL_ROUTER', 'AI_REPLAY', 'AI_ROUTER_BACKOFF_MS', 'AI_ROUTER_MAX_ATTEMPTS', 'LLM_PROVIDER'];

const answer = (model) => ({ content: '{"ok":true}', inputTokens: 1000, outputTokens: 500, model });
const call = (over = {}) => getProvider().chat({ messages: [{ role: 'user', content: PROMPT }], maxTokens: 1000, spend: SPEND, ...over });
const replays = () => mockDb.store[SCHEMA_TYPE.AI_REPLAYS] || [];
const decisionOfLastCall = () => replays()[replays().length - 1].decision;
const failure = (provider, type) => new AIProviderError({ provider, type, message: `${provider} ${type}` });

const spanOf = async (fn) => {
    const real = telemetry.withSpan;
    const spans = [];
    const spy = jest.spyOn(telemetry, 'withSpan').mockImplementation((name, attributes, inner) => real(name, attributes, (span) => { spans.push(span); return inner(span); }));
    try { await fn(); } finally { spy.mockRestore(); }
    return spans[0];
};

beforeEach(() => {
    jest.clearAllMocks();
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    ENV.forEach((key) => { delete process.env[key]; });
    process.env.AI_REPLAY = 'all';
    process.env.AI_ROUTER_BACKOFF_MS = '0';
    health.reset();
    rateLimit.reset();
    openai.model = 'gpt-4.1';
    openai.chat.mockImplementation(async () => answer('gpt-4.1'));
    anthropic.chat.mockImplementation(async () => answer('claude-sonnet-4-6'));
});

afterAll(() => { ENV.forEach((key) => { delete process.env[key]; }); });

describe('with the router flag off', () => {
    it('records the one candidate, its estimate and what it actually used', async () => {
        await call();

        expect(decisionOfLastCall()).toMatchObject({
            routerEnabled: false,
            taskClass: 'assist',
            requested: { provider: 'openai', model: null, pinned: false },
            chosen: { provider: 'openai', model: 'gpt-4.1' },
            attempts: 1,
            retries: 0,
            skipped: [],
            estimate: { outputTokens: 1000, priced: true, inputBudgetTokens: 16000, overInputBudget: false },
            actual: { inputTokens: 1000, outputTokens: 500, costUsd: 0.006 },
            reservation: { state: 'off', usd: 0 },
        });
        expect(decisionOfLastCall().drift.outputTokens).toBe(-500);
    });

    it('carries no prompt text, so nothing on it needs redacting', async () => {
        await call();
        expect(JSON.stringify(decisionOfLastCall())).not.toContain('Helios');
    });
});

describe('with the router flag on', () => {
    beforeEach(() => { process.env.AI_MODEL_ROUTER = 'on'; });

    it('names the candidate the breaker skipped and the provider that answered instead', async () => {
        for (let i = 0; i < 5; i += 1) health.record({ provider: 'openai', model: 'gpt-4.1', ok: false, errorType: TYPES.SERVER });

        const result = await call();

        expect(result.model).toBe('claude-sonnet-4-6');
        expect(openai.chat).not.toHaveBeenCalled();
        expect(decisionOfLastCall()).toMatchObject({
            routerEnabled: true,
            chosen: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
            attempts: 1,
            skipped: [{ provider: 'openai', model: 'gpt-4.1', reason: 'breaker_open' }],
        });
    });

    it('counts a second try on the same provider as a retry and the move to the next one as neither', async () => {
        process.env.AI_ROUTER_MAX_ATTEMPTS = '2';
        openai.chat.mockImplementation(async () => { throw failure('openai', TYPES.OVERLOADED); });

        await call();

        expect(openai.chat).toHaveBeenCalledTimes(2);
        expect(decisionOfLastCall()).toMatchObject({
            chosen: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
            attempts: 3,
            retries: 1,
            skipped: [{ provider: 'openai', reason: TYPES.OVERLOADED }],
        });
    });

    it('says a pinned model could not travel to the provider that took over', async () => {
        openai.chat.mockImplementation(async () => { throw failure('openai', TYPES.QUOTA); });

        await call({ model: 'gpt-5-mini' });

        expect(decisionOfLastCall()).toMatchObject({
            requested: { model: 'gpt-5-mini', pinned: true },
            chosen: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
            skipped: expect.arrayContaining([{ provider: 'anthropic', model: 'gpt-5-mini', reason: 'pin_dropped' }]),
        });
    });

    it('records the reservation state alongside the estimate', async () => {
        mockDb.seed('companies', { _id: C, agentMonthlyBudgetUsd: 10 });
        await call();
        expect(decisionOfLastCall().reservation).toMatchObject({ state: 'settled', usd: 0.008 });
    });
});

describe('on the model call span', () => {
    it('carries the chosen model, the task class, the estimate and the reservation', async () => {
        const span = await spanOf(() => askModel({ systemPrompt: 'review', maxTokens: 1000 }, { prompt: PROMPT, budget: {}, spend: SPEND }));

        expect(span.attributes).toMatchObject({
            'gen_ai.system': 'openai',
            'ai.routing.enabled': false,
            'ai.routing.task_class': 'assist',
            'ai.routing.provider': 'openai',
            'ai.routing.model': 'gpt-4.1',
            'ai.routing.attempts': 1,
            'ai.routing.retries': 0,
            'ai.routing.estimated_output_tokens': 1000,
            'ai.routing.input_budget_tokens': 16000,
            'ai.routing.input_over_budget': false,
            'ai.routing.actual_input_tokens': 1000,
            'ai.budget.reservation_state': 'off',
        });
    });

    it('says which candidate was skipped for having no price, before anything is bought', async () => {
        openai.model = 'mystery-model';
        const span = await spanOf(() => askModel({ systemPrompt: 'review', maxTokens: 1000 }, { prompt: PROMPT, budget: {}, spend: SPEND }));

        expect(openai.chat).not.toHaveBeenCalled();
        expect(span.attributes['ai.routing.skipped']).toBe('openai:unpriced');
        expect(replays()).toHaveLength(0);
    });
});
