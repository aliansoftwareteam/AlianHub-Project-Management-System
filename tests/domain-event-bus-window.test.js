const { EventEmitter } = require('events');

const mockEmitter = new EventEmitter();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn(async () => null) }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => mockEmitter);

const domainEventBus = require('../event/domainEventBus');

const C = '6f00000000000000000000c1';
const TASK = '6f00000000000000000000d1';
const OTHER_TASK = '6f00000000000000000000d2';

const taskDoc = (over = {}) => ({ _id: TASK, CompanyId: C, TaskKey: 'T-1', TaskName: 'Task', Task_Priority: 'LOW', statusType: 'open', ...over });

const emit = (type, doc, updatedFields, extra = {}) => mockEmitter.emit(type, { data: doc, updatedFields, ...extra });
const emitPriority = (priority, extra) => emit('task:update', taskDoc({ Task_Priority: priority }), { Task_Priority: priority }, extra);

let published = [];
const onEnvelope = (envelope) => published.push(envelope);

beforeAll(() => {
    domainEventBus.start();
    domainEventBus.bus.on('domain.event', onEnvelope);
});

afterAll(() => {
    domainEventBus.bus.off('domain.event', onEnvelope);
});

beforeEach(() => {
    jest.useFakeTimers();
    published = [];
});

afterEach(async () => {
    await jest.advanceTimersByTimeAsync(10000);
    jest.useRealTimers();
});

describe('domain event bus task window is fixed, not sliding', () => {
    it('publishes once per window while echo emits keep arriving every 500ms', async () => {
        const seen = [];
        for (let i = 0; i < 12; i += 1) {
            emitPriority('HIGH');
            await jest.advanceTimersByTimeAsync(500);
            seen.push(published.length);
        }

        expect(seen[2]).toBe(0);
        expect(seen[3]).toBe(1);
        expect(seen[7]).toBe(2);
        expect(seen[11]).toBe(3);
    });

    it('closes the window two seconds after its first emit, however late the last echo lands', async () => {
        emitPriority('HIGH');
        await jest.advanceTimersByTimeAsync(1900);
        emitPriority('HIGH');
        await jest.advanceTimersByTimeAsync(100);

        expect(published).toHaveLength(1);
    });

    it('carries the latest document and every field changed within the window in one envelope', async () => {
        emitPriority('HIGH');
        await jest.advanceTimersByTimeAsync(500);
        emit('task:update', taskDoc({ Task_Priority: 'HIGH', statusType: 'done' }), { statusType: 'done' });
        await jest.advanceTimersByTimeAsync(1500);

        expect(published).toHaveLength(1);
        const [envelope] = published;
        expect(envelope.type).toBe('task.status_changed');
        expect(envelope.data).toMatchObject({ Task_Priority: 'HIGH', statusType: 'done' });
        expect(envelope.changedFields.sort()).toEqual(['Task_Priority', 'statusType']);
    });

    it('publishes early when a field moves to a new value, and the new value gets a fresh window', async () => {
        emitPriority('HIGH');
        await jest.advanceTimersByTimeAsync(500);
        emitPriority('URGENT');

        expect(published).toHaveLength(1);
        expect(published[0].data.Task_Priority).toBe('HIGH');

        await jest.advanceTimersByTimeAsync(1900);
        expect(published).toHaveLength(1);

        await jest.advanceTimersByTimeAsync(100);
        expect(published).toHaveLength(2);
        expect(published[1].data.Task_Priority).toBe('URGENT');
    });

    it('keeps different tasks and different emit types in their own windows', async () => {
        emitPriority('HIGH');
        emit('task:update', taskDoc({ _id: OTHER_TASK, TaskKey: 'T-2', Task_Priority: 'HIGH' }), { Task_Priority: 'HIGH' });
        emit('task:insert', taskDoc(), undefined);
        await jest.advanceTimersByTimeAsync(2000);

        const sent = published.map((e) => `${e.entity.id}:${e.type}`).sort();
        expect(sent).toEqual([`${TASK}:task.created`, `${TASK}:task.priority_changed`, `${OTHER_TASK}:task.priority_changed`].sort());
    });

    it('keeps the deepest emit\'s actor and depth, so a later shallower echo cannot lower the loop count', async () => {
        emitPriority('HIGH', { actor: { kind: 'automation' }, depth: 2 });
        await jest.advanceTimersByTimeAsync(500);
        emit('task:update', taskDoc({ Task_Priority: 'HIGH', TaskName: 'Renamed' }), { TaskName: 'Renamed' }, { actor: { kind: 'user', userId: 'u1' }, depth: 0 });
        await jest.advanceTimersByTimeAsync(1500);

        expect(published).toHaveLength(1);
        expect(published[0]).toMatchObject({ depth: 2, actor: { kind: 'automation', userId: null } });
    });

    it('takes the latest actor when emits in the window are equally deep', async () => {
        emitPriority('HIGH', { actor: { kind: 'user', userId: 'u1' }, depth: 0 });
        await jest.advanceTimersByTimeAsync(500);
        emitPriority('HIGH', { actor: { kind: 'user', userId: 'u2' }, depth: 0 });
        await jest.advanceTimersByTimeAsync(1500);

        expect(published).toHaveLength(1);
        expect(published[0].actor).toEqual({ kind: 'user', userId: 'u2' });
    });
});
