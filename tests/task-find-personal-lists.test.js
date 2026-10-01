const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (...a) => mockDb.crud(...a),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../Modules/settings/securityPermissions/controller', () => ({ fetchRules: jest.fn(async () => []) }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));

const mongoose = require('mongoose');
const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { getTask, getTaskByQyery } = require('../Modules/Tasks/helpers/getTasksData');
const { taskScopeFor, ownerSeesTask } = require('../Modules/Agents/schedules/ownerAccess');

const C = '6f0000000000000000000e01';
const OWNER = '6f0000000000000000000e11';
const ADMIN = '6f0000000000000000000e12';
const MEMBER = '6f0000000000000000000e13';
const GUEST = '6f0000000000000000000e14';
const CHAT_SPACE = '6f0000000000000000000e99';
const ROLES = { [OWNER]: 1, [ADMIN]: 2, [MEMBER]: 3, [GUEST]: 0 };

const oid = () => new mongoose.Types.ObjectId().toString();

const response = () => {
    const res = { statusCode: 200 };
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (payload) => { res.body = payload; return res; };
    return res;
};

const find = async (uid, match = {}) => {
    const res = response();
    await getTaskByQyery({ headers: { companyid: C }, aud: C, uid, body: { findQuery: [{ $match: match }] } }, res);
    expect(res.statusCode).toBe(200);
    return res.body.map((task) => task.TaskName).sort();
};

const readable = async (uid, task) => {
    const res = response();
    await getTask({ headers: { companyid: C }, uid, params: { id: String(task._id) } }, res);
    return res.statusCode === 200;
};

const project = (over) => mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: oid(), ProjectName: 'P', isPrivateSpace: false, AssigneeUserId: [], deletedStatusKey: 0, ...over });
const personalList = (uid) => project({ ProjectName: 'Personal', isPrivateSpace: true, isPersonal: true, personalOwner: uid, AssigneeUserId: [uid] });
const task = (proj, TaskName, over) => mockDb.seed(SCHEMA_TYPE.TASKS, { _id: oid(), TaskName, ProjectID: String(proj._id), deletedStatusKey: 0, ...over });
const chat = (TaskName, people) => mockDb.seed(SCHEMA_TYPE.TASKS, { _id: oid(), TaskName, ProjectID: CHAT_SPACE, mainChat: true, AssigneeUserId: people, deletedStatusKey: 0 });

let seeded;

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    myCache.flushAll();
    Object.entries(ROLES).forEach(([userId, roleType]) => mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId, roleType, status: 2, isDelete: false }));
    mockDb.seed(SCHEMA_TYPE.MAIN_CHATS, { _id: CHAT_SPACE, default: true });
    const lists = { [OWNER]: personalList(OWNER), [ADMIN]: personalList(ADMIN), [MEMBER]: personalList(MEMBER) };
    seeded = {
        lists,
        open: task(project(), 'in a public project'),
        closed: task(project({ isPrivateSpace: true, AssigneeUserId: [MEMBER] }), 'in a private project of the member'),
        trashed: task(project({ deletedStatusKey: 1 }), 'in a trashed project'),
        orphan: task({ _id: oid() }, 'in a project that is gone'),
        ownerOwn: task(lists[OWNER], 'in the owner\'s personal list'),
        adminOwn: task(lists[ADMIN], 'in the admin\'s personal list'),
        memberOwn: task(lists[MEMBER], 'in the member\'s personal list'),
        ownerChat: chat('chat of the owner and the member', [OWNER, MEMBER]),
        othersChat: chat('chat of the member and the guest', [MEMBER, GUEST]),
    };
});

const COMPANY_WIDE = ['in a public project', 'in a private project of the member', 'in a trashed project', 'in a project that is gone'];

describe('POST /api/v1/task/find leaves a personal list to its owner', () => {
    it('gives an owner every project\'s tasks, their own personal list and their own chats', async () => {
        expect(await find(OWNER)).toEqual([...COMPANY_WIDE, 'in the owner\'s personal list', 'chat of the owner and the member'].sort());
    });

    it('gives an admin every project\'s tasks and their own personal list', async () => {
        expect(await find(ADMIN)).toEqual([...COMPANY_WIDE, 'in the admin\'s personal list'].sort());
    });

    it.each([['an owner', OWNER], ['an admin', ADMIN]])('does not find a task in someone else\'s personal list for %s, by id or by project', async (_who, uid) => {
        expect(await find(uid, { _id: String(seeded.memberOwn._id) })).toEqual([]);
        expect(await find(uid, { ProjectID: String(seeded.lists[MEMBER]._id) })).toEqual([]);
        expect(await find(uid, { TaskName: 'in the member\'s personal list' })).toEqual([]);
    });

    it.each([['an owner', OWNER], ['an admin', ADMIN]])('does not find a chat %s is not in', async (_who, uid) => {
        expect(await find(uid, { mainChat: true, AssigneeUserId: GUEST })).toEqual([]);
        expect(await find(uid, { _id: String(seeded.othersChat._id) })).toEqual([]);
    });

    it('answers the same as GET /api/v1/task/:id for personal lists and chats', async () => {
        for (const uid of [OWNER, ADMIN]) {
            for (const key of ['ownerOwn', 'adminOwn', 'memberOwn', 'ownerChat', 'othersChat', 'open', 'closed']) {
                const found = (await find(uid, { _id: String(seeded[key]._id) })).length === 1;
                expect({ uid, key, found }).toEqual({ uid, key, found: await readable(uid, seeded[key]) });
            }
        }
    });

    it('is unchanged for a member', async () => {
        expect(await find(MEMBER)).toEqual(['in a public project', 'in a private project of the member', 'in the member\'s personal list'].sort());
    });
});

describe('a schedule run as an owner reads the same tasks', () => {
    it('does not reach a task in someone else\'s personal list', async () => {
        const scope = await taskScopeFor(C, OWNER, { projectIds: [] });
        expect(await ownerSeesTask(C, scope, seeded.memberOwn._id)).toBeNull();
        expect(await ownerSeesTask(C, scope, seeded.open._id)).toMatchObject({ TaskName: 'in a public project' });
        expect(await ownerSeesTask(C, scope, seeded.ownerOwn._id)).toMatchObject({ TaskName: 'in the owner\'s personal list' });
    });

    it('keeps an agent\'s project list as the scope, without someone else\'s personal list', async () => {
        const open = String(seeded.open.ProjectID);
        const scope = await taskScopeFor(C, OWNER, { projectIds: [open, String(seeded.lists[MEMBER]._id)] });
        expect(scope.ProjectID.$in.map(String)).toEqual([open, String(seeded.lists[MEMBER]._id)]);
        expect(await ownerSeesTask(C, scope, seeded.open._id)).toMatchObject({ TaskName: 'in a public project' });
        expect(await ownerSeesTask(C, scope, seeded.memberOwn._id)).toBeNull();
    });
});
