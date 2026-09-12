/* One contract, four adapters. Every provider in the registry is driven
 * through the same requests and the same failures here, so a new adapter —
 * Google is the first to arrive under it — cannot ship with a different
 * output ceiling story, a different structured-output story, a different
 * reasoning-parameter story or a different error vocabulary. */
const mockDb = require('./fixtures/fakeMongo').create();

const OPENAI_KEY = 'sk-proj-OPENAISECRET0123456789';
const DEEPSEEK_KEY = 'sk-DEEPSEEKSECRET0123456789';
const ANTHROPIC_KEY = 'sk-ant-api03-ANTHROPICSECRET0123456789';
const GOOGLE_KEY = 'AIzaSyGOOGLESECRET0123456789';

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../Config/config', () => ({ AI_API_KEY: 'sk-proj-OPENAISECRET0123456789', AI_MODEL: 'gpt-4.1', DEEPSEEK_API_KEY: 'sk-DEEPSEEKSECRET0123456789', DEEPSEEK_MODEL: 'deepseek-chat' }));
jest.mock('axios', () => ({ post: jest.fn() }));
jest.mock('@anthropic-ai/sdk', () => {
    const actual = jest.requireActual('@anthropic-ai/sdk');
    const box = { params: [], result: null, error: null };
    class FakeAnthropic {
        constructor() {
            this.messages = {
                stream: (params) => {
                    box.params.push(params);
                    return { finalMessage: () => (box.error ? Promise.reject(box.error) : Promise.resolve(box.result)) };
                },
            };
        }
    }
    return { ...actual, default: FakeAnthropic, Anthropic: FakeAnthropic, __box: box };
});

process.env.ANTHROPIC_API_KEY = ANTHROPIC_KEY;
process.env.ANTHROPIC_MODEL = 'claude-sonnet-4-6';
process.env.GOOGLE_API_KEY = GOOGLE_KEY;
process.env.GOOGLE_MODEL = 'gemini-3-flash';

const axios = require('axios');
const { AxiosError, AxiosHeaders } = jest.requireActual('axios');
const Anthropic = require('@anthropic-ai/sdk');
const { AIProviderError, TYPES, TYPE_LIST } = require('../Modules/AICore/providerError');
const { STRUCTURED_OUTPUT, normaliseRequest, capabilitiesOf } = require('../Modules/AICore/llmProvider/normalise');
const registry = require('../Modules/AICore/llmProvider/registry');
const { getProvider, listProviders, PROVIDER_NAMES } = require('../Modules/AICore/llmProvider');
const { FEATURES } = require('../Modules/AICore/features');
const { SCHEMA_TYPE } = require('../Config/schemaType');

const C = '6f0000000000000000000c01';
const SPEND = { feature: FEATURES.ASK, companyId: C };
const OPTS = { messages: [{ role: 'user', content: 'hi' }], spend: SPEND };

const axiosError = ({ status, body, headers = {}, key }) => {
    const config = { headers: { Authorization: `Bearer ${key}` }, data: JSON.stringify({ model: 'm' }) };
    const response = { status, data: body, headers: AxiosHeaders.from(headers), config };
    return new AxiosError(`Request failed with status code ${status}`, status >= 500 ? AxiosError.ERR_BAD_RESPONSE : AxiosError.ERR_BAD_REQUEST, config, {}, response);
};
const axiosTransport = (message, code, key) => new AxiosError(message, code, { headers: { Authorization: `Bearer ${key}` } }, {});

const openAiBody = (status, key) => axiosError({
    status,
    key,
    body: { error: { message: `vendor said no (key ${key})`, type: status === 429 ? 'rate_limit_error' : 'server_error', code: status === 401 ? 'invalid_api_key' : null } },
    headers: { 'x-request-id': 'req_1', 'retry-after': '2' },
});

const chatCompletion = (model) => ({
    data: { choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }], usage: { prompt_tokens: 11, completion_tokens: 5, total_tokens: 16 }, model },
});

const DRIVERS = [
    {
        name: 'openai',
        adapter: registry.ADAPTERS.openai,
        key: OPENAI_KEY,
        configuredModel: 'gpt-4.1',
        otherModel: 'gpt-4o',
        reasoningModel: 'o3',
        succeed() { axios.post.mockResolvedValue(chatCompletion('gpt-4.1')); },
        failWith(status) { axios.post.mockRejectedValue(openAiBody(status, OPENAI_KEY)); },
        failTransport(code) { axios.post.mockRejectedValue(axiosTransport('socket hang up', code, OPENAI_KEY)); },
        sent: () => axios.post.mock.calls[0][1],
        sentModel: () => axios.post.mock.calls[0][1].model,
        sentCeiling: (body) => body.max_tokens || body.max_completion_tokens,
        hasStructuredOutput: (body) => body.response_format && body.response_format.type === 'json_object',
    },
    {
        name: 'deepseek',
        adapter: registry.ADAPTERS.deepseek,
        key: DEEPSEEK_KEY,
        configuredModel: 'deepseek-chat',
        otherModel: 'deepseek-v4-flash',
        reasoningModel: 'deepseek-reasoner',
        succeed() { axios.post.mockResolvedValue(chatCompletion('deepseek-chat')); },
        failWith(status) { axios.post.mockRejectedValue(openAiBody(status, DEEPSEEK_KEY)); },
        failTransport(code) { axios.post.mockRejectedValue(axiosTransport('socket hang up', code, DEEPSEEK_KEY)); },
        sent: () => axios.post.mock.calls[0][1],
        sentModel: () => axios.post.mock.calls[0][1].model,
        sentCeiling: (body) => body.max_tokens,
        hasStructuredOutput: (body) => body.response_format && body.response_format.type === 'json_object',
    },
    {
        name: 'google',
        adapter: registry.ADAPTERS.google,
        key: GOOGLE_KEY,
        configuredModel: 'gemini-3-flash',
        otherModel: 'gemini-2.5-pro',
        reasoningModel: 'gemini-2.5-pro',
        succeed() {
            axios.post.mockResolvedValue({
                data: {
                    candidates: [{ content: { parts: [{ text: '{"ok":true}' }] }, finishReason: 'STOP' }],
                    usageMetadata: { promptTokenCount: 11, candidatesTokenCount: 5, totalTokenCount: 16 },
                },
            });
        },
        failWith(status) {
            axios.post.mockRejectedValue(axiosError({
                status,
                key: GOOGLE_KEY,
                body: { error: { code: status, status: status === 429 ? 'RESOURCE_EXHAUSTED' : (status === 401 ? 'UNAUTHENTICATED' : 'INTERNAL'), message: `vendor said no (key ${GOOGLE_KEY})` } },
                headers: { 'x-request-id': 'req_1' },
            }));
        },
        failTransport(code) { axios.post.mockRejectedValue(axiosTransport('socket hang up', code, GOOGLE_KEY)); },
        sent: () => axios.post.mock.calls[0][1],
        sentModel: () => decodeURIComponent(String(axios.post.mock.calls[0][0]).split('/models/')[1].split(':')[0]),
        sentCeiling: (body) => body.generationConfig.maxOutputTokens,
        hasStructuredOutput: (body) => body.generationConfig.responseMimeType === 'application/json',
    },
    {
        name: 'anthropic',
        adapter: registry.ADAPTERS.anthropic,
        key: ANTHROPIC_KEY,
        configuredModel: 'claude-sonnet-4-6',
        otherModel: 'claude-haiku-4-5',
        reasoningModel: null,
        succeed() {
            Anthropic.__box.result = { content: [{ type: 'text', text: '{"ok":true}' }], usage: { input_tokens: 11, output_tokens: 5 }, model: 'claude-sonnet-4-6', stop_reason: 'end_turn' };
        },
        failWith(status) {
            Anthropic.__box.error = Anthropic.APIError.generate(
                status,
                { type: 'error', error: { type: status === 429 ? 'rate_limit_error' : (status === 401 ? 'authentication_error' : 'api_error'), message: `vendor said no (key ${ANTHROPIC_KEY})` } },
                undefined,
                new Headers({ 'x-request-id': 'req_1' }),
            );
        },
        failTransport() { Anthropic.__box.error = new Anthropic.APIConnectionTimeoutError({ message: 'timed out' }); },
        sent: () => Anthropic.__box.params[0],
        sentModel: () => Anthropic.__box.params[0].model,
        sentCeiling: (params) => params.max_tokens,
        hasStructuredOutput: (params) => /valid JSON object/.test(params.system || ''),
    },
];

const router = (state) => { process.env.AI_MODEL_ROUTER = state; };

beforeEach(() => {
    jest.clearAllMocks();
    Anthropic.__box.params.length = 0;
    Anthropic.__box.result = null;
    Anthropic.__box.error = null;
    delete process.env.AI_MODEL_ROUTER;
    delete process.env.LLM_PROVIDER;
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
});

describe('the registry is the only place a provider is known', () => {
    it('holds an adapter per name, openai first so the fallback is unchanged', () => {
        expect(PROVIDER_NAMES).toEqual(['openai', 'anthropic', 'deepseek', 'google']);
        PROVIDER_NAMES.forEach((name) => expect(registry.ADAPTERS[name].name).toBe(name));
    });

    it('describes each provider with its model, whether it is configured and whether it is priced', () => {
        const rows = listProviders();
        expect(rows.map((r) => r.provider)).toEqual(PROVIDER_NAMES);
        const google = rows.find((r) => r.provider === 'google');
        expect(google).toMatchObject({ model: 'gemini-3-flash', configured: true, priced: true, reasoning: true, structuredOutput: STRUCTURED_OUTPUT.RESPONSE_MIME_TYPE });
    });

    it('refuses a provider it does not know, and one that is not configured', () => {
        router('on');
        expect(() => getProvider({ provider: 'llama' })).toThrow(/Unknown LLM provider "llama"/);
        const key = process.env.GOOGLE_API_KEY;
        delete process.env.GOOGLE_API_KEY;
        expect(() => getProvider({ provider: 'google' })).toThrow(/not configured/);
        process.env.GOOGLE_API_KEY = key;
    });
});

describe.each(DRIVERS.map((d) => [d.name, d]))('%s satisfies the provider contract', (name, driver) => {
    const { adapter } = driver;

    it('is shaped like a provider and declares its capabilities', () => {
        expect(typeof adapter.chat).toBe('function');
        expect(adapter.isConfigured).toBe(true);
        expect(adapter.model).toBe(driver.configuredModel);
        const caps = capabilitiesOf(adapter);
        expect(Object.values(STRUCTURED_OUTPUT)).toContain(caps.structuredOutput);
        expect(caps.maxOutputTokens(adapter.model)).toBeGreaterThan(0);
        expect(typeof caps.isReasoningModel(adapter.model)).toBe('boolean');
    });

    it('answers with the shared result shape', async () => {
        driver.succeed();
        const result = await adapter.chat(OPTS);
        expect(result).toMatchObject({ content: '{"ok":true}', inputTokens: 11, outputTokens: 5, model: driver.configuredModel, truncated: false });
        expect(result.totalTokens).toBeGreaterThan(0);
    });

    it('clamps an unbounded ask to this model output ceiling', async () => {
        driver.succeed();
        await adapter.chat({ ...OPTS, maxTokens: 10000000 });
        const ceiling = capabilitiesOf(adapter).maxOutputTokens(driver.configuredModel);
        expect(driver.sentCeiling(driver.sent())).toBe(ceiling);
    });

    it('asks for structured output the way this vendor accepts it', async () => {
        driver.succeed();
        await adapter.chat({ ...OPTS, jsonMode: true });
        expect(driver.hasStructuredOutput(driver.sent())).toBe(true);
    });

    it('sends a temperature exactly when the model accepts one', async () => {
        driver.succeed();
        const model = driver.reasoningModel || driver.configuredModel;
        router('on');
        await adapter.chat({ ...OPTS, model, temperature: 0.7 });
        const request = normaliseRequest(adapter, { model, temperature: 0.7 });
        const sent = driver.sent();
        const temperature = sent.temperature !== undefined ? sent.temperature : (sent.generationConfig || {}).temperature;
        if (request.temperature === null) expect(temperature).toBeUndefined();
        else expect(temperature).toBe(0.7);
    });

    it('ignores a model on the chat options until the router is on', async () => {
        driver.succeed();
        await adapter.chat({ ...OPTS, model: driver.otherModel });
        expect(driver.sentModel()).toBe(driver.configuredModel);

        jest.clearAllMocks();
        Anthropic.__box.params.length = 0;
        driver.succeed();
        router('on');
        await adapter.chat({ ...OPTS, model: driver.otherModel });
        expect(driver.sentModel()).toBe(driver.otherModel);
    });

    describe.each([
        [429, TYPES.RATE_LIMIT, true],
        [401, TYPES.AUTH, false],
        [500, TYPES.SERVER, true],
    ])('a %i answer', (status, type, retryable) => {
        it(`becomes a ${type} provider error that never carries the key`, async () => {
            driver.failWith(status);
            const error = await adapter.chat(OPTS).then(() => { throw new Error('expected a rejection'); }, (e) => e);
            expect(error).toBeInstanceOf(AIProviderError);
            expect(error.provider).toBe(name);
            expect(error.type).toBe(type);
            expect(TYPE_LIST).toContain(error.type);
            expect(error.retryable).toBe(retryable);
            expect(error.model).toBe(driver.configuredModel);
            expect(error.groupKey()).toBe(`${name}:${error.type}:${error.code}`);
            expect(error.message).not.toContain(driver.key);
            expect(JSON.stringify({ ...error })).not.toContain(driver.key);
        });
    });

    it('turns a request that never answered into a typed transport error', async () => {
        driver.failTransport('ETIMEDOUT');
        const error = await adapter.chat(OPTS).then(() => { throw new Error('expected a rejection'); }, (e) => e);
        expect(error).toBeInstanceOf(AIProviderError);
        expect(error.type).toBe(TYPES.TIMEOUT);
        expect(error.retryable).toBe(true);
        expect(JSON.stringify({ ...error })).not.toContain(driver.key);
    });

    it('is refused before any token is bought when the model has no price', async () => {
        driver.succeed();
        router('on');
        process.env.LLM_PROVIDER = name;
        await expect(getProvider({ provider: name }).chat({ ...OPTS, model: 'nobody-prices-this-1' }))
            .rejects.toThrow(/No price on file for nobody-prices-this-1/);
        expect(axios.post).not.toHaveBeenCalled();
        expect(Anthropic.__box.params).toHaveLength(0);
    });
});

describe('the router flag defaults to reproducing today', () => {
    it('sends the configured provider when nothing asks for another', () => {
        process.env.LLM_PROVIDER = 'deepseek';
        expect(getProvider().name).toBe('deepseek');
        expect(getProvider({ provider: 'google' }).name).toBe('deepseek');
        router('on');
        expect(getProvider({ provider: 'google' }).name).toBe('google');
    });

    it('books the model the call actually sent, not the configured one', async () => {
        process.env.LLM_PROVIDER = 'google';
        router('on');
        DRIVERS.find((d) => d.name === 'google').succeed();
        await getProvider({ provider: 'google' }).chat({ ...OPTS, model: 'gemini-2.5-pro' });
        const rows = mockDb.store[SCHEMA_TYPE.AI_USAGE] || [];
        const row = rows[rows.length - 1];
        expect(row).toMatchObject({ provider: 'google', model: 'gemini-2.5-pro', priced: true });
        expect(row.costUsd).toBeGreaterThan(0);
    });
});
