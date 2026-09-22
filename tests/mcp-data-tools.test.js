process.env.MCP_TOOLS_DATA = 'on';
const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Modules/Automations/engine/tools', () => ({ oid: (id) => (/^[0-9a-fA-F]{24}$/.test(String(id)) ? String(id) : null) }));
jest.mock('../Modules/Agents/scope', () => ({ visibleProjectIds: jest.fn(), visibleProjects: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({ ...jest.requireActual('../Config/permissionGuard'), getRoleType: jest.fn(), evaluatePermission: jest.fn() }));
jest.mock('../Modules/Agents/actions', () => {
    const real = jest.requireActual('../Modules/Agents/actions');
    class RefusedError extends Error {
        constructor(message) { super(message); this.name = 'RefusedError'; this.status = 403; }
    }
    return {
        RefusedError,
        SCOPE: real.SCOPE,
        rating: real.rating,
        unrated: real.unrated,
        authorizeRead: jest.fn(async () => true),
        perform: jest.fn(async () => ({ auditId: 'audit-1', result: { ok: 1 } })),
        refusal: jest.fn(async (companyId, actor, { reason }) => new RefusedError(reason)),
    };
});
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { ROLE_OWNER, ROLE_MEMBER } = require('../Config/roleTypes');
const scope = require('../Modules/Agents/scope');
const guard = require('../Config/permissionGuard');
const actions = require('../Modules/Agents/actions');
const registry = require('../Modules/Agents/registry');
const tools = require('../Modules/Mcp/tools');
const scopes = require('../Modules/Mcp/scopes');

/* Sprint 10 slice S6: projects, sprints, statuses, comments, pages and timesheets over MCP,
 * each answering exactly what the person behind the token can open in the web app. */

const C = '6f0000000000000000000c01';
const ME = '6f0000000000000000000001';
const SOMEONE = '6f0000000000000000000002';
const P_A = '6f0000000000000000000a01';
const P_B = '6f0000000000000000000a02';
const P_C = '6f0000000000000000000a03';
const P_PERSONAL = '6f0000000000000000000a04';

const READS = ['projects.list', 'project.get', 'sprints.list', 'statuses.list', 'comments.list', 'pages.search', 'page.get', 'timesheet.read'];
const WRITES = ['comment.create', 'timelog.create'];
const DATA_TOOLS = [...READS, ...WRITES];

const people = {
    member: { roleType: ROLE_MEMBER, visible: [P_A, P_C], tokenProjects: [] },
    restricted: { roleType: ROLE_MEMBER, visible: [P_A, P_C], tokenProjects: [P_A] },
    owner: { roleType: ROLE_OWNER, visible: [P_A, P_B, P_C], tokenProjects: [] },
};

let fx;
let person;

const ctx = (extra = {}) => ({
    companyId: C,
    userId: ME,
    actor: { kind: 'agent', userId: ME },
    ip: '1.1.1.1',
    projectIds: person.tokenProjects,
    token: { _id: 'tok', userId: ME, scopes: [], active: true },
    canWrite: true,
    ...extra,
});
const call = (name, args, extra) => tools.call(ctx(extra), name, args);
const refused = (promise) => expect(promise).rejects.toMatchObject({ name: 'RefusedError', status: 403, message: expect.stringMatching(/^not_visible/) });

const STATUSES = [
    { key: 1, name: 'To do', type: 'default_active', bgColor: '#ccc', textColor: '#000' },
    { key: 2, name: 'In progress', type: 'active', bgColor: '#00f', textColor: '#fff' },
    { key: 9, name: 'Done', type: 'close', bgColor: '#0f0', textColor: '#000' },
];

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    jest.clearAllMocks();
    delete process.env.MCP_TOOLS_V2;
    process.env.MCP_TOOLS_DATA = 'on';
    const project = (_id, ProjectName, extra = {}) => mockDb.seed(SCHEMA_TYPE.PROJECTS, {
        _id, ProjectName, ProjectCode: ProjectName.toUpperCase(), isPrivateSpace: false, AssigneeUserId: [ME, SOMEONE], taskStatusData: STATUSES, deletedStatusKey: 0, ...extra,
    });
    project(P_A, 'Apollo');
    project(P_B, 'Borealis', { isPrivateSpace: true, AssigneeUserId: [SOMEONE] });
    project(P_C, 'Cygnus');
    project(P_PERSONAL, 'Someone list', { isPersonal: true, personalOwner: SOMEONE });
    const sprint = (projectId, name, extra = {}) => mockDb.seed(SCHEMA_TYPE.SPRINTS, { projectId, name, AssigneeUserId: [], ...extra });
    const sOpen = sprint(P_A, 'Open sprint');
    const sPriv = sprint(P_A, 'Their sprint', { private: true, AssigneeUserId: [SOMEONE] });
    const sMine = sprint(P_A, 'My private sprint', { private: true, AssigneeUserId: [ME] });
    const sB = sprint(P_B, 'B sprint');
    const task = (TaskKey, ProjectID, sprintId) => mockDb.seed(SCHEMA_TYPE.TASKS, {
        TaskKey, TaskName: `Task ${TaskKey}`, CompanyId: C, ProjectID, sprintId, AssigneeUserId: [ME], statusType: 'open', deletedStatusKey: 0,
    });
    const tA = task('A-1', P_A, sOpen._id);
    const tPriv = task('A-PRIV', P_A, sPriv._id);
    const tB = task('B-1', P_B, sB._id);
    const tC = task('C-1', P_C, undefined);
    const comment = (t, message, extra = {}) => mockDb.seed(SCHEMA_TYPE.COMMENTS, {
        taskId: t._id, projectId: t.ProjectID, message, userId: SOMEONE, type: 'text', isDeleted: false, createdAt: new Date('2026-09-01T00:00:00Z'), ...extra,
    });
    comment(tA, 'first on A', { createdAt: new Date('2026-09-01T00:00:00Z') });
    comment(tA, 'second on A', { createdAt: new Date('2026-09-02T00:00:00Z'), userId: ME });
    comment(tA, 'deleted on A', { isDeleted: true });
    comment(tPriv, 'on the private sprint task');
    comment(tB, 'on B');
    comment(tC, 'on C');
    const page = (title, ProjectID, extra = {}) => mockDb.seed(SCHEMA_TYPE.PAGES, {
        title, ProjectID, content: { html: `<p>${title} body</p>` }, createdBy: SOMEONE, visibility: 'project', deletedStatusKey: 0, updatedAt: new Date('2026-09-03T00:00:00Z'), ...extra,
    });
    const entry = (Loggeduser, ProjectId, TicketID, day, minutes) => mockDb.seed(SCHEMA_TYPE.TIMESHEET, {
        Loggeduser, ProjectId, TicketID, LogStartTime: Date.parse(`${day}T09:00:00Z`) / 1000, LogEndTime: Date.parse(`${day}T09:00:00Z`) / 1000 + minutes * 60,
        LogTimeDuration: minutes, LogDescription: `${minutes} minutes`, logAddType: 0, billable: true,
    });
    fx = {
        sOpen, sPriv, sMine, sB, tA, tPriv, tB, tC,
        pgA: page('spec a', P_A),
        pgB: page('spec b', P_B),
        pgC: page('spec c', P_C),
        pgTheirs: page('their private note', P_A, { visibility: 'private' }),
        pgMine: page('my private note', P_A, { visibility: 'private', createdBy: ME }),
        pgCompany: page('company handbook', undefined),
        pgGone: page('spec deleted', P_A, { deletedStatusKey: 1 }),
        myA: entry(ME, P_A, tA._id, '2026-09-01', 30),
        myC: entry(ME, P_C, tC._id, '2026-09-02', 45),
        myB: entry(ME, P_B, tB._id, '2026-09-03', 15),
        theirA: entry(SOMEONE, P_A, tA._id, '2026-09-01', 60),
        theirB: entry(SOMEONE, P_B, tB._id, '2026-09-01', 90),
    };
});

const as = (name, { everyone = false } = {}) => {
    person = people[name];
    guard.getRoleType.mockResolvedValue(person.roleType);
    guard.evaluatePermission.mockResolvedValue(everyone ? 2 : 1);
    scope.visibleProjectIds.mockResolvedValue(person.visible);
};

describe('MCP_TOOLS_DATA off leaves the tool list and the registry as they are', () => {
    beforeEach(() => { process.env.MCP_TOOLS_DATA = 'off'; as('owner'); });

    it('offers none of the data tools and registers none of their actions', () => {
        expect(tools.names().filter((n) => DATA_TOOLS.includes(n))).toEqual([]);
        DATA_TOOLS.forEach((key) => expect(registry.has(key)).toBe(false));
        DATA_TOOLS.forEach((key) => expect(actions.rating(key)).toBeNull());
    });

    it.each(DATA_TOOLS)('answers %s as an unknown tool', async (name) => {
        await expect(call(name, {})).rejects.toMatchObject({ code: -32601 });
    });
});

describe('MCP_TOOLS_DATA on registers each tool as a rated registry action with a permission and a scope', () => {
    beforeEach(() => as('owner'));

    it('offers every data tool', () => {
        expect(tools.names()).toEqual(expect.arrayContaining(DATA_TOOLS));
    });

    it.each(DATA_TOOLS)('%s is a registry action with a permission key and a complete rating', (key) => {
        const action = registry.get(key);
        expect(action).not.toBeNull();
        expect(registry.permissionsFor(key).length).toBeGreaterThan(0);
        expect(actions.rating(key)).toMatchObject({ write: WRITES.includes(key), money: false });
        expect(actions.unrated([key])).toEqual([]);
    });

    it('rates both writes reversible and task-scoped, so neither is destructive and neither opens a proposal', () => {
        WRITES.forEach((key) => {
            expect(actions.rating(key)).toEqual({ write: true, reversible: true, scope: 'task', money: false });
            expect(registry.get(key)).toMatchObject({ write: true, undoable: true });
        });
    });

    it.each([
        ['projects.list', 'projects:read'], ['project.get', 'projects:read'], ['sprints.list', 'projects:read'], ['statuses.list', 'projects:read'],
        ['comments.list', 'tasks:read'], ['pages.search', 'docs:read'], ['page.get', 'docs:read'],
        ['timesheet.read', 'time:read'], ['comment.create', 'tasks:write'], ['timelog.create', 'time:write'],
    ])('%s needs %s', (name, needed) => {
        expect(scopes.scopeForTool(name)).toBe(needed);
    });

    it('declares visibility filtered on every data tool', () => {
        tools.registered().filter((t) => DATA_TOOLS.includes(t.name)).forEach((t) => expect(t.visibility).toBe('filtered'));
    });
});

describe('an OAuth token is held to the one scope each data tool needs', () => {
    beforeEach(() => as('owner'));
    const oauth = (granted) => ({ token: { _id: 'tok', userId: ME, oauth: true, scopes: granted, active: true } });
    const ARGS = {
        'projects.list': {}, 'project.get': { projectId: P_A }, 'sprints.list': { projectId: P_A }, 'statuses.list': { projectId: P_A },
        'comments.list': { taskId: '6f00000000000000000000ff' }, 'pages.search': {}, 'page.get': { pageId: '6f00000000000000000000ff' },
        'timesheet.read': {}, 'comment.create': { taskId: '6f00000000000000000000ff', text: 'x' }, 'timelog.create': { taskId: '6f00000000000000000000ff', minutes: 5 },
    };

    it.each(DATA_TOOLS)('%s is refused with insufficient scope when the grant lacks its scope, before anything is read', async (name) => {
        const needed = scopes.scopeForTool(name);
        const others = ['tasks:read', 'tasks:write', 'projects:read', 'docs:read', 'time:read', 'time:write'].filter((s) => s !== needed);
        await expect(call(name, ARGS[name], oauth(others))).rejects.toMatchObject({ code: -32004, message: `This token lacks the ${needed} scope.` });
        expect(actions.authorizeRead).not.toHaveBeenCalled();
        expect(actions.perform).not.toHaveBeenCalled();
        const messages = [{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: ARGS[name] } }];
        expect(scopes.missingScopes(oauth(others).token, messages)).toEqual([needed]);
        expect(scopes.missingScopes(oauth([needed]).token, messages)).toEqual([]);
    });

    it('lets the call through once the scope is granted', async () => {
        const out = await call('projects.list', {}, oauth(['projects:read']));
        expect(out.projects.length).toBeGreaterThan(0);
    });
});

const expected = {
    member: { projects: ['Apollo', 'Cygnus'], openB: false, openC: true, sprintsA: ['My private sprint', 'Open sprint'], commentsPriv: false, pages: ['company handbook', 'my private note', 'spec a', 'spec c'] },
    restricted: { projects: ['Apollo'], openB: false, openC: false, sprintsA: ['My private sprint', 'Open sprint'], commentsPriv: false, pages: ['my private note', 'spec a'] },
    owner: { projects: ['Apollo', 'Borealis', 'Cygnus'], openB: true, openC: true, sprintsA: ['My private sprint', 'Open sprint', 'Their sprint'], commentsPriv: true, pages: ['company handbook', 'my private note', 'spec a', 'spec b', 'spec c'] },
};

describe.each(Object.keys(people))('the data tools answer a %s token exactly as the web app would', (who) => {
    const want = expected[who];
    beforeEach(() => as(who));

    it('projects.list lists only the projects the person can open, never another person\'s personal list', async () => {
        const out = await call('projects.list', {});
        expect(out.projects.map((p) => p.name).sort()).toEqual(want.projects);
        expect(out.projects.find((p) => p.name === 'Apollo')).toMatchObject({ projectId: P_A, key: 'APOLLO', private: false });
    });

    it('project.get answers not found for a project outside the filter', async () => {
        expect(await call('project.get', { projectId: P_A })).toMatchObject({ projectId: P_A, name: 'Apollo' });
        for (const [open, id] of [[want.openB, P_B], [want.openC, P_C], [false, P_PERSONAL], [false, 'nope']]) {
            const out = await call('project.get', { projectId: id });
            if (open) expect(out.projectId).toBe(id); else expect(out).toEqual({ error: 'project not found' });
        }
    });

    it('sprints.list hides a private sprint from anyone not on it, except owners and admins', async () => {
        expect((await call('sprints.list', { projectId: P_A })).sprints.map((s) => s.name).sort()).toEqual(want.sprintsA);
        const outB = await call('sprints.list', { projectId: P_B });
        if (want.openB) expect(outB.sprints.map((s) => s.name)).toEqual(['B sprint']); else expect(outB).toEqual({ error: 'project not found' });
    });

    it('statuses.list gives the project\'s own statuses, and nothing for a project outside the filter', async () => {
        expect((await call('statuses.list', { projectId: P_A })).statuses).toEqual([
            { key: 1, name: 'To do', type: 'default_active', color: '#ccc' },
            { key: 2, name: 'In progress', type: 'active', color: '#00f' },
            { key: 9, name: 'Done', type: 'close', color: '#0f0' },
        ]);
        const outB = await call('statuses.list', { projectId: P_B });
        if (want.openB) expect(outB.statuses).toHaveLength(3); else expect(outB).toEqual({ error: 'project not found' });
    });

    it('comments.list reads a task\'s comments only when the person can open the task, newest first and without deleted ones', async () => {
        expect((await call('comments.list', { taskId: fx.tA._id })).comments.map((c) => c.text)).toEqual(['second on A', 'first on A']);
        for (const [open, t, text] of [[want.openB, fx.tB, 'on B'], [want.openC, fx.tC, 'on C'], [want.commentsPriv, fx.tPriv, 'on the private sprint task']]) {
            const out = await call('comments.list', { taskId: t._id });
            if (open) expect(out.comments.map((c) => c.text)).toEqual([text]); else expect(out).toEqual({ error: 'task not found' });
        }
        expect(await call('comments.list', { taskId: '6f00000000000000000000ff' })).toEqual({ error: 'task not found' });
    });

    it('pages.search never returns another person\'s private page or a page outside the filter', async () => {
        expect((await call('pages.search', {})).pages.map((p) => p.title).sort()).toEqual(want.pages);
        expect((await call('pages.search', { query: 'spec' })).pages.map((p) => p.title).sort()).toEqual(want.pages.filter((t) => t.startsWith('spec')));
    });

    it('a projectId argument narrows pages.search and never widens it', async () => {
        expect((await call('pages.search', { projectId: P_B })).pages.map((p) => p.title)).toEqual(want.openB ? ['spec b'] : []);
        expect((await call('pages.search', { projectId: P_A })).pages.map((p) => p.title).sort()).toEqual(['my private note', 'spec a']);
    });

    it('page.get reads a page the person can open and answers not found for the rest', async () => {
        expect(await call('page.get', { pageId: fx.pgA._id })).toMatchObject({ pageId: fx.pgA._id, title: 'spec a', projectId: P_A, text: 'spec a body' });
        expect((await call('page.get', { pageId: fx.pgMine._id })).title).toBe('my private note');
        for (const [open, pg] of [[want.openB, fx.pgB], [want.openC, fx.pgC], [false, fx.pgTheirs], [false, fx.pgGone], [want.pages.includes('company handbook'), fx.pgCompany]]) {
            const out = await call('page.get', { pageId: pg._id });
            if (open) expect(out.title).toBe(pg.title); else expect(out).toEqual({ error: 'page not found' });
        }
    });

    it('timesheet.read gives the caller\'s own entries, newest first', async () => {
        const out = await call('timesheet.read', {});
        const mine = who === 'restricted' ? [fx.myA] : [fx.myB, fx.myC, fx.myA];
        expect(out.userId).toBe(ME);
        expect(out.entries.map((e) => e.timesheetId)).toEqual(mine.map((e) => e._id));
        expect(out.entries.find((e) => e.timesheetId === fx.myA._id)).toMatchObject({ taskId: fx.tA._id, projectId: P_A, minutes: 30, startedAt: '2026-09-01T09:00:00.000Z', billable: true });
        expect((await call('timesheet.read', { userId: ME, from: '2026-09-02', to: '2026-09-02' })).entries.map((e) => e.timesheetId)).toEqual(who === 'restricted' ? [] : [fx.myC._id]);
    });

    it('timesheet.read refuses another person\'s entries unless the web app would show them', async () => {
        if (who === 'owner') {
            expect((await call('timesheet.read', { userId: SOMEONE })).entries.map((e) => e.timesheetId).sort()).toEqual([fx.theirA._id, fx.theirB._id].sort());
            return;
        }
        await refused(call('timesheet.read', { userId: SOMEONE }));
        expect(actions.refusal).toHaveBeenCalledWith(C, expect.anything(), expect.objectContaining({ action: 'timesheet.read' }));
    });

    it.each([
        ['comment.create', (t) => ({ taskId: t._id, text: 'hi' })],
        ['timelog.create', (t) => ({ taskId: t._id, minutes: 30 })],
    ])('%s acts on a task the person can open and refuses one outside the filter', async (name, args) => {
        await call(name, args(fx.tA));
        expect(actions.perform).toHaveBeenCalledTimes(1);
        for (const [open, t] of [[want.openB, fx.tB], [want.openC, fx.tC], [want.commentsPriv, fx.tPriv]]) {
            actions.perform.mockClear();
            if (open) {
                await call(name, args(t));
                expect(actions.perform).toHaveBeenCalledTimes(1);
            } else {
                await refused(call(name, args(t)));
                expect(actions.perform).not.toHaveBeenCalled();
            }
        }
    });
});

describe('timesheet.read for a member the permission matrix grants "Everyone"', () => {
    beforeEach(() => as('member', { everyone: true }));

    it('reads another person\'s entries, still only in the projects the member can open', async () => {
        expect((await call('timesheet.read', { userId: SOMEONE })).entries.map((e) => e.timesheetId)).toEqual([fx.theirA._id]);
    });
});

describe('the writes hand perform() only the caller\'s own target', () => {
    beforeEach(() => as('member'));

    it('timelog.create logs for the person behind the token, whatever the arguments name', async () => {
        await call('timelog.create', { taskId: fx.tA._id, minutes: 30, date: '2026-09-01', userId: SOMEONE, Loggeduser: SOMEONE });
        const { action, params } = actions.perform.mock.calls[0][0];
        expect(action).toBe('timelog.create');
        expect(params).toEqual({ taskId: fx.tA._id, minutes: 30, date: '2026-09-01', startTime: '', description: '', billable: true });
    });

    it('comment.create passes the text on as the comment body', async () => {
        await call('comment.create', { taskId: fx.tA._id, text: '<b>hi</b>' });
        expect(actions.perform.mock.calls[0][0]).toMatchObject({ action: 'comment.create', params: { taskId: fx.tA._id, body: '<b>hi</b>' } });
    });
});

describe('with MCP_TOOLS_V2 on the lists page with signed cursors and carry names', () => {
    beforeEach(() => { process.env.MCP_TOOLS_V2 = 'on'; as('owner'); });
    afterEach(() => { delete process.env.MCP_TOOLS_V2; });

    it('walks projects.list a page at a time', async () => {
        const first = await call('projects.list', { limit: 2 });
        expect(first.projects).toHaveLength(2);
        expect(typeof first.nextCursor).toBe('string');
        const second = await call('projects.list', { limit: 2, cursor: first.nextCursor });
        expect(second.nextCursor).toBeUndefined();
        expect([...first.projects, ...second.projects].map((p) => p.name).sort()).toEqual(['Apollo', 'Borealis', 'Cygnus']);
        await expect(call('projects.list', { limit: 2, cursor: `${first.nextCursor}x` })).rejects.toMatchObject({ code: -32602 });
    });

    it('puts a ref and the project name next to the ids', async () => {
        const [row] = (await call('sprints.list', { projectId: P_A, limit: 1 })).sprints;
        expect(row).toMatchObject({ ref: expect.stringMatching(/^sprint:/), project: { id: P_A, name: 'Apollo' } });
        const [pg] = (await call('pages.search', { projectId: P_A, query: 'spec', limit: 1 })).pages;
        expect(pg).toMatchObject({ ref: `page:${fx.pgA._id}`, project: { id: P_A, name: 'Apollo' } });
        const [entry] = (await call('timesheet.read', { limit: 1 })).entries;
        expect(entry).toMatchObject({ ref: expect.stringMatching(/^timesheet:/), project: { id: expect.any(String), name: expect.any(String) } });
    });

    it('annotates every data tool from its rating', () => {
        const byName = Object.fromEntries(tools.manifest().map((t) => [t.name, t.annotations]));
        READS.forEach((n) => expect(byName[n]).toMatchObject({ readOnlyHint: true, destructiveHint: false }));
        WRITES.forEach((n) => expect(byName[n]).toMatchObject({ readOnlyHint: false, destructiveHint: false }));
    });
});
