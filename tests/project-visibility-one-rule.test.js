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
const { runNarrowed } = require('../Config/tokenNarrowing');
const { canReadProject } = require('../Config/projectAccess');
const { visibleProjects, visibleProjectIds } = require('../Modules/Agents/scope');

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

const seedProject = (doc = {}) => String(mockDb.seed(SCHEMA_TYPE.PROJECTS, {
    _id: oid(), ProjectName: 'Launch', isPrivateSpace: true, AssigneeUserId: [OWNER], deletedStatusKey: 0, ...doc,
})._id);

const seedTeamOf = (uid) => String(mockDb.seed(SCHEMA_TYPE.TEAMS_MANAGEMENT, { _id: oid(), name: 'Core', assigneeUsersArray: [uid] })._id);

const answers = async (uid, projectId) => ({
    listed: (await visibleProjectIds(C, uid)).includes(projectId),
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
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: OWNER, roleType: 1, status: 2, isDelete: false });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: ADMIN, roleType: 2, status: 2, isDelete: false });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: MEMBER, roleType: 3, status: 2, isDelete: false });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: GUEST, roleType: 0, status: 2, isDelete: false });
});

describe.each(PEOPLE)('a private project, for a %s', (_label, uid, roleType) => {
    const cases = VALUES.flatMap(([valueLabel, permission]) => ASSIGNMENTS.map(([assignmentLabel, assignees, assigned]) => (
        [valueLabel, assignmentLabel, permission, assignees, assigned || permission === 2]
    )));

    it.each(cases)('private_projects %s, %s: the project list and the project read agree', async (_value, _assignment, permission, assignees, expected) => {
        seedPrivateRule(roleType, permission);
        const projectId = seedProject({ AssigneeUserId: assignees(uid) });
        expect(await answers(uid, projectId)).toEqual(both(expected));
    });
});

describe('what the rule leaves alone', () => {
    it.each(VALUES)('lists and reads a public project when private_projects is %s', async (_value, permission) => {
        seedPrivateRule(3, permission);
        const projectId = seedProject({ isPrivateSpace: false, AssigneeUserId: [] });
        expect(await answers(MEMBER, projectId)).toEqual(both(true));
    });

    it.each(VALUES)('lists and reads every private project for an owner and an admin when private_projects is %s', async (_value, permission) => {
        seedPrivateRule(3, permission);
        const projectId = seedProject();
        const unassigned = seedProject({ AssigneeUserId: [] });
        for (const uid of [OWNER, ADMIN]) {
            expect(await answers(uid, projectId)).toEqual(both(true));
            expect(await answers(uid, unassigned)).toEqual(both(true));
        }
    });

    it('lists only the projects a member is assigned to among several private ones', async () => {
        seedPrivateRule(3, NO_ROW);
        const mine = seedProject({ AssigneeUserId: [MEMBER], ProjectName: 'Mine' });
        seedProject({ ProjectName: 'Theirs' });
        const open = seedProject({ isPrivateSpace: false, AssigneeUserId: [], ProjectName: 'Open' });
        expect((await visibleProjects(C, MEMBER)).map((p) => String(p._id)).sort()).toEqual([mine, open].sort());
    });
});

describe('the list stays narrower than the project read where it already was', () => {
    beforeEach(() => seedPrivateRule(3, 2));

    it('leaves out a deleted project', async () => {
        const projectId = seedProject({ deletedStatusKey: 1 });
        expect(await visibleProjectIds(C, MEMBER)).not.toContain(projectId);
    });

    it("leaves out someone else's personal list and keeps the member's own", async () => {
        const theirs = seedProject({ isPersonal: true, personalOwner: OWNER });
        const mine = seedProject({ isPersonal: true, personalOwner: MEMBER, AssigneeUserId: [MEMBER] });
        expect(await visibleProjectIds(C, MEMBER)).toEqual([mine]);
        expect((await canReadProject(C, MEMBER, theirs)).allowed).toBe(false);
    });

    it('leaves out a project outside the list a token is narrowed to', async () => {
        const inside = seedProject();
        const outside = seedProject();
        const ids = await runNarrowed({ userId: MEMBER, projectIds: [inside] }, () => visibleProjectIds(C, MEMBER));
        expect(ids).toEqual([inside]);
        expect(await visibleProjectIds(C, MEMBER)).toEqual(expect.arrayContaining([inside, outside]));
    });
});
