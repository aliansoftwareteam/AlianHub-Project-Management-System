/* A pinned model is checked where it is saved, not where it is spent: the
 * allowlist is the pricing table joined to the configured providers, and a pin
 * outside it comes back refused with a message naming the model. */
const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../Config/config', () => ({ AI_API_KEY: 'sk-proj-OPENAISECRET0123456789', AI_MODEL: 'gpt-4.1' }));

const modelPin = require('../Modules/AICore/modelPin');
const catalogue = require('../Modules/AICore/llmProvider/catalogue');
const { validateSkill } = require('../Modules/Agents/skills/validateSkill');

const skillInput = (over = {}) => ({
    key: 'task.summary',
    name: 'Summariser',
    inputs: ['brief'],
    gather: [{ reader: 'task', params: { maxChars: 3000 } }],
    prompt: {
        partials: ['json_only'],
        instructions: 'Summarise the brief in one paragraph.',
        template: 'BRIEF: {{input.brief}}',
        output: '{"summary":"..."}',
    },
    emit: [{ action: 'task.comment', label: 'Post the summary', params: { body: '{{answer.summary}}' } }],
    ...over,
});

describe('model pin', () => {
    afterEach(() => { delete process.env.LLM_PRICING; });

    it('accepts a priced model whose provider is configured', () => {
        expect(modelPin.validatePin('gpt-4.1')).toMatchObject({ ok: true, model: 'gpt-4.1', provider: 'openai' });
    });

    it('clears the pin on an empty value', () => {
        expect(modelPin.validatePin('')).toEqual({ ok: true, model: null });
        expect(modelPin.validatePin(null)).toEqual({ ok: true, model: null });
    });

    it('refuses a model with no price on file', () => {
        const out = modelPin.validatePin('gpt-made-up');
        expect(out.ok).toBe(false);
        expect(out.code).toBe('unpriced_model');
        expect(out.message).toContain('gpt-made-up');
    });

    it('refuses a priced model whose provider is not configured', () => {
        const out = modelPin.validatePin('claude-sonnet-4-6');
        expect(out.ok).toBe(false);
        expect(out.code).toBe('provider_not_configured');
        expect(out.message).toContain('anthropic');
    });

    it('refuses a priced model that belongs to no known provider', () => {
        process.env.LLM_PRICING = JSON.stringify({ 'my-local-llama': { input: 0, output: 0 } });
        const out = modelPin.validatePin('my-local-llama');
        expect(out.ok).toBe(false);
        expect(out.code).toBe('unknown_provider');
    });

    it('takes an operator price as the way onto the allowlist', () => {
        process.env.LLM_PRICING = JSON.stringify({ 'gpt-brand-new': { input: 1, output: 2 } });
        expect(modelPin.validatePin('gpt-brand-new')).toMatchObject({ ok: true, provider: 'openai' });
    });

    it('lists only configured providers when asked to', () => {
        const configured = modelPin.allowlist({ configuredOnly: true });
        expect(configured.length).toBeGreaterThan(0);
        expect(configured.every((row) => row.provider === 'openai')).toBe(true);
        expect(modelPin.allowlist().length).toBeGreaterThan(configured.length);
    });

    it('reads a dated snapshot as its base model', () => {
        expect(catalogue.entryFor('gpt-4.1-20260115')).toMatchObject({ provider: 'openai', priced: true });
    });

    it('rates the cheap end of a line-up below the flagship', () => {
        expect(catalogue.tierOf('gpt-5-nano')).toBe('basic');
        expect(catalogue.tierOf('gpt-5-mini')).toBe('standard');
        expect(catalogue.tierOf('claude-opus-5')).toBe('frontier');
    });

    it('refuses a skill saved with a pin the allowlist would not take', () => {
        const out = validateSkill(skillInput({ model: 'claude-sonnet-4-6' }));
        expect(out.ok).toBe(false);
        expect(out.errors.find((e) => e.field === 'model').code).toBe('provider_not_configured');
    });

    it('writes the pin on a skill that names an allowed model', () => {
        const out = validateSkill(skillInput({ model: 'gpt-4.1' }));
        expect(out.ok).toBe(true);
        expect(out.value.model).toBe('gpt-4.1');
    });

    it('stores no pin when a skill names none', () => {
        expect(validateSkill(skillInput()).value.model).toBeNull();
    });
});
