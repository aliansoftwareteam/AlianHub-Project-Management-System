const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { dbCollections } = require('../Config/collections');
const { schema } = require('../utils/mongo-handler/schema');
const socketEmitter = require('../event/socketEventEmitter');
const domainEventBus = require('../event/domainEventBus');
const registry = require('../Modules/Automations/engine/registry');
const matcher = require('../Modules/Automations/engine/matcher');
const dueDates = require('../Modules/Automations/engine/dueDateTrigger');

const C = '6f0000000000000000000c01';
const PROJECT = '6f0000000000000000000a01';
const NOW = new Date('2026-10-01T12:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const ago = (ms) => new Date(NOW.getTime() - ms);

let events;
const record = (envelope) => { events.push(envelope); };

const seedRule = (over = {}) => mockDb.seed(SCHEMA_TYPE.AUTOMATION_RULES, {
    name: 'Overdue', version: 2, enabled: true, deletedStatusKey: 0,
    trigger: { type: 'event', event: 'task.due_date_passed' },
    scope: { allProjects: true, projectIds: [] },
    conditions: {},
    steps: [{ id: 's1', type: 'action', action: 'set_priority', config: { priority: 'HIGH' } }],
    createdAt: ago(7 * 24 * HOUR),
    ...over,
});

const seedTask = (over = {}) => mockDb.seed(SCHEMA_TYPE.TASKS, {
    TaskName: 'Send the report', TaskKey: 'WEB-7', CompanyId: C, ProjectID: PROJECT, sprintId: 'sp1',
    isParentTask: true, statusType: 'active', deletedStatusKey: 0, Task_Priority: 'LOW',
    AssigneeUserId: [], DueDate: ago(HOUR), ...over,
});

const stored = (task) => mockDb.store[SCHEMA_TYPE.TASKS].find((t) => String(t._id) === String(task._id));
const tick = (now = NOW) => dueDates.tickCompany(C, { now });
const firedFor = (task) => events.filter((e) => e.type === 'task.due_date_passed' && e.entity.id === String(task._id));

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.calls.length = 0;
    matcher.invalidateAll();
    events = [];
    domainEventBus.bus.on('domain.event', record);
});

afterEach(() => {
    domainEventBus.bus.removeListener('domain.event', record);
    jest.restoreAllMocks();
});

describe('the trigger is registered', () => {
    it('is offered as a task trigger that carries no before and after', () => {
        expect(registry.getTrigger('task.due_date_passed')).toMatchObject({ entity: 'task', hasDiff: false });
        expect(registry.manifest().triggers.map((t) => t.key)).toContain('task.due_date_passed');
    });

    it('stores what it fired for in a field the task schema declares', () => {
        expect(schema.tasks.dueDatePassedFor).toBeDefined();
    });
});

describe('a due date that passes while the task is open', () => {
    it('publishes one event for the task, as the system, and records the due date it fired for', async () => {
        seedRule();
        const task = seedTask();
        const out = await tick();

        expect(out.fired).toBe(1);
        expect(firedFor(task)).toHaveLength(1);
        expect(firedFor(task)[0]).toMatchObject({
            companyId: C,
            actor: { kind: 'system', userId: null },
            depth: 0,
            entity: { kind: 'task', id: String(task._id), key: 'WEB-7' },
            scope: { projectId: PROJECT },
            data: { TaskName: 'Send the report', Task_Priority: 'LOW' },
        });
        expect(new Date(stored(task).dueDatePassedFor).getTime()).toBe(task.DueDate.getTime());
    });

    it('matches a rule on that trigger', async () => {
        const rule = seedRule();
        seedTask();
        await tick();
        const matched = await matcher.match(C, events[0]);
        expect(matched.map((r) => String(r._id))).toEqual([String(rule._id)]);
    });

    it('does not fire again on a second run, nor after a restart', async () => {
        seedRule();
        const task = seedTask();
        await tick();
        await tick(new Date(NOW.getTime() + 5 * 60 * 1000));
        matcher.invalidateAll();
        await tick(new Date(NOW.getTime() + 10 * 60 * 1000));
        expect(firedFor(task)).toHaveLength(1);
    });

    it('fires again once the due date is changed and the new one passes', async () => {
        seedRule();
        const task = seedTask();
        await tick();
        stored(task).DueDate = new Date(NOW.getTime() + HOUR);
        await tick();
        expect(firedFor(task)).toHaveLength(1);

        await tick(new Date(NOW.getTime() + 2 * HOUR));
        expect(firedFor(task)).toHaveLength(2);
    });

    it('announces nothing on the task socket for its own bookkeeping, so "task is updated" rules stay quiet', async () => {
        const emit = jest.spyOn(socketEmitter, 'emit');
        seedRule();
        seedTask();
        await tick();
        expect(emit).not.toHaveBeenCalled();
    });
});

describe('tasks it leaves alone', () => {
    it.each([
        ['a closed task', { statusType: 'close' }],
        ['a done task', { statusType: 'done' }],
        ['a deleted task', { deletedStatusKey: 1 }],
        ['an archived task', { deletedStatusKey: 2 }],
        ['a task due in the future', { DueDate: new Date(NOW.getTime() + HOUR) }],
        ['a task with no due date', { DueDate: null }],
        ['a direct message', { mainChat: true }],
    ])('%s', async (_label, over) => {
        seedRule();
        const task = seedTask(over);
        const out = await tick();
        expect(out.fired).toBe(0);
        expect(firedFor(task)).toHaveLength(0);
    });

    it('fires for a task reopened after its due date passed, once', async () => {
        seedRule();
        const task = seedTask({ statusType: 'close' });
        await tick();
        stored(task).statusType = 'active';
        await tick(new Date(NOW.getTime() + 5 * 60 * 1000));
        await tick(new Date(NOW.getTime() + 10 * 60 * 1000));
        expect(firedFor(task)).toHaveLength(1);
    });
});

describe('the work is bounded', () => {
    it('never looks further back than the look-back window, so a long outage does not flood', async () => {
        seedRule();
        const old = seedTask({ DueDate: ago(dueDates.LOOKBACK_MS + HOUR) });
        const recent = seedTask({ DueDate: ago(dueDates.LOOKBACK_MS - HOUR) });
        await tick();
        expect(firedFor(old)).toHaveLength(0);
        expect(firedFor(recent)).toHaveLength(1);
    });

    it('fires at most one batch per run, oldest first, and catches the rest up on the next run', async () => {
        seedRule();
        const tasks = Array.from({ length: dueDates.BATCH + 3 }, (_, i) => seedTask({ TaskKey: `WEB-${i}`, DueDate: ago(HOUR + i * 1000) }));
        const first = await tick();
        expect(first.fired).toBe(dueDates.BATCH);
        expect(firedFor(tasks[tasks.length - 1])).toHaveLength(1);
        expect(firedFor(tasks[0])).toHaveLength(0);

        const second = await tick(new Date(NOW.getTime() + 5 * 60 * 1000));
        expect(second.fired).toBe(3);
        expect(events.filter((e) => e.type === 'task.due_date_passed')).toHaveLength(dueDates.BATCH + 3);
    });

    it('reads no task when no enabled rule uses the trigger', async () => {
        seedRule({ enabled: false });
        seedRule({ trigger: { type: 'event', event: 'task.created' } });
        seedTask();
        const out = await tick();
        expect(out.fired).toBe(0);
        expect(mockDb.calls.filter((c) => c.type === SCHEMA_TYPE.TASKS)).toHaveLength(0);
    });

    it('does not fire for a due date that passed before the rule existed', async () => {
        seedRule({ createdAt: ago(30 * 60 * 1000) });
        const before = seedTask({ DueDate: ago(HOUR) });
        const after = seedTask({ DueDate: ago(10 * 60 * 1000) });
        await tick();
        expect(firedFor(before)).toHaveLength(0);
        expect(firedFor(after)).toHaveLength(1);
    });

    it('runs on an interval of at least a minute', () => {
        expect(dueDates.intervalMs()).toBeGreaterThanOrEqual(60 * 1000);
    });
});

describe('tenancy', () => {
    it('reads and writes only in the company it was asked to run for', async () => {
        seedRule();
        seedTask();
        await tick();
        expect(mockDb.calls.length).toBeGreaterThan(0);
        expect(mockDb.calls.every((c) => c.companyId === C)).toBe(true);
    });

    it('runs each company in turn', async () => {
        mockDb.seed(dbCollections.COMPANIES, { _id: C });
        seedRule();
        const task = seedTask();
        await dueDates.tickAll({ now: NOW });
        expect(firedFor(task)).toHaveLength(1);
        const tenantCalls = mockDb.calls.filter((c) => c.type !== dbCollections.COMPANIES);
        expect(tenantCalls.every((c) => c.companyId === C)).toBe(true);
    });
});
