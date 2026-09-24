/* The OpenAI-compatible provider: a self-hosted server (Ollama, vLLM, LM Studio, a company
 * gateway) answers chat and embeddings at a base URL the instance owner configured. Every call
 * here reaches a real HTTP server on loopback that speaks the OpenAI API; nothing reaches a vendor. */
const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../Config/config', () => ({ AI_API_KEY: '', AI_MODEL: '' }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Modules/notification/prepare-notification-data/controllerV2', () => ({ handleNotificationtFun: jest.fn(async () => ({ status: true })) }));

const config = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { startOpenAiCompatibleServer } = require('./support/openAiCompatibleServer');
const registry = require('../Modules/AICore/llmProvider/registry');
const llmProvider = require('../Modules/AICore/llmProvider');
const client = require('../Modules/AICore/llmProvider/compatibleClient');
const usage = require('../Modules/AICore/usage');
const aiSwitch = require('../Modules/AICore/aiSwitch');
const { FEATURES } = require('../Modules/AICore/features');
const { isProviderError } = require('../Modules/AICore/providerError');
const knowledgeEmbeddings = require('../Modules/Knowledge/embeddings');

const C = '6f0000000000000000000c21';
const SPEND = { feature: FEATURES.ASK, companyId: C, userId: 'u1' };
const EMBED_SPEND = { feature: FEATURES.KNOWLEDGE_EMBED, companyId: C };
const KEYS = ['LLM_PROVIDER', 'OPENAI_BASE_URL', 'OPENAI_EMBEDDINGS_URL', 'OPENAI_COMPATIBLE_BASE_URL', 'OPENAI_COMPATIBLE_API_KEY', 'OPENAI_COMPATIBLE_MODEL', 'OPENAI_COMPATIBLE_EMBEDDINGS_MODEL', 'LLM_PRICING', 'AI_ENABLED', 'AI_MODEL_ROUTER', 'KNOWLEDGE_EMBEDDING_MODEL'];
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));

let stub;

const useCompatible = ({ key = '', embeddings = 'nomic-embed-text' } = {}) => {
    process.env.LLM_PROVIDER = 'openai_compatible';
    process.env.OPENAI_COMPATIBLE_BASE_URL = stub.baseUrl;
    process.env.OPENAI_COMPATIBLE_MODEL = 'llama3.1:8b';
    if (key) process.env.OPENAI_COMPATIBLE_API_KEY = key;
    if (embeddings) process.env.OPENAI_COMPATIBLE_EMBEDDINGS_MODEL = embeddings;
};

const ledger = () => mockDb.store[SCHEMA_TYPE.AI_USAGE] || [];

beforeAll(async () => { stub = await startOpenAiCompatibleServer(); });
afterAll(async () => {
    await stub.stop();
    KEYS.forEach((k) => { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; });
});

beforeEach(() => {
    KEYS.forEach((k) => { delete process.env[k]; });
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    config.AI_API_KEY = '';
    config.AI_MODEL = '';
    stub.reset();
    aiSwitch.forget();
    knowledgeEmbeddings.resetBreaker();
    knowledgeEmbeddings.forgetSizes();
});

describe('the registry knows the compatible provider', () => {
    it('lists it last, so configuring it never takes a call from the provider that answers today', () => {
        expect(registry.PROVIDER_NAMES).toEqual(['openai', 'anthropic', 'deepseek', 'google', 'openai_compatible']);
        expect(registry.ADAPTERS.openai_compatible.name).toBe('openai_compatible');
    });

    it('is configured by a base URL and a chat model; the API key is optional', () => {
        const adapter = registry.ADAPTERS.openai_compatible;
        expect(adapter.isConfigured).toBe(false);
        process.env.OPENAI_COMPATIBLE_BASE_URL = stub.baseUrl;
        expect(adapter.isConfigured).toBe(false);
        process.env.OPENAI_COMPATIBLE_MODEL = 'llama3.1:8b';
        expect(adapter.isConfigured).toBe(true);
        expect(adapter.model).toBe('llama3.1:8b');
        expect(adapter.embeddingsConfigured).toBe(false);
        process.env.OPENAI_COMPATIBLE_EMBEDDINGS_MODEL = 'nomic-embed-text';
        expect(adapter.embeddingsConfigured).toBe(true);
    });
});

describe('chat through the configured base URL', () => {
    it('is selected by LLM_PROVIDER and posts an OpenAI chat request to <base>/chat/completions', async () => {
        useCompatible();
        const provider = llmProvider.getProvider();
        expect(provider.name).toBe('openai_compatible');
        const result = await provider.chat({ systemPrompt: 'be brief', messages: [{ role: 'user', content: 'hello' }], jsonMode: true, spend: SPEND });

        expect(result).toMatchObject({ content: 'echo: hello', inputTokens: 7, outputTokens: 3, model: 'llama3.1:8b', truncated: false });
        expect(stub.requests).toHaveLength(1);
        const [sent] = stub.requests;
        expect(sent).toMatchObject({ method: 'POST', url: '/v1/chat/completions' });
        expect(sent.body).toMatchObject({ model: 'llama3.1:8b', messages: [{ role: 'system', content: 'be brief' }, { role: 'user', content: 'hello' }], response_format: { type: 'json_object' } });
        expect(sent.headers.authorization).toBeUndefined();
    });

    it('sends the optional key as a bearer token', async () => {
        useCompatible({ key: 'gateway-key-123' });
        await llmProvider.getProvider().chat({ messages: [{ role: 'user', content: 'x' }], spend: SPEND });
        expect(stub.requests[0].headers.authorization).toBe('Bearer gateway-key-123');
    });

    it('prices the self-hosted models at zero unless LLM_PRICING names a price, so they are never refused as unpriced', async () => {
        useCompatible();
        expect(usage.priceFor('llama3.1:8b')).toMatchObject({ priced: true, input: 0, output: 0 });
        expect(usage.priceFor('nomic-embed-text')).toMatchObject({ priced: true, input: 0, output: 0 });
        await llmProvider.getProvider().chat({ messages: [{ role: 'user', content: 'x' }], spend: SPEND });
        expect(ledger()[0]).toMatchObject({ provider: 'openai_compatible', model: 'llama3.1:8b', priced: true, costUsd: 0 });

        process.env.LLM_PRICING = JSON.stringify({ 'llama3.1:8b': { input: 1, output: 2 } });
        expect(usage.priceFor('llama3.1:8b')).toMatchObject({ priced: true, input: 1, output: 2 });
    });

    it('does not let a compatible model id undercut a known vendor price', () => {
        process.env.OPENAI_COMPATIBLE_BASE_URL = stub.baseUrl;
        process.env.OPENAI_COMPATIBLE_MODEL = 'gpt-4.1';
        expect(usage.priceFor('gpt-4.1').input).toBeGreaterThan(0);
    });

    it('turns a failing endpoint into a provider error', async () => {
        useCompatible({ key: 'sk-local-SECRET0123456789' });
        stub.behave(500);
        const failure = await registry.ADAPTERS.openai_compatible.chat({ messages: [{ role: 'user', content: 'x' }] }).catch((e) => e);
        expect(isProviderError(failure)).toBe(true);
        expect(failure).toMatchObject({ provider: 'openai_compatible', type: 'server', status: 500 });
        expect(JSON.stringify(failure.toFailure())).not.toContain('SECRET0123456789');
    });
});

describe('embeddings follow the chat provider', () => {
    it('embed with the compatible server and its embeddings model when it answers chat', async () => {
        useCompatible();
        config.AI_API_KEY = 'sk-proj-SHOULDNOTBEUSED0123';
        expect(llmProvider.embeddingProviderName()).toBe('openai_compatible');
        expect(llmProvider.isEmbeddingConfigured()).toBe(true);
        expect(knowledgeEmbeddings.model()).toBe('nomic-embed-text');

        const result = await llmProvider.embeddingProvider().embed({ texts: ['alpha', 'beta'], model: knowledgeEmbeddings.model(), spend: EMBED_SPEND });
        expect(result.embeddings).toHaveLength(2);
        expect(result.dimensions).toBe(4);
        expect(stub.requests).toHaveLength(1);
        expect(stub.requests[0]).toMatchObject({ method: 'POST', url: '/v1/embeddings', body: { model: 'nomic-embed-text', input: ['alpha', 'beta'] } });
        expect(ledger()[0]).toMatchObject({ provider: 'openai_compatible', feature: FEATURES.KNOWLEDGE_EMBED, priced: true });
    });

    it('never falls back to OpenAI for embeddings when the compatible provider is chosen without an embeddings model', () => {
        useCompatible({ embeddings: '' });
        config.AI_API_KEY = 'sk-proj-SHOULDNOTBEUSED0123';
        expect(llmProvider.embeddingProviderName()).toBe('openai_compatible');
        expect(llmProvider.isEmbeddingConfigured()).toBe(false);
        expect(knowledgeEmbeddings.readiness(C)).toBe('unconfigured');
    });

    it('keeps OpenAI for embeddings when OpenAI answers chat', () => {
        config.AI_API_KEY = 'sk-proj-OPENAI0123456789';
        config.AI_MODEL = 'gpt-4.1';
        process.env.OPENAI_COMPATIBLE_BASE_URL = stub.baseUrl;
        process.env.OPENAI_COMPATIBLE_EMBEDDINGS_MODEL = 'nomic-embed-text';
        expect(llmProvider.embeddingProviderName()).toBe('openai');
        expect(knowledgeEmbeddings.model()).toBe('text-embedding-3-small');
    });

    it('refuses an answer whose vectors are not all the same size', async () => {
        useCompatible();
        stub.behave('ragged');
        await expect(registry.ADAPTERS.openai_compatible.embed({ texts: ['a', 'b'], model: 'nomic-embed-text' })).rejects.toThrow(/same size|dimensions/i);
    });

    it('refuses a model whose vector size changed since this process last stored one, naming the re-embed', async () => {
        useCompatible();
        await knowledgeEmbeddings.embedTexts(C, ['first']);
        stub.resize(8);
        await expect(knowledgeEmbeddings.embedTexts(C, ['second'])).rejects.toThrow(/re-embed/i);
    });
});

describe('OPENAI_BASE_URL', () => {
    it('moves the OpenAI chat and embeddings calls off the hard-coded host', async () => {
        config.AI_API_KEY = 'sk-proj-OPENAI0123456789';
        config.AI_MODEL = 'gpt-4.1';
        process.env.OPENAI_BASE_URL = `${stub.baseUrl}/`;
        const result = await llmProvider.getProvider().chat({ messages: [{ role: 'user', content: 'via proxy' }], spend: SPEND });
        expect(result.content).toBe('echo: via proxy');
        expect(stub.requests[0]).toMatchObject({ url: '/v1/chat/completions', headers: { authorization: 'Bearer sk-proj-OPENAI0123456789' } });

        await registry.ADAPTERS.openai.embed({ texts: ['a'], model: 'text-embedding-3-small' });
        expect(stub.requests[1].url).toBe('/v1/embeddings');
    });

    it('still lets OPENAI_EMBEDDINGS_URL win for embeddings', async () => {
        config.AI_API_KEY = 'sk-proj-OPENAI0123456789';
        process.env.OPENAI_BASE_URL = 'http://127.0.0.1:9/v1';
        process.env.OPENAI_EMBEDDINGS_URL = `${stub.baseUrl}/embeddings`;
        await registry.ADAPTERS.openai.embed({ texts: ['a'], model: 'text-embedding-3-small' });
        expect(stub.requests).toHaveLength(1);
    });
});

describe('the dedicated client for the operator endpoint', () => {
    it('accepts loopback and private addresses, since a self-hosted model lives there', async () => {
        const { models } = await client.listModels({ baseUrl: stub.baseUrl, timeoutMs: 2000 });
        expect(models).toEqual(['llama3.1:8b', 'nomic-embed-text']);
        expect(client.baseUrlError('http://10.0.0.5:8000/v1')).toBeNull();
        expect(client.baseUrlError('http://ollama.lan:11434/v1')).toBeNull();
    });

    it.each([
        ['ftp://models.lan/v1', 'protocol'],
        ['http://user:pw@models.lan/v1', 'credentials'],
        ['http://models.lan/v1?key=1', 'query'],
        ['not a url', 'url'],
    ])('refuses %s as a base URL (%s)', (raw, code) => {
        expect(client.baseUrlError(raw)).toBe(code);
    });

    it('refuses link-local and cloud metadata addresses even for the owner', async () => {
        await expect(client.listModels({ baseUrl: 'http://169.254.169.254/latest', timeoutMs: 1000 })).rejects.toMatchObject({ code: client.ENDPOINT_REFUSED });
        await expect(client.listModels({ baseUrl: 'http://[fe80::1]/v1', timeoutMs: 1000 })).rejects.toMatchObject({ code: client.ENDPOINT_REFUSED });
        await expect(client.listModels({ baseUrl: 'http://metadata.google.internal/v1', timeoutMs: 1000 })).rejects.toMatchObject({ code: client.ENDPOINT_REFUSED });
    });

    it('does not follow a redirect away from the configured endpoint', async () => {
        stub.behave('redirect');
        await expect(client.listModels({ baseUrl: stub.baseUrl, timeoutMs: 2000 })).rejects.toThrow(/redirect/i);
        expect(stub.requests).toHaveLength(1);
    });

    it('gives up after its timeout', async () => {
        stub.behave('stall');
        const started = Date.now();
        await expect(client.listModels({ baseUrl: stub.baseUrl, timeoutMs: 300 })).rejects.toThrow(/timed out|timeout/i);
        expect(Date.now() - started).toBeLessThan(3000);
    });
});
