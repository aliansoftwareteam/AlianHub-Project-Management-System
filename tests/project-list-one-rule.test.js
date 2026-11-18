const verified = require('./fixtures/verifiedRequest');
const fakeMongo = require('./fixtures/fakeMongo');

let mockDb;
jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (...args) => mockDb.crud(...args),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));

const mongoose = require('mongoose');
const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { canReadProject } = require('../Config/projectAccess');
const { getProjectList } = require('../Modules/Project/controller/getProjectList');

const C = 'c00000000000000000000001';
const OWNER = 'a00000000000000000000001';
const ADMIN = 'a00000000000000000000002';
const MEMBER = 'a00000000000000000000003';
const GUEST = 'a00000000000000000000004';
const OTHER_ROLE = 7;

const oid = () => new mongoose.Types.ObjectId().toString();

const NO_RULE = Symbol('no rule');
const NO_ROW = Symbol('no row');

const seedPrivateRule = (roleType, permission) => {
    if (permission === NO_RULE) return;
    const parent = mockDb.seed(SCHEMA_TYPE.RULES, { _id: oid(), key: 'project', isParent: true, roles: [{ key: roleType, permission: true }] });
    const roles = permission === NO_ROW ? [{ key: OTHER_ROLE, permission: 2 }] : [{ key: OTHER_ROLE, permission: 2 }, { key: roleType, permission }];
    mockDb.seed(SCHEMA_TYPE.RULES, { _id: oid(), key: 'private_projects', isParent: false, parentId: String(parent._id), roles });
};

const seedSeat = (userId, roleType, seat = {}) => mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId, roleType, status: 2, isDelete: false, ...seat });

const seedProject = (doc = {}) => String(mockDb.seed(SCHEMA_TYPE.PROJECTS, {
    _id: oid(), ProjectName: 'Launch', isPrivateSpace: true, AssigneeUserId: [OWNER], deletedStatusKey: 0, ...doc,
})._id);

const seedTeamOf = (uid) => String(mockDb.seed(SCHEMA_TYPE.TEAMS_MANAGEMENT, { _id: oid(), name: 'Core', assigneeUsersArray: [uid] })._id);

const list = async (uid, query = {}) => {
    const res = { statusCode: 200, body: undefined };
    res.status = jest.fn((code) => { res.statusCode = code; return res; });
    res.json = jest.fn((body) => { res.body = body; return res; });
    res.set = jest.fn(() => res);
    myCache.flushAll();
    await getProjectList(verified({ uid, query, params: {}, body: {}, headers: { companyid: C } }), res);
    return res;
};

const listedIds = async (uid) => {
    const res = await list(uid);
    expect(res.statusCode).toBe(200);
    return res.body.map((p) => String(p._id));
};

const answers = async (uid, projectId) => ({
    listed: (await listedIds(uid)).includes(projectId),
    readable: (await canReadProject(C, uid, projectId)).allowed,
});

const both = (value) => ({ listed: value, readable: value });

const VALUES = [
    ['no rule at all', NO_RULE],
    ['no row for the role', NO_ROW],
    ['false', false],
    ['0', 0],
    ['null', null],
    ['1', 1],
    ['2', 2],
];

const ASSIGNMENTS = [
    ['not assigned', () => [OWNER], false],
    ['assigned directly', (uid) => [uid], true],
    ['assigned through a team', (uid) => [`tId_${seedTeamOf(uid)}`], true],
];

const PEOPLE = [
    ['member', MEMBER, 3],
    ['guest', GUEST, 0],
];

beforeEach(() => {
    myCache.flushAll();
    mockDb = fakeMongo.create();
    seedSeat(OWNER, 1);
    seedSeat(ADMIN, 2);
    seedSeat(MEMBER, 3);
    seedSeat(GUEST, 0);
});

describe.each(PEOPLE)('GET /api/v1/project and a private project, for a %s', (_label, uid, roleType) => {
    const cases = VALUES.flatMap(([valueLabel, permission]) => ASSIGNMENTS.map(([assignmentLabel, assignees, assigned]) => (
        [valueLabel, assignmentLabel, permission, assignees, assigned || permission === 2]
    )));

    it.each(cases)('private_projects %s, %s: the list and the project read agree', async (_value, _assignment, permission, assignees, expected) => {
        seedPrivateRule(roleType, permission);
        const projectId = seedProject({ AssigneeUserId: assignees(uid) });
        expect(await answers(uid, projectId)).toEqual(both(expected));
    });
});

describe('what the rule leaves alone', () => {
    it.each(VALUES)('lists a public project when private_projects is %s', async (_value, permission) => {
        seedPrivateRule(3, permission);
        const projectId = seedProject({ isPrivateSpace: false, AssigneeUserId: [] });
        expect(await answers(MEMBER, projectId)).toEqual(both(true));
    });

    it.each(VALUES)('lists every private project for an owner and an admin when private_projects is %s', async (_value, permission) => {
        seedPrivateRule(3, permission);
        const projectId = seedProject();
        const unassigned = seedProject({ AssigneeUserId: [] });
        for (const uid of [OWNER, ADMIN]) {
            expect(await answers(uid, projectId)).toEqual(both(true));
            expect(await answers(uid, unassigned)).toEqual(both(true));
        }
    });

    it('returns the whole project document without its legacy id', async () => {
        seedPrivateRule(3, 1);
        const projectId = seedProject({ AssigneeUserId: [MEMBER], ProjectCode: 'LCH', legacyId: 'old-1', sprintsObj: { a: { name: 'Sprint 1' } } });
        const res = await list(MEMBER);
        expect(res.body).toEqual([expect.objectContaining({ _id: projectId, ProjectName: 'Launch', ProjectCode: 'LCH', AssigneeUserId: [MEMBER], sprintsObj: { a: { name: 'Sprint 1' } } })]);
        expect(res.body[0]).not.toHaveProperty('legacyId');
    });

    it('leaves out a deleted project, and a personal list that is someone else\'s', async () => {
        seedPrivateRule(3, 2);
        seedProject({ deletedStatusKey: 1 });
        seedProject({ isPrivateSpace: false, deletedStatusKey: 1 });
        seedProject({ isPersonal: true, personalOwner: OWNER });
        const mine = seedProject({ isPersonal: true, personalOwner: MEMBER, AssigneeUserId: [MEMBER] });
        expect(await listedIds(MEMBER)).toEqual([mine]);
        expect(await listedIds(ADMIN)).toEqual([]);
    });
});

describe('a seat that is not active', () => {
    it.each([
        ['an invitation not yet accepted', { status: 1 }],
        ['a removed member', { isDelete: true }],
        ['a removed admin', { isDelete: true, roleType: 2 }],
    ])('lists nothing for %s', async (_label, seat) => {
        const uid = 'a00000000000000000000009';
        seedSeat(uid, 3, seat);
        seedPrivateRule(3, 2);
        const secret = seedProject();
        seedProject({ isPrivateSpace: false, AssigneeUserId: [] });
        expect(await listedIds(uid)).toEqual([]);
        expect((await canReadProject(C, uid, secret)).allowed).toBe(false);
    });

    it('lists nothing for someone with no seat at all', async () => {
        seedProject({ isPrivateSpace: false, AssigneeUserId: [] });
        expect(await listedIds('a00000000000000000000008')).toEqual([]);
    });
});
