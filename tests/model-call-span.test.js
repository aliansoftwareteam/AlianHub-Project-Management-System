jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../Modules/AICore/llmProvider', () => ({
    isAnyProviderConfigured: () => true,
    getProvider: () => ({ name: 'openai', model: 'gpt-4.1', chat: jest.fn(async () => ({ content: '{"ok":true}', model: 'gpt-4.1-2025-04-14', inputTokens: 120, outputTokens: 30 })) }),
}));

const telemetry = require('../Config/telemetry');
const { askModel } = require('../Modules/AICore/modelCall');

describe('the model call span', () => {
    it('uses the OTel GenAI attribute names for system, model and token usage', async () => {
        const real = telemetry.withSpan;
        const spans = [];
        const spy = jest.spyOn(telemetry, 'withSpan').mockImplementation((name, attributes, fn) => real(name, attributes, (span) => { spans.push({ name, span }); return fn(span); }));
        try {
            const out = await askModel({ systemPrompt: 'review', maxTokens: 800 }, { prompt: 'look', budget: { maxTokens: 500 }, spend: {} });
            expect(out).toMatchObject({ raw: { ok: true }, model: 'gpt-4.1-2025-04-14', degraded: null });
        } finally {
            spy.mockRestore();
        }
        expect(spans).toHaveLength(1);
        expect(spans[0].name).toBe('chat gpt-4.1');
        expect(spans[0].span.attributes).toEqual({
            'gen_ai.operation.name': 'chat',
            'gen_ai.system': 'openai',
            'gen_ai.request.model': 'gpt-4.1',
            'gen_ai.request.max_tokens': 500,
            'gen_ai.request.temperature': 0.2,
            'gen_ai.response.model': 'gpt-4.1-2025-04-14',
            'gen_ai.usage.input_tokens': 120,
            'gen_ai.usage.output_tokens': 30,
        });
    });
});
