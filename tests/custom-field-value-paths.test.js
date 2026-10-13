/* Task 046 slice A1.6: a field value is checked wherever a task is written, not only when one field is edited. A value
   that does not fit its field is left out of that write; the task itself is still saved. */
const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (companyId, q, method) => mockDb.crud(companyId, q, method),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0 } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
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
jest.mock('../Modules/CustomField/controller', () => mockStub());
jest.mock('../utils/planHelper', () => mockStub());
jest.mock('../utils/commonFunctions.js', () => mockStub());
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../common-storage/common-server.js', () => mockStub());
process.env.STORAGE_TYPE = 'server';

const mongoHelper = require('../Modules/Tasks/helpers/mongo_helper');
const { taskMongo } = require('../Modules/Tasks/helpers/task_class_Mongo');
const { storableFieldValues } = require('../Modules/CustomField/helpers/fieldValueWrite');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { CID, OWNER, MEMBER, OPEN_PROJECT } = require('./fixtures/taskWriteGuard');

mongoHelper.getTotalSprintCount = async () => true;

const PRIVATE_PROJECT = '6f0000000000000000000a09';
const SPRINT = '6f0000000000000000000e01';
const OUTSIDER = '6f0000000000000000000006';
const FIELD = {
    people: '6f0000000000000000000e11', url: '6f0000000000000000000e12', rating: '6f0000000000000000000e13',
    progress: '6f0000000000000000000e14', text: '6f0000000000000000000e15', shared: '6f0000000000000000000e16',
};
const UNKNOWN_FIELD = '6f0000000000000000000eff';
const USER = { id: OWNER, Employee_Name: 'Olivia Owner' };
const settle = async () => { for (let i = 0; i < 30; i += 1) await new Promise((resolve) => setImmediate(resolve)); };

const entry = (id, fieldValue) => ({ [id]: { _id: id, fieldValue } });
const GOOD = { ...entry(FIELD.people, [OWNER, MEMBER]), ...entry(FIELD.url, 'https://example.com/spec'), ...entry(FIELD.rating, 4), ...entry(FIELD.progress, 60), ...entry(FIELD.text, 'Acme') };
const BAD = { ...entry(FIELD.url, 'javascript:alert(1)'), ...entry(FIELD.rating, 9), ...entry(FIELD.progress, 'half') };

const seed = () => {
    Object.keys(mockDb.store).forEach((type) => { mockDb.store[type].length = 0; });
    mockDb.calls.length = 0;
    mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: OPEN_PROJECT, ProjectName: 'Open', ProjectCode: 'OPN', CompanyId: CID });
    mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: PRIVATE_PROJECT, ProjectName: 'Private', ProjectCode: 'PRV', CompanyId: CID, isPrivateSpace: true, AssigneeUserId: [OWNER] });
    mockDb.seed(SCHEMA_TYPE.USERS, { _id: OWNER, Employee_Name: 'Olivia Owner' });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: OWNER, roleType: 1, status: 2, isDelete: false });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: MEMBER, roleType: 3, status: 2, isDelete: false });
    const field = (id, fieldType, extra = {}) => mockDb.seed(SCHEMA_TYPE.CUSTOM_FIELDS, { _id: id, fieldTitle: fieldType, fieldType, type: 'task', global: true, isDelete: true, ...extra });
    field(FIELD.people, 'people', { fieldMultiple: true });
    field(FIELD.url, 'url');
    field(FIELD.rating, 'rating', { fieldRatingMax: 5 });
    field(FIELD.progress, 'progress');
    field(FIELD.text, 'text');
};

const newTask = (customField, extra = {}) => ({
    TaskName: 'Write the spec', TaskKey: '-', TaskType: 'task', TaskTypeKey: 1, ProjectID: OPEN_PROJECT, CompanyId: CID, sprintId: SPRINT,
    sprintArray: { id: SPRINT, name: 'Sprint 1' }, AssigneeUserId: [], watchers: [], isParentTask: true, ParentTaskId: '', deletedStatusKey: 0,
    status: { text: 'To Do', key: 1, type: 'default_active' }, statusType: 'default_active', statusKey: 1, Task_Priority: 'MEDIUM', customField, ...extra,
});
const projectData = (id = OPEN_PROJECT) => ({ _id: id, CompanyId: CID, ProjectName: 'Open', ProjectCode: 'OPN', lastTaskId: 0 });
const storedTask = (id) => mockDb.store[SCHEMA_TYPE.TASKS].find((task) => String(task._id) === String(id));

beforeEach(seed);

describe('the values a new or copied task may keep', () => {
    it('keeps every value that fits its field, of the new types and the older ones', async () => {
        const kept = await storableFieldValues({ companyId: CID, task: newTask(GOOD) });
        expect(kept).toEqual({ customField: GOOD, dropped: [] });
    });

    it('leaves out a value that does not fit, and says which', async () => {
        const kept = await storableFieldValues({ companyId: CID, task: newTask({ ...GOOD, ...BAD }) });
        expect(kept.customField).toEqual({ ...entry(FIELD.people, [OWNER, MEMBER]), ...entry(FIELD.text, 'Acme') });
        expect(kept.dropped.sort()).toEqual([FIELD.url, FIELD.rating, FIELD.progress].sort());
    });

    it('stores the checked value and nothing sent beside it', async () => {
        const sent = { [FIELD.url]: { _id: FIELD.url, fieldValue: ' https://example.com ', href: 'javascript:alert(1)' } };
        const kept = await storableFieldValues({ companyId: CID, task: newTask(sent) });
        expect(kept.customField).toEqual(entry(FIELD.url, 'https://example.com/'));
    });

    it('keeps the people who may be named on the task\'s project and leaves the others out', async () => {
        const open = await storableFieldValues({ companyId: CID, task: newTask(entry(FIELD.people, [OWNER, OUTSIDER, MEMBER])) });
        expect(open).toEqual({ customField: entry(FIELD.people, [OWNER, MEMBER]), dropped: [FIELD.people] });

        const closed = await storableFieldValues({ companyId: CID, task: newTask(entry(FIELD.people, [MEMBER, OWNER]), { ProjectID: PRIVATE_PROJECT }) });
        expect(closed).toEqual({ customField: entry(FIELD.people, [OWNER]), dropped: [FIELD.people] });

        const none = await storableFieldValues({ companyId: CID, task: newTask(entry(FIELD.people, [OUTSIDER])) });
        expect(none).toEqual({ customField: {}, dropped: [FIELD.people] });
    });

    it('leaves out a people value that is not a list of ids', async () => {
        const kept = await storableFieldValues({ companyId: CID, task: newTask(entry(FIELD.people, 'olivia')) });
        expect(kept).toEqual({ customField: {}, dropped: [FIELD.people] });
    });

    it('reads a field shared by every company from the global database', async () => {
        mockDb.seed(SCHEMA_TYPE.CUSTOM_FIELDS, { _id: FIELD.shared, fieldTitle: 'Shared', fieldType: 'rating', type: 'task', global: true, isDelete: true });
        const kept = await storableFieldValues({ companyId: CID, task: newTask({ ...entry(FIELD.shared, 12), ...entry(FIELD.text, 'Acme') }) });
        expect(kept).toEqual({ customField: entry(FIELD.text, 'Acme'), dropped: [FIELD.shared] });
        const lookups = mockDb.calls.filter((call) => call.type === SCHEMA_TYPE.CUSTOM_FIELDS).map((call) => call.companyId);
        expect(lookups).toContain(CID);
        expect(lookups.every((database) => [CID, 'global'].includes(database))).toBe(true);
    });

    it('leaves a value alone when its field is unknown or of an older type', async () => {
        const sent = { ...entry(UNKNOWN_FIELD, { any: 'shape' }), cf1: 'x', ...entry(FIELD.text, 42) };
        expect(await storableFieldValues({ companyId: CID, task: newTask(sent) })).toEqual({ customField: sent, dropped: [] });
    });

    it('answers no values for a task that carries none', async () => {
        expect(await storableFieldValues({ companyId: CID, task: newTask(undefined) })).toEqual({ customField: {}, dropped: [] });
        expect(await storableFieldValues({ companyId: CID, task: newTask('x') })).toEqual({ customField: {}, dropped: [] });
        expect(mockDb.calls.filter((call) => call.type === SCHEMA_TYPE.CUSTOM_FIELDS)).toEqual([]);
    });
});

describe('creating a task', () => {
    it('saves the task without the values that do not fit, and counts them', async () => {
        const result = await taskMongo.create({ data: newTask({ ...GOOD, ...BAD }), user: USER, projectData: projectData(), indexObj: {} });
        await settle();
        expect(result).toMatchObject({ status: true, droppedFieldValues: 3 });
        expect(storedTask(result.id).customField).toEqual({ ...entry(FIELD.people, [OWNER, MEMBER]), ...entry(FIELD.text, 'Acme') });
    });

    it('reports nothing dropped when every value fits', async () => {
        const result = await taskMongo.create({ data: newTask(GOOD), user: USER, projectData: projectData(), indexObj: {} });
        await settle();
        expect(result.status).toBe(true);
        expect(result.droppedFieldValues).toBeUndefined();
        expect(storedTask(result.id).customField).toEqual(GOOD);
    });

    it('checks a copy the same way, since every new task document is saved by HandleTask', async () => {
        const copy = newTask({ ...entry(FIELD.people, [MEMBER, OWNER]), ...entry(FIELD.rating, 3) }, { ProjectID: PRIVATE_PROJECT });
        const result = await mongoHelper.HandleTask(CID, copy, false, null, USER);
        await settle();
        expect(result).toMatchObject({ status: true, droppedFieldValues: 1 });
        expect(storedTask(result.id).customField).toEqual({ ...entry(FIELD.people, [OWNER]), ...entry(FIELD.rating, 3) });
    });
});

describe('importing tasks', () => {
    const rows = [
        { _id: 'r1', TaskName: 'Good row', status: 'To Do', customField: { ...entry(FIELD.url, 'https://example.com'), ...entry(FIELD.rating, 5) } },
        { _id: 'r2', TaskName: 'One bad cell', status: 'To Do', customField: { ...entry(FIELD.url, 'ftp://example.com'), ...entry(FIELD.progress, 40) } },
        { _id: 'r3', TaskName: 'Two bad cells', status: 'To Do', customField: { ...entry(FIELD.rating, 0), ...entry(FIELD.progress, 400) } },
    ];

    it('imports every row, leaves out the cells that do not fit and counts them', async () => {
        const result = await taskMongo.createMultipleTasks({
            tasks: rows.map((row) => ({ ...row })), userData: USER, projectData: projectData(), indexObj: {},
            statusArray: [{ name: 'To Do', key: 1, type: 'default_active' }], sprint: { id: SPRINT, name: 'Sprint 1' }, eventId: 'e1',
        });
        await settle();
        expect(result).toMatchObject({ status: true, droppedFieldValues: 3 });
        const saved = Object.fromEntries(mockDb.store[SCHEMA_TYPE.TASKS].map((task) => [task.TaskName, task.customField]));
        expect(saved).toEqual({
            'Good row': { ...entry(FIELD.url, 'https://example.com/'), ...entry(FIELD.rating, 5) },
            'One bad cell': entry(FIELD.progress, 40),
            'Two bad cells': {},
        });
    });
});
