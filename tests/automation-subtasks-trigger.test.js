process.env.AUTOMATION_QUEUE_DRIVER = 'inline';
const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { schema } = require('../utils/mongo-handler/schema');
const socketEmitter = require('../event/socketEventEmitter');
const domainEventBus = require('../event/domainEventBus');
const registry = require('../Modules/Automations/engine/registry');
const matcher = require('../Modules/Automations/engine/matcher');
const subtasks = require('../Modules/Automations/engine/subtaskTrigger');

const C = '6f0000000000000000000c01';
const PROJECT = '6f0000000000000000000a01';
const PARENT = '6f0000000000000000000d01';
const USER = '6f0000000000000000000011';
const EVENT = 'task.subtasks_all_done';

let events;
const record = (envelope) => { events.push(envelope); };
const allDone = () => events.filter((e) => e.type === EVENT);

const seedParent = (over = {}) => mockDb.seed(SCHEMA_TYPE.TASKS, {
    _id: PARENT, TaskName: 'Launch', TaskKey: 'WEB-1', CompanyId: C, ProjectID: PROJECT, sprintId: 'sp1',
    isParentTask: true, statusType: 'active', deletedStatusKey: 0, AssigneeUserId: [], ...over,
});

const seedSubtask = (over = {}) => mockDb.seed(SCHEMA_TYPE.TASKS, {
    TaskName: 'Write copy', TaskKey: 'WEB-1-a', CompanyId: C, ProjectID: PROJECT, sprintId: 'sp1',
    isParentTask: false, ParentTaskId: PARENT, statusType: 'active', deletedStatusKey: 0, AssigneeUserId: [], ...over,
});

const stored = (task) => mockDb.store[SCHEMA_TYPE.TASKS].find((t) => String(t._id) === String(task._id));

const envelopeOf = (task, { type = 'task.status_changed', changed = ['statusType', 'status', 'statusKey'], previous = null, actor = { kind: 'user', userId: USER }, depth = 0 } = {}) => domainEventBus.buildEnvelope({
    companyId: C, type, doc: stored(task), changedFields: new Set(changed), previous, actor, depth,
});

/* Moves the stored subtask and answers the envelope the bus would publish for it. */
const move = (task, statusType, options = {}) => {
    const previous = options.previous === undefined ? domainEventBus.trimTask(stored(task)) : options.previous;
    stored(task).statusType = statusType;
    return envelopeOf(task, { ...options, previous });
};

const close = (task, options) => subtasks.onEnvelope(move(task, 'close', options));
const reopen = (task, options) => subtasks.onEnvelope(move(task, 'active', options));

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
    jest.useRealTimers();
});

describe('the trigger is registered', () => {
    it('is offered as a task trigger that carries no before and after', () => {
        expect(registry.getTrigger(EVENT)).toMatchObject({ entity: 'task', hasDiff: false });
    });

    it('keeps its state in a field the task schema declares', () => {
        expect(schema.tasks.subtasksAllDone).toBeDefined();
    });

    it('an envelope names the parent of a subtask', () => {
        expect(domainEventBus.trimTask({ _id: 'a1', ParentTaskId: PARENT }).ParentTaskId).toBe(PARENT);
    });
});

describe('closing the last open subtask', () => {
    it('publishes one event on the parent, carrying who closed it and how deep the change was', async () => {
        seedParent();
        const first = seedSubtask({ statusType: 'done' });
        const last = seedSubtask({ TaskKey: 'WEB-1-b' });
        await close(last);

        expect(allDone()).toHaveLength(1);
        expect(allDone()[0]).toMatchObject({
            companyId: C,
            actor: { kind: 'user', userId: USER },
            depth: 0,
            entity: { kind: 'task', id: PARENT, key: 'WEB-1' },
            scope: { projectId: PROJECT },
            data: { TaskName: 'Launch', isParentTask: true },
        });
        expect(first.statusType).toBe('done');
    });

    it('matches a rule on that trigger', async () => {
        const rule = mockDb.seed(SCHEMA_TYPE.AUTOMATION_RULES, {
            name: 'Close parent', version: 2, enabled: true, deletedStatusKey: 0,
            trigger: { type: 'event', event: EVENT }, scope: { allProjects: true, projectIds: [] }, conditions: {},
            steps: [{ id: 's1', type: 'action', action: 'set_status', config: { status: 'Done' } }],
        });
        seedParent();
        await close(seedSubtask());
        expect((await matcher.match(C, allDone()[0])).map((r) => String(r._id))).toEqual([String(rule._id)]);
    });

    it('stays quiet while another subtask is still open', async () => {
        seedParent();
        seedSubtask({ TaskKey: 'WEB-1-b' });
        await close(seedSubtask());
        expect(allDone()).toHaveLength(0);
    });

    it('ignores deleted and archived subtasks when it counts what is open', async () => {
        seedParent();
        seedSubtask({ TaskKey: 'WEB-1-b', deletedStatusKey: 1 });
        seedSubtask({ TaskKey: 'WEB-1-c', deletedStatusKey: 2 });
        await close(seedSubtask());
        expect(allDone()).toHaveLength(1);
    });
});

describe('only the move from some open to none open fires', () => {
    it('never fires for a task that has no subtasks', async () => {
        const parent = seedParent();
        await subtasks.onEnvelope(move(parent, 'close'));
        expect(allDone()).toHaveLength(0);
    });

    it('does not fire when a closed subtask moves to another closed status', async () => {
        seedParent();
        const only = seedSubtask();
        await close(only);
        await subtasks.onEnvelope(move(only, 'done'));
        expect(allDone()).toHaveLength(1);
    });

    it('does not fire for a closed-to-closed move on a parent it has never seen', async () => {
        seedParent();
        const only = seedSubtask({ statusType: 'close' });
        await subtasks.onEnvelope(move(only, 'done'));
        expect(allDone()).toHaveLength(0);
    });

    it('fires again when a subtask is reopened and closed again', async () => {
        seedParent();
        const only = seedSubtask();
        await close(only);
        await reopen(only);
        expect(allDone()).toHaveLength(1);
        await close(only);
        expect(allDone()).toHaveLength(2);
    });

    it('fires again after a new subtask is added to a finished parent and closed', async () => {
        seedParent();
        await close(seedSubtask());
        const added = seedSubtask({ TaskKey: 'WEB-1-b' });
        await subtasks.onEnvelope(envelopeOf(added, { type: 'task.created', changed: [] }));
        await close(added);
        expect(allDone()).toHaveLength(2);
    });

    it('fires once when the last two subtasks are closed together', async () => {
        seedParent();
        const a = seedSubtask();
        const b = seedSubtask({ TaskKey: 'WEB-1-b' });
        const envelopes = [move(a, 'close'), move(b, 'close')];
        await Promise.all(envelopes.map((e) => subtasks.onEnvelope(e)));
        expect(allDone()).toHaveLength(1);
    });

    it('does not fire when the last open subtask is deleted rather than closed', async () => {
        seedParent();
        seedSubtask({ statusType: 'close' });
        const open = seedSubtask({ TaskKey: 'WEB-1-b' });
        stored(open).deletedStatusKey = 1;
        await subtasks.onEnvelope(envelopeOf(open, { type: 'task.updated', changed: ['deletedStatusKey'] }));
        expect(allDone()).toHaveLength(0);
    });
});

describe('agent and automation writes, and the loop guard', () => {
    it('carries an automation author and its depth onto the parent event', async () => {
        seedParent();
        await close(seedSubtask(), { actor: { kind: 'automation', userId: null }, depth: 2 });
        expect(allDone()[0]).toMatchObject({ actor: { kind: 'automation' }, depth: 2 });
        expect(matcher.acceptsActor({ reactToAutomation: false }, allDone()[0])).toBe(false);
        expect(matcher.acceptsActor({ reactToAutomation: true }, allDone()[0])).toBe(true);
    });

    it('carries an agent author too', async () => {
        seedParent();
        await close(seedSubtask(), { actor: { kind: 'agent', userId: null }, depth: 1 });
        expect(allDone()[0]).toMatchObject({ actor: { kind: 'agent' }, depth: 1 });
    });

    it('publishes nothing deeper than the bus allows', async () => {
        seedParent();
        await close(seedSubtask(), { actor: { kind: 'automation', userId: null }, depth: domainEventBus.MAX_DEPTH + 1 });
        expect(allDone()).toHaveLength(0);
    });
});

describe('where it is hooked', () => {
    it('announces nothing on the task socket for its own bookkeeping', async () => {
        const emit = jest.spyOn(socketEmitter, 'emit');
        seedParent();
        await close(seedSubtask());
        expect(emit).not.toHaveBeenCalled();
    });

    it('does not mark the parent as edited when it records that it fired', async () => {
        seedParent();
        await close(seedSubtask());
        const writes = mockDb.calls.filter((c) => c.type === SCHEMA_TYPE.TASKS && c.method !== 'find');
        expect(writes.length).toBeGreaterThan(0);
        writes.forEach((write) => expect(write.data[2]).toMatchObject({ timestamps: false }));
    });

    it('reads and writes only in the company of the event', async () => {
        seedParent();
        await close(seedSubtask());
        expect(mockDb.calls.length).toBeGreaterThan(0);
        expect(mockDb.calls.every((c) => c.companyId === C)).toBe(true);
    });

    it('listens on the bus once the engine has started, so a bulk status change reaches it', async () => {
        const engine = require('../Modules/Automations/engine');
        domainEventBus.start();
        await engine.start();
        try {
            seedParent();
            const tasks = [seedSubtask(), seedSubtask({ TaskKey: 'WEB-1-b' })];
            jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
            tasks.forEach((task) => {
                stored(task).statusType = 'close';
                socketEmitter.emit('update', { type: 'update', module: 'task', data: { ...stored(task) }, updatedFields: { statusType: 'close' } });
            });
            jest.advanceTimersByTime(2000);
            jest.useRealTimers();
            await new Promise((resolve) => { setTimeout(resolve, 30); });
            expect(allDone()).toHaveLength(1);
            expect(allDone()[0].entity.id).toBe(PARENT);
        } finally {
            jest.useRealTimers();
            await engine.stop();
        }
    });
});
