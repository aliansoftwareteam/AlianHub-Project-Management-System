/* Health, the circuit breaker, the token buckets, retry and failover. No
 * vendor is reached: every candidate here is a stub adapter with the same
 * shape the registry holds, so the router is driven by the errors it would
 * actually see rather than by a network. */
const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));

const { AIProviderError, TYPES } = require('../Modules/AICore/providerError');
const health = require('../Modules/AICore/llmProvider/health');
const rateLimit = require('../Modules/AICore/llmProvider/rateLimit');
const router = require('../Modules/AICore/llmProvider/router');
const { FEATURES } = require('../Modules/AICore/features');

const C = '6f0000000000000000000c02';
const SPEND = { feature: FEATURES.ASK, companyId: C };
const OPTS = { messages: [{ role: 'user', content: 'hi' }], spend: SPEND };

const MODELS = { openai: 'gpt-4.1', anthropic: 'claude-sonnet-4-6', deepseek: 'deepseek-chat' };

const result = (model) => ({ content: '{"ok":true}', inputTokens: 10, outputTokens: 4, totalTokens: 14, model });

const stub = (name) => {
    const adapter = {
        name,
        isConfigured: true,
        model: MODELS[name],
        capabilities: { structuredOutput: 'json_object', defaultMaxTokens: 4096 },
        calls: [],
        script: [],
        chat: jest.fn(async (opts) => {
            adapter.calls.push(opts);
            const next = adapter.script.length > 1 ? adapter.script.shift() : adapter.script[0];
            if (next instanceof Error) throw next;
            return result(MODELS[name]);
        }),
    };
    adapter.succeeds = () => { adapter.script = [null]; return adapter; };
    adapter.fails = (...errors) => { adapter.script = errors; return adapter; };
    return adapter;
};

const failure = (provider, type, extra = {}) => new AIProviderError({ provider, model: MODELS[provider], type, ...extra });

const registryOf = (...adapters) => ({
    ADAPTERS: Object.fromEntries(adapters.map((a) => [a.name, a])),
    configuredNames: () => adapters.filter((a) => a.isConfigured).map((a) => a.name),
});

const ROUTER_ENV = [
    'AI_MODEL_ROUTER', 'AI_ROUTER_MAX_ATTEMPTS', 'AI_ROUTER_BACKOFF_MS', 'AI_ROUTER_BACKOFF_MAX_MS',
    'AI_ROUTER_HEALTH_WINDOW_MS', 'AI_ROUTER_HEALTH_SAMPLES', 'AI_ROUTER_BREAKER_VOLUME',
    'AI_ROUTER_BREAKER_THRESHOLD', 'AI_ROUTER_BREAKER_COOLDOWN_MS', 'AI_ROUTER_BREAKER_MAX_COOLDOWN_MS',
    'AI_ROUTER_RATE_LIMITS', 'AI_ROUTER_DEFAULT_RPM', 'AI_ROUTER_RATE_WAIT_MS',
];

beforeEach(() => {
    jest.clearAllMocks();
    ROUTER_ENV.forEach((key) => { delete process.env[key]; });
    process.env.AI_ROUTER_BACKOFF_MS = '0';
    health.reset();
    rateLimit.reset();
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
});

afterAll(() => { ROUTER_ENV.forEach((key) => { delete process.env[key]; }); });

describe('the health window', () => {
    it('starts empty, with a closed breaker and no rates', () => {
        expect(health.snapshot('openai', 'gpt-4.1')).toMatchObject({ calls: 0, successRate: null, breaker: { state: 'closed', trips: 0 } });
    });

    it('counts successes and failures per provider and model, and keeps latency quantiles', () => {
        health.record({ provider: 'openai', model: 'gpt-4.1', ok: true, durationMs: 100 });
        health.record({ provider: 'openai', model: 'gpt-4.1', ok: true, durationMs: 300 });
        health.record({ provider: 'openai', model: 'gpt-4.1', ok: false, durationMs: 50, errorType: TYPES.SERVER });
        health.record({ provider: 'openai', model: 'gpt-4o', ok: true, durationMs: 10 });

        const snap = health.snapshot('openai', 'gpt-4.1');
        expect(snap).toMatchObject({ calls: 3, successes: 2, failures: 1, lastErrorType: TYPES.SERVER });
        expect(snap.successRate).toBeCloseTo(2 / 3);
        expect(snap.latencyMs).toEqual({ p50: 100, p95: 300 });
        expect(health.snapshot('openai', 'gpt-4o').calls).toBe(1);
    });

    it('forgets calls older than the window', () => {
        process.env.AI_ROUTER_HEALTH_WINDOW_MS = '1000';
        const t0 = 1000000;
        health.record({ provider: 'openai', model: 'gpt-4.1', ok: false, errorType: TYPES.SERVER }, t0);
        expect(health.snapshot('openai', 'gpt-4.1', t0 + 500).calls).toBe(1);
        expect(health.snapshot('openai', 'gpt-4.1', t0 + 5000).calls).toBe(0);
    });
});

describe('the circuit breaker', () => {
    const trip = (type = TYPES.SERVER, times = 5, provider = 'openai') => {
        for (let i = 0; i < times; i += 1) health.record({ provider, model: MODELS[provider], ok: false, errorType: type });
    };

    it('opens once the failure rate holds over the minimum volume', () => {
        process.env.AI_ROUTER_BREAKER_VOLUME = '5';
        trip(TYPES.SERVER, 4);
        expect(health.stateOf('openai', MODELS.openai)).toBe('closed');
        trip(TYPES.SERVER, 1);
        expect(health.stateOf('openai', MODELS.openai)).toBe('open');
        expect(health.snapshot('openai', MODELS.openai).breaker.trips).toBe(1);
    });

    it('refuses a call while it is open, and half-opens for one probe after the cooldown', () => {
        process.env.AI_ROUTER_BREAKER_COOLDOWN_MS = '1000';
        trip();
        const t = Date.now();
        expect(health.admit('openai', MODELS.openai, t)).toMatchObject({ allowed: false, state: 'open' });

        const probe = health.admit('openai', MODELS.openai, t + 2000);
        expect(probe).toMatchObject({ allowed: true, state: 'half_open', probe: true });
        expect(health.admit('openai', MODELS.openai, t + 2001)).toMatchObject({ allowed: false, state: 'half_open' });
    });

    it('closes on a successful probe and clears the window', () => {
        process.env.AI_ROUTER_BREAKER_COOLDOWN_MS = '1000';
        trip();
        const t = Date.now();
        health.admit('openai', MODELS.openai, t + 2000);
        health.record({ provider: 'openai', model: MODELS.openai, ok: true, durationMs: 20, probe: true });
        expect(health.stateOf('openai', MODELS.openai)).toBe('closed');
        expect(health.snapshot('openai', MODELS.openai).calls).toBe(0);
    });

    it('re-opens on a failed probe with a longer cooldown, up to the ceiling', () => {
        process.env.AI_ROUTER_BREAKER_COOLDOWN_MS = '1000';
        process.env.AI_ROUTER_BREAKER_MAX_COOLDOWN_MS = '3000';
        trip();
        expect(health.snapshot('openai', MODELS.openai).breaker.cooldownMs).toBe(1000);
        const t = Date.now();
        health.admit('openai', MODELS.openai, t + 2000);
        health.record({ provider: 'openai', model: MODELS.openai, ok: false, errorType: TYPES.SERVER, probe: true });
        expect(health.snapshot('openai', MODELS.openai).breaker).toMatchObject({ state: 'open', cooldownMs: 2000, trips: 2 });

        health.admit('openai', MODELS.openai, t + 10000);
        health.record({ provider: 'openai', model: MODELS.openai, ok: false, errorType: TYPES.SERVER, probe: true });
        expect(health.snapshot('openai', MODELS.openai).breaker.cooldownMs).toBe(3000);
    });

    it('ignores a failure the caller caused: another provider would refuse it too', () => {
        trip(TYPES.CONTEXT_LENGTH, 10);
        expect(health.stateOf('openai', MODELS.openai)).toBe('closed');
        trip(TYPES.INVALID_REQUEST, 10);
        expect(health.stateOf('openai', MODELS.openai)).toBe('closed');
    });

    it('does not open on rate limits alone, but does when nothing is getting through', () => {
        health.record({ provider: 'openai', model: MODELS.openai, ok: true, durationMs: 10 });
        trip(TYPES.RATE_LIMIT, 8);
        expect(health.stateOf('openai', MODELS.openai)).toBe('closed');

        health.reset();
        trip(TYPES.RATE_LIMIT, 8);
        expect(health.stateOf('openai', MODELS.openai)).toBe('open');
    });
});

describe('the per-provider token bucket', () => {
    it('is off until a limit is configured, which is today', () => {
        expect(rateLimit.budget('openai')).toMatchObject({ limitPerMinute: 0, available: null });
        for (let i = 0; i < 100; i += 1) expect(rateLimit.take('openai').allowed).toBe(true);
    });

    it('spends a token per call and refuses when the minute is spent', () => {
        process.env.AI_ROUTER_RATE_LIMITS = 'openai:2,anthropic:10';
        const t = Date.now();
        expect(rateLimit.take('openai', t).allowed).toBe(true);
        expect(rateLimit.take('openai', t).allowed).toBe(true);
        const refused = rateLimit.take('openai', t);
        expect(refused.allowed).toBe(false);
        expect(refused.waitMs).toBeGreaterThan(0);
        expect(rateLimit.take('anthropic', t).allowed).toBe(true);
        expect(rateLimit.budget('openai', t)).toMatchObject({ limitPerMinute: 2, available: 0 });
    });

    it('refills over the minute', () => {
        process.env.AI_ROUTER_RATE_LIMITS = 'openai:60';
        const t = Date.now();
        for (let i = 0; i < 60; i += 1) rateLimit.take('openai', t);
        expect(rateLimit.take('openai', t).allowed).toBe(false);
        expect(rateLimit.take('openai', t + 1100).allowed).toBe(true);
    });

    it('is tightened by a retry hint the provider returned', () => {
        process.env.AI_ROUTER_RATE_LIMITS = 'openai:60';
        const t = Date.now();
        rateLimit.tighten('openai', 5000, t);
        expect(rateLimit.take('openai', t + 1000).allowed).toBe(false);
        expect(rateLimit.budget('openai', t + 1000).blockedUntil).toBe(new Date(t + 5000).toISOString());
        expect(rateLimit.take('openai', t + 6000).allowed).toBe(true);
    });

    it('reads AI_ROUTER_DEFAULT_RPM for a provider with no entry of its own', () => {
        process.env.AI_ROUTER_RATE_LIMITS = 'openai:5';
        process.env.AI_ROUTER_DEFAULT_RPM = '7';
        expect(rateLimit.limitFor('openai')).toBe(5);
        expect(rateLimit.limitFor('anthropic')).toBe(7);
    });
});

describe('with AI_MODEL_ROUTER off, nothing changes', () => {
    it('calls the one adapter once and does not fail over', async () => {
        const openai = stub('openai').fails(failure('openai', TYPES.SERVER));
        const anthropic = stub('anthropic').succeeds();
        const provider = router.resilient(openai, registryOf(openai, anthropic));

        await expect(provider.chat(OPTS)).rejects.toThrow(AIProviderError);
        expect(openai.chat).toHaveBeenCalledTimes(1);
        expect(anthropic.chat).not.toHaveBeenCalled();
    });

    it('still records the outcome, so the console has something to show', async () => {
        const openai = stub('openai').succeeds();
        await router.resilient(openai, registryOf(openai)).chat(OPTS);
        expect(health.snapshot('openai', MODELS.openai)).toMatchObject({ calls: 1, successes: 1 });
    });

    it('ignores an open breaker: the flag gates the effect, not the tracking', async () => {
        for (let i = 0; i < 8; i += 1) health.record({ provider: 'openai', model: MODELS.openai, ok: false, errorType: TYPES.SERVER });
        expect(health.stateOf('openai', MODELS.openai)).toBe('open');
        const openai = stub('openai').succeeds();
        await expect(router.resilient(openai, registryOf(openai)).chat(OPTS)).resolves.toMatchObject({ model: MODELS.openai });
    });
});

describe('with AI_MODEL_ROUTER on', () => {
    beforeEach(() => { process.env.AI_MODEL_ROUTER = 'on'; });

    it('retries a transient failure on the same provider before moving on', async () => {
        const openai = stub('openai').fails(failure('openai', TYPES.OVERLOADED), null);
        const anthropic = stub('anthropic').succeeds();

        await expect(router.resilient(openai, registryOf(openai, anthropic)).chat(OPTS)).resolves.toMatchObject({ model: MODELS.openai });
        expect(openai.chat).toHaveBeenCalledTimes(2);
        expect(anthropic.chat).not.toHaveBeenCalled();
    });

    it('honours a retry hint instead of its own backoff, capped', () => {
        process.env.AI_ROUTER_BACKOFF_MAX_MS = '4000';
        expect(router.backoffFor(1, failure('openai', TYPES.RATE_LIMIT, { retryAfterMs: 1500 }))).toBe(1500);
        expect(router.backoffFor(1, failure('openai', TYPES.RATE_LIMIT, { retryAfterMs: 60000 }))).toBe(4000);
    });

    it('fails over to the next configured provider when attempts run out', async () => {
        process.env.AI_ROUTER_MAX_ATTEMPTS = '1';
        const openai = stub('openai').fails(failure('openai', TYPES.SERVER));
        const anthropic = stub('anthropic').succeeds();
        const deepseek = stub('deepseek').succeeds();

        await expect(router.resilient(openai, registryOf(openai, anthropic, deepseek)).chat(OPTS)).resolves.toMatchObject({ model: MODELS.anthropic });
        expect(openai.chat).toHaveBeenCalledTimes(1);
        expect(anthropic.chat).toHaveBeenCalledTimes(1);
        expect(deepseek.chat).not.toHaveBeenCalled();
    });

    it('drops the caller model on failover, because a model id belongs to one vendor', async () => {
        process.env.AI_ROUTER_MAX_ATTEMPTS = '1';
        const openai = stub('openai').fails(failure('openai', TYPES.SERVER));
        const anthropic = stub('anthropic').succeeds();

        await router.resilient(openai, registryOf(openai, anthropic)).chat({ ...OPTS, model: 'gpt-4o' });
        expect(openai.calls[0].model).toBe('gpt-4o');
        expect(anthropic.calls[0].model).toBeUndefined();
    });

    it('skips a candidate whose breaker is open and takes the next one', async () => {
        process.env.AI_ROUTER_MAX_ATTEMPTS = '1';
        for (let i = 0; i < 8; i += 1) health.record({ provider: 'openai', model: MODELS.openai, ok: false, errorType: TYPES.SERVER });
        const openai = stub('openai').succeeds();
        const anthropic = stub('anthropic').succeeds();

        await expect(router.resilient(openai, registryOf(openai, anthropic)).chat(OPTS)).resolves.toMatchObject({ model: MODELS.anthropic });
        expect(openai.chat).not.toHaveBeenCalled();
    });

    it('opens the breaker from real failures and then routes past it', async () => {
        process.env.AI_ROUTER_MAX_ATTEMPTS = '1';
        process.env.AI_ROUTER_BREAKER_VOLUME = '3';
        const openai = stub('openai').fails(failure('openai', TYPES.NETWORK));
        const anthropic = stub('anthropic').succeeds();
        const provider = router.resilient(openai, registryOf(openai, anthropic));

        for (let i = 0; i < 3; i += 1) await provider.chat(OPTS);
        expect(health.stateOf('openai', MODELS.openai)).toBe('open');
        const before = openai.chat.mock.calls.length;
        await provider.chat(OPTS);
        expect(openai.chat).toHaveBeenCalledTimes(before);
        expect(anthropic.chat).toHaveBeenCalledTimes(4);
    });

    it('takes the next candidate rather than waiting out a long rate-limit block', async () => {
        process.env.AI_ROUTER_RATE_LIMITS = 'openai:60';
        process.env.AI_ROUTER_RATE_WAIT_MS = '10';
        rateLimit.tighten('openai', 30000);
        const openai = stub('openai').succeeds();
        const anthropic = stub('anthropic').succeeds();

        await expect(router.resilient(openai, registryOf(openai, anthropic)).chat(OPTS)).resolves.toMatchObject({ model: MODELS.anthropic });
        expect(openai.chat).not.toHaveBeenCalled();
    });

    it('tightens the bucket from the provider own rate-limit answer', async () => {
        process.env.AI_ROUTER_RATE_LIMITS = 'openai:60';
        process.env.AI_ROUTER_MAX_ATTEMPTS = '1';
        const openai = stub('openai').fails(failure('openai', TYPES.RATE_LIMIT, { retryAfterMs: 20000 }));
        const anthropic = stub('anthropic').succeeds();

        await router.resilient(openai, registryOf(openai, anthropic)).chat(OPTS);
        expect(rateLimit.budget('openai').blockedUntil).not.toBeNull();
    });

    it('does not fail over a failure the caller caused', async () => {
        const openai = stub('openai').fails(failure('openai', TYPES.CONTEXT_LENGTH));
        const anthropic = stub('anthropic').succeeds();

        await expect(router.resilient(openai, registryOf(openai, anthropic)).chat(OPTS)).rejects.toMatchObject({ type: TYPES.CONTEXT_LENGTH });
        expect(anthropic.chat).not.toHaveBeenCalled();
    });

    it('rethrows the last provider error when every candidate is exhausted', async () => {
        process.env.AI_ROUTER_MAX_ATTEMPTS = '1';
        const openai = stub('openai').fails(failure('openai', TYPES.SERVER));
        const anthropic = stub('anthropic').fails(failure('anthropic', TYPES.OVERLOADED));

        await expect(router.resilient(openai, registryOf(openai, anthropic)).chat(OPTS)).rejects.toMatchObject({ provider: 'anthropic', type: TYPES.OVERLOADED });
    });

    it('fails transient when every candidate was skipped without being called', async () => {
        for (const name of ['openai', 'anthropic']) {
            for (let i = 0; i < 8; i += 1) health.record({ provider: name, model: MODELS[name], ok: false, errorType: TYPES.SERVER });
        }
        const openai = stub('openai').succeeds();
        const anthropic = stub('anthropic').succeeds();

        await expect(router.resilient(openai, registryOf(openai, anthropic)).chat(OPTS))
            .rejects.toMatchObject({ retryable: true, message: expect.stringContaining('No LLM provider could take the call') });
    });

    it('puts the chosen provider first and the registry order behind it', () => {
        const openai = stub('openai');
        const anthropic = stub('anthropic');
        const deepseek = stub('deepseek');
        expect(router.candidatesFor(anthropic, registryOf(openai, anthropic, deepseek)).map((a) => a.name))
            .toEqual(['anthropic', 'openai', 'deepseek']);
    });
});
