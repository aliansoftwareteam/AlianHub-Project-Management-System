/* bulkUpdateDates: the Gantt's one write for a move that shifts its dependants, and for its undo. */
const mongoose = require('mongoose');

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Modules/Tasks/helpers/mongo_helper', () => ({ HandleHistory: jest.fn(() => Promise.resolve()) }));
jest.mock('../Modules/Tasks/helpers/handleNotification', () => ({ HandleBothNotification: jest.fn() }));
jest.mock('../Modules/Tasks/helpers/taskMongo/recordCompletion.js', () => ({ recordCompletion: jest.fn() }));
jest.mock('../Modules/Tasks/helpers/notificationTemplate', () => ({
    taskAssigneeAdd: jest.fn(), taskAssigneeRemove: jest.fn(), taskAssigneeReplace: jest.fn(),
    taskStatusChange: jest.fn(), taskPriorityChange: jest.fn()
}));

const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const socketEmitter = require('../event/socketEventEmitter');
const { HandleHistory } = require('../Modules/Tasks/helpers/mongo_helper');
const bulk = require('../Modules/Tasks/helpers/taskMongo/bulk');
const { TASK_ACTIONS } = require('../Config/taskWritePermissions');
const { TASK_ACTION_FIELDS } = require('../Modules/Tasks/helpers/taskWriteFields');

const COMPANY = 'c1';
const PROJECT = new mongoose.Types.ObjectId();
const A = new mongoose.Types.ObjectId();
const B = new mongoose.Types.ObjectId();
const FOREIGN = new mongoose.Types.ObjectId();
const USER = { id: 'u1', Employee_Name: 'Max' };

const stored = (id) => ({ _id: id, ProjectID: PROJECT, sprintId: 's1', TaskName: 'T', AssigneeUserId: ['u1'], startDate: new Date('2026-09-01'), DueDate: new Date('2026-09-03') });

beforeEach(() => {
    jest.clearAllMocks();
    MongoDbCrudOpration.mockImplementation(async (companyId, query, method) => {
        if (query.type === 'tasks' && method === 'find') return [stored(A), stored(B)];
        if (query.type === 'tasks' && method === 'bulkWrite') return { modifiedCount: query.data[0].length };
        if (query.type === 'projects' && method === 'findOne') return { _id: PROJECT, ProjectName: 'P' };
        return null;
    });
});

const dates = [
    { taskId: String(A), startDate: '2026-09-02T00:00:00.000Z', DueDate: '2026-09-04T00:00:00.000Z' },
    { taskId: String(B), startDate: '2026-09-04T00:00:00.000Z', DueDate: '2026-09-06T00:00:00.000Z' },
];

const callsOf = (method) => MongoDbCrudOpration.mock.calls.filter(([, , m]) => m === method);

describe('bulkUpdateDates', () => {
    test('writes every task\'s own dates in one bulk write', async () => {
        const result = await bulk.bulkUpdateDates({ companyId: COMPANY, userData: USER, dates });
        const writes = callsOf('bulkWrite');
        expect(writes).toHaveLength(1);
        const [companyId, query] = writes[0];
        expect(companyId).toBe(COMPANY);
        expect(query.type).toBe('tasks');
        expect(query.data[0]).toEqual([
            { updateOne: { filter: { _id: A }, update: { $set: { startDate: new Date(dates[0].startDate), DueDate: new Date(dates[0].DueDate) } } } },
            { updateOne: { filter: { _id: B }, update: { $set: { startDate: new Date(dates[1].startDate), DueDate: new Date(dates[1].DueDate) } } } },
        ]);
        expect(result.totals).toEqual({ updated: 2, skipped: 0, errors: 0 });
    });

    test('emits an update per task, one summary, and records history', async () => {
        await bulk.bulkUpdateDates({ companyId: COMPANY, userData: USER, dates });
        const updates = socketEmitter.emit.mock.calls.filter(([name]) => name === 'update');
        expect(updates).toHaveLength(2);
        expect(updates[0][1]).toMatchObject({
            type: 'update',
            module: 'task',
            updatedFields: { startDate: new Date(dates[0].startDate), DueDate: new Date(dates[0].DueDate) },
            data: { sprintId: 's1', DueDate: new Date(dates[0].DueDate) },
        });
        expect(String(updates[0][1].data._id)).toBe(String(A));
        expect(socketEmitter.emit).toHaveBeenCalledWith('bulkUpdate', expect.objectContaining({ action: 'bulkUpdateDates', taskIds: [String(A), String(B)] }));
        expect(HandleHistory).toHaveBeenCalledTimes(2);
        expect(HandleHistory).toHaveBeenCalledWith('task', COMPANY, PROJECT, A, expect.objectContaining({ key: 'Project_DueDate', sprintId: 's1' }), USER);
    });

    test('the lookup is company-scoped and leaves out trashed and archived tasks', async () => {
        await bulk.bulkUpdateDates({ companyId: COMPANY, userData: USER, dates });
        const [[companyId, query]] = callsOf('find');
        expect(companyId).toBe(COMPANY);
        expect(query.data[0].deletedStatusKey).toEqual({ $nin: [1, 2] });
    });

    test('ids the company does not own are skipped and never written', async () => {
        const result = await bulk.bulkUpdateDates({
            companyId: COMPANY, userData: USER,
            dates: [...dates, { taskId: String(FOREIGN), startDate: dates[0].startDate, DueDate: dates[0].DueDate }],
        });
        expect(callsOf('bulkWrite')[0][1].data[0]).toHaveLength(2);
        expect(result.skipped).toEqual([{ taskId: String(FOREIGN), reason: 'not-found-or-cross-tenant' }]);
    });

    test.each([
        ['no dates', []],
        ['a list that is not one', { taskId: String(A) }],
        ['an unreadable date', [{ taskId: String(A), startDate: 'soon', DueDate: dates[0].DueDate }]],
        ['a missing date', [{ taskId: String(A), startDate: dates[0].startDate }]],
        ['a due date before the start', [{ taskId: String(A), startDate: dates[0].DueDate, DueDate: dates[0].startDate }]],
        ['the same task twice', [dates[0], dates[0]]],
    ])('refuses %s before writing anything', async (_, value) => {
        await expect(bulk.bulkUpdateDates({ companyId: COMPANY, userData: USER, dates: value })).rejects.toThrow();
        expect(callsOf('bulkWrite')).toHaveLength(0);
    });

    test('refuses more tasks than one move can reach', async () => {
        const many = Array.from({ length: 501 }, () => ({ taskId: String(new mongoose.Types.ObjectId()), startDate: dates[0].startDate, DueDate: dates[0].DueDate }));
        await expect(bulk.bulkUpdateDates({ companyId: COMPANY, userData: USER, dates: many })).rejects.toThrow();
    });

    test('companyId is required', async () => {
        await expect(bulk.bulkUpdateDates({ userData: USER, dates })).rejects.toThrow('companyId required');
    });

    test('needs the due-date key in every project the named tasks live in', () => {
        const entry = TASK_ACTIONS.bulkUpdateDates;
        expect(entry.needs.map((need) => need.key)).toEqual(['task.task_due_date']);
        expect(entry.tasks).toEqual([['dates', '*', 'taskId']]);
        expect(TASK_ACTION_FIELDS.bulkUpdateDates.ids).toEqual([['dates', '*', 'taskId']]);
        expect(TASK_ACTION_FIELDS.bulkUpdateDates.params).toEqual(['companyId', 'dates', 'userData']);
    });
});
