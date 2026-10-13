let mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const SC = require('../Modules/Automations/helpers/statusConditions');
const matcher = require('../Modules/Automations/engine/matcher');
const runner = require('../Modules/Automations/engine/runner');
const store = require('../Modules/Workflows/store');
const graph = require('../Modules/Workflows/stepTypes/graph');
const condition = require('../Modules/Workflows/stepTypes/condition');
const dryRun = require('../Modules/Automations/helpers/dryRun');

const C = '6f0000000000000000000c01';
const WEB = '6f0000000000000000000a01';
const OPS = '6f0000000000000000000a02';

const PROJECTS = [
    {
        _id: WEB,
        deletedStatusKey: 0,
        taskStatusData: [
            { key: 3, name: 'In Progress', type: 'active' },
            { key: 4, name: 'Blocked', type: 'active' },
            { key: 6, name: 'Done', type: 'close' },
        ],
    },
    {
        _id: OPS,
        deletedStatusKey: 0,
        taskStatusData: [
            { key: 7, name: 'Blocked', type: 'active' },
            { key: 9, name: 'Complete', type: 'close' },
        ],
    },
];

const snapshot = (projectId, statusKey, statusType) => ({ _id: 't1', TaskKey: 'WEB-1', ProjectID: projectId, statusKey, statusType, Task_Priority: 'HIGH' });

const statusChange = (from, to) => ({
    id: 'evt_1',
    companyId: C,
    type: 'task.status_changed',
    actor: { kind: 'user', userId: 'u1' },
    scope: { projectId: to.ProjectID },
    entity: { kind: 'task', id: 't1', key: 'WEB-1' },
    data: to,
    previous: from,
    changedFields: ['statusKey'],
});

const branch = (when) => ({ stepId: 'sCheck', type: 'condition', config: { when, then: ['sYes'], else: ['sNo'] } });

const runOn = (task, over = {}) => ({ _id: 'run1', workflowId: 'wf1', entity: { kind: 'task', id: 't1', data: task }, envelope: {}, ...over });

beforeEach(() => {
    mockDb = require('./fixtures/fakeMongo').create();
    PROJECTS.forEach((p) => mockDb.seed(SCHEMA_TYPE.PROJECTS, p));
    matcher.invalidateAll();
    jest.restoreAllMocks();
    jest.spyOn(store, 'outputsOf').mockResolvedValue({});
    jest.spyOn(store, 'skipStep').mockResolvedValue({ modifiedCount: 1 });
});

describe('a workflow condition step on a named status', () => {
    test('a branch on "Blocked" takes the yes path for a blocked task in either project', async () => {
        const out = await condition.execute({ companyId: C, run: runOn(snapshot(OPS, 7, 'active')), step: branch({ op: 'eq', field: 'statusType', value: 'Blocked' }) });
        expect(out).toEqual({ matched: true, taken: ['sYes'], skipped: ['sNo'] });
    });

    test('a branch on "Blocked" takes the no path for a task in another status of the same type', async () => {
        const out = await condition.execute({ companyId: C, run: runOn(snapshot(WEB, 3, 'active')), step: branch({ op: 'eq', field: 'statusType', value: 'Blocked' }) });
        expect(out).toEqual({ matched: false, taken: ['sNo'], skipped: ['sYes'] });
        expect(store.skipStep).toHaveBeenCalledWith(C, 'run1', 'sYes', expect.stringContaining('sCheck was false'));
    });

    test('a keyed condition matches by the task\'s own project and key', async () => {
        const when = { op: 'in', field: 'statusRef', value: [`${WEB}:4`], label: 'Blocked' };
        expect((await condition.execute({ companyId: C, run: runOn(snapshot(WEB, 4, 'active')), step: branch(when) })).matched).toBe(true);
        expect((await condition.execute({ companyId: C, run: runOn(snapshot(OPS, 4, 'active')), step: branch(when) })).matched).toBe(false);
    });

    test('a stored name is never widened to its type', async () => {
        const out = await condition.execute({ companyId: C, run: runOn(snapshot(OPS, 9, 'close')), step: branch({ op: 'eq', field: 'statusType', value: 'Done' }) });
        expect(out.matched).toBe(false);
    });

    test('a name no project has leaves the condition false rather than throwing', async () => {
        const out = await condition.execute({ companyId: C, run: runOn(snapshot(WEB, 4, 'active')), step: branch({ op: 'eq', field: 'statusType', value: 'Frozen' }) });
        expect(out.matched).toBe(false);
    });

    test('a condition on the status type still reads the type', async () => {
        const out = await condition.execute({ companyId: C, run: runOn(snapshot(OPS, 9, 'close')), step: branch({ op: 'eq', field: 'statusType', value: 'close' }) });
        expect(out.matched).toBe(true);
    });
});

describe('a workflow started by a status-change event', () => {
    const run = (from, to) => runOn(to, { envelope: statusChange(from, to) });

    test('changedTo a named status holds when the task moved into it', async () => {
        const when = { op: 'changedTo', field: 'statusType', value: 'Blocked' };
        expect((await condition.execute({ companyId: C, run: run(snapshot(WEB, 3, 'active'), snapshot(WEB, 4, 'active')), step: branch(when) })).matched).toBe(true);
        expect((await condition.execute({ companyId: C, run: run(snapshot(WEB, 4, 'active'), snapshot(WEB, 3, 'active')), step: branch(when) })).matched).toBe(false);
    });

    test('changedFrom a named status reads the task\'s previous state', async () => {
        const when = { op: 'changedFrom', field: 'statusType', value: 'In Progress' };
        expect((await condition.execute({ companyId: C, run: run(snapshot(WEB, 3, 'active'), snapshot(WEB, 4, 'active')), step: branch(when) })).matched).toBe(true);
    });

    test('the context is the automation matcher\'s own, with the run\'s ids added to the scope', () => {
        const envelope = statusChange(snapshot(WEB, 3, 'active'), snapshot(WEB, 4, 'active'));
        const ctx = graph.contextFor(runOn(envelope.data, { envelope, startedBy: 'u9' }), { sA: { ok: true } });
        const expected = matcher.contextFor(envelope, { sA: { ok: true } });
        expect(ctx.task).toEqual(expected.task);
        expect(ctx.previous).toEqual(expected.previous);
        expect(ctx.changedFields).toEqual(expected.changedFields);
        expect(ctx.task.statusRef).toBe(`${WEB}:4`);
        expect(ctx.previous.statusRef).toBe(`${WEB}:3`);
        expect(ctx.changedFields).toContain('statusRef');
        expect(ctx.scope).toMatchObject({ projectId: WEB, workflowId: 'wf1', runId: 'run1' });
        expect(ctx.steps).toEqual({ sA: { ok: true } });
    });

    test('a run no event started still gets a statusRef for its task', () => {
        const ctx = graph.contextFor(runOn(snapshot(OPS, 7, 'active'), { startedBy: 'u9' }), {});
        expect(ctx.task.statusRef).toBe(`${OPS}:7`);
        expect(ctx.previous).toEqual({});
        expect(ctx.actor).toEqual({ userId: 'u9' });
    });
});

describe('condition steps nested in an automation rule', () => {
    const seedRule = (condition) => {
        mockDb.seed(SCHEMA_TYPE.AUTOMATION_RULES, {
            _id: 'r1', name: 'Blocked follow-up', version: 2, enabled: true, deletedStatusKey: 0,
            trigger: { type: 'event', event: 'task.status_changed' },
            scope: { allProjects: true, projectIds: [] },
            conditions: {},
            steps: [{ id: 's1', type: 'condition', condition }],
        });
    };
    const seedRun = (envelope) => mockDb.seed(SCHEMA_TYPE.AUTOMATION_RUNS, { _id: 'ar1', ruleId: 'r1', status: 'queued', cursor: 0, attempts: 0, steps: [], outputs: {}, envelope });
    const storedRun = () => mockDb.store[SCHEMA_TYPE.AUTOMATION_RUNS].find((r) => r._id === 'ar1');

    test('a stored status name in a step resolves when the run reads the rule', async () => {
        seedRule({ op: 'changedTo', field: 'statusType', value: 'Blocked' });
        seedRun(statusChange(snapshot(OPS, 9, 'close'), snapshot(OPS, 7, 'active')));
        expect(await runner.execute({ companyId: C, runId: 'ar1', ruleId: 'r1' })).toEqual({ status: 'success' });
        expect(storedRun().outputs.s1).toEqual({ passed: true });
    });

    test('the step stops the run when the task is in another status', async () => {
        seedRule({ op: 'eq', field: 'statusType', value: 'Blocked' });
        seedRun(statusChange(snapshot(WEB, 4, 'active'), snapshot(WEB, 3, 'active')));
        expect(await runner.execute({ companyId: C, runId: 'ar1', ruleId: 'r1' })).toEqual({ status: 'stopped' });
    });

    test('the dry run resolves step names the way the runner does', () => {
        const rule = {
            _id: 'r1', version: 2, trigger: { type: 'event', event: 'task.status_changed' }, scope: { allProjects: true },
            conditions: {}, steps: [{ id: 's1', type: 'condition', condition: { op: 'eq', field: 'statusType', value: 'Blocked' } }],
        };
        const plan = dryRun.plan({ rule, task: snapshot(WEB, 4, 'active'), uid: 'u1', triggerLabel: 'Status changes', statuses: SC.catalogueOf(PROJECTS) });
        expect(plan.actions[0]).toMatchObject({ id: 's1', passed: true });
    });
});

describe('normaliseStepConditions', () => {
    const statuses = SC.catalogueOf(PROJECTS);

    test('resolves a rule condition step, a workflow condition and a loop\'s while', () => {
        const steps = [
            { id: 's1', type: 'condition', condition: { op: 'eq', field: 'statusType', value: 'Blocked' } },
            { id: 'sIf', type: 'condition', config: { when: { op: 'neq', field: 'statusType', value: 'Done' }, then: ['a'] } },
            { id: 'sLoop', type: 'loop', config: { body: ['a'], while: { op: 'eq', field: 'task.statusType', value: 'In Progress' } } },
            { id: 's4', type: 'action', action: 'add_comment', config: { body: 'Blocked' } },
        ];
        const out = SC.normaliseStepConditions(steps, statuses, {}, { extend: false, generic: false });
        expect(out.changed).toBe(true);
        expect(out.steps[0].condition).toEqual({ op: 'in', field: 'statusRef', value: [`${WEB}:4`, `${OPS}:7`], label: 'Blocked' });
        expect(out.steps[1].config).toEqual({ when: { op: 'notIn', field: 'statusRef', value: [`${WEB}:6`], label: 'Done' }, then: ['a'] });
        expect(out.steps[2].config.while).toEqual({ op: 'in', field: 'statusRef', value: [`${WEB}:3`], label: 'In Progress' });
        expect(out.steps[3]).toBe(steps[3]);
        expect(out.unresolved).toEqual([]);
    });

    test('names what it could not resolve, per step, and leaves that step as written', () => {
        const steps = [{ id: 's1', type: 'condition', condition: { op: 'eq', field: 'statusType', value: 'Frozen' } }];
        const out = SC.normaliseStepConditions(steps, statuses, {}, { extend: false, generic: false });
        expect(out.changed).toBe(false);
        expect(out.steps[0]).toEqual(steps[0]);
        expect(out.unresolved).toEqual([{ step: 's1', status: 'Frozen' }]);
    });

    test('knows when a step list needs the status catalogue', () => {
        expect(SC.stepsNeedStatusCatalogue([{ id: 's1', type: 'condition', condition: { op: 'eq', field: 'statusType', value: 'close' } }])).toBe(false);
        expect(SC.stepsNeedStatusCatalogue([{ id: 's1', type: 'condition', config: { when: { op: 'eq', field: 'statusType', value: 'Blocked' } } }])).toBe(true);
        expect(SC.stepsNeedStatusCatalogue(undefined)).toBe(false);
    });
});
