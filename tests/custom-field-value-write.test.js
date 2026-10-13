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
const { CID, OWNER, OPEN_PROJECT, OPEN_TASK } = require('./fixtures/taskWriteGuard');

const OTHER_PROJECT = '6f0000000000000000000a09';
const TEXT_FIELD = '6f0000000000000000000d01';
const PHONE_FIELD = '6f0000000000000000000d02';
const CHOICE_FIELD = '6f0000000000000000000d03';
const OTHER_PROJECT_FIELD = '6f0000000000000000000d04';
const PROJECT_DETAIL_FIELD = '6f0000000000000000000d05';
const UNKNOWN_FIELD = '6f0000000000000000000dff';
const settle = async () => { for (let i = 0; i < 30; i += 1) await new Promise((resolve) => setImmediate(resolve)); };

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

const write = (fieldId, updateDetail) => patch({ action: 'updateTaskCustomField', companyId: CID, taskId: OPEN_TASK, customFieldId: fieldId, updateDetail });
const stored = () => mockDb.store.tasks.find((task) => String(task._id) === OPEN_TASK).customField || {};
const field = (_id, fieldType, extra = {}) => mockDb.seed(SCHEMA_TYPE.CUSTOM_FIELDS, { _id, fieldTitle: fieldType, fieldType, type: 'task', global: true, isDelete: true, ...extra });

beforeEach(() => {
    Object.keys(mockDb.store).forEach((type) => { mockDb.store[type].length = 0; });
    mockDb.seed('projects', { _id: OPEN_PROJECT, ProjectName: 'Open', ProjectCode: 'OPN', CompanyId: CID });
    mockDb.seed(SCHEMA_TYPE.USERS, { _id: OWNER, Employee_Name: 'Olivia Owner' });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: OWNER, roleType: 1, status: 2, isDelete: false });
    field(TEXT_FIELD, 'text');
    field(PHONE_FIELD, 'phone');
    field(CHOICE_FIELD, 'dropdown');
    field(OTHER_PROJECT_FIELD, 'text', { global: false, projectId: [OTHER_PROJECT] });
    field(PROJECT_DETAIL_FIELD, 'text', { type: 'project' });
    mockDb.seed(SCHEMA_TYPE.TASKS, { _id: OPEN_TASK, TaskName: 'Login fails', ProjectID: OPEN_PROJECT, CompanyId: CID, TaskTypeKey: 1, deletedStatusKey: 0, customField: {} });
});

describe('writing a field value on a task', () => {
    it.each([
        ['a field that does not exist', UNKNOWN_FIELD],
        ['a field kept for another project', OTHER_PROJECT_FIELD],
        ['a field of project details', PROJECT_DETAIL_FIELD],
    ])('refuses %s', async (label, fieldId) => {
        const answer = await write(fieldId, { _id: fieldId, fieldValue: 'Critical' });

        expect(answer.code).toBe(400);
        expect(stored()).toEqual({});
    });

    it.each([
        ['a record inside a record', { depth: { more: 1 } }],
        ['a list of lists', [['a']]],
        ['text beyond the limit', 'x'.repeat(20001)],
        ['a list beyond the limit', Array.from({ length: 201 }, () => 'a')],
    ])('refuses %s as the value of a text field', async (label, fieldValue) => {
        const answer = await write(TEXT_FIELD, { _id: TEXT_FIELD, fieldValue });

        expect(answer.code).toBe(400);
        expect(stored()).toEqual({});
    });

    it('stores the value under the field\'s own id and nothing else of the detail', async () => {
        const answer = await write(TEXT_FIELD, { _id: 'something else', fieldValue: 'Critical', note: { any: 'thing' } });

        expect(answer.code).toBe(200);
        expect(stored()[TEXT_FIELD]).toEqual({ fieldValue: 'Critical', _id: TEXT_FIELD });
    });

    it('keeps the dialling code beside a phone number', async () => {
        await write(PHONE_FIELD, { _id: PHONE_FIELD, fieldValue: '9876543210', fieldCode: '+91', fieldPattern: '##### #####', fieldFlag: 'in', note: 'x' });

        expect(stored()[PHONE_FIELD]).toEqual({ fieldValue: '9876543210', fieldCode: '+91', fieldPattern: '##### #####', fieldFlag: 'in', _id: PHONE_FIELD });
    });

    it('stores a choice as the web app sends it, and as older tasks hold it', async () => {
        await write(CHOICE_FIELD, { _id: CHOICE_FIELD, fieldValue: ['opt-1'] });
        expect(stored()[CHOICE_FIELD].fieldValue).toEqual(['opt-1']);

        await write(CHOICE_FIELD, { _id: CHOICE_FIELD, fieldValue: [{ id: 'opt-1', label: 'High', color: '#f00' }] });
        expect(stored()[CHOICE_FIELD].fieldValue).toEqual([{ id: 'opt-1', label: 'High', color: '#f00' }]);
    });
});
