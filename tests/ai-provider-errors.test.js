const mockDb = require('./fixtures/fakeMongo').create();

const OPENAI_KEY = 'sk-proj-OPENAISECRET0123456789';
const DEEPSEEK_KEY = 'sk-DEEPSEEKSECRET0123456789';
const ANTHROPIC_KEY = 'sk-ant-api03-ANTHROPICSECRET0123456789';

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../Config/config', () => ({ AI_API_KEY: 'sk-proj-OPENAISECRET0123456789', AI_MODEL: 'gpt-4.1', DEEPSEEK_API_KEY: 'sk-DEEPSEEKSECRET0123456789', DEEPSEEK_MODEL: 'deepseek-chat' }));
jest.mock('axios', () => ({ post: jest.fn() }));
jest.mock('@anthropic-ai/sdk', () => {
    const actual = jest.requireActual('@anthropic-ai/sdk');
    const failure = { next: null };
    class FakeAnthropic { constructor() { this.messages = { stream: () => ({ finalMessage: () => Promise.reject(failure.next) }) }; } }
    return { ...actual, default: FakeAnthropic, Anthropic: FakeAnthropic, __failure: failure };
});

process.env.ANTHROPIC_API_KEY = ANTHROPIC_KEY;
process.env.ANTHROPIC_MODEL = 'claude-sonnet-4-6';
process.env.LLM_PROVIDER = 'openai';

const axios = require('axios');
const { AxiosError, AxiosHeaders } = jest.requireActual('axios');
const Anthropic = require('@anthropic-ai/sdk');
const logger = require('../Config/loggerConfig');
const { AIProviderError, TYPE_LIST } = require('../Modules/AICore/providerError');
const openaiProvider = require('../Modules/AICore/llmProvider/openaiProvider');
const anthropicProvider = require('../Modules/AICore/llmProvider/anthropicProvider');
const deepseekProvider = require('../Modules/AICore/llmProvider/deepseekProvider');
const { getProvider } = require('../Modules/AICore/llmProvider');
const { askModel } = require('../Modules/AICore/modelCall');
const { FEATURES } = require('../Modules/AICore/features');

const C = '6f0000000000000000000c01';
const OPTS = { messages: [{ role: 'user', content: 'hi' }], spend: { feature: FEATURES.ASK, companyId: C } };

const httpError = ({ status, body, headers = {}, key }) => {
    const config = { headers: { Authorization: `Bearer ${key}` }, data: JSON.stringify({ model: 'm' }) };
    const response = { status, data: body, headers: AxiosHeaders.from(headers), config };
    return new AxiosError(`Request failed with status code ${status}`, status >= 500 ? AxiosError.ERR_BAD_RESPONSE : AxiosError.ERR_BAD_REQUEST, config, {}, response);
};
const transportError = (message, code, key) => new AxiosError(message, code, { headers: { Authorization: `Bearer ${key}` } }, {});

const anthropicHttp = (status, type, message, headers = {}) => Anthropic.APIError.generate(status, { type: 'error', error: { type, message }, request_id: null }, undefined, new Headers(headers));

const caught = async (fn) => { try { await fn(); } catch (e) { return e; } throw new Error('expected a rejection'); };

const expectClean = (error, key) => {
    expect(error).toBeInstanceOf(AIProviderError);
    expect(TYPE_LIST).toContain(error.type);
    expect(JSON.stringify(error.raw || {})).not.toContain(key);
    expect(JSON.stringify({ ...error })).not.toContain(key);
    expect(error.message).not.toContain(key);
    expect(error.groupKey()).toBe(`${error.provider}:${error.type}:${error.code}`);
};

beforeEach(() => { jest.clearAllMocks(); Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; }); });

describe('openai adapter maps vendor errors', () => {
    const cases = [
        {
            name: '429 rate_limit_exceeded with request id and retry-after',
            error: httpError({ status: 429, key: OPENAI_KEY, headers: { 'x-request-id': 'req_rl1', 'retry-after': '20' }, body: { error: { message: 'Rate limit reached for gpt-4.1 on tokens per min (TPM): Limit 30000, Used 30000.', type: 'tokens', param: null, code: 'rate_limit_exceeded' } } }),
            expected: { type: 'rate_limit', code: 'rate_limit_exceeded', retryable: true, requestId: 'req_rl1', retryAfterMs: 20000, status: 429 },
        },
        {
            name: '429 insufficient_quota',
            error: httpError({ status: 429, key: OPENAI_KEY, headers: { 'x-request-id': 'req_q1' }, body: { error: { message: 'You exceeded your current quota, please check your plan and billing details.', type: 'insufficient_quota', param: null, code: 'insufficient_quota' } } }),
            expected: { type: 'quota', code: 'insufficient_quota', retryable: false, requestId: 'req_q1', retryAfterMs: null, status: 429 },
        },
        {
            name: '400 context_length_exceeded',
            error: httpError({ status: 400, key: OPENAI_KEY, headers: { 'x-request-id': 'req_cl1' }, body: { error: { message: "This model's maximum context length is 1047576 tokens.", type: 'invalid_request_error', param: 'messages', code: 'context_length_exceeded' } } }),
            expected: { type: 'context_length', code: 'context_length_exceeded', retryable: false, requestId: 'req_cl1', retryAfterMs: null, status: 400 },
        },
        {
            name: '401 invalid_api_key, whose message echoes part of the key',
            error: httpError({ status: 401, key: OPENAI_KEY, headers: { 'x-request-id': 'req_a1' }, body: { error: { message: `Incorrect API key provided: ${OPENAI_KEY}. You can find your API key at https://platform.openai.com/account/api-keys.`, type: 'invalid_request_error', param: null, code: 'invalid_api_key' } } }),
            expected: { type: 'auth', code: 'invalid_api_key', retryable: false, requestId: 'req_a1', retryAfterMs: null, status: 401 },
        },
        {
            name: 'an axios timeout',
            error: transportError('timeout of 240000ms exceeded', 'ECONNABORTED', OPENAI_KEY),
            expected: { type: 'timeout', code: 'ECONNABORTED', retryable: true, requestId: null, retryAfterMs: null, status: null },
        },
        {
            name: 'ECONNRESET',
            error: transportError('socket hang up', 'ECONNRESET', OPENAI_KEY),
            expected: { type: 'network', code: 'ECONNRESET', retryable: true, requestId: null, retryAfterMs: null, status: null },
        },
    ];

    it.each(cases)('$name', async ({ error, expected }) => {
        axios.post.mockRejectedValueOnce(error);
        const thrown = await caught(() => openaiProvider.chat(OPTS));
        expectClean(thrown, OPENAI_KEY);
        expect(thrown).toMatchObject({ provider: 'openai', model: 'gpt-4.1', ...expected });
    });

    it('keeps the vendor error object as raw and nothing else', async () => {
        axios.post.mockRejectedValueOnce(cases[0].error);
        const thrown = await caught(() => openaiProvider.chat(OPTS));
        expect(thrown.raw).toEqual({ type: 'tokens', code: 'rate_limit_exceeded', message: expect.stringContaining('Rate limit reached') });
    });
});

describe('anthropic adapter maps SDK errors', () => {
    const cases = [
        {
            name: '529 overloaded_error',
            error: () => anthropicHttp(529, 'overloaded_error', 'Overloaded', { 'request-id': 'req_011CAnth1' }),
            expected: { type: 'overloaded', code: 'overloaded_error', retryable: true, requestId: 'req_011CAnth1', retryAfterMs: null, status: 529 },
        },
        {
            name: '429 rate_limit_error with retry-after',
            error: () => anthropicHttp(429, 'rate_limit_error', 'Number of request tokens has exceeded your per-minute rate limit', { 'request-id': 'req_011CAnth2', 'retry-after': '30' }),
            expected: { type: 'rate_limit', code: 'rate_limit_error', retryable: true, requestId: 'req_011CAnth2', retryAfterMs: 30000, status: 429 },
        },
        {
            name: '400 invalid_request_error',
            error: () => anthropicHttp(400, 'invalid_request_error', 'messages: roles must alternate between "user" and "assistant"', { 'request-id': 'req_011CAnth3' }),
            expected: { type: 'invalid_request', code: 'invalid_request_error', retryable: false, requestId: 'req_011CAnth3', retryAfterMs: null, status: 400 },
        },
        {
            name: '400 invalid_request_error for a prompt over the context window',
            error: () => anthropicHttp(400, 'invalid_request_error', 'prompt is too long: 212345 tokens > 200000 maximum', { 'request-id': 'req_011CAnth4' }),
            expected: { type: 'context_length', code: 'invalid_request_error', retryable: false, requestId: 'req_011CAnth4', status: 400 },
        },
        {
            name: '400 billing_error',
            error: () => anthropicHttp(400, 'billing_error', 'Your credit balance is too low to access the Anthropic API.', { 'request-id': 'req_011CAnth5' }),
            expected: { type: 'quota', code: 'billing_error', retryable: false, requestId: 'req_011CAnth5', status: 400 },
        },
        {
            name: 'an overloaded error event mid-stream',
            error: () => new Anthropic.APIError(undefined, { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }, undefined, new Headers({ 'request-id': 'req_011CAnth6' }), 'overloaded_error'),
            expected: { type: 'overloaded', code: 'overloaded_error', retryable: true, requestId: 'req_011CAnth6', status: null },
        },
        {
            name: 'APIConnectionTimeoutError',
            error: () => new Anthropic.APIConnectionTimeoutError(),
            expected: { type: 'timeout', code: 'timeout', retryable: true, requestId: null, retryAfterMs: null, status: null },
        },
        {
            name: 'APIConnectionError caused by ECONNRESET',
            error: () => new Anthropic.APIConnectionError({ cause: Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }) }),
            expected: { type: 'network', code: 'ECONNRESET', retryable: true, requestId: null, retryAfterMs: null, status: null },
        },
    ];

    it.each(cases)('$name', async ({ error, expected }) => {
        Anthropic.__failure.next = error();
        const thrown = await caught(() => anthropicProvider.chat(OPTS));
        expectClean(thrown, ANTHROPIC_KEY);
        expect(thrown).toMatchObject({ provider: 'anthropic', model: 'claude-sonnet-4-6', ...expected });
    });

    it('keeps only the vendor error object, not the SDK headers', async () => {
        Anthropic.__failure.next = cases[0].error();
        const thrown = await caught(() => anthropicProvider.chat(OPTS));
        expect(thrown.raw).toEqual({ type: 'overloaded_error', message: 'Overloaded' });
    });
});

describe('deepseek adapter maps vendor errors', () => {
    const cases = [
        {
            name: '402 insufficient balance',
            error: httpError({ status: 402, key: DEEPSEEK_KEY, headers: { 'x-request-id': 'ds_1' }, body: { error: { message: 'Insufficient Balance', type: 'unknown_error', param: null, code: 'invalid_request_error' } } }),
            expected: { type: 'quota', code: 'invalid_request_error', retryable: false, requestId: 'ds_1', status: 402 },
        },
        {
            name: '429 rate limit with retry-after',
            error: httpError({ status: 429, key: DEEPSEEK_KEY, headers: { 'retry-after': '5' }, body: { error: { message: 'Rate Limit Reached', type: 'rate_limit_reached_error', param: null, code: 'rate_limit_reached' } } }),
            expected: { type: 'rate_limit', code: 'rate_limit_reached', retryable: true, retryAfterMs: 5000, status: 429 },
        },
        {
            name: '503 server overloaded',
            error: httpError({ status: 503, key: DEEPSEEK_KEY, body: { error: { message: 'Server overloaded, please try again later.', type: 'service_unavailable_error', param: null, code: 'service_unavailable' } } }),
            expected: { type: 'overloaded', code: 'service_unavailable', retryable: true, status: 503 },
        },
        {
            name: 'an axios timeout',
            error: transportError('timeout of 600000ms exceeded', 'ETIMEDOUT', DEEPSEEK_KEY),
            expected: { type: 'timeout', code: 'ETIMEDOUT', retryable: true, requestId: null, status: null },
        },
        {
            name: 'ENOTFOUND',
            error: transportError('getaddrinfo ENOTFOUND api.deepseek.com', 'ENOTFOUND', DEEPSEEK_KEY),
            expected: { type: 'network', code: 'ENOTFOUND', retryable: true, requestId: null, status: null },
        },
    ];

    it.each(cases)('$name', async ({ error, expected }) => {
        axios.post.mockRejectedValueOnce(error);
        const thrown = await caught(() => deepseekProvider.chat(OPTS));
        expectClean(thrown, DEEPSEEK_KEY);
        expect(thrown).toMatchObject({ provider: 'deepseek', model: 'deepseek-chat', ...expected });
    });
});

describe('the provider error travels unchanged', () => {
    const quota = () => httpError({ status: 429, key: OPENAI_KEY, headers: { 'x-request-id': 'req_q9' }, body: { error: { message: 'You exceeded your current quota.', type: 'insufficient_quota', param: null, code: 'insufficient_quota' } } });

    it('through the metered chat, which logs the group key', async () => {
        axios.post.mockRejectedValueOnce(quota());
        const thrown = await caught(() => getProvider().chat(OPTS));
        expect(thrown).toBeInstanceOf(AIProviderError);
        expect(thrown.groupKey()).toBe('openai:quota:insufficient_quota');
        expect(logger.error.mock.calls.some(([line]) => line.includes('openai:quota:insufficient_quota') && line.includes('req_q9'))).toBe(true);
    });

    it('through askModel, which returns the error beside the degraded reason', async () => {
        axios.post.mockRejectedValueOnce(quota());
        const asked = await askModel({ systemPrompt: 's', maxTokens: 100 }, { prompt: 'p', budget: {}, spend: OPTS.spend });
        expect(asked.raw).toBeNull();
        expect(asked.error).toBeInstanceOf(AIProviderError);
        expect(asked.error.toFailure()).toEqual({ type: 'quota', code: 'insufficient_quota', provider: 'openai', model: 'gpt-4.1', status: 429, requestId: 'req_q9', groupKey: 'openai:quota:insufficient_quota', message: asked.error.message });
        expect(asked.degraded).toContain(asked.error.message);
    });
});

describe('AIProviderError', () => {
    it('closes the type set and parses an HTTP-date retry-after', () => {
        const { retryAfterMsOf } = require('../Modules/AICore/providerError');
        expect(new AIProviderError({ provider: 'openai', type: 'made_up' }).type).toBe('unknown');
        expect(retryAfterMsOf({ 'retry-after': new Date(Date.UTC(2030, 0, 1, 0, 0, 10)).toUTCString() }, Date.UTC(2030, 0, 1))).toBe(10000);
        expect(retryAfterMsOf({ 'retry-after-ms': '750' })).toBe(750);
    });
});
