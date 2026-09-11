const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({ getRoleType: jest.fn(async (c, uid) => ({ owner1: 1, admin1: 2, member1: 3, member2: 3, guest1: 0 })[uid]), isPrivileged: (r) => r === 1 || r === 2 }));
jest.mock('../Modules/Agents/scope', () => ({ visibleProjectIds: jest.fn(async () => ['p1']) }));
jest.mock('../Modules/Agents/actor', () => {
    const isAgent = (a) => Boolean(a && a.kind === 'agent');
    return {
        isAgent,
        resolveActor: jest.fn(async (req) => (req.agentToken
            ? { kind: 'agent', userId: req.uid, agentId: req.agentToken.agentId, agentName: 'Reviewer', viaAccount: 'workspace' }
            : { kind: 'human', userId: req.uid })),
        attribution: (a) => (isAgent(a) ? { actorId: a.agentId, actorType: 'agent', agentId: a.agentId, label: a.agentName } : { actorId: a.userId, actorType: 'human', label: '' }),
    };
});

const { SCHEMA_TYPE } = require('../Config/schemaType');

beforeAll(() => require('../Modules/AICore/persistence').useInMemory());
const ctrl = require('../Modules/Agents/controller');

const C = '6f0000000000000000000c01';
const AGENT_ID = '6f0000000000000000000a01';
const OTHER_AGENT_ID = '6f0000000000000000000a02';
const TASK_ID = '6f0000000000000000000701';
const MISSING_ID = '0123456789abcdef01234567';

const rows = (type) => mockDb.store[type] || [];
const res = () => { const r = { code: 200, body: null }; r.status = (c) => { r.code = c; return r; }; r.send = (b) => { r.body = b; return r; }; r.json = r.send; return r; };
const req = (uid, over = {}) => ({ headers: { companyid: C }, params: {}, query: {}, body: {}, uid, ip: '', ...over });
const call = async (handler, request) => { const r = res(); await handler(request, r); return r; };
const comment = (body) => [{ action: 'task.comment', params: { taskId: TASK_ID, body } }];

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    jest.clearAllMocks();
    mockDb.seed(SCHEMA_TYPE.AGENTS, { _id: AGENT_ID, name: 'Reviewer', ownerId: 'owner1', autonomy: 1, spendCapUsd: 1, paused: false, deletedStatusKey: 0 });
    mockDb.seed(SCHEMA_TYPE.AGENTS, { _id: OTHER_AGENT_ID, name: 'Reporter', ownerId: 'owner1', autonomy: 1, spendCapUsd: 1, paused: false, deletedStatusKey: 0 });
    mockDb.seed(SCHEMA_TYPE.TASKS, { _id: TASK_ID, ProjectID: 'p1' });
});

describe('AGT-01 creating an agent', () => {
    it.each(['member1', 'guest1'])('refuses %s and stores nothing', async (uid) => {
        const r = await call(ctrl.createAgent, req(uid, { body: { name: 'Mine', autonomy: 3, spendCapUsd: 500 } }));
        expect(r.code).toBe(403);
        expect(r.body).toMatchObject({ status: false, statusText: 'Only an Owner or an Admin can manage agents.' });
        expect(rows(SCHEMA_TYPE.AGENTS)).toHaveLength(2);
    });

    it('lets an admin create one', async () => {
        const r = await call(ctrl.createAgent, req('admin1', { body: { name: 'Admin agent', autonomy: 1, spendCapUsd: 1 } }));
        expect(r.body).toMatchObject({ status: true, data: { name: 'Admin agent', ownerId: 'admin1' } });
    });
});

describe('AGT-02 editing an agent', () => {
    it('refuses a member raising an agent to L3 and leaves it as it was', async () => {
        const r = await call(ctrl.updateAgent, req('member1', { params: { id: AGENT_ID }, body: { autonomy: 3, spendCapUsd: 500 } }));
        expect(r.code).toBe(403);
        expect(rows(SCHEMA_TYPE.AGENTS)[0]).toMatchObject({ autonomy: 1, spendCapUsd: 1 });
    });

    it('lets the owner change the autonomy', async () => {
        const r = await call(ctrl.updateAgent, req('owner1', { params: { id: AGENT_ID }, body: { autonomy: 2 } }));
        expect(r.body).toMatchObject({ status: true, data: { autonomy: 2 } });
    });
});

describe('AGT-03 the kill switch', () => {
    it.each([true, false])('refuses a guest setting paused=%s', async (paused) => {
        rows(SCHEMA_TYPE.AGENTS)[0].paused = !paused;
        const r = await call(ctrl.setPaused(paused), req('guest1', { params: { id: AGENT_ID } }));
        expect(r.code).toBe(403);
        expect(rows(SCHEMA_TYPE.AGENTS)[0].paused).toBe(!paused);
    });

    it('refuses a guest pausing every agent and lets an admin do it', async () => {
        const refused = await call(ctrl.pauseAll, req('guest1'));
        expect(refused.code).toBe(403);
        expect(rows(SCHEMA_TYPE.AGENTS).every((a) => !a.paused)).toBe(true);

        const allowed = await call(ctrl.pauseAll, req('admin1'));
        expect(allowed.body.status).toBe(true);
    });

    it('lets an admin pause one agent', async () => {
        const r = await call(ctrl.setPaused(true), req('admin1', { params: { id: AGENT_ID }, body: { reason: 'test' } }));
        expect(r.body).toMatchObject({ status: true, data: { paused: true } });
    });
});

describe('AGT-04 stopping a run', () => {
    const seedRun = (over = {}) => mockDb.seed(SCHEMA_TYPE.AGENT_RUNS, { agentId: AGENT_ID, agentName: 'Reviewer', taskId: TASK_ID, projectId: 'p1', status: 'running', startedBy: 'member1', startedAt: new Date(), ...over });

    it('refuses a guest stopping a run someone else started, running or finished', async () => {
        const running = seedRun();
        const finished = seedRun({ status: 'done', finishedAt: new Date() });
        const r = await call(ctrl.stopRun, req('guest1', { params: { id: String(running._id) } }));
        expect(r.code).toBe(403);
        expect(r.body.statusText).toBe('Only an Owner, an Admin or the person who started the run can stop it.');
        expect(rows(SCHEMA_TYPE.AGENT_RUNS)[0].status).toBe('running');
        const done = await call(ctrl.stopRun, req('guest1', { params: { id: String(finished._id) } }));
        expect(done.code).toBe(403);
    });

    it('refuses another member and lets the starter stop it', async () => {
        const run = seedRun();
        const other = await call(ctrl.stopRun, req('member2', { params: { id: String(run._id) } }));
        expect(other.code).toBe(403);
        const mine = await call(ctrl.stopRun, req('member1', { params: { id: String(run._id) } }));
        expect(mine.body).toMatchObject({ status: true, data: { status: 'stopped' } });
    });

    it('lets an admin stop a run a member started', async () => {
        const run = seedRun();
        const r = await call(ctrl.stopRun, req('admin1', { params: { id: String(run._id) } }));
        expect(r.body.status).toBe(true);
    });
});

describe('AGT-05 filing a proposal', () => {
    const body = (over = {}) => ({ agentId: AGENT_ID, taskId: TASK_ID, what: 'Comment on the task', changes: comment('forged'), ...over });

    it.each(['member1', 'guest1', 'owner1'])('refuses %s filing in an agent\'s name', async (uid) => {
        const r = await call(ctrl.createProposal, req(uid, { body: body() }));
        expect(r.code).toBe(403);
        expect(r.body.statusText).toBe('Only the agent itself can file a proposal in its name.');
        expect(rows(SCHEMA_TYPE.AGENT_PROPOSALS)).toHaveLength(0);
    });

    it('refuses an agent filing in another agent\'s name', async () => {
        const r = await call(ctrl.createProposal, req('owner1', { agentToken: { agentId: OTHER_AGENT_ID }, body: body() }));
        expect(r.code).toBe(403);
        expect(rows(SCHEMA_TYPE.AGENT_PROPOSALS)).toHaveLength(0);
    });

    it('lets the agent file in its own name and takes the project from the task', async () => {
        const r = await call(ctrl.createProposal, req('owner1', { agentToken: { agentId: AGENT_ID }, body: body() }));
        expect(r.body).toMatchObject({ status: true, data: { agentId: AGENT_ID, agentName: 'Reviewer', projectId: 'p1', what: 'Comment on the task' } });
    });
});

describe('AGT-06 undoing an approval', () => {
    const seedApproved = () => mockDb.seed(SCHEMA_TYPE.AGENT_PROPOSALS, {
        agentId: AGENT_ID, agentName: 'Reviewer', taskId: TASK_ID, projectId: 'p1', what: 'x', changes: comment('x'),
        status: 'approved', decidedBy: 'admin1', undoUntil: new Date(Date.now() + 60000), auditIds: [],
    });

    it.each(['guest1', 'member1'])('refuses %s undoing an approval an admin made', async (uid) => {
        const p = seedApproved();
        const r = await call(ctrl.undoProposal, req(uid, { params: { id: String(p._id) } }));
        expect(r.code).toBe(403);
        expect(r.body).toMatchObject({ status: false, reason: 'not_permitted' });
        expect(rows(SCHEMA_TYPE.AGENT_PROPOSALS)[0].status).toBe('approved');
    });

    it.each(['admin1', 'owner1'])('lets %s undo it', async (uid) => {
        const p = seedApproved();
        const r = await call(ctrl.undoProposal, req(uid, { params: { id: String(p._id) } }));
        expect(r.body).toMatchObject({ status: true, data: { proposal: { status: 'undone' } } });
    });
});

describe('AGT-07 project visibility', () => {
    const seedPair = () => {
        mockDb.seed(SCHEMA_TYPE.AGENT_PROPOSALS, { agentId: AGENT_ID, agentName: 'Reviewer', projectId: 'p1', what: 'public', changes: comment('a'), status: 'pending' });
        mockDb.seed(SCHEMA_TYPE.AGENT_PROPOSALS, { agentId: AGENT_ID, agentName: 'Reviewer', projectId: 'p2', what: 'private', changes: comment('b'), status: 'pending' });
        mockDb.seed(SCHEMA_TYPE.AGENT_RUNS, { agentId: AGENT_ID, agentName: 'Reviewer', projectId: 'p1', status: 'done', startedBy: 'owner1', startedAt: new Date(), finishedAt: new Date() });
        return mockDb.seed(SCHEMA_TYPE.AGENT_RUNS, { agentId: AGENT_ID, agentName: 'Reviewer', projectId: 'p2', status: 'done', startedBy: 'owner1', startedAt: new Date(), finishedAt: new Date() });
    };

    it('keeps proposals of a project the member cannot open out of the list and the counts', async () => {
        seedPair();
        const member = await call(ctrl.listProposals, req('member1', { query: { status: 'all' } }));
        expect(member.body.data.map((p) => p.what)).toEqual(['public']);
        expect(member.body.counts.waiting).toBe(1);
        const owner = await call(ctrl.listProposals, req('owner1', { query: { status: 'all' } }));
        expect(owner.body.data.map((p) => p.what).sort()).toEqual(['private', 'public']);
    });

    it('keeps runs of a project the guest cannot open out of the list and answers their detail with 404', async () => {
        const hidden = seedPair();
        const list = await call(ctrl.listRuns, req('guest1'));
        expect(list.body.data.map((r) => r.projectId)).toEqual(['p1']);
        const detail = await call(ctrl.getRun, req('guest1', { params: { id: String(hidden._id) } }));
        expect(detail.code).toBe(404);
        expect(detail.body.data).toBeUndefined();
        const owner = await call(ctrl.getRun, req('owner1', { params: { id: String(hidden._id) } }));
        expect(owner.body).toMatchObject({ status: true, data: { run: { projectId: 'p2' } } });
    });
});

describe('AGT-08, AGT-09 and AGT-10 status codes and validation', () => {
    it('answers validation errors with 400', async () => {
        expect((await call(ctrl.createAgent, req('admin1', { body: { name: '' } }))).code).toBe(400);
        expect((await call(ctrl.updateAgent, req('admin1', { params: { id: AGENT_ID }, body: {} }))).code).toBe(400);
        expect((await call(ctrl.updateAgent, req('admin1', { params: { id: 'nope' }, body: { name: 'x' } }))).code).toBe(400);
        expect((await call(ctrl.getRun, req('admin1', { params: { id: 'nope' } }))).code).toBe(400);
        expect((await call(ctrl.approveProposal, req('admin1', { params: { id: 'nope' } }))).code).toBe(400);
    });

    it('answers stopping a run that does not exist with 404', async () => {
        const r = await call(ctrl.stopRun, req('admin1', { params: { id: MISSING_ID } }));
        expect(r.code).toBe(404);
        expect(r.body.statusText).toBe('Run not found.');
    });

    it('refuses a proposal without a summary instead of saving "undefined"', async () => {
        const r = await call(ctrl.createProposal, req('owner1', { agentToken: { agentId: AGENT_ID }, body: { agentId: AGENT_ID, taskId: TASK_ID, changes: comment('x') } }));
        expect(r.code).toBe(400);
        expect(r.body.statusText).toMatch(/^what is required/);
        expect(rows(SCHEMA_TYPE.AGENT_PROPOSALS)).toHaveLength(0);
    });
});
