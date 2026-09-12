/* Sprint 4's exit gate: one provider blackholed, the run continues on the
 * fallback, and the breaker state is visible.
 *
 * The stubs sit at the adapter's own HTTP boundary rather than in place of the
 * adapter, so the real DeepSeek and Google adapters, the real axios timeouts
 * and the real provider-error mapping are all in the path. Both are configured
 * with dummy keys and priced model ids and pointed at localhost, so nothing
 * here can reach a vendor.
 *
 * DeepSeek is the blackhole: it accepts the connection and never answers, so
 * the call dies on the adapter's own timeout the way a hung vendor would.
 * Google answers correctly. OpenAI and Anthropic are mocked unconfigured so
 * the candidate list is exactly the two stubs, in that order. */
process.env.NODE_ENV = 'test';
process.env.LLM_PROVIDER = 'deepseek';
process.env.DEEPSEEK_API_KEY = 'gate-dummy-deepseek';
process.env.DEEPSEEK_MODEL = 'deepseek-chat';
process.env.GOOGLE_API_KEY = 'gate-dummy-google';
process.env.GOOGLE_MODEL = 'gemini-2.5-flash';
process.env.DEEPSEEK_TIMEOUT_MS = '250';
process.env.GOOGLE_TIMEOUT_MS = '4000';
process.env.AI_REPLAY = 'all';

const http = require('http');
const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../Modules/AICore/llmProvider/openaiProvider', () => ({ name: 'openai', model: null, isConfigured: false, capabilities: {}, chat: jest.fn() }));
jest.mock('../Modules/AICore/llmProvider/anthropicProvider', () => ({ name: 'anthropic', model: null, isConfigured: false, capabilities: {}, chat: jest.fn() }));

const mockSpans = [];
jest.mock('../Config/telemetry', () => ({
    setAttributes: (attrs) => mockSpans.push(attrs),
    traceIdNow: () => null,
    withSpan: (name, fn) => fn(),
    isActive: () => false,
}));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { dbCollections } = require('../Config/collections');
const { getProvider, providerStatus } = require('../Modules/AICore/llmProvider');
const health = require('../Modules/AICore/llmProvider/health');
const rateLimit = require('../Modules/AICore/llmProvider/rateLimit');
const { FEATURES } = require('../Modules/AICore/features');
const { isProviderError } = require('../Modules/AICore/providerError');

const COMPANY = '6f0000000000000000000c05';
const RUN = 'run-gate-4';
const BREAKER_VOLUME = 3;
const COOLDOWN_MS = 400;
const BLACKHOLE_TIMEOUT_MS = 250;

/* A stub that can be blackholed and healed. While `hanging`, it accepts the
 * connection and writes nothing, which is what a provider that has stopped
 * answering looks like from the client side. */
function stubServer(answer) {
    const stub = { requests: 0, hanging: false };
    const sockets = new Set();
    const server = http.createServer((req, res) => {
        stub.requests += 1;
        req.resume();
        if (stub.hanging) return;
        const body = JSON.stringify(answer());
        res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
        res.end(body);
    });
    server.on('connection', (socket) => {
        sockets.add(socket);
        socket.on('close', () => sockets.delete(socket));
    });
    stub.start = () => new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => {
            stub.port = server.address().port;
            stub.url = `http://127.0.0.1:${stub.port}`;
            resolve(stub);
        });
    });
    stub.stop = () => new Promise((resolve) => {
        sockets.forEach((socket) => socket.destroy());
        server.close(() => resolve());
    });
    return stub;
}

const deepseekAnswer = () => ({
    choices: [{ message: { role: 'assistant', content: '{"from":"deepseek"}' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 12, completion_tokens: 6, total_tokens: 18 },
});

const googleAnswer = () => ({
    candidates: [{ content: { parts: [{ text: '{"from":"google"}' }] }, finishReason: 'STOP' }],
    usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 6, totalTokenCount: 18 },
    modelVersion: 'gemini-2.5-flash',
});

const deepseek = stubServer(deepseekAnswer);
const google = stubServer(googleAnswer);

const ROUTER_ENV = [
    'AI_MODEL_ROUTER', 'AI_ROUTER_MAX_ATTEMPTS', 'AI_ROUTER_BACKOFF_MS', 'AI_ROUTER_BREAKER_VOLUME',
    'AI_ROUTER_BREAKER_THRESHOLD', 'AI_ROUTER_BREAKER_COOLDOWN_MS', 'AI_ROUTER_BREAKER_MAX_COOLDOWN_MS',
];

/* The nearest real call path to an agent run: the feature tag an agent run
 * carries, its runId, and the same getProvider().chat() every feature uses, so
 * the router, the meter, the reservation and the replay row are all in it. */
const run = () => getProvider().chat({
    systemPrompt: 'You are a helpful planner.',
    messages: [{ role: 'user', content: 'plan the sprint' }],
    maxTokens: 256,
    jsonMode: true,
    spend: { feature: FEATURES.AGENT_RUN, companyId: COMPANY, userId: 'u-gate', runId: RUN },
});

const replays = () => mockDb.store[SCHEMA_TYPE.AI_REPLAYS] || [];
const ledger = () => mockDb.store[SCHEMA_TYPE.AI_USAGE] || [];
const lastDecision = () => replays()[replays().length - 1].decision;
const rowFor = (name) => providerStatus().providers.find((p) => p.provider === name);
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

beforeAll(async () => {
    await deepseek.start();
    await google.start();
    process.env.DEEPSEEK_BASE_URL = deepseek.url;
    process.env.GOOGLE_BASE_URL = google.url;
});

afterAll(async () => {
    await deepseek.stop();
    await google.stop();
    ROUTER_ENV.forEach((key) => { delete process.env[key]; });
    ['DEEPSEEK_BASE_URL', 'GOOGLE_BASE_URL', 'AI_REPLAY'].forEach((key) => { delete process.env[key]; });
});

beforeEach(() => {
    jest.clearAllMocks();
    mockSpans.length = 0;
    health.reset();
    rateLimit.reset();
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.seed(dbCollections.COMPANIES, { _id: COMPANY, agentMonthlyBudgetUsd: 100 });
    deepseek.requests = 0;
    google.requests = 0;
    deepseek.hanging = true;
    google.hanging = false;
    ROUTER_ENV.forEach((key) => { delete process.env[key]; });
    process.env.AI_ROUTER_MAX_ATTEMPTS = '1';
    process.env.AI_ROUTER_BACKOFF_MS = '0';
    process.env.AI_ROUTER_BREAKER_VOLUME = String(BREAKER_VOLUME);
    process.env.AI_ROUTER_BREAKER_THRESHOLD = '0.5';
    process.env.AI_ROUTER_BREAKER_COOLDOWN_MS = String(COOLDOWN_MS);
    process.env.AI_ROUTER_BREAKER_MAX_COOLDOWN_MS = '2000';
});

describe('the two stub providers stand in for the vendors', () => {
    it('configures exactly the blackholed provider and its fallback, both priced', () => {
        const status = providerStatus();
        expect(status.providers.filter((p) => p.configured).map((p) => p.provider)).toEqual(['deepseek', 'google']);
        expect(rowFor('deepseek')).toMatchObject({ model: 'deepseek-chat', priced: true });
        expect(rowFor('google')).toMatchObject({ model: 'gemini-2.5-flash', priced: true });
    });
});

describe('with AI_MODEL_ROUTER on and DeepSeek blackholed', () => {
    it('fails over to Google, names the skip and its reason, opens the breaker and recovers through a half-open probe', async () => {
        process.env.AI_MODEL_ROUTER = 'on';

        // 1. The run completes on the fallback, and the decision says why.
        const first = await run();
        expect(first.content).toBe('{"from":"google"}');
        expect(first.model).toBe('gemini-2.5-flash');
        expect(deepseek.requests).toBe(1);
        expect(google.requests).toBe(1);

        const decided = lastDecision();
        expect(decided.routerEnabled).toBe(true);
        expect(decided.chosen).toEqual({ provider: 'google', model: 'gemini-2.5-flash' });
        expect(decided.skipped).toContainEqual({ provider: 'deepseek', model: 'deepseek-chat', reason: 'timeout' });
        expect(decided.reservation.state).toBe('settled');
        expect(decided.estimate.priced).toBe(true);
        expect(decided.actual).toMatchObject({ inputTokens: 12, outputTokens: 6 });
        expect(mockSpans[mockSpans.length - 1]['ai.routing.skipped']).toBe('deepseek:timeout');
        expect(mockSpans[mockSpans.length - 1]['ai.routing.provider']).toBe('google');

        // The meter still booked the call that answered, and only that one.
        expect(ledger().filter((r) => r.provider === 'google')).toHaveLength(1);
        expect(ledger().filter((r) => r.provider === 'deepseek')).toHaveLength(0);

        // 2. The breaker opens once the window holds the configured volume.
        for (let i = 1; i < BREAKER_VOLUME; i += 1) {
            // eslint-disable-next-line no-await-in-loop
            expect((await run()).model).toBe('gemini-2.5-flash');
        }
        expect(deepseek.requests).toBe(BREAKER_VOLUME);
        expect(health.stateOf('deepseek', 'deepseek-chat')).toBe('open');

        // 3. The instance console's provider row reports that state.
        const open = rowFor('deepseek');
        expect(open.health.breaker).toMatchObject({ state: 'open', trips: 1, cooldownMs: COOLDOWN_MS });
        expect(open.health).toMatchObject({ calls: BREAKER_VOLUME, successes: 0, failures: BREAKER_VOLUME, lastErrorType: 'timeout' });
        expect(open.health.breaker.retryAt).not.toBeNull();
        expect(rowFor('google').health.breaker.state).toBe('closed');

        // 4. An open breaker is skipped without being called at all.
        const whileOpen = await run();
        expect(whileOpen.model).toBe('gemini-2.5-flash');
        expect(deepseek.requests).toBe(BREAKER_VOLUME);
        expect(lastDecision().skipped).toContainEqual({ provider: 'deepseek', model: 'deepseek-chat', reason: 'breaker_open' });

        // 5. After the cooldown one probe is admitted, and a success closes it.
        await sleep(COOLDOWN_MS + 50);
        expect(rowFor('deepseek').health.breaker.state).toBe('half_open');

        deepseek.hanging = false;
        const probed = await run();
        expect(deepseek.requests).toBe(BREAKER_VOLUME + 1);
        expect(probed.content).toBe('{"from":"deepseek"}');
        expect(lastDecision().chosen).toEqual({ provider: 'deepseek', model: 'deepseek-chat' });

        const closed = rowFor('deepseek');
        expect(closed.health.breaker).toMatchObject({ state: 'closed', trips: 1, cooldownMs: 0, consecutiveFailures: 0 });
        expect(closed.health.lastSuccessAt).not.toBeNull();
    }, 30000);
});

describe('with AI_MODEL_ROUTER off', () => {
    it('uses the blackholed provider, fails, and never reaches the fallback', async () => {
        process.env.AI_MODEL_ROUTER = 'off';

        const error = await run().then(() => null, (e) => e);
        expect(error).not.toBeNull();
        expect(isProviderError(error)).toBe(true);
        expect(error).toMatchObject({ provider: 'deepseek', type: 'timeout' });
        expect(deepseek.requests).toBe(1);
        expect(google.requests).toBe(0);
        expect(ledger()).toHaveLength(0);

        const decided = lastDecision();
        expect(decided.routerEnabled).toBe(false);
        expect(decided.chosen).toEqual({ provider: null, model: null });
        expect(decided.skipped).toEqual([]);
        expect(decided.reservation.state).toBe('off');
    }, 30000);

    it('leaves the breaker unread: the window fills but the blackholed provider keeps taking the call', async () => {
        process.env.AI_MODEL_ROUTER = 'off';

        for (let i = 0; i < BREAKER_VOLUME + 1; i += 1) {
            // eslint-disable-next-line no-await-in-loop
            await expect(run()).rejects.toMatchObject({ provider: 'deepseek' });
        }
        expect(deepseek.requests).toBe(BREAKER_VOLUME + 1);
        expect(google.requests).toBe(0);
        expect(rowFor('deepseek').health.breaker.state).toBe('open');
    }, 30000);
});

describe('the timings this gate runs on', () => {
    it('keeps every wait shorter than the cooldown it configures', () => {
        expect(BLACKHOLE_TIMEOUT_MS).toBe(Number(process.env.DEEPSEEK_TIMEOUT_MS));
        expect(COOLDOWN_MS).toBeGreaterThan(BLACKHOLE_TIMEOUT_MS);
    });
});
