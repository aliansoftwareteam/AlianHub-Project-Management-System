/* A file imported again with "update", and an import undone, through the real controller and the real task write path on
 * the in-memory database. */
const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (companyId, q, method) => mockDb.crud(companyId, q, method),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0 } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../Config/tenant', () => ({ pinSessionTenant: (req) => req.headers.companyid }));
const mockStub = () => new Proxy({}, {
    get: (target, name) => {
        if (name === 'then' || name === '__esModule') return undefined;
        target[name] = target[name] || jest.fn(() => Promise.resolve({}));
        return target[name];
    },
});
jest.mock('../Modules/Sprints/controller', () => mockStub());
jest.mock('../Modules/Tasks/helpers/handleNotification', () => mockStub());
jest.mock('../Modules/Company/eventController', () => mockStub());
jest.mock('../Modules/Company/controller/updateCompany', () => mockStub());
jest.mock('../Modules/notification-count/controller', () => mockStub());
jest.mock('../Modules/Comments/controller', () => mockStub());
jest.mock('../Modules/MainChats/controller', () => mockStub());
jest.mock('../Modules/LogTime/controllerV2.js', () => mockStub());
jest.mock('../utils/planHelper', () => mockStub());
jest.mock('../utils/commonFunctions.js', () => mockStub());
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../common-storage/common-server.js', () => mockStub());
process.env.STORAGE_TYPE = 'server';

const mongoHelper = require('../Modules/Tasks/helpers/mongo_helper');
const socketEmitter = require('../event/socketEventEmitter');
const taskNotices = require('../Modules/Tasks/helpers/handleNotification');
const domainEventBus = require('../event/domainEventBus');
const matcher = require('../Modules/Automations/engine/matcher');
const assignmentRules = require('../Modules/AssignmentRules/engine');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const importers = require('../Modules/Importers/controller');
const { taskMongo } = require('../Modules/Tasks/helpers/task_class_Mongo');
const guardFixture = require('./fixtures/taskWriteGuard');

mongoHelper.getTotalSprintCount = async () => true;

const { CID, OWNER, OPEN_PROJECT: PROJECT } = guardFixture;
const OTHER_PROJECT = '6f0000000000000000000a09';
const SPRINT = '6f0000000000000000000e01';
const guard = guardFixture.create(mockDb);
const settle = async () => { for (let i = 0; i < 40; i += 1) await new Promise((resolve) => setImmediate(resolve)); };

const STATUSES = [{ name: 'To Do', key: 1, type: 'default_active' }, { name: 'In Progress', key: 2, type: 'active' }, { name: 'Done', key: 3, type: 'close' }];
const DONE = STATUSES[2];
const LIST = { 'List Name': 'Website relaunch', 'Folder Name': 'Marketing', 'Space Name': 'Acme' };
const fileRows = (statuses = {}) => [
    { ...LIST, 'Task ID': 'c1', 'Task Name': 'Write the copy', Status: statuses.c1 === undefined ? 'to do' : statuses.c1, 'Story Points (number)': '3' },
    { ...LIST, 'Task ID': 'c2', 'Task Name': 'Draw the hero', Status: statuses.c2 === undefined ? 'to do' : statuses.c2 },
    { ...LIST, 'Task ID': 'c3', 'Task Name': 'Book the venue', Status: statuses.c3 === undefined ? 'in progress' : statuses.c3 },
];

const store = (type) => mockDb.store[type] || [];
const taskNamed = (name) => store(SCHEMA_TYPE.TASKS).find((task) => task.TaskName === name);
const historyOf = (name) => store(SCHEMA_TYPE.HISTORY)
    .filter((line) => String(line.TaskId) === String(taskNamed(name)._id) && line.Key !== 'Task_Created')
    .map(({ Type, Key, UserId, ProjectId, Message }) => ({ Type, Key, UserId: String(UserId), ProjectId: String(ProjectId), Message }));
const withoutTimes = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value, (key, entry) => (key === 'at' ? undefined : entry))));
const statusOutcome = (name) => {
    const task = taskNamed(name);
    return {
        status: task.status,
        statusKey: task.statusKey,
        statusType: task.statusType,
        onTheBoardAt: task.groupByStatusIndex,
        completion: withoutTimes(task.completion),
        history: historyOf(name),
    };
};
const taskEmits = (name) => socketEmitter.emit.mock.calls
    .map(([, payload]) => payload)
    .filter((payload) => payload && payload.module === 'task' && payload.data && String(payload.data._id) === String(taskNamed(name)._id));

const call = async (handler, body, params = {}) => {
    const res = { code: 200 };
    res.status = (code) => { res.code = code; return res; };
    res.send = (payload) => { res.body = payload; return res; };
    res.json = res.send;
    await handler({ uid: OWNER, headers: { companyid: CID }, body, params, query: {} }, res);
    await settle();
    return res;
};

const importFile = async (options, rows = fileRows()) => (await call(importers.importFromClickUp, { rows, projectId: PROJECT, sprintId: SPRINT, options })).body;
const updateFrom = (rows, options = {}) => importFile({ createMissingStatuses: true, existing: 'update', ...options }, rows);

const moveByHand = async (name, status) => {
    const task = taskNamed(name);
    await taskMongo.updateStatus({
        newStatus: { status: { text: status.name, key: status.key, type: status.type }, statusKey: status.key, statusType: status.type },
        prevStatus: { taskId: String(task._id), statusName: task.status.text, updatedTaskName: status.name },
        projectData: { _id: PROJECT, CompanyId: CID, ProjectName: 'Website' },
        task: { _id: String(task._id), sprintId: task.sprintId, statusType: task.statusType, status: task.status },
        userData: { id: OWNER, Employee_Name: 'Olivia Owner' },
        isUpdateTask: true,
    });
    await settle();
};

beforeEach(async () => {
    guard.reset();
    Object.assign(store(SCHEMA_TYPE.PROJECTS).find((row) => row._id === PROJECT), {
        ProjectName: 'Website', ProjectCode: 'WEB', CompanyId: CID, lastTaskId: 0, taskStatusData: STATUSES.map((status) => ({ ...status })), tagsArray: [],
    });
    mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: SPRINT, name: 'From ClickUp', projectId: PROJECT });
    mockDb.seed(SCHEMA_TYPE.USERS, { _id: OWNER, Employee_Name: 'Olivia Owner', Employee_Email: 'olivia.owner@example.test' });
    await importFile({ createMissingStatuses: true });
    store(SCHEMA_TYPE.TASKS).filter((task) => task.TaskName).forEach((task) => { task.groupByStatusIndex = 7; });
    jest.clearAllMocks();
    mockDb.calls.length = 0;
});

describe('a status the file changed, on a task that is already here', () => {
    it('is stored as a person\'s status change is: the status, the place on the board, who closed it and the history line', async () => {
        await moveByHand('Draw the hero', DONE);
        const byHand = statusOutcome('Draw the hero');
        expect(byHand).toMatchObject({ statusKey: 3, statusType: 'close', onTheBoardAt: undefined, completion: { closedBy: { actorId: OWNER, actorType: 'human' } } });
        expect(byHand.history).toHaveLength(1);

        const out = await updateFrom(fileRows({ c1: 'complete' }));

        expect(out).toMatchObject({ status: true, data: { created: 0, updated: 3 } });
        expect(statusOutcome('Write the copy')).toEqual(byHand);
    });

    it('notifies no one, and its events say an import made them, which no automation and no assignment rule answers', async () => {
        await updateFrom(fileRows({ c1: 'complete' }));

        expect(taskNotices.HandleBothNotification).not.toHaveBeenCalled();
        const emits = taskEmits('Write the copy');
        expect(emits.some((payload) => 'statusKey' in payload.updatedFields)).toBe(true);
        expect(emits.some((payload) => 'completion' in payload.updatedFields)).toBe(true);
        emits.forEach((payload) => {
            const envelope = { companyId: CID, type: 'task.status_changed', entity: { kind: 'task', id: String(payload.data._id) }, changedFields: Object.keys(payload.updatedFields), actor: domainEventBus.resolveActor(payload) };
            expect(envelope.actor).toEqual({ kind: 'import', userId: OWNER });
            expect(matcher.acceptsActor({ reactToAutomation: false }, envelope)).toBe(false);
            expect(matcher.acceptsActor({ reactToAutomation: true }, envelope)).toBe(false);
            expect(assignmentRules.triggerOf(envelope)).toBeNull();
        });
    });

    it('still answers a person\'s own status change: that one is no import', async () => {
        await moveByHand('Draw the hero', DONE);
        const [moved] = taskEmits('Draw the hero').filter((payload) => 'statusKey' in payload.updatedFields);
        expect(domainEventBus.resolveActor(moved).kind).toBe('system');
        expect(taskNotices.HandleBothNotification).toHaveBeenCalledTimes(1);
    });
});

describe('a status the file did not change', () => {
    it('writes no status: no history line, no completion record and no status in any write or event', async () => {
        const out = await updateFrom(fileRows());

        expect(out.data).toMatchObject({ created: 0, updated: 3 });
        expect(out.data.skippedCells).toEqual([]);
        ['Write the copy', 'Draw the hero', 'Book the venue'].forEach((name) => {
            expect(historyOf(name)).toEqual([]);
            expect(taskNamed(name).completion).toBeUndefined();
            expect(taskNamed(name).groupByStatusIndex).toBe(7);
            taskEmits(name).forEach((payload) => expect(Object.keys(payload.updatedFields)).not.toEqual(expect.arrayContaining(['statusKey'])));
        });
        const taskWrites = mockDb.calls.filter((entry) => entry.type === SCHEMA_TYPE.TASKS && ['findOneAndUpdate', 'updateOne', 'updateMany'].includes(entry.method));
        taskWrites.forEach((entry) => expect(Object.keys(entry.data[1].$set || {})).not.toEqual(expect.arrayContaining(['statusKey'])));
    });

    it('leaves the status alone where the file\'s cell is empty', async () => {
        await moveByHand('Book the venue', DONE);
        const out = await updateFrom(fileRows({ c3: '' }));
        expect(out.data.skippedCells).toEqual([]);
        expect(taskNamed('Book the venue')).toMatchObject({ statusKey: 3, statusType: 'close' });
    });
});

describe('a status the project does not have', () => {
    it('is not written, and the answer names the cell that was skipped', async () => {
        await moveByHand('Book the venue', STATUSES[1]);
        jest.clearAllMocks();

        const out = await updateFrom(fileRows({ c1: 'in review', c3: 'blocked' }), { createMissingStatuses: false });

        expect(out.data.skippedCells).toEqual([
            { name: 'Write the copy', column: 'status', value: 'in review', code: 'UNKNOWN_STATUS' },
            { name: 'Book the venue', column: 'status', value: 'blocked', code: 'UNKNOWN_STATUS' },
        ]);
        expect(out.data.updated).toBe(3);
        expect(taskNamed('Write the copy')).toMatchObject({ statusKey: 1, statusType: 'default_active', groupByStatusIndex: 7 });
        expect(taskNamed('Book the venue')).toMatchObject({ statusKey: 2, statusType: 'active' });
        expect(historyOf('Write the copy')).toEqual([]);
        expect(store(SCHEMA_TYPE.PROJECTS).find((row) => row._id === PROJECT).taskStatusData).toHaveLength(3);
    });
});

describe('undoing an import: is a field it created still in use', () => {
    const fieldNamed = (name) => store(SCHEMA_TYPE.CUSTOM_FIELDS).find((field) => field.fieldTitle === name);
    const undo = (jobId) => call(importers.undoImport, {}, { id: String(jobId) });
    const usageReads = () => mockDb.calls.filter((entry) => entry.type === SCHEMA_TYPE.TASKS && Object.keys(entry.data[0] || {}).some((key) => key.startsWith('customField.')));
    const jobId = () => store(SCHEMA_TYPE.IMPORT_JOBS)[0]._id;

    it('asks once for each field, inside the field\'s own projects, for one task', async () => {
        const res = await undo(jobId());

        expect(res.body).toMatchObject({ status: true, data: { trashed: 3, fieldsRemoved: ['Story Points'], fieldsKept: [] } });
        const reads = usageReads();
        expect(reads).toHaveLength(1);
        expect(reads[0].method).toBe('find');
        expect(reads[0].data[0].ProjectID.$in.map(String)).toEqual([PROJECT]);
        expect(reads[0].data[1]).toEqual({ _id: 1 });
        expect(reads[0].data[2]).toEqual({ limit: 1 });
    });

    it('keeps a field a task outside the trash still holds', async () => {
        const field = String(fieldNamed('Story Points')._id);
        mockDb.seed(SCHEMA_TYPE.TASKS, { TaskName: 'Added by hand', ProjectID: PROJECT, sprintId: SPRINT, deletedStatusKey: 0, customField: { [field]: { fieldValue: '5' } } });

        const res = await undo(jobId());

        expect(res.body.data).toMatchObject({ fieldsRemoved: [], fieldsKept: ['Story Points'] });
        expect(fieldNamed('Story Points').isDelete).not.toBe(false);
    });

    it('looks in every project the field has been shared with since', async () => {
        const field = fieldNamed('Story Points');
        field.projectId = [PROJECT, OTHER_PROJECT];
        mockDb.seed(SCHEMA_TYPE.TASKS, { TaskName: 'Elsewhere', ProjectID: OTHER_PROJECT, deletedStatusKey: 0, customField: { [String(field._id)]: { fieldValue: '8' } } });

        const res = await undo(jobId());

        expect(usageReads()[0].data[0].ProjectID.$in.map(String)).toEqual([PROJECT, OTHER_PROJECT]);
        expect(res.body.data).toMatchObject({ fieldsRemoved: [], fieldsKept: ['Story Points'] });
    });

    it('keeps a field that has been made a field of every project, without reading the tasks of the company', async () => {
        fieldNamed('Story Points').global = true;

        const res = await undo(jobId());

        expect(usageReads()).toEqual([]);
        expect(res.body.data).toMatchObject({ fieldsRemoved: [], fieldsKept: ['Story Points'] });
    });
});
