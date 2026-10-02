/* Task 047, decision 6: a connected agent's batch that names more than one task waits for a person as one proposal. */
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
jest.mock('../Modules/Company/controller/updateCompany', () => mockStub());
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
jest.mock('../Modules/AI/feedback', () => ({ fromDecline: jest.fn(async () => null) }));
jest.mock('../Config/jwt', () => ({ verifyCompanyMembership: jest.fn(async () => true) }));
jest.mock('../Modules/ApiTokens/controller', () => ({ verifyToken: jest.fn(), logTokenActivity: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const world = require('./fixtures/mcpManageWorld');
const mongoHelper = require('../Modules/Tasks/helpers/mongo_helper');
const socketEmitter = require('../event/socketEventEmitter');
const persistence = require('../Modules/AICore/persistence');
const proposals = require('../Modules/Agents/proposals');
const projectPolicy = require('../Modules/Agents/projectPolicy');
const standing = require('../Modules/Agents/standingApprovals');
const access = require('../Modules/Agents/access');
const queue = require('../Modules/Inbox/helpers/approvalQueue');
const instructions = require('../Modules/Mcp/instructions');
const server = require('../Modules/Mcp/server');

mongoHelper.getTotalSprintCount = async () => true;

const { CID, OWNER, MEMBER, OTHER, TOKEN, P_OPEN, P_PRIVATE, P_DEST, S_OPEN, S_DEST, S_PRIVATE, TASKS_GRANT, PLAIN_SCOPES, CLIENT, GRANT_ID, settle, ctx, outside } = world;
const { seed, stored, rows, audits, rpcThrough, seedGrant } = world.create(mockDb);
const rpc = rpcThrough(server);
const store = persistence.useInMemory();

const { DONE, CONNECTED } = projectPolicy;
const DAY = 24 * 60 * 60 * 1000;
const TWENTY = 20;

const proposalRows = () => rows(SCHEMA_TYPE.AGENT_PROPOSALS);
const project = (id) => rows(SCHEMA_TYPE.PROJECTS).find((row) => String(row._id) === String(id));
const setProject = (id, agentPolicy) => { project(id).agentPolicy = agentPolicy; };
const person = (uid) => ({ kind: 'human', userId: uid });
const caller = (uid, privileged = false) => ({ actor: person(uid), human: true, privileged });
const statusOf = (task) => stored(task._id).status.text;
const setStatus = (task, status) => ({ tool: 'task.status.set', arguments: { taskId: String(task._id), status } });
const rename = (task, title) => ({ tool: 'task.update', arguments: { taskId: String(task._id), title } });
const batch = (as, operations, reason = 'Tidy the week') => rpc(as, 'tasks.batch', { reason, operations });
const approve = (id, uid = MEMBER, isPrivileged = false) => proposals.approve(CID, id, { decider: person(uid), isPrivileged, ip: '' });
const copyOf = (task, over) => {
    const copy = { ...stored(task._id), ...over };
    delete copy._id;
    return mockDb.seed(SCHEMA_TYPE.TASKS, copy);
};
const rowFor = async (uid, id) => (await queue.readQueue(CID, uid)).find((row) => row.proposalId === id);

let fx;
let twenty;

beforeEach(() => {
    jest.clearAllMocks();
    store.reset();
    fx = seed();
    mockDb.store[SCHEMA_TYPE.AGENT_PROPOSALS] = [];
    mockDb.store[SCHEMA_TYPE.AGENT_STANDING_APPROVALS] = [];
    mockDb.store[SCHEMA_TYPE.API_TOKENS] = [];
    mockDb.seed(SCHEMA_TYPE.API_TOKENS, { _id: TOKEN, userId: OWNER, name: 'Claude', active: true, scopes: ['read', 'write'], grants: [TASKS_GRANT], projectIds: [], expiresAt: new Date(Date.now() + DAY) });
    twenty = Array.from({ length: TWENTY }, (unused, at) => copyOf(fx.bug, { TaskKey: `BLK-${at + 1}`, TaskName: `Bulk ${at + 1}`, ProjectID: P_OPEN, sprintId: S_OPEN }));
});
afterEach(settle);
afterAll(() => { ['MCP_TOOLS_MANAGE', 'MCP_TOOLS_WORK', 'MCP_TOOLS_V2', 'AGENT_TAINT_ROUTING'].forEach((key) => { delete process.env[key]; }); });

describe('a batch that names more than one task, in a project left at its default', () => {
    it('changes nothing and waits as one proposal', async () => {
        const out = await batch(ctx(OWNER), twenty.map((task) => setStatus(task, 'To Do')), 'Back to the start of the week');

        expect(twenty.map(statusOf)).toEqual(Array(TWENTY).fill('In Progress'));
        expect(out).toMatchObject({ ok: false, pending: true, approval: 'pending', applied: 0, notApplied: TWENTY, waiting: TWENTY, auditId: null, undoable: false });
        expect(out.message).toMatch(/more than one task[\s\S]*nothing has changed yet[\s\S]*Inbox[\s\S]*one at a time/);
        expect(out.items).toHaveLength(TWENTY);
        out.items.forEach((item, index) => expect(item).toEqual({ index, tool: 'task.status.set', ok: false, pending: true }));
        expect(audits('task.status.change', 'applied')).toHaveLength(0);
        expect(audits('tasks.batch')).toHaveLength(0);

        expect(proposalRows()).toHaveLength(1);
        const [filed] = proposalRows();
        expect(String(filed._id)).toBe(out.proposalId);
        expect(filed).toMatchObject({ status: 'pending', source: 'mcp', requestedBy: OWNER, tokenId: TOKEN, taskId: null });
        expect(String(filed.projectId)).toBe(P_OPEN);
        expect(filed.why).toMatch(/^Back to the start of the week \(a batch that names more than one task waits/);
        expect(filed.changes.map((change) => change.action)).toEqual(Array(TWENTY).fill('task.status.change'));
        expect([...filed.taskIds].sort()).toEqual(twenty.map((task) => String(task._id)).sort());
        expect(socketEmitter.emit).toHaveBeenCalledWith('update', expect.objectContaining({ module: 'agent', companyId: CID, data: expect.objectContaining({ kind: 'proposal' }) }));
    });

    it('is one card in the approval queue: how many tasks, what changes, the first few by name and how many more', async () => {
        const out = await batch(ctx(OWNER), [...twenty.map((task) => setStatus(task, 'To Do')), ...twenty.slice(0, 3).map((task, at) => rename(task, `Renamed ${at}`))]);
        const queued = await queue.readQueue(CID, MEMBER);
        expect(queued).toHaveLength(1);
        const [row] = queued;
        expect(row).toMatchObject({ proposalId: out.proposalId, source: 'mcp', locked: false, always: false, editable: false });
        expect(row.changes).toHaveLength(TWENTY + 3);
        expect(row.batch).toMatchObject({ kind: 'batch', tasks: TWENTY, changes: TWENTY + 3 });
        expect(row.batch.lines.slice(0, 2)).toEqual([
            { kind: 'batchChange', what: 'status', count: TWENTY, value: 'To Do', mixed: false },
            { kind: 'batchChange', what: 'title', count: 3, value: '', mixed: true },
        ]);
        const named = row.batch.lines[2];
        expect(named).toMatchObject({ kind: 'batchTasks', others: TWENTY - 5 });
        expect(named.tasks.map((task) => task.name)).toEqual(['Bulk 1', 'Bulk 2', 'Bulk 3', 'Bulk 4', 'Bulk 5']);
        expect(named.tasks[0]).toEqual({ taskId: String(twenty[0]._id), name: 'Bulk 1', projectId: P_OPEN, sprintId: S_OPEN, folderId: '' });
    });

    it('one approval applies all of it, change by change, and one undo takes all of it back', async () => {
        const out = await batch(ctx(OWNER), twenty.map((task) => setStatus(task, 'To Do')));
        const approved = await approve(out.proposalId);
        await settle();
        expect(approved.error).toBeUndefined();
        expect(approved.applied.map((change) => change.ok)).toEqual(Array(TWENTY).fill(true));
        expect(twenty.map(statusOf)).toEqual(Array(TWENTY).fill('To Do'));
        expect(audits('task.status.change', 'applied')).toHaveLength(TWENTY);
        expect(proposalRows()[0]).toMatchObject({ status: 'approved', decidedBy: MEMBER });
        expect(proposalRows()[0].auditIds).toHaveLength(TWENTY);

        const undone = await proposals.undoApproval(CID, out.proposalId, { decider: person(MEMBER), isPrivileged: false, ip: '' });
        await settle();
        expect(undone.error).toBeUndefined();
        expect(undone.results.map((result) => result.ok)).toEqual(Array(TWENTY).fill(true));
        expect(twenty.map(statusOf)).toEqual(Array(TWENTY).fill('In Progress'));
        expect(proposalRows()[0].status).toBe('undone');
    });

    it('new tasks each count as a task of their own', async () => {
        const out = await batch(ctx(OWNER), [
            { tool: 'task.create', arguments: { projectId: P_OPEN, title: 'First' } },
            { tool: 'task.create', arguments: { projectId: P_OPEN, title: 'Second' } },
        ]);
        expect(out).toMatchObject({ pending: true, waiting: 2, applied: 0 });
        expect(rows(SCHEMA_TYPE.TASKS).map((task) => task.TaskName)).not.toEqual(expect.arrayContaining(['First']));
        expect((await rowFor(MEMBER, out.proposalId)).batch).toMatchObject({ tasks: 0, changes: 2, lines: [{ kind: 'batchChange', what: 'task', count: 2, value: '', mixed: false }] });
    });
});

describe('a batch on one task', () => {
    it('runs at once as before: each operation on its own, and the ones that applied recorded as one group', async () => {
        const [task] = twenty;
        const out = await batch(ctx(OWNER), [setStatus(task, 'To Do'), rename(task, 'Renamed'), { tool: 'subtask.create', arguments: { taskId: String(task._id), title: 'Follow up' } }]);
        expect(out).toMatchObject({ ok: true, applied: 3, notApplied: 0, undoable: true });
        expect(out.pending).toBeUndefined();
        expect(stored(task._id)).toMatchObject({ TaskName: 'Renamed', status: expect.objectContaining({ text: 'To Do' }) });
        expect(proposalRows()).toHaveLength(0);
        expect(audits('tasks.batch')[0].meta.undo).toMatchObject({ kind: 'batch', auditIds: out.items.map((item) => item.auditId) });
    });

    it('a single operation runs at once too, and one that cannot run does not make a batch wide', async () => {
        const [task] = twenty;
        expect(await batch(ctx(OWNER), [rename(task, 'Only one')])).toMatchObject({ ok: true, applied: 1 });
        const out = await batch(ctx(OWNER), [rename(task, 'Again'), { tool: 'tasks.search', arguments: {} }, { tool: 'task.update', arguments: { taskId: String(twenty[1]._id), colour: 'red' } }]);
        expect(out).toMatchObject({ ok: false, applied: 1, notApplied: 2 });
        expect(stored(task._id).TaskName).toBe('Again');
        expect(proposalRows()).toHaveLength(0);
    });
});

describe('what a waiting batch may hold', () => {
    it('leaves out an operation no call could make, with its own refusal, and files the rest', async () => {
        const out = await batch(ctx(MEMBER), [
            rename(twenty[0], 'Mine'),
            rename(fx.private, 'Not mine'),
            { tool: 'tasks.search', arguments: {} },
            rename(twenty[1], 'Mine too'),
        ]);
        expect(out).toMatchObject({ pending: true, waiting: 2, applied: 0, notApplied: 4 });
        expect(out.items.map((item) => [item.index, item.pending === true])).toEqual([[0, true], [1, false], [2, false], [3, true]]);
        expect(out.items[1]).toMatchObject({ refused: true, reason: expect.stringMatching(/^not_visible/), auditId: expect.anything() });
        expect(out.items[2].error).toMatch(/not a write tool a batch can run/);
        expect(proposalRows()[0].changes.map((change) => change.params.taskId)).toEqual([String(twenty[0]._id), String(twenty[1]._id)]);
        expect([stored(twenty[0]._id).TaskName, stored(fx.private._id).TaskName]).toEqual(['Bulk 1', 'Task PRV-1']);
    });

    it('files nothing when no operation could run', async () => {
        const out = await batch(ctx(MEMBER), [rename(fx.private, 'x'), rename(fx.secret, 'y')]);
        expect(out).toMatchObject({ ok: false, applied: 0, waiting: 0, auditId: null });
        expect(out.pending).toBeUndefined();
        expect(out.items.map((item) => item.refused)).toEqual([true, true]);
        expect(proposalRows()).toHaveLength(0);
    });

    it('stays inside one project: a batch that reaches a second one is not filed', async () => {
        const elsewhere = copyOf(fx.bug, { TaskKey: 'DST-1', ProjectID: P_DEST, sprintId: S_DEST });
        const out = await batch(ctx(OWNER), [rename(twenty[0], 'Here'), rename(elsewhere, 'There')]);
        expect(out).toMatchObject({ ok: false, applied: 0, waiting: 0 });
        expect(out.pending).toBeUndefined();
        expect(out.message).toMatch(/more than one project[\s\S]*nothing has changed/);
        expect(out.items.map((item) => item.notFiled)).toEqual([true, true]);
        expect(proposalRows()).toHaveLength(0);
        expect([stored(twenty[0]._id).TaskName, stored(elsewhere._id).TaskName]).toEqual(['Bulk 1', 'Task OPN-4']);
    });

    it('a close the project leaves to people is refused change by change, and one it holds for approval waits with the rest', async () => {
        setProject(P_OPEN, { done: DONE.NEVER });
        const refused = await batch(ctx(OWNER), twenty.slice(0, 3).map((task) => setStatus(task, 'Done')));
        expect(refused.items.map((item) => item.refused)).toEqual([true, true, true]);
        expect(refused.items[0].reason).toBe(projectPolicy.REASON.NEVER);
        expect(proposalRows()).toHaveLength(0);

        setProject(P_OPEN, { done: DONE.APPROVAL });
        const waiting = await batch(ctx(OWNER), twenty.slice(0, 3).map((task) => setStatus(task, 'Done')));
        expect(waiting).toMatchObject({ pending: true, waiting: 3 });
        expect(proposalRows()).toHaveLength(1);
        expect(twenty.slice(0, 3).map(statusOf)).toEqual(['In Progress', 'In Progress', 'In Progress']);
    });

    it('an outside client files only what its grant lets it file', async () => {
        const scopes = [...PLAIN_SCOPES, TASKS_GRANT];
        seedGrant(OWNER, scopes);
        const out = await batch(outside(OWNER, scopes), [rename(twenty[0], 'One'), rename(twenty[1], 'Two'), { tool: 'task.comment', arguments: { taskId: String(twenty[2]._id), body: 'Hello' } }]);
        expect(out).toMatchObject({ pending: true, waiting: 2, applied: 0 });
        expect(out.items[2]).toMatchObject({ refused: true, reason: expect.stringMatching(/needs a person's approval, which is filed only/) });
        expect(proposalRows()[0]).toMatchObject({ oauthGrantId: GRANT_ID, oauthClientId: CLIENT, requestedBy: OWNER });
        expect(rows(SCHEMA_TYPE.COMMENTS)).toHaveLength(0);
        expect(stored(twenty[0]._id).TaskName).toBe('Bulk 1');
    });

    it('is not filed again once a person declined the same batch with a reason', async () => {
        const operations = twenty.slice(0, 2).map((task) => setStatus(task, 'To Do'));
        const first = await batch(ctx(OWNER), operations);
        await proposals.decline(CID, first.proposalId, { decider: person(MEMBER), ip: '', reason: 'These two stay where they are' });
        const again = await batch(ctx(OWNER), operations);
        expect(again).toMatchObject({ ok: false, declinedBefore: true, applied: 0, waiting: 0, note: { reason: 'These two stay where they are' } });
        expect(proposalRows()).toHaveLength(1);
    });
});

describe('approving a waiting batch', () => {
    it('is held to what the approver may do: one task the approver cannot open refuses the whole approval', async () => {
        const out = await batch(ctx(OWNER), [rename(twenty[0], 'Open'), rename(fx.secret, 'Hidden')]);
        expect(out).toMatchObject({ pending: true, waiting: 2 });
        expect(await approve(out.proposalId, MEMBER)).toMatchObject({ status: 403, error: expect.stringMatching(/approver cannot open/) });
        expect(proposalRows()[0].status).toBe('pending');
        expect([stored(twenty[0]._id).TaskName, stored(fx.secret._id).TaskName]).toEqual(['Bulk 1', 'Task OPN-9']);
    });

    it('is held to the connection that filed it: a token that is gone approves nothing', async () => {
        const out = await batch(ctx(OWNER), twenty.slice(0, 2).map((task) => setStatus(task, 'To Do')));
        mockDb.store[SCHEMA_TYPE.API_TOKENS] = [];
        expect(await approve(out.proposalId, OWNER, true)).toMatchObject({ status: 403 });
        expect(twenty.slice(0, 2).map(statusOf)).toEqual(['In Progress', 'In Progress']);
    });

    it('asks the project again for each change: a close the project has since left to people is not made', async () => {
        const out = await batch(ctx(OWNER), [setStatus(twenty[0], 'Done'), rename(twenty[1], 'Still fine')]);
        setProject(P_OPEN, { done: DONE.NEVER });
        const approved = await approve(out.proposalId);
        await settle();
        expect(approved.applied.map((change) => change.ok)).toEqual([false, true]);
        expect(approved.applied[0].error).toBe(projectPolicy.REASON.NEVER);
        expect([statusOf(twenty[0]), stored(twenty[1]._id).TaskName]).toEqual(['In Progress', 'Still fine']);
    });
});

describe('who sees a waiting batch', () => {
    it('a person who cannot open its project sees no card', async () => {
        const hidden = [fx.private, copyOf(fx.private, { TaskKey: 'PRV-2', TaskName: 'Task PRV-2', ProjectID: P_PRIVATE, sprintId: S_PRIVATE })];
        const out = await batch(ctx(OWNER), hidden.map((task) => rename(task, 'Quiet')));
        expect(out).toMatchObject({ pending: true, waiting: 2 });
        expect(await queue.readQueue(CID, MEMBER)).toEqual([]);
        expect(await access.canSeeProposal(CID, caller(MEMBER), proposalRows()[0])).toBe(false);
        expect((await queue.readQueue(CID, OTHER)).map((row) => row.proposalId)).toEqual([out.proposalId]);
    });

    it('a person who cannot read one of its tasks sees no card, in the queue or in the list of proposals', async () => {
        const out = await batch(ctx(OWNER), [rename(twenty[0], 'Open'), rename(fx.secret, 'Hidden')]);
        expect(await queue.readQueue(CID, MEMBER)).toEqual([]);
        expect(await access.canSeeProposal(CID, caller(MEMBER), proposalRows()[0])).toBe(false);
        const scope = await access.readScopeOf(CID, caller(MEMBER));
        expect((await proposals.list(CID, { status: 'pending', ...scope })).proposals).toEqual([]);

        const row = await rowFor(OTHER, out.proposalId);
        expect(row.batch.lines.find((line) => line.kind === 'batchTasks').tasks.map((task) => task.name)).toEqual(['Bulk 1', 'Task OPN-9']);
        expect(await access.canSeeProposal(CID, caller(OTHER), proposalRows()[0])).toBe(true);
    });
});

describe('"Always do this" and a batch', () => {
    it('is not offered on a batch, and a standing approval for the same kind of change does not let a batch through', async () => {
        setProject(P_OPEN, { done: DONE.YES, connected: CONNECTED.PROPOSE_ALL });
        mockDb.seed(SCHEMA_TYPE.AGENT_STANDING_APPROVALS, {
            projectId: P_OPEN, action: 'task.edit', tokenId: TOKEN, requestedBy: OWNER, agentId: `mcp:${TOKEN}`, agentName: 'Claude (MCP)', madeBy: MEMBER,
            madeAt: new Date(), expiresAt: new Date(Date.now() + 90 * DAY), status: 'active', uses: 0,
        });
        expect(await rpc(ctx(OWNER), 'task.update', { taskId: String(twenty[0]._id), title: 'Alone' })).toMatchObject({ ok: true, standingApprovalId: expect.any(String) });

        const out = await batch(ctx(OWNER), twenty.slice(1, 4).map((task) => rename(task, 'Together')));
        expect(out).toMatchObject({ pending: true, waiting: 3, applied: 0 });
        expect(twenty.slice(1, 4).map((task) => stored(task._id).TaskName)).toEqual(['Bulk 2', 'Bulk 3', 'Bulk 4']);
        const filed = proposalRows().find((row) => String(row._id) === out.proposalId);
        expect(standing.offerable(filed)).toBe(false);
        expect((await rowFor(MEMBER, out.proposalId)).always).toBe(false);
        expect(await standing.approveAlways(CID, out.proposalId, { decider: person(MEMBER), isPrivileged: false, ip: '' })).toMatchObject({ status: 409 });
        expect(filed.status).toBe('pending');
    });
});

describe('what the agent is told', () => {
    it('the tool says a batch on more than one task waits, and the instructions already say what to do with a change that waits', async () => {
        const listed = (await server.handleRpc(ctx(OWNER), { jsonrpc: '2.0', id: 1, method: 'tools/list' })).result.tools.find((tool) => tool.name === 'tasks.batch');
        expect(listed.description).toMatch(/more than one task, nothing runs[\s\S]*one proposal that a person approves or declines whole/);
        expect(instructions.forCaller(ctx(OWNER))).toMatch(/When a tool answers that a change is waiting[\s\S]*tell the person, and do not try another way/);
    });
});
