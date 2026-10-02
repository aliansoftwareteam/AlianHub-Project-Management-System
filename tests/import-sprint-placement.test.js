/* An imported task takes its sprint, folder and ids from the stored sprint the caller may import
   into, in the form the app's own create and move store (sprintPlacementOf), whatever the request
   carries. The stored form is read from what Mongoose hands the driver under the real task schema. */
process.env.STORAGE_TYPE = 'server';
const mongoose = require('mongoose');

const mockDbs = {};
const mockDbFor = (companyId) => { mockDbs[companyId] = mockDbs[companyId] || require('./fixtures/fakeMongo').create(); return mockDbs[companyId]; };

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (companyId, q, method) => mockDbFor(String(companyId)).crud(companyId, q, method),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0 } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../Config/tenant', () => ({ ...jest.requireActual('../Config/tenant'), pinSessionTenant: (req) => req.headers.companyid }));
jest.mock('../Config/projectAccess', () => ({ canEditProject: jest.fn(), canReadProject: jest.fn(), DETAILS: 'project.project_details' }));
jest.mock('../Modules/Tasks/helpers/taskWriteFields', () => ({
    ...jest.requireActual('../Modules/Tasks/helpers/taskWriteFields'),
    sessionActor: async (req) => ({ id: String(req.uid), Employee_Name: 'Member' }),
}));
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
jest.mock('../Modules/AIProjectGenerator/orchestrator', () => mockStub());
jest.mock('../utils/planHelper', () => mockStub());
jest.mock('../utils/commonFunctions.js', () => mockStub());
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../common-storage/common-server.js', () => mockStub());

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { SEAT_ACTIVE } = require('../Config/seatStatus');
const { canEditProject, canReadProject } = require('../Config/projectAccess');
const { taskMongo } = require('../Modules/Tasks/helpers/task_class_Mongo');
const { sprintPlacementOf } = require('../Modules/Tasks/helpers/sprintPlacement');
const { driverWrites, sprintArraysIn, isObjectId } = require('./fixtures/realTaskStore');
const importers = require('../Modules/Importers/controller');

const COMPANY = '6f0000000000000000000c61';
const OTHER_COMPANY = '6f0000000000000000000c62';
const PROJECT = '6f0000000000000000000d61';
const OTHER_PROJECT = '6f0000000000000000000d62';
const SPRINT = '6f0000000000000000000e61';
const FOLDERLESS_SPRINT = '6f0000000000000000000e62';
const ORPHAN_SPRINT = '6f0000000000000000000e63';
const OTHER_PROJECT_SPRINT = '6f0000000000000000000e64';
const PRIVATE_SPRINT = '6f0000000000000000000e65';
const FOREIGN_SPRINT = '6f0000000000000000000e66';
const FOLDER = '6f0000000000000000000f61';
const GONE_FOLDER = '6f0000000000000000000f62';
const MEMBER = '6f00000000000000000000a6';
const oid = (id) => new mongoose.Types.ObjectId(id);

const STATUSES = [{ name: 'To Do', key: 1, type: 'default_active' }, { name: 'Done', key: 2, type: 'close' }];
const sprintRow = (id, extra = {}) => ({ _id: oid(id), name: `List ${id.slice(-2)}`, projectId: oid(PROJECT), deletedStatusKey: 0, private: false, AssigneeUserId: [], ...extra });

let created = [];

beforeEach(() => {
    Object.keys(mockDbs).forEach((key) => { delete mockDbs[key]; });
    jest.clearAllMocks();
    created = [];
    const db = mockDbFor(COMPANY);
    db.seed(SCHEMA_TYPE.PROJECTS, { _id: oid(PROJECT), ProjectName: 'Web', ProjectCode: 'WEB', lastTaskId: 0, taskStatusData: STATUSES });
    db.seed(SCHEMA_TYPE.COMPANY_USERS, { companyId: COMPANY, userId: MEMBER, roleType: 3, designation: 0, status: SEAT_ACTIVE, isDelete: false });
    db.seed(SCHEMA_TYPE.FOLDERS, { _id: oid(FOLDER), name: 'Q4', projectId: oid(PROJECT) });
    db.seed(SCHEMA_TYPE.SPRINTS, sprintRow(SPRINT, { name: 'Sprint 7', folderId: oid(FOLDER) }));
    db.seed(SCHEMA_TYPE.SPRINTS, sprintRow(FOLDERLESS_SPRINT, { name: 'Backlog' }));
    db.seed(SCHEMA_TYPE.SPRINTS, sprintRow(ORPHAN_SPRINT, { name: 'Leftover', folderId: oid(GONE_FOLDER) }));
    db.seed(SCHEMA_TYPE.SPRINTS, sprintRow(OTHER_PROJECT_SPRINT, { projectId: oid(OTHER_PROJECT) }));
    db.seed(SCHEMA_TYPE.SPRINTS, sprintRow(PRIVATE_SPRINT, { private: true, AssigneeUserId: ['6f00000000000000000000a7'] }));
    mockDbFor(OTHER_COMPANY).seed(SCHEMA_TYPE.SPRINTS, { ...sprintRow(FOREIGN_SPRINT), CompanyId: OTHER_COMPANY });
    canEditProject.mockResolvedValue({ allowed: true });
    canReadProject.mockResolvedValue({ allowed: true });
    jest.spyOn(taskMongo, 'create').mockImplementation(async ({ data }) => {
        created.push(data);
        return { status: true, id: new mongoose.Types.ObjectId().toHexString() };
    });
});

afterEach(() => jest.restoreAllMocks());

const call = async (handler, body) => {
    const res = { code: 200 };
    res.status = (code) => { res.code = code; return res; };
    res.send = (payload) => { res.body = payload; return res; };
    res.json = res.send;
    await handler({ uid: MEMBER, aud: COMPANY, headers: { companyid: COMPANY }, body }, res);
    for (let i = 0; i < 30 && res.body === undefined; i += 1) await new Promise((resolve) => setImmediate(resolve));
    return res;
};

const IMPORTERS = [
    ['Jira', 'importFromJira', (body) => ({ rows: [{ Summary: 'Write the brief' }], ...body })],
    ['CSV', 'importFromCsv', (body) => ({ rows: [{ 'Task name': 'Write the brief' }], ...body })],
    ['Monday', 'importFromMonday', (body) => ({ rows: [{ Name: 'Write the brief' }], ...body })],
];

const importInto = (sprintId, extra = {}, [, handler, bodyOf] = IMPORTERS[0]) => call(importers[handler], bodyOf({ projectId: PROJECT, sprintId, ...extra }));

const placementOf = async (sprintId) => (await sprintPlacementOf(COMPANY, await mockDbFor(COMPANY).crud(COMPANY, { type: SCHEMA_TYPE.SPRINTS, data: [{ _id: oid(sprintId) }] }, 'findOne'))).set;

const storedTask = async () => {
    const { writes, error } = await driverWrites('save', created[0]);
    expect(error).toBeNull();
    return writes[0].args[0];
};

describe('an imported task is placed where the app places a task', () => {
    test.each(IMPORTERS)('%s hands the task create the placement of the chosen sprint', async (...importer) => {
        const res = await importInto(SPRINT, {}, importer);

        expect(res.body.status).toBe(true);
        expect(created).toHaveLength(1);
        const placement = await placementOf(SPRINT);
        expect({ sprintId: created[0].sprintId, sprintArray: created[0].sprintArray, folderObjId: created[0].folderObjId }).toEqual(placement);
    });

    it('stores the sprint element with ObjectId ids and the folder under the real task schema', async () => {
        await importInto(SPRINT);

        const stored = await storedTask();
        const [element] = sprintArraysIn([stored]);
        expect(element).toEqual({ id: oid(SPRINT), name: 'Sprint 7', folderId: oid(FOLDER), folderName: 'Q4' });
        expect(isObjectId(element.id) && isObjectId(element.folderId)).toBe(true);
        expect(isObjectId(stored.sprintId) && String(stored.sprintId) === SPRINT).toBe(true);
        expect(isObjectId(stored.folderObjId) && String(stored.folderObjId) === FOLDER).toBe(true);
    });

    it('files a task of a sprint at the project root without a folder', async () => {
        await importInto(FOLDERLESS_SPRINT);

        const stored = await storedTask();
        expect(sprintArraysIn([stored])).toEqual([{ id: oid(FOLDERLESS_SPRINT), name: 'Backlog' }]);
        expect(stored.folderObjId).toBeUndefined();
    });

    it('keeps the folder of a sprint whose folder record is gone, as a move into it would', async () => {
        await importInto(ORPHAN_SPRINT);

        expect(created[0]).toMatchObject({ sprintArray: { folderId: oid(GONE_FOLDER), folderName: '' }, folderObjId: oid(GONE_FOLDER) });
    });

    it('ignores a sprint, sprint element and folder the request carries', async () => {
        await importInto(SPRINT, {
            sprint: { id: FOLDERLESS_SPRINT, name: 'Hijacked', folderId: GONE_FOLDER, isAccessible: true },
            sprintArray: { id: OTHER_PROJECT_SPRINT, name: 'Elsewhere', value: 'x' },
            folderObjId: GONE_FOLDER,
            rows: [{ Summary: 'Write the brief', sprintArray: 'x', sprintId: OTHER_PROJECT_SPRINT, folderObjId: GONE_FOLDER }],
        });

        expect(created).toHaveLength(1);
        expect({ sprintId: created[0].sprintId, sprintArray: created[0].sprintArray, folderObjId: created[0].folderObjId }).toEqual(await placementOf(SPRINT));
    });
});

describe('an import refuses a sprint the caller may not import into', () => {
    test.each([
        ['a sprint of another project', OTHER_PROJECT_SPRINT],
        ['a private sprint the caller is not on', PRIVATE_SPRINT],
        ['a sprint of another company', FOREIGN_SPRINT],
        ['a sprint that does not exist', '6f0000000000000000000e6f'],
    ])('%s', async (_, sprintId) => {
        const res = await importInto(sprintId);

        expect(res.code).toBe(404);
        expect(created).toHaveLength(0);
    });

    it('still asks for task-create access to the project', async () => {
        canEditProject.mockResolvedValue({ allowed: false, statusCode: 403 });

        const res = await importInto(SPRINT);

        expect(res.code).toBe(403);
        expect(canEditProject).toHaveBeenCalledWith(COMPANY, MEMBER, PROJECT, ['task.task_create']);
        expect(created).toHaveLength(0);
    });
});

describe('the web app\'s spreadsheet import (PATCH /api/v1/importTasks)', () => {
    const routes = {};
    const register = (method) => (routePath, ...handlers) => { routes[`${method} ${routePath}`] = handlers[handlers.length - 1]; };
    require('../Modules/Tasks/routes').init({ get: register('GET'), post: register('POST'), put: register('PUT'), patch: register('PATCH'), delete: register('DELETE'), use: register('USE') });

    const importSheet = (sprint) => call(routes['PATCH /api/v1/importTasks'], {
        action: 'createMultipleTasks',
        tasks: [{ TaskName: 'Write the brief', status: 'To Do', Task_Leader: MEMBER }],
        userData: { id: MEMBER, Employee_Name: 'Member' },
        projectData: { _id: PROJECT, CompanyId: COMPANY, ProjectName: 'Web', ProjectCode: 'WEB', lastTaskId: 0 },
        indexObj: {},
        statusArray: STATUSES,
        sprint,
        eventId: 'e1',
    });

    it('places the tasks by the stored sprint the body names, not the element it sends', async () => {
        const res = await importSheet({ id: SPRINT, name: 'Hijacked', value: 'x', folderId: GONE_FOLDER, folderName: 'Elsewhere', isAccessible: true });

        expect(res.body.status).toBe(true);
        expect(created).toHaveLength(1);
        expect({ sprintId: created[0].sprintId, sprintArray: created[0].sprintArray, folderObjId: created[0].folderObjId }).toEqual(await placementOf(SPRINT));
    });

    test.each([
        ['a sprint of another project', OTHER_PROJECT_SPRINT],
        ['a private sprint the caller is not on', PRIVATE_SPRINT],
        ['a sprint of another company', FOREIGN_SPRINT],
        ['no sprint id', undefined],
    ])('refuses %s', async (_, sprintId) => {
        const res = await importSheet({ id: sprintId, name: 'Sprint' });

        expect(res.code).toBe(404);
        expect(created).toHaveLength(0);
    });
});
