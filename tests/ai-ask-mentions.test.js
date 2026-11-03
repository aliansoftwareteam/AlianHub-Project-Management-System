const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Config/permissionGuard', () => ({ getRoleType: jest.fn(), isPrivileged: (roleType) => roleType === 1 || roleType === 2 }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../Modules/Tasks/helpers/taskListProjects', () => ({ keepTaskListProjectIds: jest.fn(async (c, u, ids) => ids.map(String)) }));
jest.mock('../Modules/AI/ask', () => ({ openProjects: jest.fn(), tokenProjectIdsOf: () => [] }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { getRoleType } = require('../Config/permissionGuard');
const { openProjects } = require('../Modules/AI/ask');
const { mentions, shapeItems, LIMITS } = require('../Modules/AI/askMentions');

const C = '6f0000000000000000000c01';
const OPEN = '6f0000000000000000000a01';
const SHARED = '6f0000000000000000000a03';
const HIDDEN = '6f0000000000000000000a02';
const ME = '6f0000000000000000000001';
const RAJ = '6f0000000000000000000002';
const GRACE = '6f0000000000000000000003';
const LIST = '6f0000000000000000000d01';
const PRIVATE_LIST = '6f0000000000000000000d02';

const PROJECTS = [{ _id: OPEN, ProjectName: 'Platform Engineering' }, { _id: SHARED, ProjectName: 'Support desk' }];

const call = async (query) => {
    const res = { code: 200, body: null, status(code) { this.code = code; return this; }, send(body) { this.body = body; return this; } };
    await mentions({ headers: { companyid: C }, uid: ME, query }, res);
    return res;
};

const seed = () => {
    mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: OPEN, ProjectName: 'Platform Engineering', AssigneeUserId: [ME, RAJ] });
    mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: SHARED, ProjectName: 'Support desk', AssigneeUserId: [ME] });
    mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: LIST, projectId: OPEN, name: 'Platform release', deletedStatusKey: 0 });
    mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: PRIVATE_LIST, projectId: OPEN, name: 'Platform pay review', private: true, AssigneeUserId: [GRACE], deletedStatusKey: 0 });
    mockDb.seed(SCHEMA_TYPE.SPRINTS, { projectId: HIDDEN, name: 'Platform board', deletedStatusKey: 0 });
    mockDb.seed(SCHEMA_TYPE.TASKS, { _id: '6f0000000000000000000e01', ProjectID: OPEN, sprintId: LIST, TaskName: 'Platform export', TaskKey: 'ENG-1', deletedStatusKey: 0, AssigneeUserId: [ME], statusType: 'active' });
    mockDb.seed(SCHEMA_TYPE.TASKS, { ProjectID: OPEN, sprintId: PRIVATE_LIST, TaskName: 'Platform salaries', TaskKey: 'ENG-9', deletedStatusKey: 0 });
    mockDb.seed(SCHEMA_TYPE.TASKS, { ProjectID: HIDDEN, TaskName: 'Platform secret', TaskKey: 'HR-1', deletedStatusKey: 0 });
    mockDb.seed(SCHEMA_TYPE.PAGES, { ProjectID: OPEN, title: 'Platform runbook', deletedStatusKey: 0, visibility: 'project', createdBy: RAJ });
    mockDb.seed(SCHEMA_TYPE.PAGES, { ProjectID: HIDDEN, title: 'Platform board minutes', deletedStatusKey: 0, visibility: 'project', createdBy: RAJ });
    [ME, RAJ, GRACE].forEach((userId) => mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId, status: 2 }));
    mockDb.seed(SCHEMA_TYPE.USERS, { _id: RAJ, Employee_Name: 'Raj Platt' });
    mockDb.seed(SCHEMA_TYPE.USERS, { _id: GRACE, Employee_Name: 'Grace Platero' });
};

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.calls.length = 0;
    jest.clearAllMocks();
    getRoleType.mockResolvedValue(3);
    openProjects.mockResolvedValue(PROJECTS);
});

describe('@ search', () => {
    it('finds projects, lists, tasks, docs and people the asker can open, in picker order', async () => {
        seed();
        const { body } = await call({ q: 'plat' });
        expect(body.status).toBe(true);
        const items = body.data.items;
        expect([...new Set(items.map((i) => i.kind))]).toEqual(['project', 'list', 'task', 'page', 'person']);
        expect(items.map((i) => i.title)).toEqual(['Platform Engineering', 'Platform release', 'Platform export', 'Platform runbook', 'Raj Platt', 'Grace Platero']);
        expect(items.find((i) => i.kind === 'task')).toMatchObject({ sub: 'ENG-1 · Platform Engineering' });
        expect(items.find((i) => i.kind === 'list')).toMatchObject({ sub: 'Platform Engineering' });
    });

    it('never offers a private list the asker is not on, its tasks, or anything in a project they cannot open', async () => {
        seed();
        const titles = (await call({ q: 'plat' })).body.data.items.map((i) => i.title);
        expect(titles).not.toEqual(expect.arrayContaining(['Platform pay review']));
        ['Platform pay review', 'Platform salaries', 'Platform secret', 'Platform board', 'Platform board minutes'].forEach((t) => expect(titles).not.toContain(t));
    });

    it('lets a guest find only the people on the projects shared with them', async () => {
        seed();
        getRoleType.mockResolvedValue(0);
        const people = (await call({ q: 'plat' })).body.data.items.filter((i) => i.kind === 'person').map((i) => i.title);
        expect(people).toEqual(['Raj Platt']);
    });

    it('treats the query as text, not a pattern', async () => {
        seed();
        const { body } = await call({ q: '.*' });
        expect(body.data.items).toEqual([]);
    });

    it('refuses a caller with no seat, and reads only the asker\'s company and the shared people list', async () => {
        seed();
        await call({ q: 'plat' });
        expect(mockDb.calls.every((c) => c.companyId === C || c.companyId === 'global')).toBe(true);
        getRoleType.mockResolvedValue(null);
        const res = await call({ q: 'plat' });
        expect(res.code).toBe(403);
    });
});

describe('@ alone suggests', () => {
    it('the scoped project and its lists, recent visits and the asker\'s own open work', async () => {
        seed();
        mockDb.seed(SCHEMA_TYPE.RECENTVISITS, { userId: ME, entityType: 'project', entityId: SHARED, visitedAt: new Date() });
        mockDb.seed(SCHEMA_TYPE.RECENTVISITS, { userId: ME, entityType: 'project', entityId: HIDDEN, visitedAt: new Date() });
        mockDb.seed(SCHEMA_TYPE.RECENTVISITS, { userId: RAJ, entityType: 'task', entityId: '6f0000000000000000000e01', visitedAt: new Date() });
        const { body } = await call({ q: '', projectId: OPEN });
        expect(body.data.suggested).toBe(true);
        const items = body.data.items;
        expect(items.filter((i) => i.kind === 'project').map((i) => i.id)).toEqual([OPEN, SHARED]);
        expect(items.filter((i) => i.kind === 'list').map((i) => i.title)).toEqual(['Platform release']);
        expect(items.filter((i) => i.kind === 'task').map((i) => i.title)).toEqual(['Platform export']);
        expect(items.some((i) => i.id === HIDDEN)).toBe(false);
    });
});

describe('shapeItems', () => {
    it('drops repeats and keeps each kind under its limit', () => {
        const many = Array.from({ length: LIMITS.task + 3 }, (_, i) => ({ kind: 'task', id: `t${i}`, title: `T${i}` }));
        const out = shapeItems([{ kind: 'person', id: 'u', title: 'U' }, ...many, many[0], { kind: 'bogus', id: 'x', title: 'X' }]);
        expect(out.filter((i) => i.kind === 'task')).toHaveLength(LIMITS.task);
        expect(out[out.length - 1].kind).toBe('person');
        expect(out.some((i) => i.kind === 'bogus')).toBe(false);
    });
});
