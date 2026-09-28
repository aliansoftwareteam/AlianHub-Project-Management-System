jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../Modules/AICore/providerKeys', () => ({ apiKeyFor: jest.fn(async () => 'sk-ant-test') }));
jest.mock('@anthropic-ai/sdk', () => {
    const actual = jest.requireActual('@anthropic-ai/sdk');
    const script = { deltas: [], withOn: true };
    class FakeAnthropic {
        constructor() {
            this.messages = {
                stream: () => {
                    const handlers = {};
                    const stream = {
                        finalMessage: async () => {
                            script.deltas.forEach((delta) => (handlers.text || []).forEach((fn) => fn(delta)));
                            return { content: [{ type: 'text', text: script.deltas.join('') }], usage: { input_tokens: 3, output_tokens: 4 }, model: 'claude-test', stop_reason: 'end_turn' };
                        },
                    };
                    if (script.withOn) stream.on = (event, fn) => { (handlers[event] = handlers[event] || []).push(fn); return stream; };
                    return stream;
                },
            };
        }
    }
    return { ...actual, default: FakeAnthropic, Anthropic: FakeAnthropic, __script: script };
});

process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
process.env.ANTHROPIC_MODEL = 'claude-test';

const { __script: script } = require('@anthropic-ai/sdk');
const anthropicProvider = require('../Modules/AICore/llmProvider/anthropicProvider');

const OPTS = { messages: [{ role: 'user', content: 'hi' }] };

describe('the anthropic adapter hands each text delta to onText', () => {
    beforeEach(() => { script.deltas = ['Hel', 'lo']; script.withOn = true; });

    it('calls onText per delta and still resolves the whole answer', async () => {
        const seen = [];
        const result = await anthropicProvider.chat({ ...OPTS, onText: (delta) => seen.push(delta) });
        expect(seen).toEqual(['Hel', 'lo']);
        expect(result.content).toBe('Hello');
    });

    it('keeps answering when onText throws or the stream has no listener support', async () => {
        const thrower = await anthropicProvider.chat({ ...OPTS, onText: () => { throw new Error('socket gone'); } });
        expect(thrower.content).toBe('Hello');
        script.withOn = false;
        expect((await anthropicProvider.chat({ ...OPTS, onText: jest.fn() })).content).toBe('Hello');
    });
});
