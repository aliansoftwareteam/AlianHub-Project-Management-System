const verified = require('./fixtures/verifiedRequest');
const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../Modules/Pages/helpers/pageAi', () => ({ composePage: jest.fn(), isAiConfigured: () => false }));

const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { READ, requireProjectAccess } = require('../Config/projectAccess');
const { requireSprintAccess } = require('../Modules/Sprints/helpers/sprintVisibility');
const pages = require('../Modules/Pages/controller');
const { explain } = require('../Modules/WhoCanSee/helpers/explain');
const { whoCanSee } = require('../Modules/WhoCanSee/controller');

const C = '6f0000000000000000000c01';
const OWNER = '6f0000000000000000000001';
const ADMIN = '6f0000000000000000000002';
const ASSIGNED = '6f0000000000000000000003';
const IN_TEAM = '6f0000000000000000000004';
const BYSTANDER = '6f0000000000000000000005';
const GUEST_IN = '6f0000000000000000000006';
const GUEST_OUT = '6f0000000000000000000007';
const AUDITOR = '6f0000000000000000000008';
const REMOVED = '6f0000000000000000000009';
const STRANGER = '6f000000000000000000000a';

const PRIVATE_PROJECT = '6f00000000000000000000a1';
const PUBLIC_PROJECT = '6f00000000000000000000a2';
const TEAM = '6f00000000000000000000b1';

const AUDITOR_ROLE = 4;
const SEATS = { [OWNER]: 1, [ADMIN]: 2, [ASSIGNED]: 3, [IN_TEAM]: 3, [BYSTANDER]: 3, [GUEST_IN]: 0, [GUEST_OUT]: 0, [AUDITOR]: AUDITOR_ROLE };
const EVERYONE = [...Object.keys(SEATS), REMOVED, STRANGER];

const rule = (parentId, key, roles) => ({ parentId, key, roles: Object.entries(roles).map(([role, permission]) => ({ key: Number(role), permission })) });

const seedRules = () => {
    const project = mockDb.seed(SCHEMA_TYPE.RULES, { isParent: true, key: 'project', roles: [] });
    const task = mockDb.seed(SCHEMA_TYPE.RULES, { isParent: true, key: 'task', roles: [] });
    mockDb.seed(SCHEMA_TYPE.RULES, rule(project._id, 'private_projects', { 3: 1, 0: 1, [AUDITOR_ROLE]: 2 }));
    mockDb.seed(SCHEMA_TYPE.RULES, rule(project._id, 'project_details', { 3: false, 0: false, [AUDITOR_ROLE]: false }));
    mockDb.seed(SCHEMA_TYPE.RULES, rule(project._id, 'project_sprint_create', { 3: true, 0: false, [AUDITOR_ROLE]: false }));
    mockDb.seed(SCHEMA_TYPE.RULES, rule(task._id, 'task_create', { 3: true, 0: false, [AUDITOR_ROLE]: false }));
};

const seedCompany = () => {
    Object.entries(SEATS).forEach(([userId, roleType]) => mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId, roleType, status: 2, userEmail: `${userId}@example.test` }));
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: REMOVED, roleType: 3, status: 2, isDelete: true });
    mockDb.seed(SCHEMA_TYPE.TEAMS_MANAGEMENT, { _id: TEAM, name: 'Design', assigneeUsersArray: [IN_TEAM, BYSTANDER] });
    mockDb.seed(SCHEMA_TYPE.PROJECTS, {
        _id: PRIVATE_PROJECT, ProjectName: 'Launch', isPrivateSpace: true, deletedStatusKey: 0,
        AssigneeUserId: [ASSIGNED, GUEST_IN, `tId_${TEAM}`],
    });
    mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: PUBLIC_PROJECT, ProjectName: 'Handbook', isPrivateSpace: false, deletedStatusKey: 0, AssigneeUserId: [] });
};

const seedSprint = (over) => mockDb.seed(SCHEMA_TYPE.SPRINTS, { name: 'Sprint 1', private: false, AssigneeUserId: [], deletedStatusKey: 0, ...over });
const seedPage = (over) => mockDb.seed(SCHEMA_TYPE.PAGES, { title: 'Runbook', visibility: 'project', createdBy: OWNER, deletedStatusKey: 0, ...over });
const seedShare = (over) => mockDb.seed(SCHEMA_TYPE.PUBLIC_SHARES, { token: 'ab'.repeat(32), enabled: true, createdBy: OWNER, ...over });

const response = () => {
    const res = { statusCode: 200, body: undefined };
    res.status = jest.fn((code) => { res.statusCode = code; return res; });
    res.send = jest.fn((body) => { res.body = body; return res; });
    res.json = jest.fn((body) => { res.body = body; return res; });
    return res;
};
const request = (uid, over = {}) => verified({ uid, params: {}, query: {}, body: {}, headers: { companyid: C }, ...over });

const passes = async (middleware, req) => {
    const res = response();
    let through = false;
    await middleware(req, res, () => { through = true; });
    return through;
};

/* The read checks the API runs, called the way the routes call them. */
const enforcedRead = {
    project: (uid, id) => passes(requireProjectAccess({ mode: READ, projectIds: (req) => req.params.id }), request(uid, { params: { id } })),
    sprint: async (uid, id, projectId) => (await passes(requireProjectAccess({ mode: READ, projectIds: () => projectId }), request(uid)))
        && passes(requireSprintAccess(() => id), request(uid)),
    page: async (uid, id) => {
        const res = response();
        await pages.getPage(request(uid, { params: { id } }), res);
        return res.body.status === true;
    },
};

const people = (explanation) => new Map(explanation.groups.flatMap((group) => group.userIds.map((userId) => [userId, group])));

const expectAgreesWithEnforcement = async (kind, id, projectId) => {
    const explanation = await explain(kind, C, id, OWNER);
    const listed = people(explanation);
    const seen = [];
    const hidden = [];
    for (const uid of EVERYONE) {
        const allowed = await enforcedRead[kind](uid, id, projectId);
        expect({ uid, listed: listed.has(uid) }).toEqual({ uid, listed: allowed });
        (allowed ? seen : hidden).push(uid);
    }
    expect(seen.length).toBeGreaterThan(0);
    expect(hidden.length).toBeGreaterThan(0);
    return listed;
};

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    myCache.flushAll();
    seedRules();
    seedCompany();
});

describe('who can see a project', () => {
    it('lists exactly the people the project read check lets in, grouped by why', async () => {
        const listed = await expectAgreesWithEnforcement('project', PRIVATE_PROJECT);
        expect(listed.get(OWNER).reason).toBe('admin');
        expect(listed.get(ADMIN).reason).toBe('admin');
        expect(listed.get(ASSIGNED).reason).toBe('member');
        expect(listed.get(IN_TEAM)).toMatchObject({ reason: 'team', teamNames: ['Design'] });
        expect(listed.get(GUEST_IN).reason).toBe('guest');
        expect(listed.get(AUDITOR).reason).toBe('role');
        expect(listed.has(GUEST_OUT)).toBe(false);
        expect(listed.has(REMOVED)).toBe(false);
    });

    it('says what each group can do, from the write checks', async () => {
        const listed = people(await explain('project', C, PRIVATE_PROJECT, OWNER));
        expect(listed.get(OWNER).can).toBe('manage');
        expect(listed.get(ASSIGNED).can).toBe('edit');
        expect(listed.get(GUEST_IN).can).toBe('view');
        expect(listed.get(AUDITOR).can).toBe('view');
    });

    it('puts everyone in the company in one group on a public project', async () => {
        const listed = await expectAgreesWithEnforcement('project', PUBLIC_PROJECT);
        expect(listed.get(BYSTANDER).reason).toBe('everyone');
        expect(listed.get(GUEST_OUT).reason).toBe('everyone');
    });

    it('shows a client link only while it is on and unexpired', async () => {
        seedShare({ entityType: 'client_view', entityId: PRIVATE_PROJECT, passwordHash: 'x' });
        const on = await explain('project', C, PRIVATE_PROJECT, OWNER);
        expect(on.links).toEqual([expect.objectContaining({ kind: 'client_view', hasPassword: true, fromParent: false })]);

        mockDb.store[SCHEMA_TYPE.PUBLIC_SHARES][0].enabled = false;
        expect((await explain('project', C, PRIVATE_PROJECT, OWNER)).links).toEqual([]);

        mockDb.store[SCHEMA_TYPE.PUBLIC_SHARES][0].enabled = true;
        mockDb.store[SCHEMA_TYPE.PUBLIC_SHARES][0].expiresAt = new Date(Date.now() - 1000);
        expect((await explain('project', C, PRIVATE_PROJECT, OWNER)).links).toEqual([]);
    });
});

describe('who can see a sprint', () => {
    it('follows the project for a shared sprint', async () => {
        const sprint = seedSprint({ projectId: PRIVATE_PROJECT });
        const listed = await expectAgreesWithEnforcement('sprint', sprint._id, PRIVATE_PROJECT);
        expect(listed.get(ASSIGNED).reason).toBe('member');
    });

    it('narrows a private sprint to the people it is shared with and the admins', async () => {
        const sprint = seedSprint({ projectId: PUBLIC_PROJECT, private: true, AssigneeUserId: [BYSTANDER, `tId_${TEAM}`] });
        const listed = await expectAgreesWithEnforcement('sprint', sprint._id, PUBLIC_PROJECT);
        expect(listed.get(ADMIN).reason).toBe('admin');
        expect(listed.get(BYSTANDER).reason).toBe('member');
        expect(listed.get(IN_TEAM).reason).toBe('team');
        expect(listed.has(ASSIGNED)).toBe(false);
    });

    it('lists a live public link to the sprint', async () => {
        const sprint = seedSprint({ projectId: PUBLIC_PROJECT });
        seedShare({ entityType: 'sprint', entityId: sprint._id });
        expect((await explain('sprint', C, sprint._id, OWNER)).links).toEqual([expect.objectContaining({ kind: 'sprint', hasPassword: false })]);
    });
});

describe('who can see a doc', () => {
    it('follows the project for a shared doc', async () => {
        const page = seedPage({ ProjectID: PRIVATE_PROJECT });
        const listed = await expectAgreesWithEnforcement('page', page._id);
        expect(listed.get(IN_TEAM).reason).toBe('team');
        expect(listed.get(AUDITOR).reason).toBe('role');
    });

    it('lists only the author of a private doc', async () => {
        const page = seedPage({ ProjectID: PUBLIC_PROJECT, visibility: 'private', createdBy: ASSIGNED });
        const explanation = await explain('page', C, page._id, ASSIGNED);
        expect(explanation.groups).toEqual([expect.objectContaining({ reason: 'author', userIds: [ASSIGNED] })]);
        for (const uid of EVERYONE) {
            expect({ uid, allowed: await enforcedRead.page(uid, page._id) }).toEqual({ uid, allowed: uid === ASSIGNED });
        }
    });

    it('gives a company doc to every member', async () => {
        const page = seedPage({});
        const listed = await expectAgreesWithEnforcement('page', page._id);
        expect(listed.get(GUEST_OUT).reason).toBe('everyone');
    });

    it('counts a live link on a parent doc, which shares the whole subtree', async () => {
        const parent = seedPage({ ProjectID: PUBLIC_PROJECT, title: 'Guides' });
        const child = seedPage({ ProjectID: PUBLIC_PROJECT, parentPageId: parent._id });
        seedShare({ entityType: 'page', entityId: parent._id });
        expect((await explain('page', C, child._id, OWNER)).links).toEqual([expect.objectContaining({ kind: 'page', fromParent: true })]);
    });
});

describe('GET /api/v2/who-can-see/:kind/:id', () => {
    const get = async (uid, kind, id) => {
        const res = response();
        await whoCanSee(request(uid, { params: { kind, id } }), res);
        return res;
    };

    it('answers someone who can see the item, without emails', async () => {
        const res = await get(ASSIGNED, 'project', PRIVATE_PROJECT);
        expect(res.body.status).toBe(true);
        expect(res.body.data.groups.length).toBeGreaterThan(0);
        expect(JSON.stringify(res.body)).not.toMatch(/@|userEmail|Employee_Email/);
    });

    it('answers 404 to someone who cannot see it, and to a stranger', async () => {
        expect((await get(GUEST_OUT, 'project', PRIVATE_PROJECT)).statusCode).toBe(404);
        expect((await get(STRANGER, 'project', PUBLIC_PROJECT)).statusCode).toBe(404);
        const page = seedPage({ ProjectID: PUBLIC_PROJECT, visibility: 'private', createdBy: ASSIGNED });
        expect((await get(OWNER, 'page', page._id)).statusCode).toBe(404);
    });

    it('refuses an unknown kind or a malformed id', async () => {
        expect((await get(OWNER, 'task', PRIVATE_PROJECT)).statusCode).toBe(400);
        expect((await get(OWNER, 'project', 'nope')).statusCode).toBe(400);
    });
});
