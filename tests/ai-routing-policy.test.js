/* Task classes, the per-workspace policy that points each one at a model, and
 * the flag that keeps the whole thing inert until an operator turns it on. */
const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../Config/config', () => ({ AI_API_KEY: 'sk-proj-OPENAISECRET0123456789', AI_MODEL: 'gpt-4.1' }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));

const { dbCollections } = require('../Config/collections');
const taskClass = require('../Modules/AICore/taskClass');
const routingPolicy = require('../Modules/AICore/routingPolicy');
const { FEATURE_LIST, FEATURES } = require('../Modules/AICore/features');

const C = '6f0000000000000000000c01';
const USER = '6f0000000000000000000u01';
const seedCompany = (over = {}) => mockDb.seed(dbCollections.COMPANIES, { _id: C, ...over });
const stored = () => mockDb.store[dbCollections.COMPANIES][0][routingPolicy.COMPANY_FIELD];
const classOf = (policy, key) => policy.classes.find((c) => c.taskClass === key);

const routerOn = () => { process.env.AI_MODEL_ROUTER = 'on'; };

describe('task classes', () => {
    it('covers every feature that spends tokens, once', () => {
        const assigned = taskClass.list().flatMap((c) => c.features);
        expect([...assigned].sort()).toEqual([...FEATURE_LIST].sort());
        expect(new Set(assigned).size).toBe(assigned.length);
    });

    it('gives every class a quality floor, a latency target and an input budget', () => {
        taskClass.list().forEach((c) => {
            expect(taskClass.isQuality(c.qualityFloor)).toBe(true);
            expect(c.latencyTargetMs).toBeGreaterThan(0);
            expect(c.inputBudgetTokens).toBeGreaterThan(0);
        });
    });

    it('puts an untagged feature on the interactive class, not the cheapest', () => {
        expect(taskClass.classOfFeature('nothing-we-know')).toBe(taskClass.TASK_CLASS.ASSIST);
        expect(taskClass.classOfFeature(FEATURES.TASK_CATEGORY)).toBe(taskClass.TASK_CLASS.CLASSIFY);
        expect(taskClass.classOfFeature(FEATURES.MEETING_NOTES)).toBe(taskClass.TASK_CLASS.LONG_CONTEXT);
    });

    it('reads a floor as met only from its own tier upward', () => {
        expect(taskClass.meetsQuality('high', 'standard')).toBe(true);
        expect(taskClass.meetsQuality('basic', 'standard')).toBe(false);
    });
});

describe('routing policy', () => {
    beforeEach(() => {
        Object.keys(mockDb.store).forEach((key) => delete mockDb.store[key]);
        delete process.env.AI_MODEL_ROUTER;
        seedCompany();
    });

    it('answers with the platform defaults before anything is saved', async () => {
        const policy = await routingPolicy.get(C);
        expect(policy.classes).toHaveLength(taskClass.TASK_CLASS_LIST.length);
        expect(classOf(policy, 'agent')).toMatchObject({ model: null, qualityFloor: 'high', latencyTargetMs: 30000, inputBudgetTokens: 64000 });
    });

    it('saves a model, a floor and a latency target for one class', async () => {
        const out = await routingPolicy.update(C, { classes: { classify: { model: 'gpt-4.1', qualityFloor: 'standard', latencyTargetMs: 1500 } } }, USER);
        expect(out.error).toBeUndefined();
        expect(classOf(out.policy, 'classify')).toMatchObject({ model: 'gpt-4.1', qualityFloor: 'standard', latencyTargetMs: 1500 });
        expect(stored().updatedBy).toBe(USER);
    });

    it('leaves the classes it was not given alone', async () => {
        await routingPolicy.update(C, { classes: { classify: { model: 'gpt-4.1' } } }, USER);
        await routingPolicy.update(C, { classes: { agent: { latencyTargetMs: 20000 } } }, USER);
        const policy = await routingPolicy.get(C);
        expect(classOf(policy, 'classify').model).toBe('gpt-4.1');
        expect(classOf(policy, 'agent').latencyTargetMs).toBe(20000);
    });

    it('clears a model back to no preference', async () => {
        await routingPolicy.update(C, { classes: { classify: { model: 'gpt-4.1' } } }, USER);
        await routingPolicy.update(C, { classes: { classify: { model: '' } } }, USER);
        expect(classOf(await routingPolicy.get(C), 'classify').model).toBeNull();
    });

    it('refuses a model the priced allowlist would not take, and writes nothing', async () => {
        const out = await routingPolicy.update(C, { classes: { agent: { model: 'claude-sonnet-4-6' } } }, USER);
        expect(out.status).toBe(400);
        expect(out.code).toBe('provider_not_configured');
        expect(stored()).toBeUndefined();
    });

    it('refuses an unknown task class, an unknown floor and an impossible latency target', async () => {
        expect((await routingPolicy.update(C, { classes: { nonsense: {} } }, USER)).error).toContain('Unknown task class');
        expect((await routingPolicy.update(C, { classes: { agent: { qualityFloor: 'perfect' } } }, USER)).error).toContain('qualityFloor');
        expect((await routingPolicy.update(C, { classes: { agent: { latencyTargetMs: 5 } } }, USER)).error).toContain('latencyTargetMs');
        expect((await routingPolicy.update(C, {}, USER)).error).toContain('classes');
    });

    it('keeps a saved policy inert while the router flag is off', async () => {
        await routingPolicy.update(C, { classes: { classify: { model: 'gpt-4.1' } } }, USER);
        const off = await routingPolicy.effective(C, 'classify');
        expect(off).toMatchObject({ model: null, routerEnabled: false, qualityFloor: 'basic' });
    });

    it('hands the saved model over once the router flag is on', async () => {
        await routingPolicy.update(C, { classes: { classify: { model: 'gpt-4.1' } } }, USER);
        routerOn();
        expect(await routingPolicy.effective(C, 'classify')).toMatchObject({ model: 'gpt-4.1', routerEnabled: true });
        expect(await routingPolicy.effectiveForFeature(C, FEATURES.TASK_CATEGORY)).toMatchObject({ model: 'gpt-4.1', taskClass: 'classify' });
    });

    it('falls back to the interactive class for a feature it does not know', async () => {
        routerOn();
        expect(await routingPolicy.effectiveForFeature(C, 'nothing-we-know')).toMatchObject({ taskClass: 'assist' });
    });
});
