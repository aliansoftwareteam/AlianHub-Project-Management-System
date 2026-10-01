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

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { schema } = require('../utils/mongo-handler/schema');
const { fieldAppliesToTask, fieldTaskTypes, cleanTaskTypeList } = require('../Modules/CustomField/helpers/fieldTaskTypes');
const { fieldInsertFrom, fieldUpdateFrom, FieldWriteError } = require('../Modules/CustomField/helpers/fieldWrite');
const { CID, OWNER, OPEN_PROJECT, OPEN_TASK } = require('./fixtures/taskWriteGuard');

const BUG = 2;
const STORY = 4;
const SCOPED_FIELD = '6f0000000000000000000d01';
const OPEN_FIELD = '6f0000000000000000000d02';
const settle = async () => { for (let i = 0; i < 30; i += 1) await new Promise((resolve) => setImmediate(resolve)); };

describe('fieldAppliesToTask', () => {
    it('shows a field with no task types on every task, as fields always did', () => {
        expect(fieldAppliesToTask({}, { TaskTypeKey: 1 })).toBe(true);
        expect(fieldAppliesToTask({ fieldTaskTypes: [] }, { TaskTypeKey: 1 })).toBe(true);
        expect(fieldAppliesToTask(null, { TaskTypeKey: 1 })).toBe(true);
    });

    it('shows a scoped field only on tasks of one of its types', () => {
        const field = { fieldTaskTypes: [BUG, STORY] };
        expect(fieldAppliesToTask(field, { TaskTypeKey: BUG })).toBe(true);
        expect(fieldAppliesToTask(field, { TaskTypeKey: String(STORY) })).toBe(true);
        expect(fieldAppliesToTask(field, { TaskTypeKey: 1 })).toBe(false);
        expect(fieldAppliesToTask(field, {})).toBe(false);
    });

    it('reads the stored list leniently and without repeats', () => {
        expect(fieldTaskTypes({ fieldTaskTypes: [BUG, '2', 'x', null, STORY] })).toEqual([BUG, STORY]);
    });
});

describe('saving a field with task types', () => {
    it('declares fieldTaskTypes on the custom field schema with an empty default', () => {
        expect(schema.customFields.fieldTaskTypes).toMatchObject({ type: Array, default: [] });
    });

    it('keeps a clean list of task type keys', () => {
        expect(cleanTaskTypeList([BUG, String(STORY), BUG])).toEqual([BUG, STORY]);
        expect(fieldInsertFrom({ fieldTitle: 'Severity', fieldType: 'dropdown', fieldTaskTypes: [BUG, '4'] }).fieldTaskTypes).toEqual([BUG, STORY]);
        expect(fieldUpdateFrom({ key: '$set', id: SCOPED_FIELD, updateObject: { fieldTaskTypes: [] } }).fieldTaskTypes).toEqual([]);
    });

    it.each([['bug'], [[0]], [[-1]], [[1.5]], [[true]], [[{ key: 2 }]], [Array.from({ length: 101 }, (_, at) => at + 1)]])('refuses %j', (value) => {
        expect(cleanTaskTypeList(value)).toBeNull();
        expect(() => fieldInsertFrom({ fieldTitle: 'Severity', fieldTaskTypes: value })).toThrow(FieldWriteError);
    });
});

describe('writing a scoped field value on a task', () => {
    const routes = {};
    const register = (method) => (routePath, ...handlers) => { routes[`${method} ${routePath}`] = handlers[handlers.length - 1]; };
    require('../Modules/Tasks/routes').init({ get: register('GET'), post: register('POST'), put: register('PUT'), patch: register('PATCH'), delete: register('DELETE'), use: register('USE') });

    const patch = (body) => new Promise((resolve) => {
        const res = { statusCode: 200 };
        res.status = (code) => { res.statusCode = code; return res; };
        res.send = (answer) => { resolve({ code: res.statusCode, body: answer }); return res; };
        res.json = res.send;
        routes['PATCH /api/v2/tasks']({ method: 'PATCH', path: '/api/v2/tasks', headers: { companyid: CID }, aud: CID, uid: OWNER, body }, res, () => resolve({ code: 'next' }));
    }).then(async (result) => { await settle(); return result; });

    const write = (fieldId, fieldValue = 'Critical') => patch({
        action: 'updateTaskCustomField', companyId: CID, taskId: OPEN_TASK, customFieldId: fieldId, updateDetail: { _id: fieldId, fieldValue },
    });
    const stored = () => mockDb.store.tasks.find((task) => String(task._id) === OPEN_TASK);

    const seedTask = (TaskTypeKey) => {
        Object.keys(mockDb.store).forEach((type) => { mockDb.store[type].length = 0; });
        mockDb.calls.length = 0;
        mockDb.seed('projects', { _id: OPEN_PROJECT, ProjectName: 'Parity', ProjectCode: 'PAR', CompanyId: CID });
        mockDb.seed(SCHEMA_TYPE.USERS, { _id: OWNER, Employee_Name: 'Olivia Owner' });
        mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: OWNER, roleType: 1, status: 2, isDelete: false });
        mockDb.seed(SCHEMA_TYPE.CUSTOM_FIELDS, { _id: SCOPED_FIELD, fieldTitle: 'Severity', fieldType: 'text', type: 'task', global: true, isDelete: true, fieldTaskTypes: [BUG] });
        mockDb.seed(SCHEMA_TYPE.CUSTOM_FIELDS, { _id: OPEN_FIELD, fieldTitle: 'Customer', fieldType: 'text', type: 'task', global: true, isDelete: true });
        mockDb.seed(SCHEMA_TYPE.TASKS, {
            _id: OPEN_TASK, TaskName: 'Login fails', ProjectID: OPEN_PROJECT, CompanyId: CID, TaskType: TaskTypeKey === BUG ? 'bug' : 'task', TaskTypeKey,
            deletedStatusKey: 0, customField: { [SCOPED_FIELD]: { _id: SCOPED_FIELD, fieldValue: 'Kept' } },
        });
    };

    it('refuses the write when the task is of another type, and keeps the stored value', async () => {
        seedTask(1);
        const answer = await write(SCOPED_FIELD);
        expect(answer.code).toBe(400);
        expect(answer.body).toMatchObject({ status: false, statusText: expect.stringMatching(/task type/i) });
        expect(stored().customField[SCOPED_FIELD].fieldValue).toBe('Kept');
    });

    it('reads the field definition from the signed-in company', async () => {
        seedTask(1);
        await write(SCOPED_FIELD);
        const lookup = mockDb.calls.find((call) => call.type === SCHEMA_TYPE.CUSTOM_FIELDS);
        expect(lookup.companyId).toBe(CID);
    });

    it('writes the value on a task of one of the field\'s types', async () => {
        seedTask(BUG);
        const answer = await write(SCOPED_FIELD);
        expect(answer.body.status).toBe(true);
        expect(stored().customField[SCOPED_FIELD].fieldValue).toBe('Critical');
    });

    it('writes a field with no task types on any task', async () => {
        seedTask(1);
        const answer = await write(OPEN_FIELD, 'Acme');
        expect(answer.body.status).toBe(true);
        expect(stored().customField[OPEN_FIELD].fieldValue).toBe('Acme');
    });
});
