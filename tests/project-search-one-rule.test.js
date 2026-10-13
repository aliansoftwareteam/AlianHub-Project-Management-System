const verified = require('./fixtures/verifiedRequest');
const fakeMongo = require('./fixtures/fakeMongo');

let mockDb;
jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (...args) => mockDb.crud(...args),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));

const mongoose = require('mongoose');
const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { canReadProject } = require('../Config/projectAccess');
const { projectFilter } = require('../Modules/Project/controller/getProjectFilterData');
const { resolveVisibleProjectFilter } = require('../Modules/UserDashboard/controller');

const C = 'c00000000000000000000001';
const OWNER = 'a00000000000000000000001';
const ADMIN = 'a00000000000000000000002';
const MEMBER = 'a00000000000000000000003';
const GUEST = 'a00000000000000000000004';
const OTHER_ROLE = 7;

const oid = () => new mongoose.Types.ObjectId().toString();

const NO_RULE = Symbol('no rule');
const NO_ROW = Symbol('no row');

const seedProjectRule = (key, roleType, permission) => {
    if (permission === NO_RULE) return;
    const rules = mockDb.store[SCHEMA_TYPE.RULES] || [];
    const parent = rules.find((rule) => rule.key === 'project')
        || mockDb.seed(SCHEMA_TYPE.RULES, { _id: oid(), key: 'project', isParent: true, roles: [{ key: roleType, permission: true }] });
    const roles = permission === NO_ROW ? [{ key: OTHER_ROLE, permission: 2 }] : [{ key: OTHER_ROLE, permission: 2 }, { key: roleType, permission }];
    mockDb.seed(SCHEMA_TYPE.RULES, { _id: oid(), key, isParent: false, parentId: String(parent._id), roles });
};
const seedPrivateRule = (roleType, permission) => seedProjectRule('private_projects', roleType, permission);

const seedSeat = (userId, roleType, seat = {}) => mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId, roleType, status: 2, isDelete: false, ...seat });

const seedProject = (doc = {}) => String(mockDb.seed(SCHEMA_TYPE.PROJECTS, {
    _id: oid(), ProjectName: 'Launch', isPrivateSpace: true, AssigneeUserId: [OWNER], deletedStatusKey: 0, statusType: 'active', ...doc,
})._id);

const seedPersonalList = (uid) => seedProject({ isPersonal: true, personalOwner: uid, AssigneeUserId: [uid] });

const seedTeamOf = (uid) => String(mockDb.seed(SCHEMA_TYPE.TEAMS_MANAGEMENT, { _id: oid(), name: 'Core', assigneeUsersArray: [uid] })._id);

const search = async (uid, body) => {
    const res = { statusCode: 200, body: undefined };
    res.status = jest.fn((code) => { res.statusCode = code; return res; });
    res.json = jest.fn((payload) => { res.body = payload; return res; });
    jest.spyOn(console, 'error').mockImplementation(() => {});
    myCache.flushAll();
    await projectFilter(verified({ uid, query: {}, params: {}, body, headers: { companyid: C } }), res);
    expect(res.statusCode).toBe(200);
    return res.body;
};

const SEARCHES = [
    { type: 'projectName', search: 'Launch', fields: 'ProjectName' },
    { type: 'projectFilter', query: { $and: [] }, sortByField: {}, fields: 'ProjectName' },
];

const searchedIds = async (uid) => {
    const [byName, byFilter] = await Promise.all(SEARCHES.map(async (body) => (await search(uid, body)).map((p) => String(p._id)).sort()));
    expect(byFilter).toEqual(byName);
    return byName;
};

const onDashboard = async (uid, projectId) => {
    myCache.flushAll();
    const filter = await resolveVisibleProjectFilter(C, uid);
    const project = mockDb.store[SCHEMA_TYPE.PROJECTS].find((p) => String(p._id) === projectId);
    return fakeMongo.matches(project, filter || {});
};

const answers = async (uid, projectId) => ({
    searched: (await searchedIds(uid)).includes(projectId),
    dashboard: await onDashboard(uid, projectId),
    readable: (await canReadProject(C, uid, projectId)).allowed,
});

const all = (value) => ({ searched: value, dashboard: value, readable: value });

const VALUES = [
    ['no rule at all', NO_RULE],
    ['no row for the role', NO_ROW],
    ['false', false],
    ['true', true],
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

afterEach(() => jest.restoreAllMocks());

describe.each(PEOPLE)('the project search, the dashboard filter and a private project, for a %s', (_label, uid, roleType) => {
    const cases = VALUES.flatMap(([valueLabel, permission]) => ASSIGNMENTS.map(([assignmentLabel, assignees, assigned]) => (
        [valueLabel, assignmentLabel, permission, assignees, assigned || permission === 2]
    )));

    it.each(cases)('private_projects %s, %s: both agree with the project read', async (_value, _assignment, permission, assignees, expected) => {
        seedPrivateRule(roleType, permission);
        const projectId = seedProject({ AssigneeUserId: assignees(uid) });
        expect(await answers(uid, projectId)).toEqual(all(expected));
    });
});

describe('a public project', () => {
    it.each(VALUES)('is found by a member it is not assigned to when private_projects is %s', async (_value, permission) => {
        seedPrivateRule(3, permission);
        const projectId = seedProject({ isPrivateSpace: false, AssigneeUserId: [] });
        expect(await answers(MEMBER, projectId)).toEqual(all(true));
    });

    it.each([
        ['no rule at all', NO_RULE],
        ['no row for the role', NO_ROW],
        ['false', false],
        ['true', true],
    ])('is found by a member and a guest it is not assigned to when public_projects is %s', async (_value, permission) => {
        seedProjectRule('public_projects', 3, permission);
        const projectId = seedProject({ isPrivateSpace: false, AssigneeUserId: [] });
        expect(await answers(MEMBER, projectId)).toEqual(all(true));
        expect(await answers(GUEST, projectId)).toEqual(all(true));
    });
});

describe('owners and admins', () => {
    it.each(VALUES)('find every private project when private_projects is %s', async (_value, permission) => {
        seedPrivateRule(3, permission);
        const projectId = seedProject();
        const unassigned = seedProject({ AssigneeUserId: [] });
        for (const uid of [OWNER, ADMIN]) {
            expect(await answers(uid, projectId)).toEqual(all(true));
            expect(await answers(uid, unassigned)).toEqual(all(true));
        }
    });
});

describe('a personal list', () => {
    it('is found by its owner alone, whatever their role', async () => {
        seedPrivateRule(3, 2);
        const lists = { [OWNER]: seedPersonalList(OWNER), [ADMIN]: seedPersonalList(ADMIN), [MEMBER]: seedPersonalList(MEMBER) };
        for (const viewer of [OWNER, ADMIN, MEMBER, GUEST]) {
            for (const [holder, projectId] of Object.entries(lists)) {
                expect({ viewer, holder, ...(await answers(viewer, projectId)) }).toEqual({ viewer, holder, ...all(viewer === holder) });
            }
        }
    });
});

describe('what the search leaves alone', () => {
    it('leaves out a closed and a deleted project', async () => {
        seedProject({ isPrivateSpace: false, statusType: 'close' });
        seedProject({ isPrivateSpace: false, deletedStatusKey: 1 });
        const open = seedProject({ isPrivateSpace: false });
        expect(await searchedIds(MEMBER)).toEqual([open]);
        expect(await searchedIds(OWNER)).toEqual([open]);
    });

    it('still matches the project name it is given', async () => {
        const launch = seedProject({ isPrivateSpace: false });
        seedProject({ isPrivateSpace: false, ProjectName: 'Billing' });
        const found = await search(MEMBER, { type: 'projectName', search: 'laun', fields: 'ProjectName' });
        expect(found.map((p) => String(p._id))).toEqual([launch]);
    });
});

describe('the archive search follows project and sprint visibility', () => {
    const projectOid = (projectId) => new mongoose.Types.ObjectId(projectId);

    const seedArchive = (projectId, label, sprint = {}) => {
        const folder = mockDb.seed(SCHEMA_TYPE.FOLDERS, { _id: oid(), name: `${label} folder`, projectId: projectOid(projectId), deletedStatusKey: 2 });
        mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: oid(), name: `${label} sprint`, projectId: projectOid(projectId), deletedStatusKey: 2, ...sprint });
        mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: oid(), name: `${label} sprint with archived tasks`, projectId: projectOid(projectId), deletedStatusKey: 0, archiveTaskCount: 3, folderId: folder._id, ...sprint });
    };

    const archived = async (uid) => {
        const body = await search(uid, { type: 'showArchiveOnly' });
        expect(body).toHaveLength(1);
        return {
            sprints: body[0].matchedDocuments.map((sprint) => sprint.name).sort(),
            folders: body[0].additionalFolders.map((folder) => folder.name).sort(),
        };
    };

    const everythingOf = (...labels) => ({
        sprints: labels.flatMap((label) => [`${label} sprint`, `${label} sprint with archived tasks`]).sort(),
        folders: labels.map((label) => `${label} folder`).sort(),
    });

    beforeEach(() => {
        seedPrivateRule(3, 1);
        seedArchive(seedProject({ isPrivateSpace: false, AssigneeUserId: [] }), 'public');
        seedArchive(seedProject({ AssigneeUserId: [OWNER] }), 'private');
    });

    it('gives a member nothing from a private project they are not on', async () => {
        expect(await archived(MEMBER)).toEqual(everythingOf('public'));
    });

    it('gives a member the archive of a private project they are assigned to, directly or through a team', async () => {
        seedArchive(seedProject({ AssigneeUserId: [MEMBER] }), 'assigned');
        seedArchive(seedProject({ AssigneeUserId: [`tId_${seedTeamOf(MEMBER)}`] }), 'team');
        expect(await archived(MEMBER)).toEqual(everythingOf('assigned', 'public', 'team'));
    });

    it('gives an owner and an admin the archive of every project', async () => {
        seedArchive(seedProject({ isPrivateSpace: false, deletedStatusKey: 1 }), 'trashed');
        expect(await archived(OWNER)).toEqual(everythingOf('private', 'public', 'trashed'));
        expect(await archived(ADMIN)).toEqual(everythingOf('private', 'public', 'trashed'));
    });

    it('joins each sprint to its folder', async () => {
        const body = await search(OWNER, { type: 'showArchiveOnly' });
        const inFolder = body[0].matchedDocuments.find((sprint) => sprint.name === 'public sprint with archived tasks');
        expect(inFolder.folderData.map((folder) => folder.name)).toEqual(['public folder']);
        expect(inFolder).not.toHaveProperty('source');
    });

    it('keeps a private sprint to the people it is shared with, and to owners and admins', async () => {
        const projectId = seedProject({ isPrivateSpace: false, AssigneeUserId: [], ProjectName: 'Sprints' });
        mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: oid(), name: 'shared with the guest', projectId: projectOid(projectId), deletedStatusKey: 2, private: true, AssigneeUserId: [GUEST] });
        expect((await archived(MEMBER)).sprints).not.toContain('shared with the guest');
        expect((await archived(GUEST)).sprints).toContain('shared with the guest');
        expect((await archived(OWNER)).sprints).toContain('shared with the guest');
    });

    it('keeps the archive of a personal list to its owner', async () => {
        seedArchive(seedPersonalList(MEMBER), 'personal');
        expect(await archived(MEMBER)).toEqual(everythingOf('personal', 'public'));
        expect(await archived(OWNER)).toEqual(everythingOf('private', 'public'));
        expect(await archived(ADMIN)).toEqual(everythingOf('private', 'public'));
    });
});

describe('the fields a search returns', () => {
    const SEARCHED = [
        ['by project name', { type: 'projectName', search: 'Launch' }],
        ['by saved filter', { type: 'projectFilter', query: { $and: [] }, sortByField: {} }],
        ['by saved filter and project name', { type: 'projectFilter_projectName', search: 'Launch', query: { $and: [] }, sortByField: {} }],
    ];

    beforeEach(() => {
        seedProject({ isPrivateSpace: false, AssigneeUserId: [], ProjectCode: 'LAU', budget: 9000, taskStatusData: [{ key: 1 }] });
    });

    it.each(SEARCHED)('%s: are the project id when the caller names none', async (_label, body) => {
        const [found] = await search(MEMBER, body);
        expect(Object.keys(found)).toEqual(['_id']);
    });

    it.each(SEARCHED)('%s: are the id and the name, whatever else the caller names', async (_label, body) => {
        const [found] = await search(MEMBER, { ...body, fields: 'ProjectName, budget,taskStatusData,AssigneeUserId,$$ROOT,sprints.name' });
        expect(Object.keys(found).sort()).toEqual(['ProjectName', '_id']);
        const [forOwner] = await search(OWNER, { ...body, fields: 'ProjectName,budget' });
        expect(Object.keys(forOwner).sort()).toEqual(['ProjectName', '_id']);
    });

    it.each(SEARCHED)('%s: are the project id when fields is not text', async (_label, body) => {
        const [found] = await search(MEMBER, { ...body, fields: { budget: 1 } });
        expect(Object.keys(found)).toEqual(['_id']);
    });
});

describe('a search that joins sprints follows sprint visibility', () => {
    const JOINED = [
        ['by sprint name', { type: 'sprint', search: 'Plan' }],
        ['by folder name', { type: 'folder', search: 'Plan' }],
        ['by saved filter and sprint name', { type: 'projectFilter_sprint', search: 'Plan', query: { $and: [] }, sortByField: {} }],
        ['by saved filter and folder name', { type: 'projectFilter_folder', search: 'Plan', query: { $and: [] }, sortByField: {} }],
    ];
    const PRIVATE_SPRINT = { name: 'Plan', deletedStatusKey: 0, private: true, AssigneeUserId: [GUEST] };
    const OPEN_SPRINT = { name: 'Plan', deletedStatusKey: 0 };

    /* The fake has no join by `let`, so the sprint join is read from the pipeline and its plain matches are applied to the row. */
    const joinsSprint = async (uid, body, sprint) => {
        const real = mockDb.crud;
        let pipeline = null;
        mockDb.crud = (companyId, query, method) => {
            if (method !== 'aggregate') return real(companyId, query, method);
            [pipeline] = query.data;
            return Promise.resolve([]);
        };
        try {
            await search(uid, body);
        } finally {
            mockDb.crud = real;
        }
        const joins = pipeline.filter((stage) => stage.$lookup && stage.$lookup.from === 'sprints');
        expect(joins).toHaveLength(1);
        return joins[0].$lookup.pipeline
            .filter((stage) => stage.$match && !stage.$match.$expr)
            .every((stage) => fakeMongo.matches(sprint, stage.$match));
    };

    it.each(JOINED)('%s: a private sprint is joined for the people it is shared with, and for owners and admins', async (_label, body) => {
        expect(await joinsSprint(MEMBER, body, PRIVATE_SPRINT)).toBe(false);
        expect(await joinsSprint(GUEST, body, PRIVATE_SPRINT)).toBe(true);
        expect(await joinsSprint(OWNER, body, PRIVATE_SPRINT)).toBe(true);
        expect(await joinsSprint(ADMIN, body, PRIVATE_SPRINT)).toBe(true);
    });

    it.each(JOINED)('%s: a sprint shared with a team is joined for its members', async (_label, body) => {
        const sprint = { ...PRIVATE_SPRINT, AssigneeUserId: [`tId_${seedTeamOf(MEMBER)}`] };
        expect(await joinsSprint(MEMBER, body, sprint)).toBe(true);
        expect(await joinsSprint(GUEST, body, sprint)).toBe(false);
    });

    it.each(JOINED)('%s: an open sprint is joined for everyone', async (_label, body) => {
        expect(await joinsSprint(MEMBER, body, OPEN_SPRINT)).toBe(true);
        expect(await joinsSprint(GUEST, body, OPEN_SPRINT)).toBe(true);
    });
});
