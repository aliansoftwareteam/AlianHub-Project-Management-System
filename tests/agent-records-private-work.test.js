const fakeMongo = require('./fixtures/fakeMongo');

const mockDb = fakeMongo.create();
const mockRoles = {};
const mockVisible = {};

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({
    getRoleType: jest.fn(async (companyId, uid) => (uid in mockRoles ? mockRoles[uid] : null)),
    isPrivileged: (r) => r === 1 || r === 2,
    evaluatePermission: jest.fn(async () => 1),
    isWritable: () => true,
    isReadable: () => true,
}));
jest.mock('../Modules/Agents/scope', () => ({
    visibleProjectIds: jest.fn(async (companyId, uid) => mockVisible[uid] || []),
    visibleProjects: jest.fn(async (companyId, uid) => (mockVisible[uid] || []).map((_id) => ({ _id }))),
}));
jest.mock('../Modules/Agents/actor', () => {
    const isAgent = (a) => Boolean(a && a.kind === 'agent');
    return {
        isAgent,
        resolveActor: jest.fn(async (req) => ({ kind: 'human', userId: req.uid })),
        attribution: (a) => ({ actorId: a.userId, actorType: 'human', label: '' }),
    };
});

const { SCHEMA_TYPE } = require('../Config/schemaType');

beforeAll(() => require('../Modules/AICore/persistence').useInMemory());
const ctrl = require('../Modules/Agents/controller');
const inbox = require('../Modules/Inbox/controller');
const shipping = require('../Modules/Agents/shipping');
const team = require('../Modules/Agents/team');

const C = '6f0000000000000000000c01';
const OWNER = '6f0000000000000000000001';
const ADMIN = '6f0000000000000000000002';
const MEMBER = '6f0000000000000000000003';
const OTHER = '6f0000000000000000000004';
const AGENT = '6f0000000000000000000a01';
const P_OPEN = '6f0000000000000000000b01';
const PL_MEMBER = '6f0000000000000000000b02';
const PL_OWNER = '6f0000000000000000000b03';
const DIRECT_SPACE = '6f0000000000000000000b09';
const T_OPEN = '6f0000000000000000000701';
const T_LIST = '6f0000000000000000000702';
const T_OWNER_LIST = '6f0000000000000000000703';
const T_CHAT = '6f0000000000000000000704';

const PRIVILEGED = [['an owner', OWNER], ['an admin', ADMIN]];

const rows = (type) => mockDb.store[type] || [];
const res = () => { const r = { code: 200, body: null }; r.status = (c) => { r.code = c; return r; }; r.send = (b) => { r.body = b; return r; }; r.json = r.send; return r; };
const req = (uid, over = {}) => ({ headers: { companyid: C }, params: {}, query: {}, body: {}, uid, ip: '', ...over });
const call = async (handler, request) => { const r = res(); await handler(request, r); return r; };
const change = [{ action: 'task.comment', params: { taskId: T_OPEN, body: 'x' } }];

let run;
let proposal;

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    jest.clearAllMocks();
    Object.assign(mockRoles, { [OWNER]: 1, [ADMIN]: 2, [MEMBER]: 3, [OTHER]: 3 });
    Object.assign(mockVisible, { [OWNER]: [P_OPEN, PL_OWNER], [ADMIN]: [P_OPEN], [MEMBER]: [P_OPEN, PL_MEMBER], [OTHER]: [P_OPEN] });

    mockDb.seed(SCHEMA_TYPE.AGENTS, { _id: AGENT, name: 'Reviewer', ownerId: OWNER, autonomy: 1, spendCapUsd: 1, paused: false, deletedStatusKey: 0, projectIds: [] });
    const project = (_id, extra = {}) => mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id, ProjectName: 'P', isPrivateSpace: false, AssigneeUserId: [], deletedStatusKey: 0, ...extra });
    project(P_OPEN);
    project(PL_MEMBER, { isPrivateSpace: true, isPersonal: true, personalOwner: MEMBER, AssigneeUserId: [MEMBER] });
    project(PL_OWNER, { isPrivateSpace: true, isPersonal: true, personalOwner: OWNER, AssigneeUserId: [OWNER] });
    mockDb.seed(SCHEMA_TYPE.MAIN_CHATS, { _id: DIRECT_SPACE, default: true });
    mockDb.seed(SCHEMA_TYPE.TASKS, { _id: T_OPEN, TaskName: 'Shared work', ProjectID: P_OPEN, deletedStatusKey: 0 });
    mockDb.seed(SCHEMA_TYPE.TASKS, { _id: T_LIST, TaskName: 'Private errand', ProjectID: PL_MEMBER, deletedStatusKey: 0 });
    mockDb.seed(SCHEMA_TYPE.TASKS, { _id: T_OWNER_LIST, TaskName: 'Owner errand', ProjectID: PL_OWNER, deletedStatusKey: 0 });
    mockDb.seed(SCHEMA_TYPE.TASKS, { _id: T_CHAT, TaskName: 'Chat', ProjectID: DIRECT_SPACE, mainChat: true, AssigneeUserId: [MEMBER, OTHER], deletedStatusKey: 0 });

    const seedRun = (label, over) => mockDb.seed(SCHEMA_TYPE.AGENT_RUNS, {
        agentId: AGENT, agentName: 'Reviewer', label, status: 'running', startedAt: new Date(), outcome: label, taskId: null, projectId: null, ...over,
    });
    run = {
        open: seedRun('on the open project', { taskId: T_OPEN, projectId: P_OPEN, startedBy: MEMBER }),
        list: seedRun('in the member\'s personal list', { taskId: T_LIST, projectId: PL_MEMBER, startedBy: MEMBER }),
        ownerList: seedRun('in the owner\'s personal list', { taskId: T_OWNER_LIST, projectId: PL_OWNER, startedBy: OWNER }),
        chat: seedRun('the member\'s conversation with the agent', { kind: 'chat', trigger: 'direct', startedBy: MEMBER, actions: [{ action: 'mention', note: 'a private question' }] }),
        ownerChat: seedRun('the owner\'s conversation with the agent', { kind: 'chat', trigger: 'direct', startedBy: OWNER }),
        message: seedRun('on a direct message of two members', { taskId: T_CHAT, projectId: DIRECT_SPACE, startedBy: MEMBER }),
    };
    const seedProposal = (what, over) => mockDb.seed(SCHEMA_TYPE.AGENT_PROPOSALS, { agentId: AGENT, agentName: 'Reviewer', what, why: what, changes: change, status: 'pending', gate: 'owner_admin', ...over });
    proposal = {
        open: seedProposal('on the open project', { taskId: T_OPEN, projectId: P_OPEN, runId: String(run.open._id) }),
        list: seedProposal('in the member\'s personal list', { taskId: T_LIST, projectId: PL_MEMBER, runId: String(run.list._id) }),
        ownerList: seedProposal('in the owner\'s personal list', { taskId: T_OWNER_LIST, projectId: PL_OWNER, runId: String(run.ownerList._id) }),
        message: seedProposal('on a direct message of two members', { taskId: T_CHAT, projectId: DIRECT_SPACE, runId: String(run.message._id) }),
        approved: seedProposal('approved in the member\'s personal list', { taskId: T_LIST, projectId: PL_MEMBER, runId: String(run.list._id), status: 'approved', decidedBy: MEMBER, undoUntil: new Date(Date.now() + 60000), auditIds: [] }),
    };
});

const labels = (list) => list.map((r) => r.label || r.what).sort();
const OWN = { [OWNER]: ['in the owner\'s personal list', 'on the open project', 'the owner\'s conversation with the agent'], [ADMIN]: ['on the open project'] };

describe.each(PRIVILEGED)('agent runs, for %s', (_who, uid) => {
    it('the list and its summary leave out private work that is someone else\'s', async () => {
        const r = await call(ctrl.listRuns, req(uid));
        expect(labels(r.body.data)).toEqual(OWN[uid]);
        expect(r.body.summary.running).toBe(OWN[uid].length);
        expect(r.body.summary.runs.map((row) => row._id).sort()).toEqual(r.body.data.map((row) => String(row._id)).sort());
    });

    it('the counts leave them out', async () => {
        const r = await call(ctrl.runSummary, req(uid));
        expect(r.body.data.running).toBe(OWN[uid].length);
        expect(r.body.data.counts.running).toBe(OWN[uid].length);
    });

    it.each(['list', 'chat', 'message'])('the detail and the replay of the %s run answer 404', async (key) => {
        const detail = await call(ctrl.getRun, req(uid, { params: { id: String(run[key]._id) } }));
        expect(detail.code).toBe(404);
        expect(JSON.stringify(detail.body)).not.toContain('a private question');
        const replay = await call(ctrl.getRunReplay, req(uid, { params: { id: String(run[key]._id) } }));
        expect(replay.code).toBe(404);
    });

    it.each(['list', 'chat', 'message'])('stopping or reverting the %s run answers 404 and leaves it running', async (key) => {
        for (const handler of [ctrl.stopRun, ctrl.revertRun]) {
            // eslint-disable-next-line no-await-in-loop
            const r = await call(handler, req(uid, { params: { id: String(run[key]._id) } }));
            expect(r.code).toBe(404);
            expect(JSON.stringify(r.body)).not.toContain('a private question');
        }
        expect(rows(SCHEMA_TYPE.AGENT_RUNS).find((row) => String(row._id) === String(run[key]._id)).status).toBe('running');
    });

    it('a run on the open project is still stopped', async () => {
        const r = await call(ctrl.stopRun, req(uid, { params: { id: String(run.open._id) } }));
        expect(r.body).toMatchObject({ status: true, data: { status: 'stopped' } });
    });

    it('the detail of a run on the open project still opens', async () => {
        const detail = await call(ctrl.getRun, req(uid, { params: { id: String(run.open._id) } }));
        expect(detail.body).toMatchObject({ status: true, data: { run: { projectId: P_OPEN } } });
    });

    it('the team board names none of them', async () => {
        const board = await team.board(C, { viewerId: uid });
        const text = JSON.stringify(board);
        [run.list, run.chat, run.message].forEach((hidden) => expect(text).not.toContain(String(hidden._id)));
        expect(text).not.toContain(T_LIST);
        expect(board.activity.map((row) => row.what)).not.toContain('the member\'s conversation with the agent');
    });
});

describe.each(PRIVILEGED)('agent proposals, for %s', (_who, uid) => {
    const mine = uid === OWNER ? ['in the owner\'s personal list', 'on the open project'] : ['on the open project'];

    it('the list and its counts leave out private work that is someone else\'s', async () => {
        const r = await call(ctrl.listProposals, req(uid, { query: { status: 'all' } }));
        expect(labels(r.body.data)).toEqual(mine);
        expect(r.body.counts).toMatchObject({ waiting: mine.length, doneByAi: 0 });
    });

    it.each([
        ['approve', 'approveProposal', 'list'],
        ['decline', 'declineProposal', 'list'],
        ['approve', 'approveProposal', 'message'],
        ['decline', 'declineProposal', 'message'],
        ['undo', 'undoProposal', 'approved'],
    ])('cannot %s the one they cannot see: it answers 404 as a missing one does', async (_what, handler, key) => {
        const before = proposal[key].status;
        const r = await call(ctrl[handler], req(uid, { params: { id: String(proposal[key]._id) } }));
        const missing = await call(ctrl[handler], req(uid, { params: { id: '0123456789abcdef01234567' } }));
        expect(r.code).toBe(404);
        expect(r.body).toEqual(missing.body);
        expect(rows(SCHEMA_TYPE.AGENT_PROPOSALS).find((p) => String(p._id) === String(proposal[key]._id)).status).toBe(before);
    });

    it('the inbox leaves them out', async () => {
        const items = await inbox.__internals.readProposals(C, uid);
        expect(items.map((item) => item.what).sort()).toEqual(mine);
    });

    it('the release view leaves them out', async () => {
        const out = await shipping.releaseCandidate(C, uid);
        expect(JSON.stringify(out)).not.toContain(String(proposal.list._id));
        expect(JSON.stringify(out)).not.toContain(String(proposal.message._id));
    });
});

describe('the person the work belongs to', () => {
    it('the holder of a personal list sees and decides the runs and proposals in it', async () => {
        const list = await call(ctrl.listRuns, req(MEMBER));
        expect(labels(list.body.data)).toEqual(['in the member\'s personal list', 'on the open project']);
        expect((await call(ctrl.getRun, req(MEMBER, { params: { id: String(run.list._id) } }))).code).toBe(200);
        const proposals = await call(ctrl.listProposals, req(MEMBER, { query: { status: 'all' } }));
        expect(labels(proposals.body.data)).toEqual(['approved in the member\'s personal list', 'in the member\'s personal list', 'on the open project']);
        const declined = await call(ctrl.declineProposal, req(MEMBER, { params: { id: String(proposal.list._id) } }));
        expect(declined.body).toMatchObject({ status: true, data: { proposal: { status: 'declined' } } });
    });

    it('an owner decides a proposal in their own personal list', async () => {
        const declined = await call(ctrl.declineProposal, req(OWNER, { params: { id: String(proposal.ownerList._id) } }));
        expect(declined.body).toMatchObject({ status: true, data: { proposal: { status: 'declined' } } });
    });

    it('a member cannot decide a proposal in a project they cannot open, and a 404 says so', async () => {
        const r = await call(ctrl.declineProposal, req(OTHER, { params: { id: String(proposal.list._id) } }));
        expect(r.code).toBe(404);
        expect(rows(SCHEMA_TYPE.AGENT_PROPOSALS).find((p) => String(p._id) === String(proposal.list._id)).status).toBe('pending');
    });

    it('a member who can open the project is told an owner-or-admin proposal is not theirs to decline, and it keeps waiting', async () => {
        const r = await call(ctrl.declineProposal, req(OTHER, { params: { id: String(proposal.open._id) } }));
        expect(r.code).toBe(403);
        expect(r.body).toMatchObject({ status: false, reason: 'not_permitted' });
        expect(rows(SCHEMA_TYPE.AGENT_PROPOSALS).find((p) => String(p._id) === String(proposal.open._id)).status).toBe('pending');
    });
});

describe('a proposal on a thread the approver cannot open, and a comment that would go to one', () => {
    const SPRINT = '6f0000000000000000000801';
    const T_SPRINT = '6f0000000000000000000705';
    const NOT_FOUND = { status: false, statusText: 'Proposal not found.', message: 'Proposal not found.' };
    const stored = (p) => rows(SCHEMA_TYPE.AGENT_PROPOSALS).find((row) => String(row._id) === String(p._id));
    const commentOn = (taskId) => [{ action: 'task.comment', params: { taskId, body: 'x' }, label: 'Comment' }];
    const seedOn = (over) => mockDb.seed(SCHEMA_TYPE.AGENT_PROPOSALS, { agentId: AGENT, agentName: 'Reviewer', what: 'x', why: 'x', status: 'pending', gate: null, runId: null, ...over });

    beforeEach(() => {
        mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: SPRINT, name: 'Private', projectId: P_OPEN, private: true, AssigneeUserId: [OWNER], deletedStatusKey: 0 });
        mockDb.seed(SCHEMA_TYPE.TASKS, { _id: T_SPRINT, TaskName: 'On a private sprint', ProjectID: P_OPEN, sprintId: SPRINT, deletedStatusKey: 0 });
    });

    it('answers a member 404 for a proposal on a private sprint they are not on, and leaves it pending', async () => {
        const p = seedOn({ taskId: T_SPRINT, projectId: P_OPEN, changes: commentOn(T_SPRINT) });
        const r = await call(ctrl.approveProposal, req(OTHER, { params: { id: String(p._id) } }));
        expect(r.code).toBe(404);
        expect(r.body).toEqual(NOT_FOUND);
        expect(stored(p)).toMatchObject({ status: 'pending' });
        expect(stored(p).decidedBy).toBeUndefined();
        expect(rows(SCHEMA_TYPE.COMMENTS)).toHaveLength(0);
    });

    it('answers an admin 404 for a proposal on a direct message they are not in, and leaves it pending', async () => {
        const p = seedOn({ taskId: T_CHAT, projectId: DIRECT_SPACE, changes: commentOn(T_CHAT) });
        const r = await call(ctrl.approveProposal, req(ADMIN, { params: { id: String(p._id) } }));
        expect(r.code).toBe(404);
        expect(r.body).toEqual(NOT_FOUND);
        expect(stored(p)).toMatchObject({ status: 'pending' });
        expect(stored(p).decidedBy).toBeUndefined();
    });

    it.each([
        ['a member, a private sprint they are not on', OTHER, T_SPRINT],
        ['an admin, a direct message they are not in', ADMIN, T_CHAT],
    ])('refuses the approval and leaves the proposal waiting when the approver sees it but its comment targets a thread they cannot open (%s)', async (_who, uid, target) => {
        const p = seedOn({ taskId: T_OPEN, projectId: P_OPEN, changes: commentOn(target) });
        const r = await call(ctrl.approveProposal, req(uid, { params: { id: String(p._id) } }));
        expect(r.code).toBe(403);
        expect(r.body).toMatchObject({ status: false, reason: 'not_permitted', statusText: expect.stringMatching(/cannot open what this change touches/) });
        expect(stored(p)).toMatchObject({ status: 'pending' });
        expect(stored(p).decidedBy).toBeUndefined();
        expect(rows(SCHEMA_TYPE.COMMENTS)).toHaveLength(0);
    });
});

describe('the rule has one meaning as a query clause and as a check on a record already read', () => {
    it('for runs and for proposals, for an owner, an admin and a member', async () => {
        const privateWork = require('../Modules/Agents/privateWork');
        for (const uid of [OWNER, ADMIN, MEMBER]) {
            const scope = await privateWork.privateWorkOf(C, uid);
            rows(SCHEMA_TYPE.AGENT_RUNS).forEach((record) => {
                expect({ uid, run: record.label, reads: privateWork.readsRun(scope, record) })
                    .toEqual({ uid, run: record.label, reads: fakeMongo.matches(record, privateWork.runClause(scope)) });
            });
            rows(SCHEMA_TYPE.AGENT_PROPOSALS).forEach((record) => {
                expect({ uid, proposal: record.what, reads: privateWork.readsProposal(scope, record) })
                    .toEqual({ uid, proposal: record.what, reads: fakeMongo.matches(record, privateWork.proposalClause(scope)) });
            });
        }
    });
});
