/* A model pinned on a skill or an agent reaches the vendor request and the
 * routing decision. The adapters are mocked but resolve the model the same way
 * the real ones do, so a pin that stops at the chat options shows up here as
 * the configured model. No vendor is reached. */
const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Modules/AICore/llmProvider/openaiProvider', () => ({ name: 'openai', model: 'gpt-4.1', isConfigured: true, capabilities: { structuredOutput: 'json_object', defaultMaxTokens: 128000 }, chat: jest.fn() }));
jest.mock('../Modules/AICore/llmProvider/anthropicProvider', () => ({ name: 'anthropic', model: 'claude-sonnet-4-6', isConfigured: true, capabilities: { structuredOutput: 'system_prompt', defaultMaxTokens: 64000 }, chat: jest.fn() }));
jest.mock('../Modules/AICore/llmProvider/deepseekProvider', () => ({ name: 'deepseek', model: null, isConfigured: false, chat: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const openai = require('../Modules/AICore/llmProvider/openaiProvider');
const anthropic = require('../Modules/AICore/llmProvider/anthropicProvider');
const deepseek = require('../Modules/AICore/llmProvider/deepseekProvider');
const { resolveModel } = require('../Modules/AICore/llmProvider/normalise');
const health = require('../Modules/AICore/llmProvider/health');
const rateLimit = require('../Modules/AICore/llmProvider/rateLimit');
const { FEATURES } = require('../Modules/AICore/features');
const { askModel } = require('../Modules/AICore/modelCall');
const { validateSkill } = require('../Modules/Agents/skills/validateSkill');
const orchestrator = require('../Modules/Agents/engine/orchestrator');

const C = '6f0000000000000000000c64';
const SPEND = { feature: FEATURES.AGENT_RUN, companyId: C, userId: 'u1' };
const ENV = ['AI_MODEL_ROUTER', 'AI_REPLAY', 'AI_ROUTER_BACKOFF_MS', 'LLM_PROVIDER'];
const TASK = { _id: '6f0000000000000000000764', TaskName: 'Pin check', ProjectID: '6f0000000000000000000964', description: '<p>Goal: check the pin.</p>' };

const sentBy = (adapter) => async (opts) => ({ content: '{"summary":"ok"}', inputTokens: 100, outputTokens: 20, model: resolveModel(adapter, opts) });
const skill = (over = {}) => ({ systemPrompt: 'review', maxTokens: 1000, ...over });
const ask = (skillDoc, agent) => askModel(skillDoc, { prompt: 'look', budget: {}, spend: SPEND, agent });
const replays = () => mockDb.store[SCHEMA_TYPE.AI_REPLAYS] || [];
const lastDecision = () => replays()[replays().length - 1].decision;

beforeEach(() => {
    jest.clearAllMocks();
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    ENV.forEach((key) => { delete process.env[key]; });
    process.env.AI_REPLAY = 'all';
    process.env.AI_ROUTER_BACKOFF_MS = '0';
    health.reset();
    rateLimit.reset();
    openai.chat.mockImplementation(sentBy(openai));
    anthropic.chat.mockImplementation(sentBy(anthropic));
    deepseek.chat.mockImplementation(sentBy(deepseek));
});

afterAll(() => { ENV.forEach((key) => { delete process.env[key]; }); });

describe('with the router flag off (the default)', () => {
    it('sends the skill\'s pinned model and records it as pinned', async () => {
        const out = await ask(skill({ model: 'gpt-5-mini' }));

        expect(out.model).toBe('gpt-5-mini');
        expect(openai.chat).toHaveBeenCalledTimes(1);
        expect(lastDecision()).toMatchObject({
            requested: { provider: 'openai', model: 'gpt-5-mini', pinned: true },
            chosen: { provider: 'openai', model: 'gpt-5-mini' },
            skipped: [],
        });
    });

    it('uses the agent\'s pin when the skill has none', async () => {
        const out = await ask(skill(), { model: 'gpt-4.1-mini' });

        expect(out.model).toBe('gpt-4.1-mini');
        expect(lastDecision().requested).toEqual({ provider: 'openai', model: 'gpt-4.1-mini', pinned: true });
    });

    it('lets the skill\'s pin win over the agent\'s', async () => {
        const out = await ask(skill({ model: 'gpt-5-mini' }), { model: 'gpt-4.1-mini' });

        expect(out.model).toBe('gpt-5-mini');
        expect(lastDecision().requested.model).toBe('gpt-5-mini');
    });

    it('sends a pin on another configured provider to that provider', async () => {
        const out = await ask(skill({ model: 'claude-haiku-4-5' }));

        expect(out.model).toBe('claude-haiku-4-5');
        expect(openai.chat).not.toHaveBeenCalled();
        expect(anthropic.chat).toHaveBeenCalledTimes(1);
        expect(lastDecision()).toMatchObject({
            requested: { provider: 'anthropic', model: 'claude-haiku-4-5', pinned: true },
            chosen: { provider: 'anthropic', model: 'claude-haiku-4-5' },
        });
    });

    it('drops an unpriced pin, records the drop and never sends the unpriced model', async () => {
        const out = await ask(skill({ model: 'gpt-9-imaginary' }));

        expect(out.model).toBe('gpt-4.1');
        expect(openai.chat.mock.calls.map(([opts]) => resolveModel(openai, opts))).toEqual(['gpt-4.1']);
        expect(lastDecision()).toMatchObject({
            requested: { provider: 'openai', model: 'gpt-9-imaginary', pinned: true },
            chosen: { provider: 'openai', model: 'gpt-4.1' },
            skipped: [{ provider: 'openai', model: 'gpt-9-imaginary', reason: 'pin_dropped' }],
        });
    });

    it('drops a pin whose provider is not configured and records the drop', async () => {
        const out = await ask(skill({ model: 'deepseek-flash' }));

        expect(deepseek.chat).not.toHaveBeenCalled();
        expect(out.model).toBe('gpt-4.1');
        expect(lastDecision()).toMatchObject({
            requested: { model: 'deepseek-flash', pinned: true },
            chosen: { provider: 'openai', model: 'gpt-4.1' },
            skipped: [{ provider: 'openai', model: 'deepseek-flash', reason: 'pin_dropped' }],
        });
    });

    it('prices the reservation and names the refusal with the pinned model', async () => {
        const reserve = jest.fn(async () => ({ ok: false, reason: 'spend_cap_exceeded', code: 'spend_cap_exceeded' }));

        const out = await askModel(skill({ model: 'gpt-5-mini' }), { prompt: 'look', budget: { guard: { reserve } }, spend: SPEND });

        expect(out.model).toBe('gpt-5-mini');
        expect(reserve.mock.calls[0][0].model).toBe('gpt-5-mini');
        expect(openai.chat).not.toHaveBeenCalled();
    });

    it('leaves an unpinned call exactly as it was', async () => {
        const out = await ask(skill(), {});

        expect(out.model).toBe('gpt-4.1');
        const [opts] = openai.chat.mock.calls[0];
        expect(Object.keys(opts).filter((k) => k !== 'decision').sort()).toEqual(['jsonMode', 'maxTokens', 'messages', 'spend', 'systemPrompt', 'temperature']);
        expect(lastDecision()).toMatchObject({ requested: { provider: 'openai', model: null, pinned: false }, skipped: [] });
    });
});

describe('with the router flag on', () => {
    beforeEach(() => { process.env.AI_MODEL_ROUTER = 'on'; });

    it('sends the pinned model through the router and records it as pinned', async () => {
        const out = await ask(skill({ model: 'claude-haiku-4-5' }), { model: 'gpt-5-mini' });

        expect(out.model).toBe('claude-haiku-4-5');
        expect(lastDecision()).toMatchObject({
            routerEnabled: true,
            requested: { provider: 'anthropic', model: 'claude-haiku-4-5', pinned: true },
            chosen: { provider: 'anthropic', model: 'claude-haiku-4-5' },
        });
    });

    it('records a dropped pin the same way', async () => {
        await ask(skill({ model: 'gpt-9-imaginary' }));

        expect(lastDecision()).toMatchObject({
            requested: { model: 'gpt-9-imaginary', pinned: true },
            chosen: { provider: 'openai', model: 'gpt-4.1' },
            skipped: expect.arrayContaining([{ provider: 'openai', model: 'gpt-9-imaginary', reason: 'pin_dropped' }]),
        });
    });
});

describe('an agent run', () => {
    const dataSkill = (over = {}) => validateSkill({
        key: 'task.summary',
        name: 'Summariser',
        inputs: ['brief'],
        gather: [{ reader: 'task' }],
        prompt: { template: '{{input.brief}}', output: '{"summary":"..."}' },
        emit: [{ action: 'task.comment', params: { body: '{{answer.summary}}' } }],
        ...over,
    }).value;

    const analyse = (agent) => orchestrator.analyse({ skillSlug: 'task.summary', task: TASK, context: {}, budget: { maxTokens: 4000 }, spend: SPEND, companyId: C, agent });

    it('calls the provider with the stored skill\'s pin over the agent\'s', async () => {
        mockDb.seed(SCHEMA_TYPE.AGENT_SKILLS, dataSkill({ model: 'gpt-5-mini' }));

        const result = await analyse({ allowedActions: [], model: 'gpt-4.1-mini' });

        expect(result.model).toBe('gpt-5-mini');
        expect(lastDecision().requested).toEqual({ provider: 'openai', model: 'gpt-5-mini', pinned: true });
    });

    it('calls the provider with the agent\'s pin when the stored skill has none', async () => {
        mockDb.seed(SCHEMA_TYPE.AGENT_SKILLS, dataSkill());

        const result = await analyse({ allowedActions: [], model: 'gpt-4.1-mini' });

        expect(result.model).toBe('gpt-4.1-mini');
        expect(lastDecision().requested).toEqual({ provider: 'openai', model: 'gpt-4.1-mini', pinned: true });
    });
});
