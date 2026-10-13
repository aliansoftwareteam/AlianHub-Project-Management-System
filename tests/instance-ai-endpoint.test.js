/* Instance › Settings › AI for a self-hosted endpoint: the fields the owner fills in, how they are
 * validated, and the "Test connection" probe, which asks the endpoint for its models through the
 * dedicated client and answers with the list or a clear reason. The endpoint is a loopback server. */
const { startOpenAiCompatibleServer } = require('./support/openAiCompatibleServer');
const { byKey, validateSettings } = require('../Modules/Instance/settingsCatalog');
const { probeAi } = require('../Modules/Instance/probes');

const KEYS = ['LLM_PROVIDER', 'OPENAI_BASE_URL', 'OPENAI_COMPATIBLE_BASE_URL', 'OPENAI_COMPATIBLE_API_KEY', 'OPENAI_COMPATIBLE_MODEL', 'OPENAI_COMPATIBLE_EMBEDDINGS_MODEL', 'AI_API_KEY'];
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));

let open;
let keyed;

beforeAll(async () => {
    open = await startOpenAiCompatibleServer();
    keyed = await startOpenAiCompatibleServer({ apiKey: 'gw-secret-1', models: ['company/gpt-oss'] });
});
afterAll(async () => {
    await open.stop();
    await keyed.stop();
    KEYS.forEach((k) => { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; });
});
beforeEach(() => {
    KEYS.forEach((k) => { delete process.env[k]; });
    open.reset();
    keyed.reset();
});

describe('the AI settings for a self-hosted endpoint', () => {
    it('offers the compatible provider and its fields, with the key kept secret', () => {
        expect(byKey.get('LLM_PROVIDER').options).toEqual(expect.arrayContaining(['openai', 'anthropic', 'deepseek', 'openai_compatible']));
        for (const key of ['OPENAI_BASE_URL', 'OPENAI_COMPATIBLE_BASE_URL', 'OPENAI_COMPATIBLE_MODEL', 'OPENAI_COMPATIBLE_EMBEDDINGS_MODEL']) {
            expect(byKey.get(key)).toMatchObject({ group: 'ai', type: 'text' });
        }
        expect(byKey.get('OPENAI_COMPATIBLE_API_KEY')).toMatchObject({ group: 'ai', secret: true });
        expect(byKey.get('AI_ENABLED')).toMatchObject({ group: 'ai', type: 'boolean', default: 'true' });
    });

    it('accepts a loopback or private base URL and refuses one that is not a plain http(s) URL', () => {
        expect(validateSettings({ LLM_PROVIDER: 'openai_compatible', OPENAI_COMPATIBLE_BASE_URL: 'http://127.0.0.1:11434/v1', AI_ENABLED: 'false' }).valid).toBe(true);
        expect(validateSettings({ OPENAI_COMPATIBLE_BASE_URL: 'http://192.168.1.20:8000/v1' }).valid).toBe(true);
        expect(validateSettings({ OPENAI_COMPATIBLE_BASE_URL: 'file:///etc/passwd' }).errors).toEqual({ OPENAI_COMPATIBLE_BASE_URL: 'protocol' });
        expect(validateSettings({ OPENAI_BASE_URL: 'https://user:pw@proxy.example.com/v1' }).errors).toEqual({ OPENAI_BASE_URL: 'credentials' });
    });
});

describe('Test connection', () => {
    it('lists the models the endpoint serves', async () => {
        const result = await probeAi({ LLM_PROVIDER: 'openai_compatible', OPENAI_COMPATIBLE_BASE_URL: open.baseUrl });
        expect(result.status).toBe(true);
        expect(result.data).toMatchObject({ provider: 'openai_compatible', models: ['llama3.1:8b', 'nomic-embed-text'] });
        expect(open.requests.map((r) => `${r.method} ${r.url}`)).toEqual(['GET /v1/models']);
    });

    it('tests what the owner typed before it is saved, key included', async () => {
        const refused = await probeAi({ LLM_PROVIDER: 'openai_compatible', OPENAI_COMPATIBLE_BASE_URL: keyed.baseUrl, OPENAI_COMPATIBLE_API_KEY: 'wrong' });
        expect(refused).toMatchObject({ status: false, statusText: expect.stringMatching(/rejected the API key/) });
        const accepted = await probeAi({ LLM_PROVIDER: 'openai_compatible', OPENAI_COMPATIBLE_BASE_URL: keyed.baseUrl, OPENAI_COMPATIBLE_API_KEY: 'gw-secret-1' });
        expect(accepted).toMatchObject({ status: true, data: { models: ['company/gpt-oss'] } });
    });

    it('says clearly when the endpoint is unreachable, missing or not a URL', async () => {
        const down = await probeAi({ LLM_PROVIDER: 'openai_compatible', OPENAI_COMPATIBLE_BASE_URL: 'http://127.0.0.1:9/v1' });
        expect(down.status).toBe(false);
        expect(down.statusText).toMatch(/could not reach|refused/i);

        const missing = await probeAi({ LLM_PROVIDER: 'openai_compatible' });
        expect(missing).toMatchObject({ status: false, statusText: expect.stringMatching(/base URL/i) });

        const bad = await probeAi({ LLM_PROVIDER: 'openai_compatible', OPENAI_COMPATIBLE_BASE_URL: 'ftp://x/v1' });
        expect(bad).toMatchObject({ status: false, statusText: expect.stringMatching(/http/i) });

        open.behave(500);
        const broken = await probeAi({ LLM_PROVIDER: 'openai_compatible', OPENAI_COMPATIBLE_BASE_URL: open.baseUrl });
        expect(broken).toMatchObject({ status: false, statusText: expect.stringMatching(/500/) });
    });

    it('refuses a link-local or metadata address', async () => {
        const metadata = await probeAi({ LLM_PROVIDER: 'openai_compatible', OPENAI_COMPATIBLE_BASE_URL: 'http://169.254.169.254/v1' });
        expect(metadata).toMatchObject({ status: false, statusText: expect.stringMatching(/link-local|metadata/i) });
    });

    it('asks OpenAI at OPENAI_BASE_URL when one is set', async () => {
        const result = await probeAi({ LLM_PROVIDER: 'openai', AI_API_KEY: 'sk-test-1', OPENAI_BASE_URL: open.baseUrl });
        expect(result.status).toBe(true);
        expect(open.requests[0]).toMatchObject({ method: 'GET', url: '/v1/models', headers: { authorization: 'Bearer sk-test-1' } });
    });
});
