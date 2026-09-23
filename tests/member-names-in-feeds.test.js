const { EventEmitter } = require('events');

const mockDb = require('./fixtures/fakeMongo').create();
const mockEmitter = new EventEmitter();
const mockChat = jest.fn(async () => ({ content: '{"summary":"ok"}' }));

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => mockEmitter);
jest.mock('../Modules/Agents/engine/safeFetch', () => ({ safeFetch: jest.fn(async () => ({ status: 200, data: 'ok' })) }));
jest.mock('../Modules/AI/taskAccess', () => ({ visibleTask: jest.fn(async () => ({ _id: '6f00000000000000000000d1', TaskName: 'Ship it' })), TASK_NOT_FOUND: 'Task not found' }));
jest.mock('../Modules/AICore/llmProvider', () => ({ isAnyProviderConfigured: () => true, getProvider: () => ({ chat: mockChat }) }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { myCache } = require('../Config/config');
const { safeFetch } = require('../Modules/Agents/engine/safeFetch');
const dispatcher = require('../Modules/Webhooks/dispatcher');
const { summarizeTask } = require('../Modules/AI/taskSummary');

const COMPANY = '6f00000000000000000000c1';
const TASK = '6f00000000000000000000d1';
const MEMBER = '6f0000000000000000000002';
const OUTSIDER = '6f0000000000000000000009';
const UNKNOWN = '6f00000000000000000000ff';

const flushAsync = async () => { for (let i = 0; i < 50; i += 1) await Promise.resolve(); };

const taskDoc = (assignees) => ({
    _id: TASK,
    CompanyId: COMPANY,
    TaskKey: 'T-1',
    TaskName: 'Ship it',
    AssigneeUserId: assignees,
    ProjectID: '6f00000000000000000000a1',
    sprintId: '6f00000000000000000000b1',
    deletedStatusKey: 0,
    createdAt: new Date('2026-01-01T00:00:00Z'),
});

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    jest.clearAllMocks();
    myCache.flushAll();
    mockDb.seed(SCHEMA_TYPE.USERS, { _id: MEMBER, Employee_Name: 'Mia Member' });
    mockDb.seed(SCHEMA_TYPE.USERS, { _id: OUTSIDER, Employee_Name: 'Otto Outsider' });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: MEMBER, status: 2, isDelete: false });
    // Invited but never accepted: the row names the account without making it a member.
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: OUTSIDER, status: 1, isDelete: false });
});

describe('task webhooks', () => {
    beforeAll(() => dispatcher.start());
    beforeEach(() => {
        jest.useFakeTimers();
        mockDb.seed(SCHEMA_TYPE.WEBHOOKS, { name: 'qa', url: 'https://hooks.example.test/x', events: ['*'], secret: 's'.repeat(40), format: 'json', active: true });
    });
    afterEach(() => jest.useRealTimers());

    const deliver = async (assignees) => {
        mockDb.store[SCHEMA_TYPE.TASKS] = [taskDoc(assignees)];
        mockEmitter.emit('task:insert', { data: taskDoc(assignees) });
        await flushAsync();
        await jest.advanceTimersByTimeAsync(2000);
        const calls = safeFetch.mock.calls;
        return JSON.parse(calls[calls.length - 1][1].data);
    };

    it('names a member assignee and nobody from outside the company', async () => {
        const body = await deliver([MEMBER, OUTSIDER, UNKNOWN]);

        expect(body.data.assigneeNames).toEqual(['Mia Member']);
        expect(JSON.stringify(body)).not.toContain('Otto');
    });
});

describe('task thread summary', () => {
    const summarise = async (authorId) => {
        mockDb.store[SCHEMA_TYPE.COMMENTS] = [];
        const crud = mockDb.crud.getMockImplementation();
        mockDb.crud.mockImplementation(async (db, obj, method) => {
            if (obj.type === SCHEMA_TYPE.COMMENTS && method === 'aggregate') {
                const counting = obj.data[0].some((stage) => stage.$count);
                return counting ? [{ count: 1 }] : [{ userId: authorId, message: 'Looks good', createdAt: new Date('2026-09-01') }];
            }
            return crud(db, obj, method);
        });
        try {
            await summarizeTask({ companyId: COMPANY, uid: MEMBER, taskId: TASK, force: true });
        } finally {
            mockDb.crud.mockImplementation(crud);
        }
        return mockChat.mock.calls.at(-1)[0].messages[0].content;
    };

    it('names a comment author from outside the company exactly as an unknown one', async () => {
        const outsider = await summarise(OUTSIDER);
        const unknown = await summarise(UNKNOWN);

        expect(outsider).toBe(unknown);
        expect(outsider).not.toContain('Otto');
    });

    it('still names a member who commented', async () => {
        expect(await summarise(MEMBER)).toContain('Mia Member');
    });
});
