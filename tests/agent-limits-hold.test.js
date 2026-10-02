/* Task 047, decision 6 and T-5: what a connected agent changes on its own is one task and can be undone, a batch
   is as wide as every task it reaches, and a pause holds every agent it names until a person lifts it. */
process.env.STORAGE_TYPE = 'server';
const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (companyId, q, method) => mockDb.crud(companyId, q, method),
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
jest.mock('../Modules/Sprints/controller', () => mockStub());
jest.mock('../Modules/Tasks/helpers/handleNotification', () => mockStub());
jest.mock('../Modules/notification/prepare-notification-data/controllerV2', () => mockStub());
jest.mock('../Modules/Company/eventController', () => mockStub());
jest.mock('../Modules/Company/controller/updateCompany', () => ({ getCompanyDataFun: jest.fn(async () => [mockDb.store.companies[0]]) }));
jest.mock('../Modules/notification-count/controller', () => mockStub());
jest.mock('../Modules/MainChats/controller', () => mockStub());
jest.mock('../Modules/LogTime/controllerV2.js', () => mockStub());
jest.mock('../Modules/CustomField/controller', () => mockStub());
jest.mock('../utils/planHelper', () => mockStub());
jest.mock('../utils/commonFunctions.js', () => mockStub());
jest.mock('../common-storage/common-server.js', () => mockStub());
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../Modules/Knowledge/ingest/events', () => ({ publishCommentChanged: jest.fn(), publish: jest.fn() }));
jest.mock('../Modules/Knowledge/memory/publish', () => mockStub());
jest.mock('../Modules/Agents/triggers', () => ({ fromComment: jest.fn(async () => null), TRIGGER: { MENTION: 'mention', ASSIGN: 'assign' } }));
jest.mock('../Modules/Agents/engine/graph', () => ({ runGraph: jest.fn(async () => ({ status: 'abandoned' })), resumeGraph: jest.fn(async () => ({ resumed: false })) }));
jest.mock('../Modules/AI/feedback', () => ({ fromDecline: jest.fn(async () => null) }));
jest.mock('../Config/jwt', () => ({ verifyCompanyMembership: jest.fn(async () => true) }));
jest.mock('../Modules/ApiTokens/controller', () => ({ verifyToken: jest.fn(), logTokenActivity: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const world = require('./fixtures/mcpManageWorld');
const mongoHelper = require('../Modules/Tasks/helpers/mongo_helper');
const persistence = require('../Modules/AICore/persistence');
const actions = require('../Modules/Agents/actions');
const accounts = require('../Modules/Agents/accounts');
const runs = require('../Modules/Agents/runs');
const proposals = require('../Modules/Agents/proposals');
const projectPolicy = require('../Modules/Agents/projectPolicy');
const projectLimits = require('../Modules/Agents/projectLimits');
const { RULE } = require('../Modules/Agents/manager/rules');
const dailyLook = require('../Modules/Agents/manager/dailyLook');
const queue = require('../Modules/Inbox/helpers/approvalQueue');
const names = require('../Modules/Mcp/names');
const server = require('../Modules/Mcp/server');
const { projectFindingsSchema, agentWorkMarksSchema } = require('../utils/mongo-handler/createSchema');

mongoHelper.getTotalSprintCount = async () => true;

const { CID, OWNER, MEMBER, OTHER, TOKEN, LOCKED_PROJECT, LOCKED_TASK, P_OPEN, P_PRIVATE, P_DEST, S_OPEN, S_NEXT, S_DEST, S_PRIVATE, F, TASKS_GRANT, DOCS_GRANT, STATUSES, TYPES, settle, ctx, withGrants } = world;
const { seed, stored, rows, audits, snapshot, rpcThrough } = world.create(mockDb);
const rpc = rpcThrough(server);
const store = persistence.useInMemory();

const { DECISION, DONE, CONNECTED } = projectPolicy;
const DAY = 24 * 60 * 60 * 1000;
const WEDNESDAY = new Date('2026-10-07T09:00:00Z');
const FLAGS = ['MCP_TOOLS_MANAGE', 'MCP_TOOLS_WORK', 'MCP_TOOLS_V2'];

const proposalRows = () => rows(SCHEMA_TYPE.AGENT_PROPOSALS);
const project = (id) => rows(SCHEMA_TYPE.PROJECTS).find((row) => String(row._id) === String(id));
const company = () => mockDb.store.companies[0];
const person = (uid) => ({ kind: 'human', userId: uid });
const inProduct = (uid = OWNER) => ({ kind: 'agent', userId: uid, agentId: '6f0000000000000000000a91', agentName: 'Triage', runId: '6f0000000000000000000a92', viaAccount: 'workspace', tokenId: null });
const approve = (id, uid = MEMBER, isPrivileged = false) => proposals.approve(CID, id, { decider: person(uid), isPrivileged, ip: '' });
const batch = (as, operations, reason = 'Tidy the week') => rpc(as, 'tasks.batch', { reason, operations });
const rename = (task, title) => ({ tool: 'task.update', arguments: { taskId: String(task._id), title } });
const link = (from, to) => ({ tool: 'task.relation.add', arguments: { taskId: String(from._id), relatedTaskId: String(to._id), type: 'relates_to' } });
const subtask = (parent, title) => ({ tool: 'subtask.create', arguments: { taskId: String(parent._id), title } });
const doc = (task, title) => ({ tool: 'page.create', arguments: { title, projectId: P_OPEN, taskId: String(task._id) } });
const comment = (as, taskId, body = 'Looks ready') => rpc(as, 'task.comment', { taskId: String(taskId), body });
const copyOf = (task, over) => {
    const copy = { ...stored(task._id), ...over };
    delete copy._id;
    return mockDb.seed(SCHEMA_TYPE.TASKS, copy);
};
const managing = () => withGrants(OWNER, [TASKS_GRANT, DOCS_GRANT]);
const pauseProject = (id) => { project(id).agentLimits = { paused: true }; };
const rowFor = async (uid, id) => (await queue.readQueue(CID, uid)).find((row) => row.proposalId === id);

let fx;
let several;

beforeAll(() => {
    mockDb.uniqueFromSchema(SCHEMA_TYPE.PROJECT_FINDINGS, projectFindingsSchema);
    mockDb.uniqueFromSchema(SCHEMA_TYPE.AGENT_WORK_MARKS, agentWorkMarksSchema);
});

beforeEach(() => {
    jest.clearAllMocks();
    store.reset();
    fx = seed();
    process.env.MCP_TOOLS_WORK = 'on';
    mockDb.store[SCHEMA_TYPE.AGENT_PROPOSALS] = [];
    mockDb.store[SCHEMA_TYPE.API_TOKENS] = [];
    mockDb.seed(SCHEMA_TYPE.API_TOKENS, { _id: TOKEN, userId: OWNER, name: 'Claude', active: true, scopes: ['read', 'write'], grants: [TASKS_GRANT, DOCS_GRANT], projectIds: [], expiresAt: new Date(Date.now() + DAY) });
    several = Array.from({ length: 5 }, (unused, at) => copyOf(fx.bug, { TaskKey: `WID-${at + 1}`, TaskName: `Wide ${at + 1}`, relations: [] }));
});
afterEach(settle);
afterAll(() => { FLAGS.forEach((key) => { delete process.env[key]; }); });

describe('how wide a batch is', () => {
    it.each([
        ['links from one task to several others', () => several.slice(1, 4).map((other) => link(several[0], other)), 3],
        ['several subtasks under one parent', () => ['One', 'Two', 'Three'].map((title) => subtask(several[0], title)), 3],
        ['several docs for one task', () => ['Plan', 'Notes'].map((title) => doc(several[0], title)), 2],
        ['a change to a task and a new subtask under it', () => [rename(several[0], 'Renamed'), subtask(several[0], 'Follow up')], 2],
    ])('%s reach more than one task: they change nothing and wait as one proposal', async (_what, operations, count) => {
        const before = snapshot();
        const out = await batch(managing(), operations());
        expect(out).toMatchObject({ ok: false, pending: true, applied: 0, waiting: count });
        expect(snapshot()).toBe(before);
        expect(proposalRows()).toHaveLength(1);
        expect(proposalRows()[0].changes).toHaveLength(count);
    });

    it('a batch of links names every task it links, and its card counts them', async () => {
        const out = await batch(managing(), several.slice(1, 4).map((other) => link(several[0], other)));
        expect([...proposalRows()[0].taskIds].sort()).toEqual(several.slice(0, 4).map((task) => String(task._id)).sort());
        expect((await rowFor(MEMBER, out.proposalId)).batch).toMatchObject({ tasks: 4, changes: 3 });
    });

    it.each([
        ['one link', () => [link(several[0], several[1])]],
        ['one new subtask', () => [subtask(several[0], 'Only one')]],
        ['several changes to the one task', () => [rename(several[0], 'Renamed'), { tool: 'task.update', arguments: { taskId: String(several[0]._id), priority: 'HIGH' } }]],
    ])('%s still runs at once', async (_what, operations) => {
        const out = await batch(managing(), operations());
        expect(out).toMatchObject({ ok: true, notApplied: 0 });
        expect(out.pending).toBeUndefined();
        expect(proposalRows()).toHaveLength(0);
    });
});

describe('what a person is shown of a waiting change', () => {
    const NEXT = { project: 'Open', list: 'Sprint 2' };
    const filedBatch = async () => {
        const [first, second, third, fourth, fifth] = several;
        const out = await batch(managing(), [
            { tool: 'task.assign', arguments: { taskId: String(first._id), mode: 'add', userIds: [MEMBER, OTHER] } },
            { tool: 'task.move', arguments: { taskId: String(second._id), projectId: P_OPEN, sprintId: S_NEXT } },
            { tool: 'task.field.set', arguments: { taskId: String(third._id), fieldId: F.number, value: 12 } },
            { tool: 'task.comment', arguments: { taskId: String(fourth._id), body: 'Ready for review' } },
            { tool: 'task.update', arguments: { taskId: String(fourth._id), description: 'The new plan' } },
            rename(fourth, 'Fourth'),
            rename(fifth, 'Fifth'),
            link(fifth, first),
            { tool: 'task.lists.add', arguments: { taskId: String(fifth._id), projectId: P_OPEN, sprintId: S_NEXT } },
        ]);
        expect(out).toMatchObject({ pending: true, waiting: 9 });
        return out;
    };

    it('a batch\'s card says for each change what it sets: the people, the place, the field\'s value and the text', async () => {
        const out = await filedBatch();
        const { lines } = (await rowFor(MEMBER, out.proposalId)).batch;
        expect(lines.filter((line) => line.kind !== 'batchChange' && line.kind !== 'batchTasks')).toEqual([
            { kind: 'batchItem', what: 'assignees', task: 'Wide 1', mode: 'add', names: ['Mia Member', 'Priya Other'], others: 0 },
            { kind: 'batchItem', what: 'move', task: 'Wide 2', ...NEXT },
            { kind: 'fieldValue', field: 'Budget', task: 'Wide 3', value: '12', others: 0 },
            { kind: 'batchItem', what: 'comment', task: 'Wide 4', value: 'Ready for review', more: false },
            { kind: 'batchItem', what: 'description', task: 'Wide 4', value: 'The new plan', more: false },
            { kind: 'batchItem', what: 'title', task: 'Wide 4', value: 'Fourth' },
            { kind: 'batchItem', what: 'title', task: 'Wide 5', value: 'Fifth' },
            { kind: 'batchItem', what: 'relation_add', task: 'Wide 5', value: 'Wide 1' },
            { kind: 'batchItem', what: 'list_add', task: 'Wide 5', ...NEXT },
        ]);
        expect(lines.find((line) => line.what === 'title')).toEqual({ kind: 'batchChange', what: 'title', count: 2, value: '', mixed: true });
    });

    it('a change every task shares stays one line', async () => {
        const out = await batch(managing(), several.slice(0, 3).map((task) => ({ tool: 'task.update', arguments: { taskId: String(task._id), priority: 'HIGH' } })));
        expect((await rowFor(MEMBER, out.proposalId)).batch.lines.filter((line) => line.kind !== 'batchTasks')).toEqual([{ kind: 'batchChange', what: 'priority', count: 3, value: 'HIGH', mixed: false }]);
    });

    it('the row of a connected agent\'s change carries its card and not the change as filed', async () => {
        const out = await filedBatch();
        const row = await rowFor(MEMBER, out.proposalId);
        expect(row.changes).toHaveLength(9);
        row.changes.forEach((change) => expect(change).not.toHaveProperty('params'));
        expect(JSON.stringify(row.changes)).not.toMatch(/Ready for review|The new plan/);
    });

    it.each([
        ['who may decide it', MEMBER, null, true],
        ['who may not', MEMBER, 'owner_admin', false],
    ])('the row of a change a person can edit carries the change as filed only for a person %s', async (_who, uid, gate, carried) => {
        const filed = await proposals.create(CID, {
            agent: { _id: '6f0000000000000000000a91', name: 'Triage' }, taskId: String(several[0]._id), projectId: P_OPEN, gate,
            what: 'Leave a note', why: 'It was asked for', changes: [{ action: 'task.comment', params: { taskId: String(several[0]._id), body: 'A note for the owner' }, label: 'Comment' }],
        });
        const row = await rowFor(uid, String(filed._id));
        expect(row).toMatchObject({ editable: true, locked: !carried });
        expect(row.changes[0].params).toEqual(carried ? { taskId: String(several[0]._id), body: 'A note for the owner' } : undefined);
    });

    it('a list is named only under the project it belongs to', async () => {
        const named = await names.resolver({ companyId: CID, userId: MEMBER, projectIds: [] }, { projectIds: [P_OPEN, P_PRIVATE], sprintIds: [S_NEXT, S_PRIVATE] });
        expect(named.sprint(S_NEXT, P_OPEN).name).toBe('Sprint 2');
        expect(named.sprint(S_PRIVATE, P_OPEN).name).toBeNull();
        expect(named.sprint(S_NEXT, P_PRIVATE).name).toBeNull();
    });
});

describe('a change a connected agent makes on its own is to one task and can be undone', () => {
    const archivedWithSubtasks = () => {
        Object.assign(stored(fx.top._id), { deletedStatusKey: 2 });
        [fx.child, fx.grandchild].forEach((task) => Object.assign(stored(task._id), { deletedStatusKey: 3, cascadedBy: String(fx.top._id) }));
    };

    it.each([['off', ''], ['on', 'on']])('a move to another list waits for a person, with the newer tool format %s', async (_label, flag) => {
        if (flag) process.env.MCP_TOOLS_V2 = flag;
        const before = snapshot();
        const out = await rpc(ctx(OWNER), 'task.move', { taskId: String(fx.bug._id), projectId: P_OPEN, sprintId: S_NEXT, reason: 'Next sprint' });
        expect(out).toMatchObject({ ok: false, pending: true });
        expect(snapshot()).toBe(before);
        expect(proposalRows()).toHaveLength(1);
        expect(proposalRows()[0]).toMatchObject({ status: 'pending', changes: [expect.objectContaining({ action: 'task.move' })], why: expect.stringMatching(/^Next sprint \(this change cannot be undone/) });
    });

    it.each([
        ['archiving a task that has subtasks', 'task.archive', () => {}],
        ['restoring a task whose subtasks come back with it', 'task.restore', archivedWithSubtasks],
    ])('%s waits for a person, and one approval makes it', async (_what, tool, arrange) => {
        arrange();
        const before = snapshot();
        const out = await rpc(ctx(OWNER), tool, { taskId: String(fx.top._id) });
        expect(out).toMatchObject({ ok: false, pending: true });
        expect(snapshot()).toBe(before);
        expect(proposalRows()[0].why).toMatch(/takes the task's subtasks with it/);

        const approved = await approve(out.proposalId, OWNER, true);
        await settle();
        expect(approved.applied.map((change) => change.ok)).toEqual([true]);
        const live = tool === 'task.restore';
        expect([fx.top, fx.child, fx.grandchild].map((task) => stored(task._id).deletedStatusKey)).toEqual(live ? [0, 0, 0] : [2, 3, 3]);
    });

    it('a task with no subtasks is archived and restored at once, each with its undo', async () => {
        expect(await rpc(ctx(OWNER), 'task.archive', { taskId: String(fx.bug._id) })).toMatchObject({ ok: true, undoable: true });
        expect(stored(fx.bug._id).deletedStatusKey).toBe(2);
        expect(await rpc(ctx(OWNER), 'task.restore', { taskId: String(fx.bug._id) })).toMatchObject({ ok: true, undoable: true });
        expect(stored(fx.bug._id).deletedStatusKey).toBe(0);
        expect(proposalRows()).toHaveLength(0);
    });

    it('inside a batch on one task it waits on its own and the rest runs', async () => {
        const out = await batch(ctx(OWNER), [rename(fx.top, 'Renamed'), { tool: 'task.archive', arguments: { taskId: String(fx.top._id) } }]);
        expect(out.items.map((item) => [item.ok, Boolean(item.pending)])).toEqual([[true, false], [false, true]]);
        expect(stored(fx.top._id)).toMatchObject({ TaskName: 'Renamed', deletedStatusKey: 0 });
    });

    it.each([
        ['a person', () => person(OWNER), {}, DECISION.ACT],
        ['an agent of the workspace', () => inProduct(), {}, DECISION.ACT],
        ['a connected agent', () => ctx(OWNER).actor, {}, DECISION.PROPOSE],
        ['a connected agent whose change a person approved', () => ctx(OWNER).actor, { approved: true }, DECISION.ACT],
    ])('for %s the project answers as its rule says', async (_who, actor, more, decision) => {
        const move = { companyId: CID, actor: actor(), action: 'task.move', params: { taskId: String(fx.bug._id), projectId: P_OPEN, sprintId: S_NEXT }, ...more };
        const archive = { companyId: CID, actor: actor(), action: 'task.archive', params: { taskId: String(fx.top._id) }, ...more };
        expect((await projectPolicy.ask(move)).decision).toBe(decision);
        expect((await projectPolicy.ask(archive)).decision).toBe(decision);
    });
});

describe('pausing every agent of the workspace', () => {
    const agent = (n, uid = OWNER) => {
        const id = `6f00000000000000000002${String(n).padStart(2, '0')}`;
        return ctx(uid, { actor: { kind: 'agent', userId: uid, agentName: 'Claude', viaAccount: 'personal', tokenId: id }, token: { _id: id, userId: uid, scopes: ['read', 'write'], grants: [TASKS_GRANT], active: true } });
    };
    const findings = () => rows(SCHEMA_TYPE.PROJECT_FINDINGS);
    const waitingItem = async () => {
        const task = mockDb.seed(SCHEMA_TYPE.TASKS, {
            TaskKey: 'CASE-1', TaskName: 'Case 1', CompanyId: CID, ProjectID: P_OPEN, sprintId: S_OPEN, sprintArray: { id: S_OPEN, name: 'Sprint 1' }, AssigneeUserId: [], watchers: [],
            isParentTask: true, deletedStatusKey: 0, status: { key: 2, text: 'In Progress', type: 'active' }, statusType: 'active', statusKey: 2, totalEstimatedTime: 60,
            updatedAt: new Date('2026-10-06T00:00:00Z'), createdAt: new Date('2026-09-01T00:00:00Z'), DueDate: new Date('2026-11-20T00:00:00Z'), relations: [], rawDescription: 'before',
        });
        rows(SCHEMA_TYPE.TASKS).filter((row) => String(row.ProjectID) === P_OPEN && row !== task && String(row._id) !== String(task._id))
            .forEach((row) => Object.assign(row, { AssigneeUserId: [OTHER], totalEstimatedTime: 60, updatedAt: new Date('2026-10-06T00:00:00Z'), DueDate: new Date('2026-11-20T00:00:00Z') }));
        project(P_OPEN).agentManager = { on: true };
        await dailyLook.runForCompany(CID, WEDNESDAY);
        return { taskId: String(task._id), itemId: String(findings().find((row) => row.rule === RULE.NO_OWNER && row.taskId === String(task._id))._id) };
    };
    const pauseAll = () => runs.pauseAll(CID, `pause all by ${OWNER}`);
    const listed = async (as) => (await rpc(as, 'queue.list', {})).items;

    it('stops a connected agent\'s changes and claims in every project, in plain words, and hands out no work', async () => {
        const { taskId, itemId } = await waitingItem();
        expect((await listed(agent(1))).map((item) => item.itemId)).toContain(itemId);
        await pauseAll();

        const refused = await comment(agent(1), taskId);
        expect(refused).toMatchObject({ refused: true, reason: projectPolicy.REASON.CONNECTED_PAUSED });
        expect(refused.reason).toMatch(/connected agents are paused in this workspace/);
        expect(refused.reason).not.toMatch(/waits for a person/);
        expect(rows(SCHEMA_TYPE.COMMENTS)).toHaveLength(0);
        expect(await comment(agent(2, MEMBER), several[0]._id)).toMatchObject({ refused: true, reason: projectPolicy.REASON.CONNECTED_PAUSED });

        expect(await listed(agent(1))).toEqual([]);
        expect(await rpc(agent(1), 'queue.claim', { itemId })).toMatchObject({ refused: true, reason: projectPolicy.REASON.CONNECTED_PAUSED });
        expect(findings().find((row) => String(row._id) === itemId).claim).toBeUndefined();
    });

    it('takes a held item out of a connected agent\'s hands', async () => {
        const { itemId } = await waitingItem();
        expect(await rpc(agent(1), 'queue.claim', { itemId })).toMatchObject({ ok: true });
        await pauseAll();
        expect(findings().find((row) => String(row._id) === itemId).claim).toBeUndefined();
    });

    it('leaves people and a change a person approved alone', async () => {
        await pauseAll();
        const change = { companyId: CID, action: 'task.comment', params: { taskId: String(several[0]._id), body: 'Reviewed' } };
        expect(await projectPolicy.ask({ ...change, actor: agent(1).actor })).toMatchObject({ decision: DECISION.REFUSE, paused: true });
        expect(await projectPolicy.ask({ ...change, actor: agent(1).actor, approved: true })).toMatchObject({ decision: DECISION.ACT });
        expect(await projectPolicy.ask({ ...change, actor: person(MEMBER) })).toMatchObject({ decision: DECISION.ACT });
        expect((await actions.perform({ ...change, actor: agent(1).actor, approved: true })).auditId).toBeTruthy();
    });

    it('is kept with the workspace\'s rules for agents, with who paused and when, until a person resumes them', async () => {
        expect(await accounts.getPolicy(CID)).toMatchObject({ connectedPaused: false });
        await pauseAll();
        expect(await accounts.getPolicy(CID)).toMatchObject({ connectedPaused: true });
        expect(company().agentPolicy).toMatchObject({ connectedPaused: true, connectedPausedAt: expect.any(Date) });

        const resumed = await accounts.setPolicy(CID, { connectedPaused: false });
        expect(resumed).toMatchObject({ from: { connectedPaused: true }, policy: { connectedPaused: false } });
        expect(await comment(agent(1), several[0]._id)).toMatchObject({ ok: true });
    });

    it('lets no connected agent\'s change through while the pause cannot be read', async () => {
        const plainCrud = mockDb.crud.getMockImplementation();
        mockDb.crud.mockImplementation(async (companyId, query, method) => {
            if (query.type === 'companies') throw new Error('the workspace could not be read');
            return plainCrud(companyId, query, method);
        });
        try {
            const change = { companyId: CID, actor: agent(1).actor, action: 'task.comment', params: { taskId: String(several[0]._id), body: 'Reviewed' } };
            await expect(projectPolicy.ask(change)).rejects.toThrow('the workspace could not be read');
            expect(await comment(agent(1), several[0]._id)).not.toMatchObject({ ok: true });
        } finally {
            mockDb.crud.mockImplementation(plainCrud);
        }
        expect(rows(SCHEMA_TYPE.COMMENTS)).toHaveLength(0);
    });

    it('refuses a value that is not true or false, and changes nothing beside it', async () => {
        await accounts.setPolicy(CID, { requireCheckBeforeDone: true });
        expect(await accounts.setPolicy(CID, { connectedPaused: 'yes' })).toMatchObject({ error: expect.stringMatching(/true or false/) });
        expect(await accounts.setPolicy(CID, { connectedPaused: true })).toMatchObject({ policy: { connectedPaused: true, requireCheckBeforeDone: true } });
    });
});

describe('a pause in one project', () => {
    const taskInList = (task, projectId, sprintId) => ({ taskId: String(task._id), projectId, sprintId });

    it.each([
        ['a task added to a list of that project', () => ['task.lists.add', taskInList(several[0], P_DEST, S_DEST)]],
        ['a task moved into that project', () => ['task.move', taskInList(several[0], P_DEST, S_DEST)]],
        ['a link to a task of that project', () => ['task.relation.add', { taskId: String(several[0]._id), relatedTaskId: String(copyOf(fx.bug, { TaskKey: 'DST-1', ProjectID: P_DEST, sprintId: S_DEST, relations: [] })._id), type: 'relates_to' }]],
    ])('holds a change that starts in another project and reaches it: %s', async (_what, call) => {
        pauseProject(P_DEST);
        const [tool, args] = call();
        const before = snapshot();
        expect(await rpc(ctx(OWNER), tool, args)).toMatchObject({ refused: true, reason: projectLimits.REASON.PAUSED });
        expect(snapshot()).toBe(before);
        expect(proposalRows()).toHaveLength(0);
    });

    it('holds however many projects of the workspace are paused', async () => {
        const others = Array.from({ length: 501 }, (unused, at) => ({ _id: `7a${String(at).padStart(22, '0')}`, ProjectName: `Quiet ${at}`, CompanyId: CID, agentLimits: { paused: true }, deletedStatusKey: 0 }));
        mockDb.store[SCHEMA_TYPE.PROJECTS].unshift(...others);
        pauseProject(P_OPEN);
        expect(await comment(ctx(OWNER), several[0]._id)).toMatchObject({ refused: true, reason: projectLimits.REASON.PAUSED });
        expect(await projectLimits.pausedAmong(CID, [P_OPEN, P_DEST])).toEqual([P_OPEN]);
    });

    it('a run does not start for any of several projects when one of them is paused', async () => {
        pauseProject(P_DEST);
        const helper = { _id: '6f0000000000000000000a91', name: 'Helper', paused: false };
        expect(await runs.canStart(helper, { companyId: CID, depth: 99, projectIds: [P_OPEN] })).toMatchObject({ ok: false, code: 'loop_depth_exceeded' });
        expect(await runs.canStart(helper, { companyId: CID, projectIds: [P_OPEN, P_DEST] })).toMatchObject({ ok: false, code: 'project_paused' });
        expect(await runs.canStart(helper, { companyId: CID, projectId: P_DEST })).toMatchObject({ ok: false, code: 'project_paused' });
    });
});

describe('saving a project\'s settings for agents', () => {
    /* Runs `other` once, right after the first database call `first` makes, the way a second request lands in between. */
    const between = async (first, other) => {
        const plainCrud = mockDb.crud.getMockImplementation();
        let landed = false;
        mockDb.crud.mockImplementation(async (...args) => {
            const out = await plainCrud(...args);
            if (!landed) {
                landed = true;
                mockDb.crud.mockImplementation(plainCrud);
                await other();
            }
            return out;
        });
        try {
            return await first();
        } finally {
            mockDb.crud.mockImplementation(plainCrud);
        }
    };

    it.each([
        ['a pause set while the number of agents at once is saved', () => projectLimits.save(CID, P_OPEN, { atOnce: 5 }, OWNER), () => projectLimits.save(CID, P_OPEN, { paused: true }, MEMBER),
            () => expect(project(P_OPEN).agentLimits).toMatchObject({ atOnce: 5, paused: true, pausedBy: MEMBER, pausedAt: expect.any(Date) })],
        ['a number saved while a pause is set', () => projectLimits.save(CID, P_OPEN, { paused: true }, OWNER), () => projectLimits.save(CID, P_OPEN, { directTasks: 4 }, MEMBER),
            () => expect(project(P_OPEN).agentLimits).toMatchObject({ directTasks: 4, paused: true, pausedBy: OWNER })],
        ['"propose everything" set while the rule for closing is saved', () => projectPolicy.save(CID, P_OPEN, { done: DONE.NEVER }, OWNER), () => projectPolicy.save(CID, P_OPEN, { connected: CONNECTED.PROPOSE_ALL }, MEMBER),
            () => expect(project(P_OPEN).agentPolicy).toMatchObject({ done: DONE.NEVER, connected: CONNECTED.PROPOSE_ALL })],
    ])('keeps both changes: %s', async (_what, first, other, holds) => {
        const saved = await between(first, other);
        expect(saved.error).toBeUndefined();
        holds();
    });

    it('answers what the project held before and holds now, and says when this save paused it', async () => {
        const first = await projectLimits.save(CID, P_OPEN, { paused: true, atOnce: 2 }, OWNER);
        expect(first).toMatchObject({ from: { atOnce: 3, paused: false }, to: { atOnce: 2, paused: true }, pausedNow: true });
        const again = await projectLimits.save(CID, P_OPEN, { paused: true }, MEMBER);
        expect(again).toMatchObject({ from: { paused: true }, to: { atOnce: 2, paused: true }, pausedNow: false });
        expect(project(P_OPEN).agentLimits).toMatchObject({ pausedBy: OWNER });
        const resumed = await projectLimits.save(CID, P_OPEN, { paused: false }, MEMBER);
        expect(resumed).toMatchObject({ to: { atOnce: 2, paused: false }, pausedNow: false });
        expect(project(P_OPEN).agentLimits.pausedBy).toBeUndefined();
        expect(await projectLimits.save(CID, '6f0000000000000000000dff', { atOnce: 2 }, OWNER)).toMatchObject({ status: 404 });
    });
});

describe('approving a move a connected agent filed', () => {
    const unlock = () => {
        Object.assign(project(LOCKED_PROJECT), { isPrivateSpace: false, ProjectName: 'Locked', CompanyId: CID, taskStatusData: STATUSES, taskTypeCounts: TYPES, AssigneeUserId: [] });
        Object.assign(stored(LOCKED_TASK), {
            CompanyId: CID, TaskName: 'Locked task', TaskKey: 'LCK-1', deletedStatusKey: 0, isParentTask: true, ParentTaskId: '', ancestors: [], AssigneeUserId: [], watchers: [],
            sprintId: String(mockDb.seed(SCHEMA_TYPE.SPRINTS, { projectId: LOCKED_PROJECT, name: 'Locked list', AssigneeUserId: [], deletedStatusKey: 0 })._id),
            status: { key: 2, text: 'In Progress', type: 'active' }, statusType: 'active', statusKey: 2, TaskType: 'task', TaskTypeKey: 1,
        });
    };

    it('holds the approver to moving tasks in the project the task leaves and in the one it enters', async () => {
        unlock();
        const out = await rpc(ctx(OWNER), 'task.move', { taskId: LOCKED_TASK, projectId: P_OPEN, sprintId: S_NEXT });
        expect(out).toMatchObject({ pending: true });
        expect(await approve(out.proposalId, MEMBER)).toMatchObject({ status: 403, error: expect.stringMatching(/approver may not make this change: permission_denied: task\.task_move/) });
        expect(proposalRows()[0].status).toBe('pending');
        expect(String(stored(LOCKED_TASK).ProjectID)).toBe(LOCKED_PROJECT);

        const approved = await approve(out.proposalId, OWNER, true);
        await settle();
        expect(approved.applied.map((change) => change.ok)).toEqual([true]);
        expect(String(stored(LOCKED_TASK).ProjectID)).toBe(P_OPEN);
        expect(audits('task.move', 'applied')).toHaveLength(1);
    });
});
