jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Modules/Automations/engine/matcher', () => ({ match: jest.fn(async () => []), invalidateAll: jest.fn() }));
jest.mock('../Modules/Automations/engine/runner', () => ({ execute: jest.fn(async () => ({ status: 'success' })), createRun: jest.fn() }));

/* A stand-in for Agenda that models the one behaviour under test: a job whose
 * handler is still running when its lock expires is handed out again, and
 * touch() pushes the lock forward. */
jest.mock('@hokify/agenda', () => {
    class FakeAgenda {
        constructor(opts) { this.opts = opts; this.defs = new Map(); this.deliveries = []; FakeAgenda.instances.push(this); }
        define(name, handler, options = {}) { this.defs.set(name, { handler, options }); }
        async start() {}
        async stop() {}
        async schedule(runAt, name, data) { return this.now(name, data); }
        async now(name, data) {
            const def = this.defs.get(name);
            const lockLifetime = def.options.lockLifetime || this.opts.defaultLockLifetime;
            const job = { attrs: { name, data, lockedAt: null }, done: false, touches: 0 };
            let expiry = null;
            const arm = () => {
                if (expiry) clearTimeout(expiry);
                expiry = setTimeout(() => { if (!job.done) deliver(); }, lockLifetime);
            };
            job.touch = async () => { job.touches += 1; job.attrs.lockedAt = new Date(); arm(); };
            const deliver = () => {
                this.deliveries.push(job);
                job.attrs.lockedAt = new Date();
                arm();
                Promise.resolve(def.handler(job)).then(() => { job.done = true; clearTimeout(expiry); }, () => { job.done = true; clearTimeout(expiry); });
            };
            deliver();
            return job;
        }
    }
    FakeAgenda.instances = [];
    return { Agenda: FakeAgenda };
});

const { Agenda: FakeAgenda } = require('@hokify/agenda');
const timeouts = require('../Modules/Agents/engine/timeouts');
const { createAgendaDriver, LOCK_LIFETIME_MS } = require('../Modules/Automations/engine/queue/agendaDriver');
const engine = require('../Modules/Automations/engine');
const runner = require('../Modules/Automations/engine/runner');

const { MINUTE, MODEL_TIMEOUT_MS, ACT_BUDGET_MS, RUN_LOCK_MS } = timeouts;
const OLD_LOCK_MS = 5 * MINUTE;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

beforeEach(() => { FakeAgenda.instances.length = 0; jest.clearAllMocks(); });

describe('the job lock is derived from the model timeout', () => {
    it('outlives the worst case: model timeout plus act budget', () => {
        expect(MODEL_TIMEOUT_MS).toBe(10 * MINUTE);
        expect(ACT_BUDGET_MS).toBe(5 * MINUTE);
        expect(RUN_LOCK_MS).toBeGreaterThan(MODEL_TIMEOUT_MS + ACT_BUDGET_MS);
        expect(RUN_LOCK_MS).toBeGreaterThan(OLD_LOCK_MS);
        expect(LOCK_LIFETIME_MS).toBe(RUN_LOCK_MS);
    });

    it('follows a provider override, so raising ANTHROPIC_TIMEOUT_MS raises the lock', () => {
        const before = process.env.ANTHROPIC_TIMEOUT_MS;
        process.env.ANTHROPIC_TIMEOUT_MS = String(25 * MINUTE);
        try {
            jest.isolateModules(() => {
                const raised = require('../Modules/Agents/engine/timeouts');
                expect(raised.providerTimeoutMs('anthropic')).toBe(25 * MINUTE);
                expect(raised.MODEL_TIMEOUT_MS).toBe(25 * MINUTE);
                expect(raised.RUN_LOCK_MS).toBeGreaterThan(25 * MINUTE + raised.ACT_BUDGET_MS);
            });
        } finally {
            if (before === undefined) delete process.env.ANTHROPIC_TIMEOUT_MS; else process.env.ANTHROPIC_TIMEOUT_MS = before;
        }
    });

    it('gives classic chat models the shorter budget and reasoning models the full one', () => {
        expect(timeouts.providerTimeoutMs('openai', { reasoning: false })).toBe(4 * MINUTE);
        expect(timeouts.providerTimeoutMs('openai', { reasoning: true })).toBe(MODEL_TIMEOUT_MS);
        expect(timeouts.providerTimeoutMs('deepseek', { reasoning: false })).toBe(4 * MINUTE);
        expect(timeouts.providerTimeoutMs('anthropic')).toBe(MODEL_TIMEOUT_MS);
    });
});

describe('every agenda job definition carries the derived lock', () => {
    it('the driver passes lockLifetime on define, both before and after start', async () => {
        const driver = createAgendaDriver({ mongoUrl: 'mongodb://x', concurrency: 2 });
        driver.define('early', async () => {});
        await driver.start();
        driver.define('late', async () => {});
        const [agenda] = FakeAgenda.instances;
        expect(agenda.opts.defaultLockLifetime).toBe(RUN_LOCK_MS);
        for (const name of ['early', 'late']) {
            const { options } = agenda.defs.get(name);
            expect(options.lockLifetime).toBe(RUN_LOCK_MS);
            expect(options.lockLifetime).toBeGreaterThan(MODEL_TIMEOUT_MS);
        }
        await driver.stop();
    });

    it('the automation engine defines automation.run with that lock and hands the job touch to the runner', async () => {
        const env = { ...process.env };
        process.env.AUTOMATION_ENGINE = 'true';
        process.env.AUTOMATION_QUEUE_DRIVER = 'agenda';
        process.env.MONGODB_URL = 'mongodb://x';
        try {
            await engine.start();
            const [agenda] = FakeAgenda.instances;
            const def = agenda.defs.get(engine.JOB_NAME);
            expect(def.options.lockLifetime).toBe(RUN_LOCK_MS);
            expect(def.options.lockLifetime).toBeGreaterThan(MODEL_TIMEOUT_MS);

            const job = await agenda.now(engine.JOB_NAME, { companyId: 'c1', runId: 'r1', ruleId: 'x1' });
            await Promise.resolve();
            expect(runner.execute).toHaveBeenCalledWith(expect.objectContaining({ companyId: 'c1', runId: 'r1', ruleId: 'x1', keepAlive: expect.any(Function) }));
            await runner.execute.mock.calls[0][0].keepAlive();
            expect(job.touches).toBe(1);
        } finally {
            await engine.stop();
            process.env = env;
        }
    });
});

describe('a slow run is delivered once', () => {
    beforeEach(() => { jest.useFakeTimers(); });
    afterEach(() => { jest.useRealTimers(); });

    const slowHandler = (ms) => jest.fn(async () => { await sleep(ms); });

    it('a handler that outlives the old 5-minute lock but not the new one runs exactly once', async () => {
        const driver = createAgendaDriver({ mongoUrl: 'mongodb://x' });
        const handler = slowHandler(OLD_LOCK_MS + MINUTE);
        driver.define('slow', handler);
        await driver.start();
        await driver.enqueue('slow', {});
        await jest.advanceTimersByTimeAsync(RUN_LOCK_MS + MINUTE);
        expect(handler).toHaveBeenCalledTimes(1);
        expect(FakeAgenda.instances[0].deliveries).toHaveLength(1);
    });

    it('the stub itself re-delivers under the old lock, so the assertion above is meaningful', async () => {
        const agenda = new FakeAgenda({ defaultLockLifetime: OLD_LOCK_MS });
        const handler = slowHandler(OLD_LOCK_MS + MINUTE);
        agenda.define('slow', handler);
        await agenda.now('slow', {});
        await jest.advanceTimersByTimeAsync(OLD_LOCK_MS + 2 * MINUTE);
        expect(handler).toHaveBeenCalledTimes(2);
    });

    it('a run longer than the lock keeps it by touching between phases', async () => {
        const driver = createAgendaDriver({ mongoUrl: 'mongodb://x' });
        const handler = jest.fn(async (job) => {
            for (let phase = 0; phase < 4; phase++) {
                // eslint-disable-next-line no-await-in-loop
                await sleep(RUN_LOCK_MS / 2);
                // eslint-disable-next-line no-await-in-loop
                await job.touch();
            }
        });
        driver.define('long', handler);
        await driver.start();
        await driver.enqueue('long', {});
        await jest.advanceTimersByTimeAsync(RUN_LOCK_MS * 3);
        expect(handler).toHaveBeenCalledTimes(1);
    });
});
