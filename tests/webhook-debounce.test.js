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
