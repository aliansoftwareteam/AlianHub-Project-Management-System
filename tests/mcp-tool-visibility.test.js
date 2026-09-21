process.env.AGENT_PERFORMANCE_READ = 'on';
const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Modules/Automations/engine/tools', () => ({ oid: (id) => (/^[0-9a-fA-F]{24}$/.test(String(id)) ? String(id) : null) }));
jest.mock('../Modules/Agents/scope', () => ({ visibleProjectIds: jest.fn(), visibleProjects: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({ ...jest.requireActual('../Config/permissionGuard'), getRoleType: jest.fn() }));
jest.mock('../Modules/Agents/actions', () => {
    class RefusedError extends Error {
        constructor(message) { super(message); this.name = 'RefusedError'; this.status = 403; }
    }
    return {
        RefusedError,
        authorizeRead: jest.fn(async () => true),
        perform: jest.fn(async () => ({ auditId: 'audit-1', result: { ok: 1 } })),
        refusal: jest.fn(async (companyId, actor, { reason }) => new RefusedError(reason)),
    };
});
jest.mock('../Modules/Agents/performanceRead', () => ({ ...jest.requireActual('../Modules/Agents/performanceRead'), read: jest.fn(async () => ({ projects: [] })) }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { ROLE_GUEST, ROLE_OWNER, ROLE_MEMBER } = require('../Config/roleTypes');
const scope = require('../Modules/Agents/scope');
const guard = require('../Config/permissionGuard');
const actions = require('../Modules/Agents/actions');
const performanceRead = require('../Modules/Agents/performanceRead');
const tools = require('../Modules/Mcp/tools');

const C = '6f0000000000000000000c01';
const ME = '6f0000000000000000000001';
const SOMEONE = '6f0000000000000000000002';
const P_A = '6f0000000000000000000a01';
const P_B = '6f0000000000000000000a02';
const P_C = '6f0000000000000000000a03';

const people = {
    member: { roleType: ROLE_MEMBER, visible: [P_A, P_C], tokenProjects: [] },
    restricted: { roleType: ROLE_MEMBER, visible: [P_A, P_C], tokenProjects: [P_A] },
    guest: { roleType: ROLE_GUEST, visible: [P_A], tokenProjects: [] },
    owner: { roleType: ROLE_OWNER, visible: [P_A, P_B, P_C], tokenProjects: [] },
};

let fx;
let person;

const ctx = () => ({
    companyId: C,
    userId: ME,
    actor: { kind: 'agent', userId: ME },
    ip: '1.1.1.1',
    projectIds: person.tokenProjects,
    token: { _id: 'tok', userId: ME, scopes: [], active: true },
    canWrite: true,
});
const call = (name, args) => tools.call(ctx(), name, args);
const keys = (out) => out.tasks.map((t) => t.key).sort();

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    jest.clearAllMocks();
    const sprint = (projectId, extra = {}) => mockDb.seed(SCHEMA_TYPE.SPRINTS, { projectId, name: 'Sprint', AssigneeUserId: [], ...extra });
    const sOpen = sprint(P_A);
    const sPriv = sprint(P_A, { private: true, AssigneeUserId: [SOMEONE] });
    const sC = sprint(P_C);
    const task = (TaskKey, ProjectID, sprintId, extra = {}) => mockDb.seed(SCHEMA_TYPE.TASKS, {
        TaskKey, TaskName: `Task ${TaskKey}`, CompanyId: C, ProjectID, sprintId, AssigneeUserId: ME, statusType: 'open', deletedStatusKey: 0, ...extra,
    });
    const tB = task('B-1', P_B, undefined);
    const tPriv = task('A-PRIV', P_A, sPriv._id);
    const tC = task('C-1', P_C, sC._id);
    const tA = task('A-1', P_A, sOpen._id, { relations: [{ type: 'relates_to', taskId: tB._id }, { type: 'blocks', taskId: tPriv._id }, { type: 'blocks', taskId: tC._id }] });
    const page = (title, ProjectID) => mockDb.seed(SCHEMA_TYPE.PAGES, { title, ProjectID, content: { html: `<p>${title}</p>` }, linkedTasks: [tA._id] });
    fx = { sOpen, sPriv, sC, tA, tB, tC, tPriv, pgA: page('pa', P_A), pgB: page('pb', P_B), pgC: page('pc', P_C) };
});

const as = (name) => {
    person = people[name];
    guard.getRoleType.mockResolvedValue(person.roleType);
    scope.visibleProjectIds.mockResolvedValue(person.visible);
};

const refused = (promise) => expect(promise).rejects.toMatchObject({ name: 'RefusedError', status: 403, message: expect.stringMatching(/^not_visible/) });

const expected = {
    member: { search: ['A-1', 'C-1'], openA: true, openB: false, openC: true, openPriv: false, relations: ['C-1'] },
    restricted: { search: ['A-1'], openA: true, openB: false, openC: false, openPriv: false, relations: [] },
    guest: { search: ['A-1'], openA: true, openB: false, openC: false, openPriv: false, relations: [] },
    owner: { search: ['A-1', 'A-PRIV', 'B-1', 'C-1'], openA: true, openB: true, openC: true, openPriv: true, relations: ['A-PRIV', 'B-1', 'C-1'] },
};

describe.each(Object.keys(people))('MCP tools apply the web app visibility for a %s token', (who) => {
    const want = expected[who];
    beforeEach(() => as(who));

    it('tasks.search returns only tasks the person can open', async () => {
        expect(keys(await call('tasks.search', {}))).toEqual(want.search);
    });

    it('tasks.next returns only assigned tasks the person can still open', async () => {
        const next = keys(await call('tasks.next', {}));
        expect(next).toHaveLength(Math.min(3, want.search.length));
        expect(want.search).toEqual(expect.arrayContaining(next));
    });

    it('a projectId argument narrows the filter and never replaces it', async () => {
        expect(keys(await call('tasks.search', { projectId: P_B }))).toEqual(want.openB ? ['B-1'] : []);
        expect(keys(await call('tasks.search', { projectId: P_C }))).toEqual(want.openC ? ['C-1'] : []);
        expect(keys(await call('tasks.next', { projectId: P_B }))).toEqual(want.openB ? ['B-1'] : []);
        expect(keys(await call('tasks.search', { projectId: P_A }))).toEqual(want.openPriv ? ['A-1', 'A-PRIV'] : ['A-1']);
    });

    it('task.get answers not found outside the filter and drops related tasks outside it', async () => {
        const brief = await call('task.get', { taskId: fx.tA._id });
        expect(brief.taskId).toBe(fx.tA._id);
        expect(brief.relations.map((r) => r.key).sort()).toEqual(want.relations);
        const notFound = { error: 'task not found' };
        for (const [open, t] of [[want.openB, fx.tB], [want.openC, fx.tC], [want.openPriv, fx.tPriv]]) {
            const out = await call('task.get', { taskId: t._id });
            if (open) expect(out.taskId).toBe(t._id); else expect(out).toEqual(notFound);
        }
    });

    it('task.get lists only linked docs the person can open', async () => {
        const brief = await call('task.get', { taskId: fx.tA._id });
        const titles = brief.linkedDocs.map((d) => d.title).sort();
        expect(titles).toEqual(['pa', ...(want.openB ? ['pb'] : []), ...(want.openC ? ['pc'] : [])]);
    });

    it('docs.read answers not found for a page in a project outside the filter', async () => {
        expect((await call('docs.read', { pageId: fx.pgA._id })).text).toBe('pa');
        for (const [open, pg] of [[want.openB, fx.pgB], [want.openC, fx.pgC]]) {
            const out = await call('docs.read', { pageId: pg._id });
            if (open) expect(out.text).toBe(pg.title); else expect(out).toEqual({ error: 'page not found' });
        }
    });

    const writes = [
        ['task.comment', (t) => ({ taskId: t._id, body: 'hi' })],
        ['task.status.set', (t) => ({ taskId: t._id, status: 'In progress' })],
        ['task.link', (t) => ({ taskId: t._id, url: 'https://example.com/pr/1' })],
        ['subtask.create', (t) => ({ taskId: t._id, title: 'sub' })],
        ['timelog.start', (t) => ({ taskId: t._id })],
        ['timelog.stop', (t) => ({ taskId: t._id })],
    ];

    it.each(writes)('%s acts on a task the person can open and refuses one outside the filter', async (name, args) => {
        await call(name, args(fx.tA));
        expect(actions.perform).toHaveBeenCalledTimes(1);
        for (const [open, t] of [[want.openB, fx.tB], [want.openC, fx.tC], [want.openPriv, fx.tPriv]]) {
            actions.perform.mockClear();
            if (open) {
                await call(name, args(t));
                expect(actions.perform).toHaveBeenCalledTimes(1);
            } else {
                await refused(call(name, args(t)));
                expect(actions.perform).not.toHaveBeenCalled();
            }
        }
        actions.perform.mockClear();
        await refused(call(name, args({ _id: '6f00000000000000000000ff' })));
        expect(actions.perform).not.toHaveBeenCalled();
    });

    it('performance.read refuses a project outside the filter before reading any numbers', async () => {
        const range = { from: '2026-09-01', to: '2026-09-07' };
        await call('performance.read', { ...range, projectId: P_A });
        expect(performanceRead.read).toHaveBeenCalledTimes(1);
        for (const [open, projectId] of [[want.openB, P_B], [want.openC, P_C]]) {
            performanceRead.read.mockClear();
            if (open) {
                await call('performance.read', { ...range, projectIds: [P_A, projectId] });
                expect(performanceRead.read).toHaveBeenCalledTimes(1);
            } else {
                await refused(call('performance.read', { ...range, projectIds: [P_A, projectId] }));
                expect(performanceRead.read).not.toHaveBeenCalled();
            }
        }
    });

    it('task.create refuses a project outside the filter, a hidden sprint and a sprint from another project', async () => {
        await call('task.create', { projectId: P_A, title: 'x', sprintId: fx.sOpen._id });
        expect(actions.perform).toHaveBeenCalledTimes(1);
        for (const [open, projectId] of [[want.openB, P_B], [want.openC, P_C]]) {
            actions.perform.mockClear();
            if (open) {
                await call('task.create', { projectId, title: 'x' });
                expect(actions.perform).toHaveBeenCalledTimes(1);
            } else {
                await refused(call('task.create', { projectId, title: 'x' }));
                expect(actions.perform).not.toHaveBeenCalled();
            }
        }
        actions.perform.mockClear();
        if (want.openPriv) {
            await call('task.create', { projectId: P_A, title: 'x', sprintId: fx.sPriv._id });
            expect(actions.perform).toHaveBeenCalledTimes(1);
        } else {
            await refused(call('task.create', { projectId: P_A, title: 'x', sprintId: fx.sPriv._id }));
        }
        actions.perform.mockClear();
        await refused(call('task.create', { projectId: P_A, title: 'x', sprintId: fx.sC._id }));
        await refused(call('task.create', { projectId: P_A, title: 'x', sprintId: 'not-an-id' }));
        expect(actions.perform).not.toHaveBeenCalled();
    });
});

describe('MCP visibility for a caller who is no longer a member', () => {
    beforeEach(() => {
        person = { tokenProjects: [] };
        guard.getRoleType.mockResolvedValue(null);
        scope.visibleProjectIds.mockResolvedValue([P_A]);
    });

    it('sees nothing and may write nothing', async () => {
        expect((await call('tasks.search', {})).tasks).toEqual([]);
        expect(await call('task.get', { taskId: fx.tA._id })).toEqual({ error: 'task not found' });
        await refused(call('task.comment', { taskId: fx.tA._id, body: 'x' }));
    });
});
