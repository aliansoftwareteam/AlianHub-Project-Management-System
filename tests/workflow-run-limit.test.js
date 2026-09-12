jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn() }));

const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const runLimit = require('../Modules/Workflows/runLimit');
const loop = require('../Modules/Workflows/stepTypes/loop');
const { SCHEMA_TYPE } = require('../Config/schemaType');

// Defect 17: the hourly run limit as the loop's admission control. What is
// asserted here is the arithmetic and the cost — where the number comes from,
// how the rolling hour is counted and how few queries that takes. The integration
// suite proves the same rules against real rows.

const COMPANY = 'c1';
const AGENT = 'a1';
const ENV_KEYS = ['WORKFLOW_MAX_RUNS_PER_HOUR', 'WORKFLOW_RUN_LIMIT_CACHE_MS'];
const saved = {};

const startsAt = (...offsets) => offsets.map((ms) => ({ startedAt: new Date(Date.now() - ms) }));

/* Answers the run-start read with `rows` and every other read with nothing, so a
 * test says only what it means to say. */
const answer = (rows) => MongoDbCrudOpration.mockImplementation((companyId, { type }) => {
    if (type === SCHEMA_TYPE.AGENT_RUNS) return Promise.resolve(rows);
    return Promise.resolve(null);
});

const reads = () => MongoDbCrudOpration.mock.calls.filter(([, { type }]) => type === SCHEMA_TYPE.AGENT_RUNS).length;

beforeAll(() => { ENV_KEYS.forEach((k) => { saved[k] = process.env[k]; }); });
beforeEach(() => { MongoDbCrudOpration.mockReset(); runLimit.forget(); ENV_KEYS.forEach((k) => delete process.env[k]); });
afterAll(() => { ENV_KEYS.forEach((k) => { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }); });

describe('where the hourly limit comes from', () => {
    it('is nothing when nobody set one, which is what the engine did before', async () => {
        expect(await runLimit.limitFor(COMPANY, {}, {})).toBe(0);
    });

    it('reads the rule field that was stored and never used', async () => {
        MongoDbCrudOpration.mockResolvedValue({ limits: { maxRunsPerHour: 500 } });
        expect(await runLimit.limitFor(COMPANY, { ruleId: 'r1' }, {})).toBe(500);
    });

    it('lets a definition ask for less than its rule, and never for more', async () => {
        MongoDbCrudOpration.mockResolvedValue({ limits: { maxRunsPerHour: 500 } });
        expect(await runLimit.limitFor(COMPANY, { ruleId: 'r1' }, { maxRunsPerHour: 4 })).toBe(4);
        expect(await runLimit.limitFor(COMPANY, { ruleId: 'r1' }, { maxRunsPerHour: 9000 })).toBe(500);
    });

    it('caps everything at the installation ceiling', async () => {
        process.env.WORKFLOW_MAX_RUNS_PER_HOUR = '3';
        MongoDbCrudOpration.mockResolvedValue({ limits: { maxRunsPerHour: 500 } });
        expect(await runLimit.limitFor(COMPANY, { ruleId: 'r1' }, { maxRunsPerHour: 50 })).toBe(3);
    });

    it('treats zero as no limit, the way rateLimitPerDay always has', async () => {
        expect(await runLimit.limitFor(COMPANY, {}, { maxRunsPerHour: 0 })).toBe(0);
        expect(await runLimit.check(COMPANY, AGENT, 0)).toMatchObject({ ok: true, limit: 0 });
        expect(reads()).toBe(0);
    });
});

describe('counting the hour', () => {
    it('counts only the runs inside it', async () => {
        answer(startsAt(90 * 60 * 1000, 30 * 60 * 1000, 60 * 1000));
        expect(await runLimit.check(COMPANY, AGENT, 5)).toMatchObject({ ok: true, used: 3 });
    });

    it('refuses once the allowance is spent, and says when it comes back', async () => {
        const oldest = 50 * 60 * 1000;
        answer(startsAt(oldest, 10 * 60 * 1000));
        const verdict = await runLimit.check(COMPANY, AGENT, 2);
        expect(verdict).toMatchObject({ ok: false, used: 2, limit: 2 });
        expect(verdict.resetsAt.getTime()).toBeGreaterThan(Date.now());
        expect(runLimit.sentence(verdict)).toBe('Hourly run limit reached (2 of 2 in the last hour).');
    });

    it('refills as the hour rolls past the runs in it, without reading again', async () => {
        process.env.WORKFLOW_RUN_LIMIT_CACHE_MS = '600000';
        const now = Date.now();
        answer(startsAt(59 * 60 * 1000, 58 * 60 * 1000));
        expect(await runLimit.check(COMPANY, AGENT, 2, now)).toMatchObject({ ok: false });
        expect(await runLimit.check(COMPANY, AGENT, 2, now + 90 * 1000)).toMatchObject({ ok: true, used: 1 });
        expect(reads()).toBe(1);
    });

    it('scopes the hour to one company and one agent', async () => {
        answer(startsAt(60 * 1000));
        await runLimit.check(COMPANY, AGENT, 2);
        await runLimit.check('c2', AGENT, 2);
        await runLimit.check(COMPANY, 'a2', 2);
        expect(reads()).toBe(3);
        expect(MongoDbCrudOpration.mock.calls.map(([companyId, { data }]) => [companyId, data[0].agentId]))
            .toEqual([[COMPANY, AGENT], ['c2', AGENT], [COMPANY, 'a2']]);
    });
});

describe('admitting an iteration', () => {
    const run = { _id: 'w1', ruleId: null };

    it('asks nothing of a body that starts no agent', async () => {
        expect(await runLimit.admit(COMPANY, run, { agentIds: [], config: { maxRunsPerHour: 1 } })).toMatchObject({ ok: true });
        expect(reads()).toBe(0);
    });

    it('counts what it admits, so the hour does not need a query per iteration', async () => {
        answer(startsAt(60 * 1000));
        const config = { maxRunsPerHour: 3 };
        expect(await runLimit.admit(COMPANY, run, { agentIds: [AGENT], config })).toMatchObject({ ok: true });
        expect(await runLimit.admit(COMPANY, run, { agentIds: [AGENT], config })).toMatchObject({ ok: true });
        expect(await runLimit.admit(COMPANY, run, { agentIds: [AGENT], config })).toMatchObject({ ok: false, used: 3, limit: 3 });
        expect(reads()).toBe(1);
    });

    it('stops on the first agent of the body that is over', async () => {
        MongoDbCrudOpration.mockImplementation((companyId, { type, data }) => {
            if (type !== SCHEMA_TYPE.AGENT_RUNS) return Promise.resolve(null);
            return Promise.resolve(data[0].agentId === 'a2' ? startsAt(60 * 1000, 120 * 1000) : []);
        });
        expect(await runLimit.admit(COMPANY, run, { agentIds: [AGENT, 'a2'], config: { maxRunsPerHour: 2 } }))
            .toMatchObject({ ok: false, agentId: 'a2' });
    });
});

describe('which agents a loop body would start', () => {
    it('is the agent run steps of the body, once each', () => {
        expect(loop.agentsIn([
            { type: 'agent_run', config: { agentId: 'a1' } },
            { type: 'agent_run', config: { agentId: 'a1' } },
            { type: 'agent_run', config: { agentId: 'a2' } },
            { type: 'agent_run', config: { agentRunId: 'already-started' } },
            { type: 'tool_call', config: { agentId: 'not an agent run' } },
        ])).toEqual(['a1', 'a2']);
    });
});
