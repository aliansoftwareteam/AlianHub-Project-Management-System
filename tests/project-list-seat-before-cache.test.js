const verified = require('./fixtures/verifiedRequest');
const fakeMongo = require('./fixtures/fakeMongo');

let mockDb;
jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (...args) => mockDb.crud(...args),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Modules/Audit/recorder', () => ({ recordAuditFromReq: jest.fn(), recordAudit: jest.fn() }));
jest.mock('../utils/data', () => ({ importUserNotifications: jest.fn(async () => undefined) }));
jest.mock('../Modules/Auth/controller/authHelpers', () => ({ addAndRemoveUserInMongodbNotificationCount: jest.fn(async () => {}) }));

const mongoose = require('mongoose');
const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { getProjectList } = require('../Modules/Project/controller/getProjectList');
const { updateSecurityPermissions } = require('../Modules/settings/securityPermissions/controller');
const members = require('../Modules/settings/Members/controller');
const scim = require('../Modules/Scim/provisioning');
const { updateTeam } = require('../Modules/Teams/controller');
const { updateProjectInternal } = require('../Modules/Project/controller/updateProject');

const C = 'c00000000000000000000001';
const OTHER_COMPANY = 'c00000000000000000000002';
const OWNER = 'a00000000000000000000001';
const ADMIN = 'a00000000000000000000002';
const MEMBER = 'a00000000000000000000003';
const OTHER_MEMBER = 'a00000000000000000000004';
const MEMBER_ROLE = 3;

const oid = () => new mongoose.Types.ObjectId().toString();
const cacheKey = (uid, companyId = C) => `UserProjectData:${companyId}:${uid}`;

const seedSeat = (userId, roleType, seat = {}) => mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, {
    _id: oid(), userId, roleType, status: 2, isDelete: false, companyId: C, designation: 0, userEmail: `${userId}@e2e.test`, ...seat,
});
const seatOf = (userId) => mockDb.store[SCHEMA_TYPE.COMPANY_USERS].find((row) => row.userId === userId);

const seedPrivateRule = (permission) => {
    const parent = mockDb.seed(SCHEMA_TYPE.RULES, { _id: oid(), key: 'project', isParent: true, roles: [{ key: MEMBER_ROLE, permission: true }] });
    return String(mockDb.seed(SCHEMA_TYPE.RULES, {
        _id: oid(), key: 'private_projects', isParent: false, parentId: String(parent._id), roles: [{ key: MEMBER_ROLE, permission }],
    })._id);
};

const seedProject = (doc = {}) => String(mockDb.seed(SCHEMA_TYPE.PROJECTS, {
    _id: oid(), ProjectName: 'Launch', isPrivateSpace: true, AssigneeUserId: [OWNER], deletedStatusKey: 0, ...doc,
})._id);

const response = () => {
    const res = { statusCode: 200, body: undefined };
    res.status = jest.fn((code) => { res.statusCode = code; return res; });
    res.json = jest.fn((body) => { res.body = body; return res; });
    res.send = res.json;
    res.set = jest.fn(() => res);
    return res;
};

const call = async (handler, { uid, body = {}, query = {} }) => {
    const res = response();
    await handler(verified({ uid, query, params: {}, body, headers: { companyid: C } }), res, () => {});
    return res;
};

const list = (uid) => call(getProjectList, { uid });

const listedIds = async (uid) => {
    const res = await list(uid);
    expect(res.statusCode).toBe(200);
    return res.body.map((project) => String(project._id));
};

const servedFromCache = (res) => res.set.mock.calls.some(([headers]) => headers && headers.FromCache === 'true');

beforeEach(() => {
    myCache.flushAll();
    mockDb = fakeMongo.create();
    seedSeat(OWNER, 1);
    seedSeat(ADMIN, 2);
    seedSeat(MEMBER, MEMBER_ROLE);
    seedSeat(OTHER_MEMBER, MEMBER_ROLE);
});

describe('GET /api/v1/project reads the seat before its cache', () => {
    it('serves an active seat its cached list on the second call', async () => {
        const projectId = seedProject({ AssigneeUserId: [MEMBER] });
        expect(await listedIds(MEMBER)).toEqual([projectId]);

        const second = await list(MEMBER);
        expect(servedFromCache(second)).toBe(true);
        expect(second.body.map((project) => String(project._id))).toEqual([projectId]);
    });

    it.each([
        ['removed', { isDelete: true }],
        ['back to an invitation not yet accepted', { status: 1 }],
        ['cancelled', { status: 3 }],
        ['deactivated', { status: 0, isDelete: true }],
    ])('lists nothing on the next call once the seat is %s', async (_label, seat) => {
        const projectId = seedProject({ AssigneeUserId: [MEMBER] });
        expect(await listedIds(MEMBER)).toEqual([projectId]);

        Object.assign(seatOf(MEMBER), seat);
        const next = await list(MEMBER);
        expect(next.statusCode).toBe(200);
        expect(next.body).toEqual([]);
        expect(servedFromCache(next)).toBe(false);
    });

    it.each([
        ['an invitation not yet accepted', { status: 1 }],
        ['a removed member', { isDelete: true }],
        ['a removed admin', { isDelete: true, roleType: 2 }],
    ])('neither reads nor writes the cache for %s', async (_label, seat) => {
        const uid = 'a00000000000000000000009';
        seedSeat(uid, MEMBER_ROLE, seat);
        seedProject({ isPrivateSpace: false, AssigneeUserId: [] });
        myCache.set(cacheKey(uid), JSON.stringify([{ _id: 'kept-from-before' }]), 480);

        expect(await listedIds(uid)).toEqual([]);
        expect(JSON.parse(myCache.get(cacheKey(uid)))).toEqual([{ _id: 'kept-from-before' }]);

        myCache.del(cacheKey(uid));
        expect(await listedIds(uid)).toEqual([]);
        expect(myCache.has(cacheKey(uid))).toBe(false);
    });

    it('neither reads nor writes the cache for someone with no seat at all', async () => {
        const uid = 'a00000000000000000000008';
        seedProject({ isPrivateSpace: false, AssigneeUserId: [] });
        expect(await listedIds(uid)).toEqual([]);
        expect(myCache.has(cacheKey(uid))).toBe(false);
    });
});

describe('what drops a cached project list', () => {
    it('a rule save drops every cached list of that company, and none of another', async () => {
        const ruleId = seedPrivateRule(2);
        const projectId = seedProject();
        expect(await listedIds(MEMBER)).toEqual([projectId]);
        expect(await listedIds(OTHER_MEMBER)).toEqual([projectId]);
        myCache.set(cacheKey(MEMBER, OTHER_COMPANY), '[]', 480);

        const saved = await call(updateSecurityPermissions, {
            uid: OWNER,
            body: { type: 'updateOne', key: '$set', id: ruleId, updateObject: { roles: [{ key: MEMBER_ROLE, permission: 1 }] } },
        });
        expect(saved.statusCode).toBe(200);

        expect(myCache.has(cacheKey(MEMBER))).toBe(false);
        expect(myCache.has(cacheKey(OTHER_MEMBER))).toBe(false);
        expect(myCache.has(cacheKey(MEMBER, OTHER_COMPANY))).toBe(true);
        expect(await listedIds(MEMBER)).toEqual([]);
        expect(await listedIds(OTHER_MEMBER)).toEqual([]);
    });

    it('a role change drops that member\'s cached list', async () => {
        const projectId = seedProject();
        expect(await listedIds(ADMIN)).toEqual([projectId]);

        const changed = await call(members.updateMember, { uid: OWNER, body: { id: String(seatOf(ADMIN)._id), data: { roleType: MEMBER_ROLE } } });
        expect(changed.statusCode).toBe(200);

        expect(myCache.has(cacheKey(ADMIN))).toBe(false);
        expect(await listedIds(ADMIN)).toEqual([]);
    });

    it('a removal drops that member\'s cached list', async () => {
        const projectId = seedProject({ AssigneeUserId: [MEMBER] });
        expect(await listedIds(MEMBER)).toEqual([projectId]);

        const removed = await call(members.updateMember, { uid: OWNER, body: { id: String(seatOf(MEMBER)._id), data: { isDelete: true } } });
        expect(removed.statusCode).toBe(200);

        expect(myCache.has(cacheKey(MEMBER))).toBe(false);
        expect(await listedIds(MEMBER)).toEqual([]);
    });

    it('a deactivation through provisioning drops that member\'s cached list, and nobody else\'s', async () => {
        const projectId = seedProject({ AssigneeUserId: [MEMBER, OTHER_MEMBER] });
        expect(await listedIds(MEMBER)).toEqual([projectId]);
        expect(await listedIds(OTHER_MEMBER)).toEqual([projectId]);

        await scim.setActive(C, MEMBER, false);

        expect(myCache.has(cacheKey(MEMBER))).toBe(false);
        expect(myCache.has(cacheKey(OTHER_MEMBER))).toBe(true);
    });

    it('a new invitation with another role drops that member\'s cached list', async () => {
        const projectId = seedProject();
        expect(await listedIds(ADMIN)).toEqual([projectId]);

        await members.updateMemberFunction(C, [
            { userEmail: seatOf(ADMIN).userEmail },
            { $set: { status: 1, roleType: MEMBER_ROLE, isDelete: false } },
            { returnDocument: 'after' },
        ], 'findOneAndUpdate');

        expect(myCache.has(cacheKey(ADMIN))).toBe(false);
    });

    it('a team losing a member drops the cached lists of that company', async () => {
        const team = mockDb.seed(SCHEMA_TYPE.TEAMS_MANAGEMENT, { _id: oid(), name: 'Core', value: 'CORE', assigneeUsersArray: [MEMBER] });
        const projectId = seedProject({ AssigneeUserId: [`tId_${team._id}`] });
        expect(await listedIds(MEMBER)).toEqual([projectId]);
        myCache.set(cacheKey(MEMBER, OTHER_COMPANY), '[]', 480);

        const updated = await call(updateTeam, { uid: OWNER, body: { id: String(team._id), key: '$pull', updateObject: { assigneeUsersArray: MEMBER } } });
        expect(updated.statusCode).toBe(200);

        expect(myCache.has(cacheKey(MEMBER, OTHER_COMPANY))).toBe(true);
        expect(await listedIds(MEMBER)).toEqual([]);
    });

    it('a project turning private drops the cached lists', async () => {
        const projectId = seedProject({ isPrivateSpace: false, AssigneeUserId: [] });
        expect(await listedIds(MEMBER)).toEqual([projectId]);

        await updateProjectInternal(C, projectId, { isPrivateSpace: true }, '$set');

        expect(await listedIds(MEMBER)).toEqual([]);
    });

    it('a project losing an assignee drops the cached lists', async () => {
        const projectId = seedProject({ AssigneeUserId: [MEMBER] });
        expect(await listedIds(MEMBER)).toEqual([projectId]);

        await updateProjectInternal(C, projectId, { AssigneeUserId: MEMBER }, '$pull');

        expect(await listedIds(MEMBER)).toEqual([]);
    });
});
