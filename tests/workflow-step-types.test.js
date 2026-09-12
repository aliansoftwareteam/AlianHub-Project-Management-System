jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn() }));

const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const stepTypes = require('../Modules/Workflows/stepTypes');
const waiting = require('../Modules/Workflows/stepTypes/waiting');
const graph = require('../Modules/Workflows/stepTypes/graph');
const loop = require('../Modules/Workflows/stepTypes/loop');
const retry = require('../Modules/Workflows/retry');
const store = require('../Modules/Workflows/store');
const timeTrigger = require('../Modules/Workflows/timeTrigger');
const registry = require('../Modules/Automations/engine/registry');
const { validateRuleV2, describeV2 } = require('../Modules/Automations/helpers/ruleSchemaV2');

const ENV_KEYS = ['WORKFLOW_ENGINE', 'WORKFLOW_MAX_FAN_OUT', 'WORKFLOW_MAX_LOOP_ITERATIONS'];
const saved = {};

const step = (over = {}) => ({ runId: 'r1', stepId: 's1', type: 'wait', status: 'pending', dependsOn: [], ...over });

beforeAll(() => { ENV_KEYS.forEach((k) => { saved[k] = process.env[k]; }); });
beforeEach(() => { MongoDbCrudOpration.mockReset(); ENV_KEYS.forEach((k) => delete process.env[k]); });
afterAll(() => { ENV_KEYS.forEach((k) => { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }); });

describe('the step types', () => {
    it('registers every type it describes', () => {
        const executors = require('../Modules/Workflows/executors');
        stepTypes.TYPES.forEach((type) => expect(executors.has(type)).toBe(true));
    });

    it('describes each one as data a builder can render', () => {
        stepTypes.CONTRACTS.forEach((contract) => {
            expect(typeof contract.label).toBe('string');
            expect(Object.keys(contract.config).length).toBeGreaterThan(0);
            expect(Array.isArray(contract.output)).toBe(true);
        });
        expect(JSON.stringify(stepTypes.manifest())).not.toContain('function');
    });

    it('accepts a fan-out, its join and a loop over them', () => {
        expect(stepTypes.validateSteps([
            { id: 's1', type: 'fan_out', config: { items: [1, 2], type: 'tool_call' } },
            { id: 's2', type: 'fan_in', dependsOn: ['s1'], config: { from: 's1' } },
            { id: 's3', type: 'loop', dependsOn: ['s2'], config: { body: ['s2'], maxIterations: 3 } },
        ])).toEqual({ valid: true, errors: [] });
    });

    it('names the slot that is wrong rather than refusing the whole definition', () => {
        const { valid, errors } = stepTypes.validateSteps([
            { id: 'a', type: 'fan_in', config: { from: 'nope' } },
            { id: 'b', type: 'timer', config: {} },
            { id: 'c', type: 'loop', config: { body: ['c'] } },
            { id: 'd', type: 'human_approval', config: { onDeadline: 'shrug' } },
        ]);
        expect(valid).toBe(false);
        expect(errors).toEqual(expect.arrayContaining([
            'steps[0].config.from: no step "nope" in this workflow',
            'steps[0].dependsOn: a join must depend on the fan-out it joins',
            'steps[1].config: needs "at" or "atFrom"',
            'steps[2].config.body: a loop cannot repeat itself',
            'steps[3].config.onDeadline: must be one of fail, approve, reject',
        ]));
    });

    it('catches a step reference that would quietly read nothing', () => {
        const { errors } = stepTypes.validateSteps([
            { id: 'work', type: 'wait', config: { forMs: 10 } },
            { id: 's2', type: 'condition', dependsOn: ['work'], config: { when: { op: 'and', args: [{ op: 'eq', field: '$work.ok', value: true }, { op: 'eq', field: '$nope.ok', value: true }] } } },
            { id: 's3', type: 'fan_out', config: { itemsFrom: '$work.items', type: 'wait' } },
        ]);
        expect(errors).toEqual(expect.arrayContaining([
            'steps[1].config.when.args[0].field: a step read as "$work" must have an id beginning with "s"',
            'steps[1].config.when.args[1].field: no step "nope" in this workflow',
            'steps[2].config.itemsFrom: a step read as "$work" must have an id beginning with "s"',
        ]));
    });

    it('refuses a loop or a fan-out that asks for more than the ceiling', () => {
        const { errors } = stepTypes.validateSteps([
            { id: 's1', type: 'fan_out', config: { items: [], type: 'wait', maxChildren: 5000 } },
            { id: 's2', type: 'loop', config: { body: ['s1'], maxIterations: 5000 } },
        ]);
        expect(errors).toEqual(expect.arrayContaining([
            'steps[0].config.maxChildren: at most 50',
            'steps[1].config.maxIterations: at most 25',
        ]));
    });
});

describe('waiting', () => {
    it('is not a failure: it comes back as often as its own deadline allows', () => {
        const error = (() => { try { waiting.waitFor('waiting for a person', 1000); } catch (e) { return e; } })();
        expect(error.name).toBe(retry.WAITING);
        const decision = retry.decide(error, { attempt: 9, maxAttempts: 3 });
        expect(decision).toMatchObject({ retry: true, reason: 'waiting', delayMs: 1000 });
        expect(decision.failure.type).toBe('waiting');
    });

    it('polls no later than the moment it is waiting for', () => {
        const error = (() => { try { waiting.waitUntil('soon', new Date(Date.now() + 50), { pollMs: 60000 }); } catch (e) { return e; } })();
        expect(error.retryAfterMs).toBeLessThanOrEqual(50);
    });

    it('records the reason on the row instead of an error, and gives the attempt back', async () => {
        MongoDbCrudOpration.mockResolvedValue({ _id: 'x' });
        const until = new Date(Date.now() + 5000);
        await store.deferStep('c1', { runId: 'r1', stepId: 's1', fencingToken: 2 }, {
            error: 'waiting for user 7 to approve',
            failure: { type: 'waiting', wait: { reason: 'waiting for user 7 to approve', until, set: { approvalId: 'a1' } } },
            runAt: until,
        });
        const [, { data }] = MongoDbCrudOpration.mock.calls[0];
        expect(data[1].$set).toMatchObject({ status: 'pending', error: null, waitReason: 'waiting for user 7 to approve', waitUntil: until, approvalId: 'a1' });
        expect(data[1].$inc).toEqual({ attempts: -1 });
    });

    it('still records a real transient failure as an error', async () => {
        MongoDbCrudOpration.mockResolvedValue({ _id: 'x' });
        await store.deferStep('c1', { runId: 'r1', stepId: 's1', fencingToken: 2 }, { error: 'socket hang up', failure: { type: 'transient' }, runAt: new Date() });
        const [, { data }] = MongoDbCrudOpration.mock.calls[0];
        expect(data[1].$set.error).toBe('socket hang up');
        expect(data[1].$inc).toBeUndefined();
    });

    it('says what a blocked run is blocked on, and only the first thing', () => {
        expect(waiting.blockedReason([
            step({ stepId: 'a', status: 'success' }),
            step({ stepId: 'b', type: 'human_approval', waitReason: 'waiting for user 7 to approve', approvalId: 'ap1' }),
            step({ stepId: 'c', type: 'timer', waitReason: 'waiting until tomorrow' }),
        ])).toMatchObject({ blocked: true, stepId: 'b', reason: 'waiting for user 7 to approve', approvalId: 'ap1', also: 1 });
        expect(waiting.blockedReason([step({ status: 'running' })])).toBeNull();
    });
});

describe('the graph a step prunes', () => {
    it('finds everything downstream of a step, transitively', () => {
        const steps = [
            step({ stepId: 'a' }), step({ stepId: 'b', dependsOn: ['a'] }),
            step({ stepId: 'c', dependsOn: ['b'] }), step({ stepId: 'd' }),
        ];
        expect(graph.descendantsOf(steps, 'a').sort()).toEqual(['b', 'c']);
        expect(graph.descendantsOf(steps, 'd')).toEqual([]);
    });
});

describe('a loop budget', () => {
    it('reads the spend an agent run reports, whatever it calls it', () => {
        expect(loop.costOf({ costUsd: 0.4 })).toBe(0.4);
        expect(loop.costOf({ spendUsd: 1.25 })).toBe(1.25);
        expect(loop.costOf({ spend: { usd: 2 } })).toBe(2);
        expect(loop.costOf({})).toBe(0);
    });
});

describe('a schedule as a trigger', () => {
    it('joins the automation catalogue, and only while the engine is on', () => {
        expect(registry.manifest().triggers.map((t) => t.key)).not.toContain(timeTrigger.EVENT);
        process.env.WORKFLOW_ENGINE = 'on';
        expect(registry.manifest().triggers.map((t) => t.key)).toContain(timeTrigger.EVENT);
        expect(registry.getTrigger(timeTrigger.EVENT)).toMatchObject({ kind: 'time' });
    });

    it('refuses a schedule that does not say when', () => {
        expect(timeTrigger.validateSchedule({ every: 'day' })).toEqual(['trigger.schedule.at: must be HH:MM']);
        expect(timeTrigger.validateSchedule({ every: 'week', at: '08:30' })).toEqual(['trigger.schedule.weekday: must be 0 (Sunday) to 6']);
        expect(timeTrigger.validateSchedule({ every: 'fortnight' })[0]).toMatch(/every: must be one of/);
        expect(timeTrigger.validateSchedule({ every: 'day', at: '08:30', timezone: 'Asia/Kolkata' })).toEqual(['trigger.schedule.timezone: only UTC is supported']);
    });

    it('names the next occurrence after a moment, never that moment again', () => {
        const at10 = new Date('2026-09-12T10:00:00Z');
        expect(timeTrigger.nextOccurrence({ every: 'day', at: '09:00' }, at10).toISOString()).toBe('2026-09-13T09:00:00.000Z');
        expect(timeTrigger.nextOccurrence({ every: 'day', at: '10:00' }, at10).toISOString()).toBe('2026-09-13T10:00:00.000Z');
        expect(timeTrigger.nextOccurrence({ every: 'hour', minute: 15 }, at10).toISOString()).toBe('2026-09-12T10:15:00.000Z');
        // 2026-09-12 is a Saturday; the next Wednesday is the 16th.
        expect(timeTrigger.nextOccurrence({ every: 'week', weekday: 3, at: '08:30' }, at10).toISOString()).toBe('2026-09-16T08:30:00.000Z');
    });

    it('is due only once its next occurrence has passed', () => {
        const schedule = { every: 'hour', minute: 0 };
        const lastFiredAt = new Date('2026-09-12T10:00:00Z');
        expect(timeTrigger.isDue(schedule, { lastFiredAt, now: new Date('2026-09-12T10:59:00Z') })).toBe(false);
        expect(timeTrigger.isDue(schedule, { lastFiredAt, now: new Date('2026-09-12T11:00:00Z') })).toBe(true);
        expect(timeTrigger.isDue(schedule, { now: new Date('2026-09-12T11:00:00Z') })).toBe(false);
    });

    it('validates and describes a scheduled rule through the rule validator', () => {
        process.env.WORKFLOW_ENGINE = 'on';
        const input = {
            name: 'Nightly sweep',
            trigger: { event: timeTrigger.EVENT, schedule: { every: 'day', at: '02:00' } },
            steps: [{ id: 's1', type: 'action', action: 'set_priority', config: { priority: 'HIGH' } }],
        };
        const valid = validateRuleV2(input);
        expect(valid.valid).toBe(true);
        expect(valid.value.trigger).toEqual({ type: 'time', event: timeTrigger.EVENT, schedule: { every: 'day', at: '02:00', timezone: 'UTC' } });
        expect(describeV2(valid.value)).toContain('every day at 02:00 UTC');

        expect(validateRuleV2({ ...input, trigger: { event: timeTrigger.EVENT } }).errors).toContain('trigger.schedule: required');
    });

    it('is not offered, and so cannot be saved, while the engine is off', () => {
        expect(validateRuleV2({
            name: 'Nightly sweep',
            trigger: { event: timeTrigger.EVENT, schedule: { every: 'day', at: '02:00' } },
            steps: [{ id: 's1', type: 'action', action: 'set_priority', config: { priority: 'HIGH' } }],
        }).errors).toContain(`trigger.event: unknown event "${timeTrigger.EVENT}"`);
    });
});
