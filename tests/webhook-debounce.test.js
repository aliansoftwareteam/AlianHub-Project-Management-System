const { EventEmitter } = require('events');

const mockDb = require('./fixtures/fakeMongo').create();
const mockEmitter = new EventEmitter();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => mockEmitter);
jest.mock('../Modules/Agents/engine/safeFetch', () => ({ safeFetch: jest.fn(async () => ({ status: 200, data: 'ok' })) }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { safeFetch } = require('../Modules/Agents/engine/safeFetch');
const dispatcher = require('../Modules/Webhooks/dispatcher');

const C = '6f00000000000000000000c1';
const TASK = '6f00000000000000000000d1';
const OTHER_TASK = '6f00000000000000000000d2';

const taskDoc = (priority) => ({
    _id: TASK,
    CompanyId: C,
    TaskKey: 'T-1',
    TaskName: 'Fix the thing',
    Task_Priority: priority,
    ProjectID: '6f00000000000000000000a1',
    sprintId: '6f00000000000000000000b1',
    deletedStatusKey: 0,
    createdAt: new Date('2026-01-01T00:00:00Z'),
});

const emitUpdate = (priority) => mockEmitter.emit('task:update', {
    data: taskDoc(priority),
    updatedFields: { Task_Priority: priority },
});

const emitFor = (type, doc, updatedFields) => mockEmitter.emit(type, { data: doc, updatedFields });

const storedTask = (id = TASK) => mockDb.store[SCHEMA_TYPE.TASKS].find((t) => String(t._id) === id);

const deliveries = () => safeFetch.mock.calls.map(([, options]) => JSON.parse(options.data));

const flushAsync = async () => { for (let i = 0; i < 50; i += 1) await Promise.resolve(); };

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    jest.clearAllMocks();
    mockDb.seed(SCHEMA_TYPE.WEBHOOKS, {
        name: 'qa', url: 'https://hooks.example.test/x', events: ['*'], secret: 's'.repeat(40),
        format: 'json', active: true,
    });
    mockDb.seed(SCHEMA_TYPE.TASKS, taskDoc('URGENT'));
});

describe('webhook debounce', () => {
    beforeEach(() => {
        jest.useFakeTimers();
        dispatcher.start();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('collapses the echo emits of one write into a single delivery', async () => {
        emitUpdate('HIGH');
        emitUpdate('HIGH');
        await flushAsync();
        expect(safeFetch).not.toHaveBeenCalled();

        await jest.advanceTimersByTimeAsync(2000);
        expect(safeFetch).toHaveBeenCalledTimes(1);
    });

    it('delivers the pending change at once when the same field moves again', async () => {
        emitUpdate('HIGH');
        emitUpdate('URGENT');
        await flushAsync();
        expect(safeFetch).toHaveBeenCalledTimes(1);

        await jest.advanceTimersByTimeAsync(2000);
        expect(safeFetch).toHaveBeenCalledTimes(2);
    });
});

describe('webhook debounce window is fixed, not sliding', () => {
    beforeEach(() => {
        jest.useFakeTimers();
        dispatcher.start();
    });

    afterEach(async () => {
        await jest.advanceTimersByTimeAsync(10000);
        jest.useRealTimers();
    });

    it('delivers once per window while echo emits keep arriving every 500ms', async () => {
        const seen = [];
        for (let i = 0; i < 12; i += 1) {
            emitUpdate('HIGH');
            await jest.advanceTimersByTimeAsync(500);
            seen.push(safeFetch.mock.calls.length);
        }

        expect(seen[3]).toBe(1);
        expect(seen[7]).toBe(2);
        expect(seen[11]).toBe(3);
    });

    it('closes the window two seconds after its first emit, however late the last echo lands', async () => {
        emitUpdate('HIGH');
        await jest.advanceTimersByTimeAsync(1900);
        emitUpdate('HIGH');
        await jest.advanceTimersByTimeAsync(100);

        expect(safeFetch).toHaveBeenCalledTimes(1);
    });

    it('delivers the task as stored when the window closes, naming every field changed within it', async () => {
        storedTask().Task_Priority = 'HIGH';
        emitUpdate('HIGH');
        await jest.advanceTimersByTimeAsync(500);
        storedTask().TaskName = 'Renamed';
        emitFor('task:update', { ...taskDoc('HIGH'), TaskName: 'Renamed' }, { TaskName: 'Renamed' });
        await jest.advanceTimersByTimeAsync(1500);

        expect(safeFetch).toHaveBeenCalledTimes(1);
        const [body] = deliveries();
        expect(body.data).toMatchObject({ Task_Priority: 'HIGH', TaskName: 'Renamed' });
        expect(body.changedFields).toEqual(expect.arrayContaining(['Task_Priority', 'TaskName']));
    });

    it('keeps different tasks and different events in their own windows', async () => {
        mockDb.seed(SCHEMA_TYPE.TASKS, { ...taskDoc('LOW'), _id: OTHER_TASK, TaskKey: 'T-2' });
        emitUpdate('HIGH');
        emitFor('task:update', { ...taskDoc('LOW'), _id: OTHER_TASK, TaskKey: 'T-2' }, { Task_Priority: 'LOW' });
        emitFor('task:insert', taskDoc('HIGH'), undefined);
        await jest.advanceTimersByTimeAsync(2000);

        const sent = deliveries().map((body) => `${body.data._id}:${body.event}`).sort();
        expect(sent).toEqual([`${TASK}:task.created`, `${TASK}:task.updated`, `${OTHER_TASK}:task.updated`]);
    });
});
