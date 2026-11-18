require('./fixtures/mcpFlagsOff');
/* Task 047, benchmark job 6: a connected agent asks for a copy of a project. The call makes nothing: it waits as one
   proposal with one preview. Approved, the copy is made by the route the web app duplicates a project with, as the
   person who approved, and it is private to that person whoever is on the project it was copied from. Tasks come
   only when they were asked for. Undo moves the copy to the trash unless it holds work that was not part of it. */
process.env.STORAGE_TYPE = 'server';
const mockDb = require('./fixtures/fakeMongo').create();
const mockElsewhere = require('./fixtures/fakeMongo').create();
const mockOtherCompany = '6f00000000000000000000c2';

/* One database per company, as in production: a call that names another company reads that company's rows only. */
jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (companyId, q, method) => (String(companyId) === mockOtherCompany ? mockElsewhere : mockDb).crud(companyId, q, method),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0, flushAll: () => {} } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
const mockStub = () => new Proxy({}, {
    get: (target, name) => {
        if (name === 'then' || name === '__esModule') return undefined;
        target[name] = target[name] || jest.fn(() => Promise.resolve({}));
        return target[name];
    },
});
jest.mock('../Modules/Tasks/helpers/handleNotification', () => mockStub());
jest.mock('../Modules/notification/prepare-notification-data/controllerV2', () => mockStub());
jest.mock('../Modules/Company/eventController', () => mockStub());
jest.mock('../Modules/Company/controller/updateCompany', () => mockStub());
jest.mock('../Modules/notification-count/controller', () => mockStub());
jest.mock('../Modules/Comments/controller', () => mockStub());
jest.mock('../Modules/MainChats/controller', () => mockStub());
jest.mock('../Modules/LogTime/controllerV2.js', () => mockStub());
jest.mock('../Modules/CustomField/aiFields/controller', () => mockStub());
jest.mock('../Modules/Project/helpers/projectHistory', () => ({ recordProjectCreated: jest.fn(async () => undefined), recordProjectChanges: jest.fn(async () => undefined) }));
jest.mock('../Modules/Automations/engine/matcher', () => ({ invalidate: jest.fn() }));
jest.mock('../utils/planHelper', () => ({ getCachedCompanyData: jest.fn(async () => ({ data: {} })) }));
jest.mock('../utils/commonFunctions.js', () => mockStub());
jest.mock('../common-storage/common-server.js', () => mockStub());
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../Modules/Tasks/helpers/completionStore', () => ({ recordWork: jest.fn(async () => null), forStatusChange: jest.fn(async () => null) }));
jest.mock('../Modules/Agents/engine/graph', () => ({ resumeGraph: jest.fn(async () => ({ resumed: false })) }));
jest.mock('../Modules/AICore/persistence', () => {
    const deleteThread = jest.fn(async () => {});
    return { deleteThread, saverFor: jest.fn(() => ({ deleteThread })), storeFor: jest.fn(() => { throw new Error('no store in this suite'); }), ready: jest.fn(async () => {}) };
});
jest.mock('../Config/jwt', () => ({ verifyCompanyMembership: jest.fn(async () => true) }));
jest.mock('../Modules/ApiTokens/controller', () => ({ verifyToken: jest.fn(), logTokenActivity: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const world = require('./fixtures/mcpWorkWorld');
const registry = require('../Modules/Agents/registry');
const actions = require('../Modules/Agents/actions');
const proposals = require('../Modules/Agents/proposals');
const memory = require('../Modules/Agents/memory');
const projectPolicy = require('../Modules/Agents/projectPolicy');
const intentPreview = require('../Modules/Agents/intentPreview');
const queue = require('../Modules/Inbox/helpers/approvalQueue');
const copyRules = require('../Modules/ProjectDuplicate/rules');
const socketEmitter = require('../event/socketEventEmitter');
const scopes = require('../Modules/Mcp/scopes');
const server = require('../Modules/Mcp/server');

const { CID, OWNER, INSIDER, OUTSIDER, GUEST, P_OPEN, P_PRIVATE, P_PERSONAL, L_OPEN, L_SECRET, TOKEN, MISSING, BEFORE, FLAGS, ctx, narrowed, readOnly, settle } = world;
const { seed, rows, stored, audits, setRule, rpcThrough, listedThrough } = world.create(mockDb);
const rpc = rpcThrough(server);
const listed = listedThrough(server);

const TOOL = 'project.duplicate';
const NAME = 'Open, second round';
const NO_PROJECT = 'not_visible: that project was not found, or the person cannot open it. Ask the person which project they mean.';
const PEOPLE = [OWNER, INSIDER, OUTSIDER, GUEST];
const MEMBER_KEYS = ['project_create', 'project_delete', 'project_close'];
const ASK = { projectId: P_OPEN, name: `  ${NAME}\u0007 `, reason: 'The next round starts from the same setup' };
const WITH_TASKS = { ...ASK, tasks: true };

const live = (row) => Number(row.deletedStatusKey || 0) === 0;
const projectsNamed = (name = NAME) => rows(SCHEMA_TYPE.PROJECTS).filter((row) => row.ProjectName === name);
const made = (name = NAME) => projectsNamed(name)[0];
const listsOf = (projectId) => rows(SCHEMA_TYPE.SPRINTS).filter((row) => String(row.projectId) === String(projectId) && live(row));
const tasksOf = (projectId) => rows(SCHEMA_TYPE.TASKS).filter((row) => String(row.ProjectID) === String(projectId));
const waiting = () => rows(SCHEMA_TYPE.AGENT_PROPOSALS).filter((row) => row.status === 'pending');
const everythingNow = () => JSON.stringify([SCHEMA_TYPE.PROJECTS, SCHEMA_TYPE.SPRINTS, SCHEMA_TYPE.FOLDERS, SCHEMA_TYPE.TASKS, SCHEMA_TYPE.CUSTOM_FIELDS].map((type) => mockDb.store[type]));
const human = (userId) => ({ kind: 'human', userId });
const approve = (id, uid = INSIDER) => proposals.approve(CID, id, { decider: human(uid), isPrivileged: uid === OWNER, ip: '' });
const undo = (id, uid = INSIDER) => proposals.undoApproval(CID, id, { decider: human(uid), isPrivileged: uid === OWNER, ip: '' });
const tokenOf = (uid) => TOKEN.replace(/.$/, String(PEOPLE.indexOf(uid) + 1));
const as = (uid, over = {}) => {
    const base = ctx(uid, over);
    return { ...base, actor: { ...base.actor, tokenId: tokenOf(uid) }, token: { ...base.token, _id: tokenOf(uid), grants: ['tasks:manage'] } };
};
const elsewhere = (uid) => as(uid, { companyId: mockOtherCompany });
const filed = async (caller, args = ASK) => {
    const out = await rpc(caller, TOOL, args);
    expect(out).toMatchObject({ ok: false, pending: true, approval: 'pending' });
    return out.proposalId;
};
const seedManyTasks = (count) => Array.from({ length: count }, (unused, at) => mockDb.seed(SCHEMA_TYPE.TASKS, {
    TaskName: `Bulk ${at}`, TaskKey: `OPE-${100 + at}`, ProjectID: P_OPEN, sprintId: L_OPEN, CompanyId: CID, statusKey: 1, TaskType: 'task', TaskTypeKey: 1, isParentTask: true, AssigneeUserId: [], deletedStatusKey: 0,
}));

beforeEach(() => {
    seed();
    const parent = rows(SCHEMA_TYPE.RULES).find((rule) => rule.isParent && rule.key === 'project');
    MEMBER_KEYS.forEach((key) => mockDb.seed(SCHEMA_TYPE.RULES, {
        key, name: key, isParent: false, parentId: String(parent._id), roles: [{ key: 3, permission: true }, { key: 0, permission: false }],
    }));
    stored(SCHEMA_TYPE.PROJECTS, P_OPEN).AssigneeUserId = [OWNER, INSIDER, OUTSIDER, GUEST];
    stored(SCHEMA_TYPE.PROJECTS, P_OPEN).LeadUserId = [OWNER];
    stored(SCHEMA_TYPE.PROJECTS, P_PRIVATE).AssigneeUserId = [INSIDER, OWNER];
    PEOPLE.forEach((userId) => mockDb.seed(SCHEMA_TYPE.API_TOKENS, {
        _id: tokenOf(userId), userId, active: true, scopes: ['read', 'write'], grants: ['tasks:manage'], projectIds: [], expiresAt: new Date(Date.now() + 86400000),
    }));
    Object.keys(mockElsewhere.store).forEach((type) => { mockElsewhere.store[type].length = 0; });
    mockElsewhere.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: OUTSIDER, roleType: 1, status: 2, isDelete: false });
    jest.spyOn(memory, 'rememberApprovedChanges').mockResolvedValue([]);
});
afterEach(async () => { await settle(); jest.restoreAllMocks(); });
afterAll(() => { FLAGS.forEach((flag) => { delete process.env[flag]; }); });

describe('the flag decides whether the tool exists', () => {
    it('off, the tool list and the registry are what they were', async () => {
        process.env.MCP_TOOLS_WORK = 'off';
        expect(await listed(as(OWNER))).toEqual(BEFORE);
        expect(registry.has(TOOL)).toBe(false);
        expect(actions.rating(TOOL)).toBeNull();
        expect((await rpc(as(OWNER), TOOL, ASK)).rpcError).toMatchObject({ code: -32601 });
        expect(waiting()).toHaveLength(0);
    });

    it('on, it is a rated registry action that is always proposed, under the key that creates a project by hand', async () => {
        expect(await listed(as(OWNER))).toContain(TOOL);
        expect(registry.get(TOOL)).toMatchObject({ risk: 'medium', undoable: true, write: true, proposeOnly: true });
        expect(registry.permissionsFor(TOOL)).toEqual([{ key: 'project.project_create', write: true }]);
        expect(actions.rating(TOOL)).toEqual({ write: true, reversible: true, scope: 'workspace', money: false });
        expect(scopes.scopeForTool(TOOL)).toBe('tasks:manage');
    });
});

describe('a copy is never made before a person has seen it', () => {
    it('files the copy as one proposal with one change, cleaned to plain text, and makes nothing', async () => {
        const before = everythingNow();
        const id = await filed(as(INSIDER));
        expect(everythingNow()).toBe(before);
        const [proposal] = waiting();
        expect(String(proposal._id)).toBe(id);
        expect(proposal).toMatchObject({ projectId: null, source: 'mcp', requestedBy: INSIDER });
        expect(proposal.changes).toHaveLength(1);
        expect(proposal.changes[0]).toMatchObject({ action: TOOL, reversible: true });
        expect(proposal.changes[0].params).toEqual({ sourceProjectId: P_OPEN, name: NAME });
    });

    it('files the tasks and the dates only when they are asked for', async () => {
        await filed(as(INSIDER), { ...WITH_TASKS, dates: true });
        expect(waiting()[0].changes[0].params).toEqual({ sourceProjectId: P_OPEN, name: NAME, tasks: true, dates: true });
        await filed(as(INSIDER), { ...ASK, name: 'No tasks', tasks: false, dates: false });
        expect(waiting()[1].changes[0].params).toEqual({ sourceProjectId: P_OPEN, name: 'No tasks' });
    });

    it('waits for a person whatever is set, and cannot be run directly', async () => {
        const params = { sourceProjectId: P_OPEN, name: NAME };
        expect(await projectPolicy.ask({ companyId: CID, actor: as(INSIDER).actor, action: TOOL, params })).toMatchObject({ decision: 'propose' });
        const call = (given) => actions.perform({ companyId: CID, actor: as(OWNER).actor, action: TOOL, params: given, reason: 'direct' });
        await expect(call(params)).rejects.toThrow(/has to be sent as a proposal/);
        await expect(call({ ...params, __proposal: true })).rejects.toThrow(/waits for a person's approval/);
        expect(projectsNamed()).toHaveLength(0);
    });
});

describe('who may ask for a copy', () => {
    it('files for an owner and for a member who can open the project and may create one by hand', async () => {
        await filed(as(OWNER));
        await filed(as(OUTSIDER));
        await filed(as(INSIDER), { projectId: P_PRIVATE, name: 'Private, again' });
        expect(waiting()).toHaveLength(3);
    });

    it('refuses, with the reason, a member who may not create a project by hand, and files nothing', async () => {
        setRule('project_create', false, [3]);
        const before = everythingNow();
        const out = await rpc(as(OUTSIDER), TOOL, ASK);
        expect(out).toMatchObject({ refused: true });
        expect(out.reason).toMatch(/^permission_denied: the person you act for is not allowed to create a project themselves\. Ask someone who can\. \(The permission project\.project_create is missing\.\)$/);
        expect(audits(TOOL).map((row) => row.meta.ran)).toEqual([false]);
        expect(everythingNow()).toBe(before);
        expect(waiting()).toHaveLength(0);
        await filed(as(OWNER));
    });

    it('refuses a guest', async () => {
        expect(await rpc(as(GUEST), TOOL, ASK)).toMatchObject({ refused: true, reason: expect.stringMatching(/^permission_denied: /) });
        expect(waiting()).toHaveLength(0);
    });

    it('answers a project the person cannot open as a missing project', async () => {
        const ask = (projectId) => ({ projectId, name: NAME });
        expect(await rpc(as(OWNER), TOOL, ask(MISSING))).toMatchObject({ refused: true, reason: NO_PROJECT });
        expect(await rpc(as(OUTSIDER), TOOL, ask(P_PRIVATE))).toMatchObject({ refused: true, reason: NO_PROJECT });
        expect(await rpc(as(OWNER), TOOL, ask(P_PERSONAL))).toMatchObject({ refused: true, reason: NO_PROJECT });
        expect(waiting()).toHaveLength(0);
    });

    it('refuses a token kept to some projects, even to the project it names, and a token that only reads', async () => {
        const kept = { ...as(INSIDER), projectIds: narrowed(INSIDER, [P_OPEN]).projectIds };
        expect(await rpc(kept, TOOL, ASK)).toMatchObject({ refused: true, reason: expect.stringMatching(/^not_visible: .*limited to some projects/) });
        expect(await rpc(readOnly(OWNER), TOOL, ASK)).toMatchObject({ isError: true, error: 'This connection can only read. Ask the person to connect you again and allow changes.' });
        expect(waiting()).toHaveLength(0);
    });

    it('gives another company none of this company\'s projects', async () => {
        const before = everythingNow();
        expect(await rpc(elsewhere(OUTSIDER), TOOL, WITH_TASKS)).toMatchObject({ refused: true, reason: NO_PROJECT });
        expect(everythingNow()).toBe(before);
        expect(waiting()).toHaveLength(0);
        expect(mockElsewhere.store[SCHEMA_TYPE.AGENT_PROPOSALS] || []).toHaveLength(0);
    });

    it('answers that a personal list cannot be copied', async () => {
        expect(await rpc(as(INSIDER), TOOL, { projectId: P_PERSONAL, name: NAME })).toEqual({ ok: false, error: expect.stringMatching(/personal list cannot be copied/) });
        expect(waiting()).toHaveLength(0);
    });

    it('answers that a project is too large to copy with its tasks, and offers the copy without them', async () => {
        seedManyTasks(copyRules.INLINE_TASK_LIMIT);
        const out = await rpc(as(OUTSIDER), TOOL, WITH_TASKS);
        expect(out).toEqual({ ok: false, error: expect.stringMatching(new RegExp(`has ${copyRules.INLINE_TASK_LIMIT + 3} tasks.*at most ${copyRules.INLINE_TASK_LIMIT}.*without its tasks`)) });
        expect(waiting()).toHaveLength(0);
        await filed(as(OUTSIDER), ASK);
    });

    it('holds the name and the project to their limits and says what is wrong', async () => {
        const bad = async (args) => (await rpc(as(OWNER), TOOL, args)).rpcError;
        expect(await bad({ name: NAME })).toMatchObject({ code: -32602 });
        expect(await bad({ projectId: P_OPEN })).toMatchObject({ code: -32602 });
        expect(await bad({ projectId: 'open', name: NAME })).toMatchObject({ code: -32602 });
        expect(await bad({ projectId: P_OPEN, name: ' a ' })).toMatchObject({ code: -32602, message: expect.stringMatching(/name/) });
        expect(await bad({ projectId: P_OPEN, name: 'x'.repeat(101) })).toMatchObject({ code: -32602 });
        expect(await bad({ projectId: P_OPEN, name: NAME, tasks: 'yes' })).toMatchObject({ code: -32602 });
        expect(await bad({ projectId: P_OPEN, name: NAME, assignees: true })).toMatchObject({ code: -32602 });
        expect(waiting()).toHaveLength(0);
    });
});

describe('approving makes the copy as the web app would, private to the person who approved', () => {
    it('copies the lists and the statuses and no task, with only the approver on it', async () => {
        const id = await filed(as(INSIDER));
        const source = JSON.stringify(stored(SCHEMA_TYPE.PROJECTS, P_OPEN));
        const asked = mockDb.calls.length;
        const out = await approve(id);
        expect(out.error).toBeUndefined();
        expect(out.applied).toHaveLength(1);
        expect(out.applied[0]).toMatchObject({ action: TOOL, ok: true });
        const { result } = out.applied[0];

        expect(projectsNamed()).toHaveLength(1);
        const copy = made();
        const projectId = String(copy._id);
        expect(copy).toMatchObject({ ProjectName: NAME, ProjectCode: 'OPE2', projectCreatedBy: INSIDER, AssigneeUserId: [INSIDER], LeadUserId: [INSIDER], isPrivateSpace: true });
        expect(String(copy.CompanyId)).toBe(CID);
        expect(live(copy)).toBe(true);
        expect(copy.taskStatusData.map((status) => status.name)).toEqual(['To Do', 'In Progress', 'Done']);
        expect(listsOf(projectId).map((list) => list.name)).toEqual(['Open list', 'Private list']);
        expect(tasksOf(projectId)).toHaveLength(0);
        expect(result).toMatchObject({ projectId, name: NAME, code: 'OPE2', copiedFrom: P_OPEN, copied: { folders: 0, lists: 2, tasks: 0, automations: 0 }, notes: [] });

        expect(JSON.stringify(stored(SCHEMA_TYPE.PROJECTS, P_OPEN))).toBe(source);
        expect(audits(TOOL, 'applied')[0]).toMatchObject({ entityType: 'project', entityId: projectId, meta: { onBehalfOf: INSIDER, undo: { kind: 'projectCopy', projectId, taskIds: [] } } });
        expect(socketEmitter.emit).toHaveBeenCalledWith('insert', expect.objectContaining({ module: 'project', companyId: CID, data: expect.objectContaining({ ProjectName: NAME }) }));
        expect([...new Set(mockDb.calls.slice(asked).map((call) => String(call.companyId)))].sort()).toEqual([CID, 'global'].sort());
    });

    it('keeps a private list of the copy to the approver alone', async () => {
        await approve(await filed(as(INSIDER)));
        const secret = listsOf(made()._id).find((list) => list.name === 'Private list');
        expect(secret).toMatchObject({ private: true, AssigneeUserId: [INSIDER] });
        expect(stored(SCHEMA_TYPE.SPRINTS, L_SECRET).AssigneeUserId).toEqual([INSIDER]);
    });

    it('leaves the people of a private project off the copy', async () => {
        const out = await approve(await filed(as(INSIDER), { projectId: P_PRIVATE, name: 'Private, again' }));
        expect(out.applied[0].ok).toBe(true);
        expect(made('Private, again')).toMatchObject({ AssigneeUserId: [INSIDER], LeadUserId: [INSIDER], isPrivateSpace: true });
        expect(stored(SCHEMA_TYPE.PROJECTS, P_PRIVATE).AssigneeUserId).toEqual([INSIDER, OWNER]);
    });

    it('copies the tasks, without their assignees, when they were asked for', async () => {
        const out = await approve(await filed(as(INSIDER), WITH_TASKS));
        const { result } = out.applied[0];
        const copied = tasksOf(made()._id);
        expect(copied.map((task) => task.TaskName).sort()).toEqual(['Open task', 'Second open task', 'Secret task', 'Twin of the open task']);
        copied.forEach((task) => expect(task).toMatchObject({ AssigneeUserId: [], Task_Leader: INSIDER, deletedStatusKey: 0 }));
        expect(result.copied.tasks).toBe(4);
        expect([...audits(TOOL, 'applied')[0].meta.undo.taskIds].sort()).toEqual(copied.map((task) => String(task._id)).sort());
        expect(tasksOf(P_OPEN)).toHaveLength(4);
    });

    it('copies for a member only the lists and tasks that member can open', async () => {
        const out = await approve(await filed(as(OUTSIDER), WITH_TASKS), OUTSIDER);
        const copy = made();
        expect(copy).toMatchObject({ AssigneeUserId: [OUTSIDER], isPrivateSpace: true });
        expect(listsOf(copy._id).map((list) => list.name)).toEqual(['Open list']);
        expect(tasksOf(copy._id).map((task) => task.TaskName).sort()).toEqual(['Open task', 'Second open task', 'Twin of the open task']);
        expect(out.applied[0].result).toMatchObject({ copied: { lists: 1, tasks: 3 }, notes: [{ code: 'private_lists_left', count: 1 }] });
    });

    it('makes the copy for an approver who is not the person who asked, and tells that person no count of it', async () => {
        const out = await approve(await filed(as(OUTSIDER), WITH_TASKS), OWNER);
        expect(out.applied[0].ok).toBe(true);
        const copy = made();
        expect(copy).toMatchObject({ projectCreatedBy: OWNER, AssigneeUserId: [OWNER], LeadUserId: [OWNER], isPrivateSpace: true });
        expect(listsOf(copy._id).map((list) => list.name)).toEqual(['Open list', 'Private list']);
        expect(out.applied[0].result).toEqual(expect.objectContaining({ projectId: String(copy._id), name: NAME, copiedFrom: P_OPEN }));
        expect(out.applied[0].result.copied).toBeUndefined();
        expect(out.applied[0].result.notes).toBeUndefined();
    });

    it('gives a second copy a key of its own', async () => {
        await approve(await filed(as(INSIDER)));
        const out = await approve(await filed(as(INSIDER), { ...ASK, name: 'Third round' }));
        expect(out.applied[0].result.code).toBe('OPE3');
    });

    it('refuses an approver who may not create a project by hand, and makes nothing', async () => {
        const id = await filed(as(INSIDER));
        const before = everythingNow();
        expect(await approve(id, GUEST)).toMatchObject({ status: 403, error: expect.stringMatching(/approver may not/) });
        expect(everythingNow()).toBe(before);
        expect(waiting()).toHaveLength(1);
    });

    it('refuses an approver who cannot open the project, and makes nothing', async () => {
        const id = await filed(as(INSIDER), { projectId: P_PRIVATE, name: 'Private, again' });
        const before = everythingNow();
        expect(await approve(id, OUTSIDER)).toMatchObject({ status: 403 });
        expect(everythingNow()).toBe(before);
    });

    it('refuses the approval when the person who asked can no longer open the project', async () => {
        const id = await filed(as(INSIDER), { projectId: P_PRIVATE, name: 'Private, again' });
        stored(SCHEMA_TYPE.PROJECTS, P_PRIVATE).AssigneeUserId = [OWNER];
        expect(await approve(id, OWNER)).toMatchObject({ status: 403, error: expect.stringMatching(/can no longer open/) });
        expect(projectsNamed('Private, again')).toHaveLength(0);
    });

    it('refuses the approval when the token that asked has since been kept to some projects', async () => {
        const id = await filed(as(INSIDER));
        stored(SCHEMA_TYPE.API_TOKENS, tokenOf(INSIDER)).projectIds = [P_OPEN];
        expect(await approve(id)).toMatchObject({ status: 403, error: expect.stringMatching(/outside the token's project list/) });
        expect(projectsNamed()).toHaveLength(0);
    });

    it('asks the person behind the token again, and makes nothing when they may no longer create a project', async () => {
        const id = await filed(as(OUTSIDER));
        setRule('project_create', false, [3]);
        const out = await approve(id, OWNER);
        expect(out.applied[0]).toMatchObject({ ok: false, error: expect.stringMatching(/permission_denied/) });
        expect(projectsNamed()).toHaveLength(0);
    });

    it('makes nothing when the project has grown too large to copy with its tasks by the time it is approved', async () => {
        const id = await filed(as(INSIDER), WITH_TASKS);
        seedManyTasks(copyRules.INLINE_TASK_LIMIT);
        const before = everythingNow();
        const out = await approve(id);
        expect(out.applied[0]).toMatchObject({ ok: false, error: expect.stringMatching(/at most 300/) });
        expect(everythingNow()).toBe(before);
    });

    it('moves the copy to the trash, and says so, if it ever came out open to anyone but the approver', async () => {
        jest.spyOn(copyRules, 'forCallerAlone').mockImplementation((bundle) => bundle);
        const out = await approve(await filed(as(INSIDER)));
        expect(out.applied[0]).toMatchObject({ ok: false, error: expect.stringMatching(/not private to the person approving, so it was moved to the trash/) });
        expect(Number(made().deletedStatusKey)).toBe(1);
    });
});

describe('undo moves the copy to the trash', () => {
    it('trashes a copy, where a person can restore it, and deletes nothing', async () => {
        const id = await filed(as(INSIDER));
        await approve(id);
        const projectId = String(made()._id);
        const out = await undo(id);
        expect(out.error).toBeUndefined();
        expect(out.results[0]).toMatchObject({ ok: true, result: { projectId, name: NAME, trashed: true } });
        expect(projectsNamed()).toHaveLength(1);
        expect(Number(made().deletedStatusKey)).toBe(1);
        expect(audits(TOOL, 'applied')[0].meta.undoneAt).toBeTruthy();
        expect(socketEmitter.emit).toHaveBeenCalledWith('update', expect.objectContaining({ module: 'project', companyId: CID, updatedFields: { deletedStatusKey: 1 } }));
        expect(listsOf(projectId)).toHaveLength(2);
        expect(live(stored(SCHEMA_TYPE.PROJECTS, P_OPEN))).toBe(true);
    });

    it('trashes a copy that holds only the tasks it was copied with', async () => {
        const id = await filed(as(INSIDER), WITH_TASKS);
        await approve(id);
        expect((await undo(id)).results[0]).toMatchObject({ ok: true, result: { trashed: true } });
        expect(Number(made().deletedStatusKey)).toBe(1);
        expect(tasksOf(made()._id)).toHaveLength(4);
    });

    it('leaves a copy that holds a task or a doc that was not part of it, and says why', async () => {
        const first = await filed(as(INSIDER), WITH_TASKS);
        await approve(first);
        mockDb.seed(SCHEMA_TYPE.TASKS, { TaskName: 'Draft the brief', ProjectID: String(made()._id), CompanyId: CID, statusKey: 1, deletedStatusKey: 0 });
        expect((await undo(first)).results[0]).toMatchObject({ ok: false, reason: expect.stringMatching(/The project "Open, second round" has a task that was not part of the copy, so it was kept/) });
        expect(live(made())).toBe(true);
        expect(audits(TOOL, 'applied')[0].meta.undoneAt).toBeFalsy();

        const second = await filed(as(INSIDER), { ...ASK, name: 'Third round' });
        await approve(second);
        mockDb.seed(SCHEMA_TYPE.PAGES, { title: 'Round notes', ProjectID: String(made('Third round')._id), createdBy: INSIDER, deletedStatusKey: 0 });
        expect((await undo(second)).results[0]).toMatchObject({ ok: false, reason: expect.stringMatching(/has a doc now/) });
        expect(live(made('Third round'))).toBe(true);
    });

    it('is refused for a person who may not delete a project by hand', async () => {
        const id = await filed(as(INSIDER));
        await approve(id);
        setRule('project_delete', false, [3]);
        setRule('project_close', false, [3]);
        expect((await undo(id)).results[0]).toMatchObject({ ok: false, reason: expect.stringMatching(/not allowed to delete/) });
        expect(live(made())).toBe(true);
    });
});

describe('the preview says what will be copied', () => {
    const previewFor = async (uid, proposal) => (await intentPreview.forProposals(CID, uid, [proposal])).get(String(proposal._id));

    it('names the copy, the project it is copied from, that no task comes with it, and who will be on it', async () => {
        await filed(as(INSIDER));
        expect(await previewFor(INSIDER, waiting()[0])).toEqual([{
            kind: 'projectCopy',
            title: NAME,
            lines: [{ kind: 'copyOf', project: 'Open' }, { kind: 'copyParts' }, { kind: 'copyTasks', asked: false }, { kind: 'members', only: 'approver' }],
        }]);
    });

    it('says how many tasks the person looking would copy, and that the dates are kept', async () => {
        await filed(as(OUTSIDER), { ...WITH_TASKS, dates: true });
        const lines = async (uid) => (await previewFor(uid, waiting()[0]))[0].lines;
        expect(await lines(OUTSIDER)).toEqual([{ kind: 'copyOf', project: 'Open' }, { kind: 'copyParts' }, { kind: 'copyTasks', asked: true, count: 3, limit: 0 }, { kind: 'copyDates' }, { kind: 'members', only: 'approver' }]);
        expect((await lines(OWNER))[2]).toEqual({ kind: 'copyTasks', asked: true, count: 4, limit: 0 });
    });

    it('says when the tasks are too many to copy', async () => {
        await filed(as(INSIDER), WITH_TASKS);
        seedManyTasks(copyRules.INLINE_TASK_LIMIT);
        expect((await previewFor(INSIDER, waiting()[0]))[0].lines[2]).toEqual({ kind: 'copyTasks', asked: true, count: copyRules.INLINE_TASK_LIMIT + 4, limit: copyRules.INLINE_TASK_LIMIT });
    });

    it('has no card for a person who cannot open the project it is copied from', async () => {
        await filed(as(INSIDER), { projectId: P_PRIVATE, name: 'Private, again' });
        expect(await previewFor(OUTSIDER, waiting()[0])).toEqual([null]);
    });

    it('shows the proposal in the queue of the person who asked and of an owner, and of nobody else', async () => {
        const id = await filed(as(INSIDER));
        const idsFor = async (uid) => (await queue.readQueue(CID, uid)).map((row) => row.proposalId);
        expect(await idsFor(INSIDER)).toContain(id);
        expect(await idsFor(OWNER)).toContain(id);
        expect(await idsFor(OUTSIDER)).not.toContain(id);
        const row = (await queue.readQueue(CID, INSIDER)).find((entry) => entry.proposalId === id);
        expect(row.changes[0].preview).toMatchObject({ kind: 'projectCopy', title: NAME });
    });
});
