const mockDbs = {};
const mockDbFor = (companyId) => { mockDbs[companyId] = mockDbs[companyId] || require('./fixtures/fakeMongo').create(); return mockDbs[companyId]; };

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (companyId, q, method) => mockDbFor(String(companyId)).crud(companyId, q, method) }));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0 } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../Config/tenant', () => ({ pinSessionTenant: (req) => req.headers.companyid }));
jest.mock('../Modules/Tasks/helpers/taskWriteFields', () => ({ sessionActor: async (req) => ({ id: String(req.uid), Employee_Name: 'Owner' }) }));
jest.mock('../Modules/Importers/helpers/importAccess', () => ({
    importTargetAccess: async (_companyId, _uid, { sprintId }) => ({ allowed: true, sprint: { id: String(sprintId), name: 'Sprint' } }),
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
                db.seed(T.TASKS, {
                    _id, TaskName: task.TaskName, ProjectID: String(projectData._id), sprintId: task.sprintId,
                    AssigneeUserId: task.AssigneeUserId || [], watchers: task.watchers || [], ParentTaskId: '',
                });
                task.createdTaskId = _id;
            });
            return { status: true, data: tasks };
        }),
    },
}));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { dbCollections } = require('../Config/collections');
const { SEAT_ACTIVE } = require('../Config/seatStatus');
const socketEmitter = require('../event/socketEventEmitter');
const importers = require('../Modules/Importers/controller');

const COMPANY = '6f0000000000000000000c71';
const PROJECT = '6f0000000000000000000d71';
const SPRINT = '6f0000000000000000000e71';
const OWNER = '6f00000000000000000000f1';
const MEMBER = '6f00000000000000000000f2';
const LEAVER = '6f00000000000000000000f3';

const companyDb = () => mockDbFor(COMPANY);
const counterOf = (uid) => (companyDb().store[dbCollections.USERID] || []).find((row) => String(row.userId) === uid) || {};
const taskNamed = (name) => (companyDb().store[SCHEMA_TYPE.TASKS] || []).find((row) => row.TaskName === name);

const seedPerson = (uid, email, over = {}) => {
    mockDbFor(dbCollections.GLOBAL).seed(dbCollections.USERS, { _id: uid, Employee_Email: email, Employee_Name: email, AssignCompany: [COMPANY] });
    companyDb().seed(SCHEMA_TYPE.COMPANY_USERS, {
        companyId: COMPANY, userId: uid, userEmail: email, roleType: 3, designation: 0, status: SEAT_ACTIVE, isDelete: false, ...over,
    });
};

const importBoard = async () => {
    const res = { code: 200 };
    res.status = (code) => { res.code = code; return res; };
    res.send = (body) => { res.body = body; return res; };
    res.json = res.send;
    await importers.importFromTrello({
        uid: OWNER,
        headers: { companyid: COMPANY },
        body: {
            projectId: PROJECT,
            sprintId: SPRINT,
            board: {
                lists: [{ id: 'l1', name: 'To Do', closed: false }],
                members: [{ id: 'm1', email: 'max@member.test' }, { id: 'm2', email: 'lee@left.test' }],
                cards: [
                    { id: 'c1', name: 'Discussed card', idList: 'l1', closed: false, idMembers: ['m1', 'm2'] },
                    { id: 'c2', name: 'Quiet card', idList: 'l1', closed: false, idMembers: ['m1'] },
                ],
                actions: [
                    { type: 'commentCard', data: { card: { id: 'c1' }, text: 'first' }, memberCreator: { fullName: 'Trello Tom' } },
                    { type: 'commentCard', data: { card: { id: 'c1' }, text: 'second' }, memberCreator: { fullName: 'Trello Tom' } },
                ],
            },
        },
    }, res);
    return res;
};

let emitted;

beforeEach(() => {
    Object.keys(mockDbs).forEach((k) => { delete mockDbs[k]; });
    emitted = [];
    socketEmitter.on('comments:insert', (payload) => emitted.push(payload));
    companyDb().seed(SCHEMA_TYPE.PROJECTS, { _id: PROJECT, ProjectName: 'Import', ProjectCode: 'IMP', taskStatusData: [{ name: 'To Do', key: 1, type: 'default_active' }] });
    seedPerson(OWNER, 'owner@company.test', { roleType: 1 });
    seedPerson(MEMBER, 'max@member.test');
    seedPerson(LEAVER, 'lee@left.test', { isDelete: true });
});

afterEach(() => {
    socketEmitter.removeAllListeners('comments:insert');
});

describe('comments carried in by an import', () => {
    it('are announced like a comment written in the app', async () => {
        const res = await importBoard();
        expect(res.body.status).toBe(true);

        const taskId = String(taskNamed('Discussed card')._id);
        expect(emitted).toHaveLength(2);
        emitted.forEach((event) => {
            expect(event).toMatchObject({ type: 'insert', module: 'comments', companyId: COMPANY });
            expect(String(event.data.taskId)).toBe(taskId);
            expect(String(event.data.projectId)).toBe(PROJECT);
            expect(String(event.data.sprintId)).toBe(SPRINT);
        });
    });

    it('count as unread for the task\'s people, not for the importer or someone who left', async () => {
        await importBoard();

        const field = `task_${PROJECT}_${SPRINT}_${String(taskNamed('Discussed card')._id)}_comments`;
        expect(counterOf(MEMBER)[field]).toBe(2);
        expect(counterOf(OWNER)[field]).toBeUndefined();
        expect(counterOf(LEAVER)[field]).toBeUndefined();

        const quiet = `task_${PROJECT}_${SPRINT}_${String(taskNamed('Quiet card')._id)}_comments`;
        expect(counterOf(MEMBER)[quiet]).toBeUndefined();
    });
});
