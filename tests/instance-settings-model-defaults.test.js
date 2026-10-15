const KEYS = ['LLM_PROVIDER', 'AI_API_KEY', 'AI_MODEL', 'ANTHROPIC_API_KEY', 'ANTHROPIC_MODEL', 'DEEPSEEK_API_KEY', 'DEEPSEEK_MODEL', 'GOOGLE_API_KEY', 'GOOGLE_MODEL', 'OPENAI_COMPATIBLE_BASE_URL', 'OPENAI_COMPATIBLE_MODEL'];

describe('model defaults for a provider configured from the console', () => {
    let saved;
    let instance;
    let config;
    let registry;

    beforeEach(() => {
        saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
        KEYS.forEach((key) => { delete process.env[key]; });
        config = require('../Config/config');
        KEYS.forEach((key) => { delete config[key]; });
        instance = require('../Config/instanceSettings');
        registry = require('../Modules/AICore/llmProvider/registry');
        instance._resetForTests();
    });

    afterEach(() => {
        instance._resetForTests();
        KEYS.forEach((key) => {
            if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key];
            if (saved[key] === undefined) delete config[key]; else config[key] = saved[key];
        });
    });

    it('configures OpenAI from a saved key alone, so it outranks DeepSeek when no provider is stored', () => {
        process.env.DEEPSEEK_API_KEY = 'ds-key';
        process.env.DEEPSEEK_MODEL = 'deepseek-v4-flash';
        config.DEEPSEEK_API_KEY = 'ds-key';
        config.DEEPSEEK_MODEL = 'deepseek-v4-flash';
        instance._resetForTests();

        expect(registry.configuredNames()).toEqual(['deepseek']);
        instance.applyInstanceSettings({ AI_API_KEY: 'sk-test' });
        expect(config.AI_MODEL).toBe('gpt-4.1');
        expect(registry.configuredNames()).toEqual(['openai', 'deepseek']);
    });

    it('applies the defaults on load when nothing is stored', () => {
        instance.applyInstanceSettings({});
        expect(process.env.AI_MODEL).toBe('gpt-4.1');
        expect(process.env.ANTHROPIC_MODEL).toBe('claude-sonnet-4-5-20250929');
        expect(process.env.DEEPSEEK_MODEL).toBe('deepseek-v4-flash');
    });

    it('does not report the defaults as applied settings', () => {
        expect(instance.applyInstanceSettings({ NODEMAILER_HOST: 'smtp.example.com' })).toEqual(['NODEMAILER_HOST']);
        delete process.env.NODEMAILER_HOST;
        delete config.NODEMAILER_HOST;
    });

    it('keeps a stored model over the default', () => {
        instance.applyInstanceSettings({ AI_MODEL: 'gpt-4o' });
        expect(config.AI_MODEL).toBe('gpt-4o');
    });

    it('returns to the default when a stored model is cleared', () => {
        instance.applyInstanceSettings({ AI_MODEL: 'gpt-4o' });
        instance.applyInstanceSettings({ AI_MODEL: '' });
        expect(config.AI_MODEL).toBe('gpt-4.1');
    });

    it('leaves a model the environment sets alone', () => {
        process.env.AI_MODEL = 'gpt-5';
        instance._resetForTests();
        instance.applyInstanceSettings({ AI_MODEL: 'gpt-4o' });
        instance.applyInstanceSettings({});
        expect(process.env.AI_MODEL).toBe('gpt-5');
    });
});
