const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../Modules/settings/securityPermissions/controller', () => ({ fetchRules: jest.fn(async () => []) }));
jest.mock('../event/socketEventEmitter', () => ({}));

const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { getTask } = require('../Modules/Tasks/helpers/getTasksData');

const C = '6f0000000000000000000e01';
const OWNER = '6f0000000000000000000e11';
const ADMIN = '6f0000000000000000000e12';
const MEMBER = '6f0000000000000000000e13';
const GUEST = '6f0000000000000000000e14';
const OUTSIDER = '6f0000000000000000000e15';
const ROLES = { [OWNER]: 1, [ADMIN]: 2, [MEMBER]: 3, [GUEST]: 0 };

const read = async (uid, id) => {
    const res = { statusCode: 200 };
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (payload) => { res.body = payload; return res; };
    await getTask({ headers: { companyid: C }, uid, params: { id: String(id) } }, res);
    return res;
};

const project = (over) => mockDb.seed(SCHEMA_TYPE.PROJECTS, { ProjectName: 'P', isPrivateSpace: false, AssigneeUserId: [], ...over });
const task = (proj, over) => mockDb.seed(SCHEMA_TYPE.TASKS, { TaskName: 'Secret plan', ProjectID: String(proj._id), ...over });

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    myCache.flushAll();
    Object.entries(ROLES).forEach(([userId, roleType]) => mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId, roleType, status: 2, isDelete: false }));
});

describe('GET /api/v1/task/:id follows project visibility', () => {
    it('serves a task in a public project to every role', async () => {
        const t = task(project());
        for (const uid of [OWNER, ADMIN, MEMBER, GUEST]) {
            const res = await read(uid, t._id);
            expect(res.statusCode).toBe(200);
            expect(res.body.TaskName).toBe('Secret plan');
        }
    });

    it('answers 404 to a member and a guest for a task in a private project they are not on', async () => {
        const t = task(project({ isPrivateSpace: true, AssigneeUserId: [OWNER] }));
        for (const uid of [MEMBER, GUEST]) {
            const res = await read(uid, t._id);
            expect(res.statusCode).toBe(404);
            expect(JSON.stringify(res.body)).not.toContain('Secret plan');
        }
    });

    it('serves a task in a private project to its assignees and to owners and admins', async () => {
        const t = task(project({ isPrivateSpace: true, AssigneeUserId: [MEMBER, GUEST] }));
        for (const uid of [OWNER, ADMIN, MEMBER, GUEST]) {
            expect((await read(uid, t._id)).statusCode).toBe(200);
        }
    });

    it('serves a task in a private project to a member of an assigned team', async () => {
        const team = mockDb.seed(SCHEMA_TYPE.TEAMS_MANAGEMENT, { name: 'Core', assigneeUsersArray: [MEMBER] });
        const t = task(project({ isPrivateSpace: true, AssigneeUserId: [OWNER, `tId_${team._id}`] }));
        expect((await read(MEMBER, t._id)).statusCode).toBe(200);
        expect((await read(GUEST, t._id)).statusCode).toBe(404);
    });

    it('keeps a task in someone else\'s personal list from everyone else, owners included', async () => {
        const t = task(project({ isPersonal: true, personalOwner: MEMBER }));
        expect((await read(MEMBER, t._id)).statusCode).toBe(200);
        expect((await read(OWNER, t._id)).statusCode).toBe(404);
    });

    it('answers 404 to a user who is not in the company', async () => {
        const t = task(project());
        expect((await read(OUTSIDER, t._id)).statusCode).toBe(404);
    });

    it('answers a hidden task and a task that does not exist with the same 404', async () => {
        const hidden = await read(MEMBER, task(project({ isPrivateSpace: true, AssigneeUserId: [OWNER] }))._id);
        const missing = await read(MEMBER, '6f0000000000000000000eff');
        expect(missing.statusCode).toBe(404);
        expect(hidden.body).toEqual(missing.body);
    });

    it('refuses a malformed task id with 400', async () => {
        expect((await read(MEMBER, 'not-an-id')).statusCode).toBe(400);
    });
});
