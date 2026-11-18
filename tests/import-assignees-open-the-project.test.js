const mockDbs = {};
const mockDbFor = (companyId) => { mockDbs[companyId] = mockDbs[companyId] || require('./fixtures/fakeMongo').create(); return mockDbs[companyId]; };

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (companyId, q, method) => mockDbFor(String(companyId)).crud(companyId, q, method) }));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0 } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../Config/tenant', () => ({ pinSessionTenant: (req) => req.headers.companyid }));
jest.mock('../Modules/Tasks/helpers/taskWriteFields', () => ({ sessionActor: async (req) => ({ id: String(req.uid), Employee_Name: 'Owner' }) }));
jest.mock('../Modules/Importers/helpers/importAccess', () => ({
    importTargetAccess: async (_companyId, _uid, { sprintId }) => ({ allowed: true, sprint: { id: String(sprintId), name: 'List' } }),
    previewAccess: jest.fn(),
    refuseImport: jest.fn(),
}));
jest.mock('../Modules/Tasks/helpers/task_class_Mongo', () => ({
    taskMongo: {
        createMultipleTasks: jest.fn(async ({ tasks, projectData }) => {
            const { SCHEMA_TYPE: T } = require('../Config/schemaType');
            const { ObjectId } = require('mongodb');
            const db = mockDbFor(String(projectData.CompanyId));
            tasks.forEach((task) => {
                const _id = new ObjectId().toHexString();
                db.seed(T.TASKS, { _id, TaskName: task.TaskName, ProjectID: String(projectData._id), sprintId: task.sprintId, AssigneeUserId: task.AssigneeUserId || [], ParentTaskId: '' });
                task.createdTaskId = _id;
            });
            return { status: true, data: tasks };
        }),
    },
}));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { dbCollections } = require('../Config/collections');
const { SEAT_ACTIVE } = require('../Config/seatStatus');
const importers = require('../Modules/Importers/controller');

const COMPANY = '6f0000000000000000000c71';
const PROJECT = '6f0000000000000000000d71';
const LIST = '6f0000000000000000000e71';
const OWNER = '6f00000000000000000000f1';
const ON_PROJECT = '6f00000000000000000000f2';
const NOT_ON_PROJECT = '6f00000000000000000000f3';

const companyDb = () => mockDbFor(COMPANY);
const seedPerson = (uid, email, roleType = 3) => {
    mockDbFor(dbCollections.GLOBAL).seed(dbCollections.USERS, { _id: uid, Employee_Email: email, Employee_Name: email, AssignCompany: [COMPANY] });
    companyDb().seed(SCHEMA_TYPE.COMPANY_USERS, { companyId: COMPANY, userId: uid, userEmail: email, roleType, designation: 0, status: SEAT_ACTIVE, isDelete: false });
};

beforeEach(() => {
    Object.keys(mockDbs).forEach((k) => { delete mockDbs[k]; });
    companyDb().seed(SCHEMA_TYPE.PROJECTS, {
        _id: PROJECT, ProjectName: 'Board', ProjectCode: 'BRD', isPrivateSpace: true, AssigneeUserId: [ON_PROJECT],
        taskStatusData: [{ name: 'To Do', key: 1, type: 'default_active' }],
    });
    seedPerson(OWNER, 'owner@company.test', 1);
    seedPerson(ON_PROJECT, 'max@member.test');
    seedPerson(NOT_ON_PROJECT, 'nina@member.test');
});

describe('the people an import gives its tasks to', () => {
    it('are the members who can open the project the tasks land in', async () => {
        const res = { code: 200 };
        res.status = (code) => { res.code = code; return res; };
        res.send = (body) => { res.body = body; return res; };
        res.json = res.send;
        await importers.importFromTrello({
            uid: OWNER,
            headers: { companyid: COMPANY },
            body: {
                projectId: PROJECT,
                sprintId: LIST,
                board: {
                    lists: [{ id: 'l1', name: 'To Do', closed: false }],
                    members: [{ id: 'm1', email: 'max@member.test' }, { id: 'm2', email: 'nina@member.test' }],
                    cards: [{ id: 'c1', name: 'Shared card', idList: 'l1', closed: false, idMembers: ['m1', 'm2'] }],
                    actions: [],
                },
            },
        }, res);

        expect(res.body.status).toBe(true);
        expect(companyDb().store[SCHEMA_TYPE.TASKS][0].AssigneeUserId).toEqual([ON_PROJECT]);
    });
});
