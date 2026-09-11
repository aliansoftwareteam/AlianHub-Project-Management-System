jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../Modules/AICore/llmProvider', () => ({ getProvider: jest.fn(() => ({ name: 'openai', model: 'gpt-4.1', isConfigured: true })), isAnyProviderConfigured: jest.fn(() => true) }));

const estimate = require('../Modules/AICore/estimate');
const usage = require('../Modules/AICore/usage');

const { estimateTokens, estimateCall, CHARS_PER_TOKEN, SAFETY_FACTOR, PER_MESSAGE_OVERHEAD_TOKENS } = estimate;

describe('estimateTokens sizes text from characters with a safety factor', () => {
    it('is chars / 4 * 1.25, rounded up, and zero for nothing', () => {
        expect(CHARS_PER_TOKEN).toBe(4);
        expect(SAFETY_FACTOR).toBe(1.25);
        expect(estimateTokens('')).toBe(0);
        expect(estimateTokens(null)).toBe(0);
        expect(estimateTokens(undefined)).toBe(0);
        expect(estimateTokens('abcd')).toBe(2);
        expect(estimateTokens('x'.repeat(400))).toBe(125);
        expect(estimateTokens('x'.repeat(401))).toBe(126);
    });

    it('sizes non-string content from its JSON form', () => {
        const value = { a: 1, b: 'two' };
        expect(estimateTokens(value)).toBe(estimateTokens(JSON.stringify(value)));
    });

    it('is deterministic', () => {
        const text = 'The quick brown fox jumps over the lazy dog. '.repeat(50);
        expect(estimateTokens(text)).toBe(estimateTokens(text));
    });
});

describe('estimateCall prices the prompt plus the configured maximum output', () => {
    const system = 's'.repeat(800);
    const prompt = 'p'.repeat(1200);

    it('adds the system prompt, every message with its overhead, and maxTokens as output', () => {
        const out = estimateCall({ systemPrompt: system, messages: [{ role: 'user', content: prompt }], maxTokens: 4000, model: 'gpt-4.1' });
        const inputTokens = estimateTokens(system) + estimateTokens(prompt) + PER_MESSAGE_OVERHEAD_TOKENS;
        expect(out).toEqual({
            inputTokens, outputTokens: 4000, totalTokens: inputTokens + 4000, model: 'gpt-4.1', priced: true,
            costUsd: usage.summarize({ inputTokens, outputTokens: 4000 }, 'gpt-4.1').costUsd,
        });
        expect(out.inputTokens).toBe(250 + 375 + 4);
        expect(out.costUsd).toBe(Math.round(((629 / 1e6) * 2 + (4000 / 1e6) * 8) * 10000) / 10000);
    });

    it('accepts a bare prompt in place of messages and counts one turn', () => {
        const a = estimateCall({ prompt, maxTokens: 10, model: 'gpt-4.1' });
        const b = estimateCall({ messages: [{ role: 'user', content: prompt }], maxTokens: 10, model: 'gpt-4.1' });
        expect(a).toEqual(b);
        expect(a.inputTokens).toBe(375 + PER_MESSAGE_OVERHEAD_TOKENS);
    });

    it('treats a missing or junk maxTokens as no output and never goes negative', () => {
        expect(estimateCall({ prompt: 'hi', model: 'gpt-4.1' }).outputTokens).toBe(0);
        expect(estimateCall({ prompt: 'hi', maxTokens: 'lots', model: 'gpt-4.1' }).outputTokens).toBe(0);
        expect(estimateCall({ prompt: 'hi', maxTokens: -5, model: 'gpt-4.1' }).outputTokens).toBe(0);
    });

    it('falls back to the configured model when none is named', () => {
        expect(estimateCall({ prompt: 'hi', maxTokens: 100 })).toMatchObject({ model: 'gpt-4.1', priced: true });
    });

    it('reports an unknown model as unpriced rather than free', () => {
        expect(estimateCall({ prompt, maxTokens: 4000, model: 'gpt-9-mystery' })).toMatchObject({ priced: false, costUsd: null, model: 'gpt-9-mystery' });
    });

    it('is deterministic for the same request', () => {
        const request = { systemPrompt: system, messages: [{ role: 'user', content: prompt }], maxTokens: 4000, model: 'claude-sonnet-4-6' };
        expect(estimateCall(request)).toEqual(estimateCall(request));
    });
});
