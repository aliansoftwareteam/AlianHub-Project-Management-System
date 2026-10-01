/* Task 046 M2, slice E1: POST /api/v2/tasks/everything lists tasks across every project the caller
   can open. The handler runs over fakeMongo with the real project scope, personal-list rule and
   sprint privacy, so each case below is decided by the same code the app uses elsewhere.
   fakeMongo leaves an empty array in place after $unwind where MongoDB drops the field: the
   "unassigned" count is asserted on the stages built (tests/everything-query.test.js), not on rows. */
const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (...args) => mockDb.crud(...args),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
const mockRules = { task_list: true, task_status: true, task_priority: true };
/* The rules as the matrix stores them: a section row and the keys under it, each with a value per role. */
const mockRulesFor = (permissions, projectId) => {
    const scope = projectId ? { projectId } : {};
    const section = { _id: `task-${projectId || 'company'}`, key: 'task', isParent: true, roles: [{ key: 3, permission: true }], ...scope };
    return [section, ...Object.entries(permissions).map(([key, permission]) => (
        { _id: `${key}-${projectId || 'company'}`, key, isParent: false, parentId: section._id, roles: [{ key: 3, permission }], ...scope }
    ))];
};
jest.mock('../Modules/settings/securityPermissions/controller', () => ({ fetchRules: jest.fn(async () => mockRulesFor(mockRules)) }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));

const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { holdNarrowedToken } = require('../Config/narrowedTokenRoutes');
const { listEverything } = require('../Modules/Tasks/controller/everything');
const { MAX_LIMIT, ROW_FIELDS } = require('../Modules/Tasks/helpers/everythingQuery');

const ROUTE = '/api/v2/tasks/everything';
const C = '6f0000000000000000000c01';
const OTHER_COMPANY = '6f0000000000000000000c02';
const OWNER = '6f0000000000000000000001';
const ADMIN = '6f0000000000000000000002';
const MEMBER = '6f0000000000000000000003';
const COLLEAGUE = '6f0000000000000000000004';
const DEACTIVATED = '6f0000000000000000000005';
const CANCELLED = '6f0000000000000000000006';
const ROLES = { [OWNER]: 1, [ADMIN]: 2, [MEMBER]: 3, [COLLEAGUE]: 3 };

let seq = 0;
const nextId = (prefix) => `6f${prefix}${String(++seq).padStart(20, '0')}`;
const day = (n) => new Date(Date.UTC(2026, 9, n));

const project = (over = {}) => mockDb.seed(SCHEMA_TYPE.PROJECTS, {
    _id: nextId('a0'), ProjectName: 'Project', ProjectCode: 'PRJ', isPrivateSpace: false, AssigneeUserId: [], deletedStatusKey: 0, statusType: 'active',
    projectIcon: { type: 'color', data: '#2F3990' }, taskStatusData: [{ key: 1, name: 'To Do', type: 'default_active' }], taskTypeCounts: [{ key: 1, name: 'Task' }], apps: [{ key: 'Priority' }],
    description: 'never returned', lastTaskId: 41, ...over,
});
const personalList = (uid) => project({ ProjectName: `Personal list of ${uid}`, isPrivateSpace: true, isPersonal: true, personalOwner: uid, AssigneeUserId: [uid] });
const sprint = (proj, over = {}) => mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: nextId('b0'), projectId: String(proj._id), name: 'List', private: false, AssigneeUserId: [], ...over });
const task = (proj, TaskName, over = {}) => mockDb.seed(SCHEMA_TYPE.TASKS, {
    _id: nextId('f0'), TaskName, TaskKey: `PRJ-${seq}`, ProjectID: String(proj._id), sprintId: nextId('b9'), deletedStatusKey: 0, isParentTask: true,
    status: { key: 1, text: 'To Do', type: 'default_active' }, statusKey: 1, statusType: 'default_active', Task_Priority: 'MEDIUM', TaskType: 'Task', TaskTypeKey: 1,
    AssigneeUserId: [MEMBER], tagsArray: [], subTasks: 0, updatedAt: day(1), description: 'never returned', customField: { secret: 1 }, ...over,
});

const response = () => {
    const res = { statusCode: 200, body: undefined };
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (body) => { res.body = body; return res; };
    res.send = res.json;
    return res;
};
const call = async (uid, body = {}, over = {}) => {
    const res = response();
    await listEverything({ method: 'POST', originalUrl: ROUTE, headers: { companyid: C }, aud: C, uid, body, ...over }, res);
    return res;
};
const everything = async (uid, body, over) => {
    const res = await call(uid, body, over);
    expect({ statusCode: res.statusCode, statusText: res.body && res.body.statusText }).toEqual({ statusCode: 200, statusText: 'Tasks fetched successfully.' });
    expect(res.body.status).toBe(true);
    return res.body.data;
};
const names = async (uid, body, over) => (await everything(uid, body, over)).rows.map((row) => row.TaskName).sort();
const ownRules = (proj, permissions) => {
    proj.isGlobalPermission = false;
    mockRulesFor({ task_list: true, task_status: true, task_priority: true, ...permissions }, String(proj._id)).forEach((rule) => mockDb.seed(SCHEMA_TYPE.PROJECT_RULES, rule));
};
const taskReads = () => mockDb.calls.filter((c) => c.type === SCHEMA_TYPE.TASKS);

/* Follows nextCursor to the end and returns every row in the order the pages gave them. */
const allPages = async (uid, body) => {
    const rows = [];
    let cursor = null;
    for (let page = 0; page < 50; page += 1) {
        const data = await everything(uid, { ...body, ...(cursor ? { cursor } : {}) });
        rows.push(...data.rows);
        cursor = data.nextCursor;
        if (!cursor) return rows;
    }
    throw new Error('the cursor never ended');
};

let seeded;

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.calls.length = 0;
    myCache.flushAll();
    Object.assign(mockRules, { task_list: true, task_status: true, task_priority: true });
    Object.entries(ROLES).forEach(([userId, roleType]) => mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId, roleType, status: 2, isDelete: false }));
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: DEACTIVATED, roleType: 3, status: 2, isDelete: true });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: CANCELLED, roleType: 3, status: 3, isDelete: false });

    const open = project({ ProjectName: 'Open', ProjectCode: 'OPN' });
    const mine = project({ ProjectName: 'Private, member on it', isPrivateSpace: true, AssigneeUserId: [MEMBER] });
    const theirs = project({ ProjectName: 'Private, member not on it', isPrivateSpace: true, AssigneeUserId: [COLLEAGUE] });
    const closed = project({ ProjectName: 'Closed', statusType: 'close' });
    const archived = project({ ProjectName: 'Archived', deletedStatusKey: 2 });
    const trashed = project({ ProjectName: 'Trashed', deletedStatusKey: 1 });
    const lists = { [OWNER]: personalList(OWNER), [ADMIN]: personalList(ADMIN), [MEMBER]: personalList(MEMBER) };
    const privateSprint = sprint(open, { private: true, AssigneeUserId: [COLLEAGUE] });
    const sharedSprint = sprint(open, { private: true, AssigneeUserId: [MEMBER] });

    seeded = { open, mine, theirs, closed, archived, trashed, lists, privateSprint, sharedSprint };
    task(open, 'open');
    task(mine, 'private, member on it');
    task(theirs, 'private, member not on it');
    task(lists[OWNER], 'owner\'s personal list');
    task(lists[ADMIN], 'admin\'s personal list');
    task(lists[MEMBER], 'member\'s personal list');
    task(open, 'in a private sprint of the colleague', { sprintId: String(privateSprint._id) });
    task(open, 'in a private sprint shared with the member', { sprintId: String(sharedSprint._id) });
});

const MEMBER_SEES = ['open', 'private, member on it', 'member\'s personal list', 'in a private sprint shared with the member'].sort();
const COMPANY_WIDE = ['open', 'private, member on it', 'private, member not on it', 'in a private sprint of the colleague', 'in a private sprint shared with the member'];

describe('what a person sees', () => {
    it('gives a member the projects they can open: public ones, private ones they are on, their own personal list', async () => {
        expect(await names(MEMBER)).toEqual(MEMBER_SEES);
    });

    it('does not show a private project to a member who names its id', async () => {
        const hidden = String(seeded.theirs._id);
        expect(await names(MEMBER, { filter: { projectIds: [hidden] } })).toEqual([]);
        expect(await names(MEMBER, { filter: { projectIds: [hidden, String(seeded.mine._id)] } })).toEqual(['private, member on it']);
        expect(await names(MEMBER, { filter: { projectIds: [hidden], search: 'private' } })).toEqual([]);
        expect((await everything(MEMBER, { filter: { projectIds: [hidden] }, group: 'project' })).groups).toEqual([]);
    });

    it.each([['an owner', OWNER, 'owner\'s personal list'], ['an admin', ADMIN, 'admin\'s personal list']])(
        'gives %s every project, their own personal list, and nobody else\'s',
        async (_who, uid, own) => {
            expect(await names(uid)).toEqual([...COMPANY_WIDE, own].sort());
            for (const other of [OWNER, ADMIN, MEMBER].filter((id) => id !== uid)) {
                const list = String(seeded.lists[other]._id);
                expect(await names(uid, { filter: { projectIds: [list] } })).toEqual([]);
                expect((await everything(uid, { group: 'project' })).groups.map((g) => g.key)).not.toContain(list);
            }
            expect(await names(uid, { filter: { search: 'personal list' } })).toEqual([own]);
        },
    );

    it('scopes owners and admins by project too, instead of leaving the read company-wide', async () => {
        await everything(OWNER);
        const scoped = taskReads().filter((c) => c.method === 'aggregate');
        expect(scoped.length).toBeGreaterThan(0);
        scoped.forEach((c) => {
            const { ProjectID } = c.data[0][0].$match;
            expect(ProjectID.$in.map(String)).not.toContain(String(seeded.lists[MEMBER]._id));
            expect(ProjectID.$in.map(String)).toContain(String(seeded.open._id));
        });
    });

    it('hides a private sprint from a member who is not on it, and shows it to the people who are', async () => {
        expect(await names(MEMBER)).not.toContain('in a private sprint of the colleague');
        expect(await names(MEMBER)).toContain('in a private sprint shared with the member');
        expect(await names(COLLEAGUE)).toContain('in a private sprint of the colleague');
        expect(await names(COLLEAGUE)).not.toContain('in a private sprint shared with the member');
        expect(await names(OWNER)).toEqual(expect.arrayContaining(['in a private sprint of the colleague', 'in a private sprint shared with the member']));
    });

    it('never returns a chat row, a deleted row or an archived row', async () => {
        task(seeded.open, 'a chat', { mainChat: true, AssigneeUserId: [MEMBER, OWNER] });
        task(seeded.open, 'trashed', { deletedStatusKey: 1 });
        task(seeded.open, 'archived', { deletedStatusKey: 2 });
        task(seeded.open, 'in a closed sprint', { deletedStatusKey: 5 });
        for (const uid of [MEMBER, OWNER]) {
            const seen = await names(uid, { includeSubtasks: true, includeClosedProjects: true });
            ['a chat', 'trashed', 'archived', 'in a closed sprint'].forEach((hidden) => expect(seen).not.toContain(hidden));
            expect(seen).toContain('open');
        }
    });

    it('leaves out closed, archived and trashed projects, and adds only the closed ones when asked', async () => {
        task(seeded.closed, 'in a closed project', { deletedStatusKey: 8 });
        task(seeded.closed, 'still open in a closed project');
        task(seeded.archived, 'in an archived project', { deletedStatusKey: 7 });
        task(seeded.archived, 'still open in an archived project');
        task(seeded.trashed, 'in a trashed project');
        expect(await names(MEMBER)).toEqual(MEMBER_SEES);
        expect(await names(MEMBER, { includeClosedProjects: true })).toEqual([...MEMBER_SEES, 'in a closed project', 'still open in a closed project'].sort());
        expect(await names(OWNER, { includeClosedProjects: true, filter: { projectIds: [String(seeded.archived._id), String(seeded.trashed._id)] } })).toEqual([]);
    });

    it('shows subtasks only when asked, with the chain above each so a client can show depth', async () => {
        const parent = task(seeded.open, 'parent', { subTasks: 1 });
        const child = task(seeded.open, 'child', { isParentTask: false, ParentTaskId: String(parent._id), ancestors: [String(parent._id)], subTasks: 1 });
        task(seeded.open, 'grandchild', { isParentTask: false, ParentTaskId: String(child._id), ancestors: [String(parent._id), String(child._id)] });

        expect(await names(MEMBER, { filter: { search: 'child' } })).toEqual([]);
        const rows = (await everything(MEMBER, { filter: { projectIds: [String(seeded.open._id)] }, includeSubtasks: true })).rows;
        const byName = Object.fromEntries(rows.map((row) => [row.TaskName, row]));
        expect(byName.parent).toMatchObject({ subTasks: 1, isParentTask: true });
        expect(byName.child).toMatchObject({ subTasks: 1, ancestors: [String(parent._id)], ParentTaskId: String(parent._id) });
        expect(byName.grandchild.ancestors).toEqual([String(parent._id), String(child._id)]);
    });
});

describe('a role that is denied the task list', () => {

    it('sees no project\'s tasks, as on the project page, and keeps their own personal list', async () => {
        mockRules.task_list = null;
        expect(await names(MEMBER)).toEqual(['member\'s personal list']);
        expect(await names(MEMBER, { filter: { projectIds: [String(seeded.open._id)] } })).toEqual([]);
        expect((await everything(MEMBER, { group: 'project' })).groups.map((g) => g.key)).toEqual([String(seeded.lists[MEMBER]._id)]);
    });

    it('does not change what an owner or an admin sees', async () => {
        mockRules.task_list = null;
        expect(await names(OWNER)).toEqual([...COMPANY_WIDE, 'owner\'s personal list'].sort());
        expect(await names(ADMIN)).toEqual([...COMPANY_WIDE, 'admin\'s personal list'].sort());
    });

    it('still shows the tasks to a role that may look but not edit', async () => {
        mockRules.task_list = false;
        expect(await names(MEMBER)).toEqual(MEMBER_SEES);
    });

    it('judges a project with its own rules by those rules, in both directions', async () => {
        ownRules(seeded.mine, { task_list: null });
        expect(await names(MEMBER)).toEqual(MEMBER_SEES.filter((name) => name !== 'private, member on it'));

        mockRules.task_list = null;
        ownRules(seeded.open, {});
        expect(await names(MEMBER)).toEqual(['open', 'in a private sprint shared with the member', 'member\'s personal list'].sort());
    });

    it('reads the rules of every project in one query, not one per project', async () => {
        ownRules(seeded.mine, {});
        ownRules(seeded.open, {});
        mockDb.calls.length = 0;
        await everything(MEMBER);
        expect(mockDb.calls.filter((c) => c.type === SCHEMA_TYPE.PROJECT_RULES)).toHaveLength(1);
    });
});

describe('what a person may change in a row', () => {
    const editOf = async (uid, proj, body = {}) => (await everything(uid, { filter: { projectIds: [String(proj._id)] }, ...body })).projects[String(proj._id)].edit;

    it('follows the role: status and priority each need their own permission', async () => {
        expect(await editOf(MEMBER, seeded.open)).toEqual({ status: true, priority: true });
        mockRules.task_priority = false;
        expect(await editOf(MEMBER, seeded.open)).toEqual({ status: true, priority: false });
        mockRules.task_status = null;
        expect(await editOf(MEMBER, seeded.open)).toEqual({ status: false, priority: false });
    });

    it('lets a role that may only look at the task list change nothing', async () => {
        mockRules.task_list = false;
        expect(await editOf(MEMBER, seeded.open)).toEqual({ status: false, priority: false });
    });

    it('reads a project with its own rules by those rules', async () => {
        ownRules(seeded.mine, { task_status: false });
        expect(await editOf(MEMBER, seeded.mine)).toEqual({ status: false, priority: true });
        expect(await editOf(MEMBER, seeded.open)).toEqual({ status: true, priority: true });
    });

    it('is everything for an owner or an admin, and nothing in a closed project', async () => {
        mockRules.task_status = null;
        expect(await editOf(OWNER, seeded.open)).toEqual({ status: true, priority: true });
        expect(await editOf(ADMIN, seeded.open)).toEqual({ status: true, priority: true });
        task(seeded.closed, 'in a closed project', { deletedStatusKey: 8 });
        expect(await editOf(OWNER, seeded.closed, { includeClosedProjects: true })).toEqual({ status: false, priority: false });
    });
});

describe('a restricted project', () => {
    it('is left out, as the project page leaves its tasks out', async () => {
        seeded.open.isRestrict = true;
        for (const uid of [MEMBER, OWNER]) {
            const seen = await names(uid);
            expect(seen).not.toContain('open');
            expect(seen).toContain('private, member on it');
        }
    });
});

describe('who may ask', () => {
    it.each([['deactivated', DEACTIVATED], ['cancelled', CANCELLED], ['unknown', '6f0000000000000000000009']])('refuses a %s seat before any task is read', async (_what, uid) => {
        const res = await call(uid);
        expect(res.statusCode).toBe(403);
        expect(res.body).toMatchObject({ status: false });
        expect(res.body.data).toBeUndefined();
        expect(taskReads()).toEqual([]);
        expect(mockDb.calls[0]).toMatchObject({ type: SCHEMA_TYPE.COMPANY_USERS, method: 'findOne' });
    });

    it('refuses a company outside the token audience', async () => {
        const res = await call(MEMBER, {}, { headers: { companyid: OTHER_COMPANY } });
        expect(res.statusCode).toBe(403);
        expect(mockDb.calls).toEqual([]);
    });

    it('refuses a request with nobody behind it', async () => {
        const res = await call(undefined);
        expect(res.statusCode).toBe(401);
        expect(mockDb.calls).toEqual([]);
    });
});

describe('a token narrowed to some projects', () => {
    const viaToken = async (uid, projectIds, body = {}) => {
        const req = { method: 'POST', originalUrl: ROUTE, headers: { companyid: C }, aud: C, uid, body, apiToken: { userId: uid, projectIds } };
        const res = response();
        let reached = false;
        await holdNarrowedToken(req, res, async () => { reached = true; await listEverything(req, res); });
        return { res, reached };
    };

    it.each([['a member', MEMBER], ['an owner', OWNER]])('reads only those projects for %s', async (_who, uid) => {
        const { res, reached } = await viaToken(uid, [String(seeded.mine._id)]);
        expect(reached).toBe(true);
        expect(res.statusCode).toBe(200);
        expect(res.body.data.rows.map((row) => row.TaskName)).toEqual(['private, member on it']);
        expect(Object.keys(res.body.data.projects)).toEqual([String(seeded.mine._id)]);
    });

    it('cannot be widened by naming another project, and cannot reach a project its person cannot open', async () => {
        const widened = await viaToken(MEMBER, [String(seeded.mine._id)], { filter: { projectIds: [String(seeded.open._id)] } });
        expect(widened.res.body.data.rows).toEqual([]);
        const hidden = await viaToken(MEMBER, [String(seeded.theirs._id)]);
        expect(hidden.res.body.data.rows).toEqual([]);
    });

    it('is not narrowed when its list is empty', async () => {
        const { res } = await viaToken(MEMBER, []);
        expect(res.body.data.rows.map((row) => row.TaskName).sort()).toEqual(MEMBER_SEES);
    });
});

describe('the request is data, never a pipeline', () => {
    it.each([
        ['an unknown key', { findQuery: [{ $match: {} }] }],
        ['a pipeline', { pipeline: [{ $lookup: { from: 'company_users', pipeline: [], as: 'x' } }] }],
        ['an unknown filter key', { filter: { ProjectID: { $exists: true } } }],
        ['an operator in a filter', { filter: { status: { $ne: null } } }],
        ['an unknown group', { group: 'customField' }],
        ['an unknown sort', { sort: { by: 'TaskName' } }],
        ['a made-up cursor', { cursor: 'bm90IGEgY3Vyc29y.bm90IGEgY3Vyc29y' }],
    ])('refuses %s with 400 and reads no task', async (_what, body) => {
        const res = await call(MEMBER, body);
        expect(res.statusCode).toBe(400);
        expect(res.body).toMatchObject({ status: false });
        expect(typeof res.body.message).toBe('string');
        expect(taskReads()).toEqual([]);
    });

    it('returns a fixed set of fields, whatever the row holds', async () => {
        const { rows, projects } = await everything(MEMBER, { filter: { projectIds: [String(seeded.open._id)] } });
        rows.forEach((row) => {
            expect(Object.keys(row).filter((key) => key !== '_id' && !ROW_FIELDS[key])).toEqual([]);
            expect(row).not.toHaveProperty('description');
            expect(row).not.toHaveProperty('customField');
        });
        expect(rows[0]).toMatchObject({ TaskName: expect.any(String), TaskKey: expect.any(String), status: { text: 'To Do' }, Task_Priority: 'MEDIUM', AssigneeUserId: [MEMBER], ProjectID: String(seeded.open._id), TaskType: 'Task', tagsArray: [], subTasks: 0 });
        expect(projects).toEqual({
            [String(seeded.open._id)]: {
                _id: String(seeded.open._id), ProjectName: 'Open', ProjectCode: 'OPN', projectIcon: { type: 'color', data: '#2F3990' },
                taskStatusData: [{ key: 1, name: 'To Do', type: 'default_active' }], taskTypeCounts: [{ key: 1, name: 'Task' }], apps: [{ key: 'Priority' }],
                statusType: 'active', isPersonal: false, edit: { status: true, priority: true },
            },
        });
    });

    it('names only the projects on the page', async () => {
        const { rows, projects } = await everything(MEMBER, { limit: 1 });
        expect(rows).toHaveLength(1);
        expect(Object.keys(projects)).toEqual([String(rows[0].ProjectID)]);
    });
});

describe('filters', () => {
    beforeEach(() => {
        task(seeded.open, 'urgent bug', { Task_Priority: 'HIGH', TaskType: 'Bug', TaskTypeKey: 2, tagsArray: ['tag-1'], DueDate: day(10), status: { key: 2, text: 'Doing', type: 'active' }, statusKey: 2, statusType: 'active', AssigneeUserId: [COLLEAGUE] });
        task(seeded.mine, 'nobody on it (a.b)', { AssigneeUserId: [], DueDate: day(20), status: { key: 7, text: 'Doing', type: 'active' }, statusKey: 7, statusType: 'active' });
    });

    it.each([
        ['status by name, across projects', { status: ['Doing'] }, ['nobody on it (a.b)', 'urgent bug']],
        ['status by key', { status: [7] }, ['nobody on it (a.b)']],
        ['assignee', { assignee: [COLLEAGUE] }, ['urgent bug']],
        ['nobody assigned', { assignee: ['unassigned'] }, ['nobody on it (a.b)']],
        ['priority', { priority: ['HIGH'] }, ['urgent bug']],
        ['status type', { statusType: ['active'] }, ['nobody on it (a.b)', 'urgent bug']],
        ['task type by name', { taskType: ['Bug'] }, ['urgent bug']],
        ['task type by key', { taskType: [2] }, ['urgent bug']],
        ['tags', { tags: ['tag-1'] }, ['urgent bug']],
        ['a due date range', { dueDate: { from: day(15).toISOString(), to: day(25).getTime() } }, ['nobody on it (a.b)']],
        ['text in the name, read literally', { search: 'A.B' }, ['nobody on it (a.b)']],
        ['two filters at once', { status: ['Doing'], priority: ['HIGH'] }, ['urgent bug']],
    ])('filters by %s', async (_what, filter, expected) => {
        expect(await names(MEMBER, { filter })).toEqual(expected);
    });

    it('hides done work when asked for the open status types only', async () => {
        task(seeded.open, 'finished', { status: { key: 9, text: 'Done', type: 'close' }, statusKey: 9, statusType: 'close' });
        task(seeded.open, 'ready for review', { status: { key: 8, text: 'Review', type: 'done' }, statusKey: 8, statusType: 'done' });
        expect(await names(MEMBER)).toEqual(expect.arrayContaining(['finished', 'ready for review']));
        const open = await names(MEMBER, { filter: { statusType: ['default_active', 'active'] } });
        expect(open).toEqual([...MEMBER_SEES, 'nobody on it (a.b)', 'urgent bug'].sort());
        expect(await names(MEMBER, { filter: { statusType: ['done', 'close'] } })).toEqual(['finished', 'ready for review']);
        const res = await call(MEMBER, { filter: { statusType: ['finished'] } });
        expect(res.statusCode).toBe(400);
        expect(res.body.field).toBe('filter.statusType');
    });

    it('reads a regular expression in the search as plain text', async () => {
        expect(await names(MEMBER, { filter: { search: '.*' } })).toEqual([]);
    });

    it('finds the tasks with no due date', async () => {
        expect(await names(MEMBER, { filter: { dueDate: { none: true } } })).toEqual(MEMBER_SEES);
    });
});

describe('group counts come from the same match as the rows', () => {
    beforeEach(() => {
        task(seeded.open, 'doing, high', { Task_Priority: 'HIGH', status: { key: 2, text: 'Doing', type: 'active' }, statusKey: 2, AssigneeUserId: [MEMBER, COLLEAGUE] });
        task(seeded.mine, 'doing, low', { Task_Priority: 'LOW', status: { key: 5, text: 'Doing', type: 'active' }, statusKey: 5, AssigneeUserId: [COLLEAGUE] });
        task(seeded.theirs, 'doing, hidden from the member', { Task_Priority: 'HIGH', status: { key: 2, text: 'Doing', type: 'active' }, statusKey: 2 });
        task(seeded.open, 'a subtask', { isParentTask: false, Task_Priority: 'HIGH' });
        task(seeded.open, 'a chat', { mainChat: true, Task_Priority: 'HIGH' });
    });
    const tally = (rows, keyOf) => {
        const counts = {};
        rows.forEach((row) => [].concat(keyOf(row)).forEach((key) => { counts[key] = (counts[key] || 0) + 1; }));
        return Object.entries(counts).map(([key, count]) => ({ key, count })).sort((a, b) => (a.key < b.key ? -1 : 1));
    };

    it.each([
        ['status', (row) => row.status.text],
        ['project', (row) => String(row.ProjectID)],
        ['priority', (row) => row.Task_Priority],
        ['assignee', (row) => row.AssigneeUserId],
    ])('counts by %s what the pages return', async (group, keyOf) => {
        for (const uid of [MEMBER, OWNER]) {
            for (const filter of [{}, { priority: ['HIGH'] }]) {
                const { groups } = await everything(uid, { group, filter, limit: 2 });
                expect(groups).toEqual(tally(await allPages(uid, { filter, limit: 2 }), keyOf));
            }
        }
    });

    it('counts every row once when nothing groups them', async () => {
        const { groups } = await everything(MEMBER, { limit: 1 });
        expect(groups).toEqual([{ key: null, count: (await allPages(MEMBER, { limit: 3 })).length }]);
        expect((await everything(MEMBER, { filter: { search: 'nothing is called this' } })).groups).toEqual([{ key: null, count: 0 }]);
    });

    it('names every project it counts when grouping by project, not only those on the page', async () => {
        const { groups, projects, rows } = await everything(MEMBER, { group: 'project', limit: 1 });
        expect(rows).toHaveLength(1);
        expect(Object.keys(projects).sort()).toEqual(groups.map((g) => g.key).sort());
        expect(groups.length).toBeGreaterThan(1);
    });

    it('counts once per query: a page reached by cursor carries no counts', async () => {
        const first = await everything(MEMBER, { group: 'status', limit: 2 });
        const second = await everything(MEMBER, { group: 'status', limit: 2, cursor: first.nextCursor });
        expect(first.groups.length).toBeGreaterThan(0);
        expect(second.groups).toBeNull();
    });

    it('counts due dates by calendar day in the timezone sent', async () => {
        const lateOnTheFirst = new Date('2026-10-01T20:00:00.000Z');
        task(seeded.mine, 'due late on the first, UTC', { DueDate: lateOnTheFirst });
        task(seeded.mine, 'due on the third', { DueDate: day(3) });
        const scope = { group: 'dueDate', filter: { projectIds: [String(seeded.mine._id)] } };
        expect((await everything(MEMBER, scope)).groups).toEqual([{ key: null, count: 2 }, { key: '2026-10-01', count: 1 }, { key: '2026-10-03', count: 1 }]);
        expect((await everything(MEMBER, { ...scope, timezone: 'Asia/Kolkata' })).groups).toEqual([{ key: null, count: 2 }, { key: '2026-10-02', count: 1 }, { key: '2026-10-03', count: 1 }]);
    });

    it('builds the due-date counts over the same match as the rows', async () => {
        await everything(MEMBER, { group: 'dueDate', timezone: 'Asia/Kolkata', filter: { priority: ['HIGH'] } });
        const [rowsRead, groupRead] = ['$project', '$group'].map((name) => taskReads().find((c) => c.method === 'aggregate' && c.data[0].some((stage) => stage[name])));
        const groupStages = groupRead.data[0];
        expect(groupStages[1].$group._id).toEqual({ $dateToString: { format: '%Y-%m-%d', date: '$DueDate', timezone: 'Asia/Kolkata' } });
        const { $and: rowClauses, ...rowScope } = rowsRead.data[0][0].$match;
        const { $and: groupClauses, ...groupScope } = groupStages[0].$match;
        expect(groupScope).toEqual(rowScope);
        expect(rowClauses.slice(0, groupClauses.length)).toEqual(groupClauses);
        expect(groupClauses).toEqual([{ Task_Priority: { $in: ['HIGH'] } }]);
    });
});

describe('paging', () => {
    it('forces the page size, whatever limit is sent', async () => {
        for (let n = 0; n < 130; n += 1) task(seeded.open, `bulk ${n}`);
        const data = await everything(MEMBER, { limit: 100000 });
        expect(data.rows).toHaveLength(MAX_LIMIT);
        expect(data.nextCursor).toEqual(expect.any(String));
        taskReads().filter((c) => c.method === 'aggregate').forEach((c) => {
            c.data[0].filter((stage) => stage.$limit !== undefined).forEach((stage) => expect(stage.$limit).toBeLessThanOrEqual(MAX_LIMIT + 1));
        });
        expect((await everything(MEMBER, {})).rows.length).toBeLessThanOrEqual(MAX_LIMIT);
    });

    it('returns every row once, in one stable order, when the sort keys tie', async () => {
        for (let n = 0; n < 23; n += 1) task(seeded.open, `tied ${n}`, { updatedAt: day(5) });
        for (let n = 0; n < 4; n += 1) task(seeded.mine, `later ${n}`, { updatedAt: day(6 + n) });
        const expected = await names(MEMBER, { limit: 100 });

        const paged = await allPages(MEMBER, { limit: 4 });
        expect(paged.map((row) => row.TaskName).sort()).toEqual(expected);
        expect(new Set(paged.map((row) => String(row._id))).size).toBe(paged.length);
        expect(paged.map((row) => row.TaskName).slice(0, 4)).toEqual(['later 3', 'later 2', 'later 1', 'later 0']);
        const stamps = paged.map((row) => new Date(row.updatedAt).getTime());
        expect(stamps).toEqual([...stamps].sort((a, b) => b - a));
        expect((await allPages(MEMBER, { limit: 7 })).map((row) => String(row._id))).toEqual(paged.map((row) => String(row._id)));
        const oldestFirst = await allPages(MEMBER, { limit: 5, sort: { by: 'updatedAt', dir: 'asc' } });
        expect(oldestFirst.map((row) => String(row._id))).toEqual(paged.map((row) => String(row._id)).reverse());
    });

    it.each([['asc', [10, 10, 10, 12, 20]], ['desc', [20, 12, 10, 10, 10]]])('sorts by due date %s with the undated rows last, each once', async (dir, days) => {
        [12, 10, 20, 10, 10].forEach((n, index) => task(seeded.mine, `due ${n} #${index}`, { DueDate: day(n) }));
        const scope = { filter: { projectIds: [String(seeded.mine._id)] }, sort: { by: 'DueDate', dir } };
        const paged = await allPages(MEMBER, { ...scope, limit: 2 });
        expect(paged.map((row) => (row.DueDate ? new Date(row.DueDate).getUTCDate() : null))).toEqual([...days, null]);
        expect(paged[paged.length - 1].TaskName).toBe('private, member on it');
        expect(new Set(paged.map((row) => String(row._id))).size).toBe(6);
        expect((await allPages(MEMBER, { ...scope, limit: 5 })).map((row) => String(row._id))).toEqual(paged.map((row) => String(row._id)));
    });

    it('ends without a cursor', async () => {
        const data = await everything(MEMBER, { limit: 100 });
        expect(data.nextCursor).toBeNull();
    });

    it('refuses a cursor that was changed, and one issued for another query or to someone else', async () => {
        for (let n = 0; n < 5; n += 1) task(seeded.open, `more ${n}`);
        const { nextCursor } = await everything(MEMBER, { limit: 2 });
        const [body, mac] = nextCursor.split('.');
        const claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
        const moved = Buffer.from(JSON.stringify({ ...claims, v: 0 })).toString('base64url');

        for (const [uid, request] of [
            [MEMBER, { limit: 2, cursor: `${moved}.${mac}` }],
            [MEMBER, { limit: 2, cursor: `${body}.${mac.slice(0, -1)}${mac.endsWith('A') ? 'B' : 'A'}` }],
            [MEMBER, { limit: 2, cursor: body }],
            [MEMBER, { limit: 2, cursor: nextCursor, filter: { priority: ['HIGH'] } }],
            [MEMBER, { limit: 2, cursor: nextCursor, includeSubtasks: true }],
            [OWNER, { limit: 2, cursor: nextCursor }],
        ]) {
            mockDb.calls.length = 0;
            const res = await call(uid, request);
            expect(res.statusCode).toBe(400);
            expect(res.body).toMatchObject({ status: false, field: 'cursor' });
            expect(taskReads()).toEqual([]);
        }
        expect((await call(MEMBER, { limit: 2, cursor: nextCursor })).statusCode).toBe(200);
    });
});

describe('the route', () => {
    it('is one a narrowed token may call, since the handler holds it to its projects', async () => {
        const res = response();
        const next = jest.fn();
        await holdNarrowedToken({ method: 'POST', originalUrl: ROUTE, headers: { companyid: C }, apiToken: { userId: MEMBER, projectIds: [String(seeded.mine._id)] } }, res, next);
        expect(next).toHaveBeenCalled();
    });
});
