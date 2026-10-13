/* Embeddings on the provider layer: the OpenAI adapter embeds in batches and reports the
 * model version it was billed for, the spend meter books every call to the knowledge
 * feature tag and refuses an unpriced model before any token is bought, and every other
 * adapter says it has no embeddings. Nothing here reaches a vendor: axios is a mock. */
const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../Config/config', () => ({ AI_API_KEY: 'sk-proj-EMBEDSECRET0123456789', AI_MODEL: '' }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Modules/notification/prepare-notification-data/controllerV2', () => ({ handleNotificationtFun: jest.fn(async () => ({ status: true })) }));
jest.mock('axios', () => ({ post: jest.fn() }));

const axios = require('axios');
const { AxiosError, AxiosHeaders } = jest.requireActual('axios');
const config = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { dbCollections } = require('../Config/collections');
const reservation = require('../Modules/AICore/reservation');
const registry = require('../Modules/AICore/llmProvider/registry');
const llmProvider = require('../Modules/AICore/llmProvider');
const health = require('../Modules/AICore/llmProvider/health');
const { metered } = require('../Modules/AICore/spend');
const { FEATURES } = require('../Modules/AICore/features');
const usage = require('../Modules/AICore/usage');
const taskClass = require('../Modules/AICore/taskClass');
const { NO_EMBEDDINGS, isProviderError } = require('../Modules/AICore/providerError');

const C = '6f0000000000000000000c01';
const MODEL = 'text-embedding-3-small';
const KEY = 'sk-proj-EMBEDSECRET0123456789';
const SPEND = { feature: FEATURES.KNOWLEDGE_EMBED, companyId: C, userId: 'u1' };
const ENV = { url: process.env.OPENAI_EMBEDDINGS_URL };

const ledger = () => mockDb.store[SCHEMA_TYPE.AI_USAGE] || [];
const vectorFor = (text) => [text.length, 1, 0];

/* One response per request, shaped like OpenAI's embeddings endpoint, with a token count per input. */
const answer = ({ data: body }) => Promise.resolve({
    data: {
        object: 'list',
        data: body.input.map((text, index) => ({ object: 'embedding', index, embedding: vectorFor(text) })),
        model: `${body.model}-2026`,
        usage: { prompt_tokens: body.input.length * 3, total_tokens: body.input.length * 3 },
    },
});
const answering = () => axios.post.mockImplementation(async (url, body) => answer({ data: body }));

const vendorError = (status, body) => {
    const cfg = { headers: { Authorization: `Bearer ${KEY}` } };
    const response = { status, data: body, headers: AxiosHeaders.from({ 'x-request-id': 'req_e1' }), config: cfg };
    return new AxiosError(`Request failed with status code ${status}`, AxiosError.ERR_BAD_REQUEST, cfg, {}, response);
};

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.calls.length = 0;
    jest.clearAllMocks();
    health.reset();
    config.AI_API_KEY = KEY;
    config.AI_MODEL = '';
    delete process.env.OPENAI_EMBEDDINGS_URL;
    delete process.env.LLM_PRICING;
    delete process.env.AI_MODEL_ROUTER;
    answering();
});

afterAll(() => {
    if (ENV.url === undefined) delete process.env.OPENAI_EMBEDDINGS_URL;
    else process.env.OPENAI_EMBEDDINGS_URL = ENV.url;
});

describe('the feature tag and the price', () => {
    it('names knowledge_embed as a feature, on the cheapest task class', () => {
        expect(FEATURES.KNOWLEDGE_EMBED).toBe('knowledge_embed');
        expect(taskClass.classOfFeature(FEATURES.KNOWLEDGE_EMBED)).toBe(taskClass.TASK_CLASS.CLASSIFY);
    });

    it('prices the OpenAI embedding models by input tokens only', () => {
        expect(usage.priceFor('text-embedding-3-small')).toMatchObject({ priced: true, input: 0.02, output: 0 });
        expect(usage.priceFor('text-embedding-3-large')).toMatchObject({ priced: true, input: 0.13, output: 0 });
        expect(usage.summarize({ inputTokens: 1000000, outputTokens: 0 }, MODEL).costUsd).toBe(0.02);
    });
});

describe('the OpenAI adapter embeds', () => {
    const openai = registry.ADAPTERS.openai;

    it('is configured for embeddings by the instance key alone, with no chat model set', () => {
        expect(openai.isConfigured).toBe(false);
        expect(openai.embeddingsConfigured).toBe(true);
        expect(llmProvider.isAnyProviderConfigured()).toBe(false);
        expect(llmProvider.isEmbeddingConfigured()).toBe(true);
        config.AI_API_KEY = '';
        expect(openai.embeddingsConfigured).toBe(false);
        expect(llmProvider.isEmbeddingConfigured()).toBe(false);
    });

    it('sends the texts in batches, in order, and returns one vector per text with the model the vendor billed', async () => {
        const texts = Array.from({ length: 250 }, (_, i) => `t${'x'.repeat(i % 7)}`);
        const result = await openai.embed({ texts, model: MODEL });

        expect(axios.post).toHaveBeenCalledTimes(3);
        expect(axios.post.mock.calls.map(([, body]) => body.input.length)).toEqual([100, 100, 50]);
        axios.post.mock.calls.forEach(([url, body, options]) => {
            expect(url).toBe('https://api.openai.com/v1/embeddings');
            expect(body).toEqual({ model: MODEL, input: expect.any(Array) });
            expect(options.headers.Authorization).toBe(`Bearer ${KEY}`);
            expect(options.timeout).toBeGreaterThan(0);
        });
        expect(axios.post.mock.calls.flatMap(([, body]) => body.input)).toEqual(texts);
        expect(result.embeddings).toEqual(texts.map(vectorFor));
        expect(result).toMatchObject({ model: `${MODEL}-2026`, inputTokens: 750, outputTokens: 0, totalTokens: 750, dimensions: 3 });
    });

    it('posts to OPENAI_EMBEDDINGS_URL when the operator points it elsewhere', async () => {
        process.env.OPENAI_EMBEDDINGS_URL = 'http://127.0.0.1:9/v1/embeddings';
        await openai.embed({ texts: ['a'], model: MODEL });
        expect(axios.post.mock.calls[0][0]).toBe('http://127.0.0.1:9/v1/embeddings');
    });

    it("sends the caller's timeout to the vendor when given one, and the provider timeout otherwise", async () => {
        await openai.embed({ texts: ['a'], model: MODEL, timeoutMs: 2000 });
        expect(axios.post.mock.calls[0][2].timeout).toBe(2000);
        await openai.embed({ texts: ['a'], model: MODEL });
        expect(axios.post.mock.calls[1][2].timeout).toBeGreaterThan(2000);
    });

    it('makes no request for no texts', async () => {
        const result = await openai.embed({ texts: [], model: MODEL });
        expect(result).toMatchObject({ embeddings: [], model: MODEL, inputTokens: 0, totalTokens: 0 });
        expect(axios.post).not.toHaveBeenCalled();
    });

    it('refuses without the instance key, and turns a vendor refusal into a provider error without the key in it', async () => {
        config.AI_API_KEY = '';
        await expect(openai.embed({ texts: ['a'], model: MODEL })).rejects.toThrow(/AI_API_KEY/);
        expect(axios.post).not.toHaveBeenCalled();

        config.AI_API_KEY = KEY;
        axios.post.mockRejectedValue(vendorError(401, { error: { message: `bad key ${KEY}`, type: 'invalid_request_error', code: 'invalid_api_key' } }));
        const failure = await openai.embed({ texts: ['a'], model: MODEL }).catch((e) => e);
        expect(isProviderError(failure)).toBe(true);
        expect(failure).toMatchObject({ provider: 'openai', model: MODEL, type: 'auth', status: 401, requestId: 'req_e1' });
        expect(JSON.stringify(failure.toFailure())).not.toContain(KEY);
    });

    it('rejects a vendor answer whose vectors do not line up with the texts', async () => {
        axios.post.mockResolvedValue({ data: { data: [{ index: 0, embedding: [1] }], model: MODEL, usage: { prompt_tokens: 2 } } });
        await expect(openai.embed({ texts: ['a', 'b'], model: MODEL })).rejects.toThrow(/2 texts/);
    });
});

describe('every other adapter reports no embeddings', () => {
    it.each(['anthropic', 'deepseek', 'google'])('%s', async (name) => {
        const adapter = registry.ADAPTERS[name];
        expect(adapter.embeddingsConfigured).toBe(false);
        const failure = await adapter.embed({ texts: ['a'], model: MODEL }).catch((e) => e);
        expect(failure.code).toBe(NO_EMBEDDINGS);
        expect(failure.retryable).toBe(false);
        expect(failure.message).toMatch(/no embeddings/i);
        expect(axios.post).not.toHaveBeenCalled();
    });

    it('is reported through the meter too, before any spend is booked', async () => {
        const failure = await metered(registry.ADAPTERS.anthropic).embed({ texts: ['a'], model: MODEL, spend: SPEND }).catch((e) => e);
        expect(failure.code).toBe(NO_EMBEDDINGS);
        expect(ledger()).toEqual([]);
    });
});

describe('the spend meter around embed()', () => {
    it('books one row to the knowledge feature, priced by input tokens, with the tenant and the person', async () => {
        const result = await llmProvider.embeddingProvider().embed({ texts: ['alpha', 'beta'], model: MODEL, spend: SPEND });
        expect(result.embeddings).toHaveLength(2);
        expect(ledger()).toHaveLength(1);
        expect(ledger()[0]).toMatchObject({
            companyId: C, feature: 'knowledge_embed', model: `${MODEL}-2026`, provider: 'openai',
            inputTokens: 6, outputTokens: 0, totalTokens: 6, costUsd: 0, priced: true, billedToWorkspace: true, userId: 'u1', runId: null, at: expect.any(Date),
        });
        expect(mockDb.calls.find((c) => c.type === SCHEMA_TYPE.AI_USAGE).companyId).toBe(C);
    });

    it('costs what the price sheet says once the tokens add up', async () => {
        axios.post.mockResolvedValue({ data: { data: [{ index: 0, embedding: [1, 0] }], model: MODEL, usage: { prompt_tokens: 500000, total_tokens: 500000 } } });
        await llmProvider.embeddingProvider().embed({ texts: ['a'], model: MODEL, spend: SPEND });
        expect(ledger()[0]).toMatchObject({ inputTokens: 500000, costUsd: 0.01 });
    });

    it('refuses an unpriced model before any request, as the router does for chat models', async () => {
        const failure = await llmProvider.embeddingProvider().embed({ texts: ['a'], model: 'text-embedding-9-unknown', spend: SPEND }).catch((e) => e);
        expect(failure.code).toBe(usage.UNPRICED_MODEL);
        expect(failure.message).toMatch(/text-embedding-9-unknown/);
        expect(axios.post).not.toHaveBeenCalled();
        expect(ledger()).toEqual([]);
    });

    it('takes an operator price as the way to another embedding model', async () => {
        process.env.LLM_PRICING = '{"my-embedder":{"input":0,"output":0}}';
        await llmProvider.embeddingProvider().embed({ texts: ['a'], model: 'my-embedder', spend: SPEND });
        expect(axios.post.mock.calls[0][1].model).toBe('my-embedder');
        expect(ledger()[0]).toMatchObject({ model: 'my-embedder-2026', costUsd: 0, priced: true });
    });

    it('is a hard error under test without a feature tag or a tenant, before any request', async () => {
        await expect(llmProvider.embeddingProvider().embed({ texts: ['a'], model: MODEL, spend: { companyId: C } })).rejects.toThrow('without a known feature tag');
        await expect(llmProvider.embeddingProvider().embed({ texts: ['a'], model: MODEL, spend: { feature: FEATURES.KNOWLEDGE_EMBED } })).rejects.toThrow('without a companyId');
        expect(axios.post).not.toHaveBeenCalled();
        expect(ledger()).toEqual([]);
    });

    it('books nothing when the vendor refuses, and records the failure on the provider health', async () => {
        axios.post.mockRejectedValue(vendorError(429, { error: { message: 'slow down', type: 'rate_limit_error' } }));
        await expect(llmProvider.embeddingProvider().embed({ texts: ['a'], model: MODEL, spend: SPEND })).rejects.toMatchObject({ type: 'rate_limit' });
        expect(ledger()).toEqual([]);
        expect(health.snapshot('openai', MODEL)).toMatchObject({ calls: 1, failures: 1, lastErrorType: 'rate_limit' });

        answering();
        await llmProvider.embeddingProvider().embed({ texts: ['a'], model: MODEL, spend: SPEND });
        expect(health.snapshot('openai', MODEL)).toMatchObject({ calls: 2, successes: 1 });
    });

    describe('holds the workspace budget as a chat call does', () => {
        const holds = () => mockDb.store[SCHEMA_TYPE.AI_RESERVATIONS] || [];
        const spent = (usd) => mockDb.seed(SCHEMA_TYPE.AI_USAGE, { companyId: C, feature: 'ask', model: 'gpt-4.1', costUsd: usd, totalTokens: 1, billedToWorkspace: true, at: new Date() });

        beforeEach(() => { process.env.AI_MODEL_ROUTER = 'on'; });
        afterEach(() => { delete process.env.AI_MODEL_ROUTER; });

        it('refuses before any request once the month is spent, releases the hold and books nothing', async () => {
            mockDb.seed(dbCollections.COMPANIES, { _id: C, agentMonthlyBudgetUsd: 1 });
            spent(1.5);
            const failure = await llmProvider.embeddingProvider().embed({ texts: ['a'], model: MODEL, spend: SPEND }).catch((e) => e);
            expect(failure.code).toBe(reservation.BUDGET_EXHAUSTED);
            expect(failure.message).toContain('ai_budget_exhausted');
            expect(axios.post).not.toHaveBeenCalled();
            expect(ledger()).toHaveLength(1);
            expect(holds().map((h) => h.state)).toEqual(['released']);
        });

        it('holds the estimate while the request runs and settles it to the real cost after', async () => {
            mockDb.seed(dbCollections.COMPANIES, { _id: C, agentMonthlyBudgetUsd: 1 });
            await llmProvider.embeddingProvider().embed({ texts: ['alpha', 'beta'], model: MODEL, spend: SPEND });
            expect(holds()).toHaveLength(1);
            expect(holds()[0]).toMatchObject({ state: 'settled', feature: 'knowledge_embed', model: MODEL, provider: 'openai', estimatedOutputTokens: 0, actualInputTokens: 6 });
            expect(holds()[0].estimatedInputTokens).toBeGreaterThan(0);
            expect(ledger()).toHaveLength(1);
        });

        it('releases the hold when the vendor refuses', async () => {
            mockDb.seed(dbCollections.COMPANIES, { _id: C, agentMonthlyBudgetUsd: 1 });
            axios.post.mockRejectedValue(vendorError(500, { error: { message: 'boom', type: 'server_error' } }));
            await expect(llmProvider.embeddingProvider().embed({ texts: ['a'], model: MODEL, spend: SPEND })).rejects.toMatchObject({ type: 'server' });
            expect(holds().map((h) => h.state)).toEqual(['released']);
            expect(ledger()).toEqual([]);
        });
    });

    it('is the OpenAI adapter whatever LLM_PROVIDER says, and refuses with no_embeddings when no instance key is set', async () => {
        process.env.LLM_PROVIDER = 'anthropic';
        try {
            expect(llmProvider.embeddingProvider().name).toBe('openai');
            config.AI_API_KEY = '';
            let refused = null;
            try { llmProvider.embeddingProvider(); } catch (error) { refused = error; }
            expect(refused).toMatchObject({ code: NO_EMBEDDINGS, provider: 'openai', retryable: false });
            expect(refused.message).toMatch(/AI_API_KEY/);
        } finally {
            delete process.env.LLM_PROVIDER;
        }
    });
});
