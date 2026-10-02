const mongoose = require('mongoose');
const fakeMongo = require('./fixtures/fakeMongo');

const mockDb = fakeMongo.create();
const mockRoles = {};
const mockVisible = {};

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {} } }));
jest.mock('../Modules/notification-count/controller', () => ({ updateUnReadCommentsCountFun: jest.fn(() => Promise.resolve({ status: true })) }));
jest.mock('../Config/permissionGuard', () => ({
    getRoleType: jest.fn(async (companyId, uid) => (uid in mockRoles ? mockRoles[uid] : null)),
    isPrivileged: (r) => r === 1 || r === 2,
}));
jest.mock('../Modules/Agents/scope', () => ({
    visibleProjectIds: jest.fn(async (companyId, uid) => mockVisible[uid] || []),
    visibleProjects: jest.fn(async (companyId, uid) => (mockVisible[uid] || []).map((_id) => ({ _id }))),
}));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const ctrl = require('../Modules/Inbox/controller');

const C = '6f0000000000000000000c01';
const OWNER = '6f0000000000000000000001';
const ADMIN = '6f0000000000000000000002';
const MEMBER = '6f0000000000000000000003';
const GUEST = '6f0000000000000000000004';
const STRANGER = '6f0000000000000000000005';
const AGENT = '6f0000000000000000000a01';
const P_OPEN = '6f0000000000000000000b01';
const P_CLOSED = '6f0000000000000000000b02';
const T_OPEN = '6f0000000000000000000701';
const T_CLOSED = '6f0000000000000000000702';

const comment = (taskId) => ({ action: 'task.comment', params: { taskId, body: 'Ship it' }, label: 'Comment on the task', reversible: true });

const seedProposal = (what, over = {}) => mockDb.seed(SCHEMA_TYPE.AGENT_PROPOSALS, {
    agentId: AGENT, agentName: 'Reviewer', what, why: `because ${what}`, changes: [comment(T_OPEN)], status: 'pending', gate: null,
    taskId: T_OPEN, projectId: P_OPEN, createdAt: new Date(), ...over,
});

const res = () => { const r = { body: null }; r.status = () => r; r.send = (b) => { r.body = b; return r; }; r.json = r.send; return r; };
const call = async (handler, uid, query = {}) => {
    const r = res();
    await handler({ uid, headers: { companyid: C }, query, body: {} }, r);
    return r.body.data;
};
const queueOf = (uid) => ctrl.__internals.readProposals(C, uid);
const named = (rows) => rows.map((row) => row.what).sort();

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    Object.assign(mockRoles, { [OWNER]: 1, [ADMIN]: 2, [MEMBER]: 3, [GUEST]: 0 });
    Object.assign(mockVisible, { [OWNER]: [P_OPEN, P_CLOSED], [ADMIN]: [P_OPEN, P_CLOSED], [MEMBER]: [P_OPEN], [GUEST]: [P_OPEN] });
    seedProposal('plain');
    seedProposal('gated', { gate: 'owner_admin' });
    seedProposal('in a closed project', { projectId: P_CLOSED, taskId: T_CLOSED, changes: [comment(T_CLOSED)] });
    seedProposal('reaching into a closed project', { changes: [comment(T_OPEN), { action: 'task.add', params: { projectId: P_CLOSED, title: 'Follow up' }, label: 'Add a task', reversible: true }] });
    seedProposal('from a connected agent', { source: 'mcp', requestedBy: MEMBER, agentName: 'Claude' });
    seedProposal('already decided', { status: 'approved' });
});

describe('the approval queue in the Inbox', () => {
    it.each([['an owner', OWNER], ['an admin', ADMIN]])('%s sees every waiting proposal, and none is locked', async (_who, uid) => {
        const rows = await queueOf(uid);
        expect(named(rows)).toEqual(['from a connected agent', 'gated', 'in a closed project', 'plain', 'reaching into a closed project']);
        expect(rows.every((row) => row.locked === false)).toBe(true);
    });

    it('a member sees what is in a project they can open, with the owner-or-admin one locked', async () => {
        const rows = await queueOf(MEMBER);
        expect(named(rows)).toEqual(['from a connected agent', 'gated', 'plain']);
        expect(rows.filter((row) => row.locked).map((row) => row.what)).toEqual(['gated']);
    });

    it('a member is not shown a proposal whose project they cannot open, nor one whose change reaches into such a project', async () => {
        const rows = await queueOf(MEMBER);
        expect(named(rows)).not.toContain('in a closed project');
        expect(named(rows)).not.toContain('reaching into a closed project');
    });

    it('a member who may approve nothing sees the rows locked and a count of nought', async () => {
        mockDb.store[SCHEMA_TYPE.AGENT_PROPOSALS].forEach((p) => { if (p.status === 'pending') p.gate = 'owner_admin'; });
        const rows = await queueOf(MEMBER);
        expect(rows.length).toBeGreaterThan(0);
        expect(rows.every((row) => row.locked)).toBe(true);
        expect((await call(ctrl.counts, MEMBER)).approval).toBe(0);
    });

    it.each([['a guest', GUEST], ['someone outside the workspace', STRANGER]])('%s is shown nothing', async (_who, uid) => {
        expect(await queueOf(uid)).toEqual([]);
        expect((await call(ctrl.counts, uid)).approval).toBe(0);
    });

    it('a row says who proposes, what and why, and carries the change as filed only where the person may edit it', async () => {
        const { params, ...shown } = comment(T_OPEN);
        const row = (await queueOf(OWNER)).find((r) => r.what === 'from a connected agent');
        expect(row).toMatchObject({
            kind: 'proposal', sourceType: 'proposal', proposalId: row.sourceId, agentName: 'Claude', source: 'mcp', requestedBy: MEMBER,
            why: 'because from a connected agent', editable: false, locked: false, unread: true,
        });
        expect(row.changes).toEqual([shown]);
        expect((await queueOf(OWNER)).find((r) => r.what === 'plain')).toMatchObject({ editable: true, changes: [{ ...shown, params }] });
        expect((await queueOf(MEMBER)).find((r) => r.what === 'gated')).toMatchObject({ editable: true, locked: true, changes: [shown] });
        expect((await queueOf(MEMBER)).find((r) => r.what === 'gated').changes[0].params).toBeUndefined();
    });

    it.each([['an owner', OWNER], ['a member', MEMBER]])('for %s the count on the tab is the rows that wait for them', async (_who, uid) => {
        const listed = await call(ctrl.list, uid, { tab: 'approval' });
        const counts = await call(ctrl.counts, uid);
        expect(named(listed.proposals)).toEqual(named(await queueOf(uid)));
        expect(counts.approval).toBe(listed.proposals.filter((row) => !row.locked).length + listed.approvals.length);
        expect(counts.approval).toBeGreaterThan(0);
    });

    it('a member\'s count leaves out what waits on a task in a list they are not on', async () => {
        const before = (await call(ctrl.counts, MEMBER)).approval;
        const list = mockDb.seed(SCHEMA_TYPE.SPRINTS, { projectId: new mongoose.Types.ObjectId(P_OPEN), private: true, AssigneeUserId: [OWNER] });
        const task = mockDb.seed(SCHEMA_TYPE.TASKS, { ProjectID: P_OPEN, sprintId: list._id });
        seedProposal('in a list of the owner\'s', { taskId: String(task._id), changes: [comment(String(task._id))] });

        expect(named(await queueOf(MEMBER))).not.toContain('in a list of the owner\'s');
        expect((await call(ctrl.counts, MEMBER)).approval).toBe(before);
        expect(named(await queueOf(OWNER))).toContain('in a list of the owner\'s');
    });

    it('a leave request waits in the same tab for an owner, and the count includes it', async () => {
        const before = (await call(ctrl.counts, OWNER)).approval;
        mockDb.seed(SCHEMA_TYPE.PTO_ENTRIES, { status: 'pending', userId: MEMBER, type: 'vacation', startDate: new Date(), endDate: new Date(), createdAt: new Date() });
        const listed = await call(ctrl.list, OWNER, { tab: 'approval' });
        expect(listed.approvals).toHaveLength(1);
        expect((await call(ctrl.counts, OWNER)).approval).toBe(before + 1);
        expect((await call(ctrl.list, MEMBER, { tab: 'approval' })).approvals).toEqual([]);
    });

    it('Primary no longer carries what waits for approval', async () => {
        mockDb.seed(SCHEMA_TYPE.PTO_ENTRIES, { status: 'pending', userId: MEMBER, type: 'vacation', startDate: new Date(), endDate: new Date(), createdAt: new Date() });
        const primary = await call(ctrl.list, OWNER, { tab: 'primary' });
        expect(primary.proposals).toEqual([]);
        expect(primary.approvals).toEqual([]);
        expect((await call(ctrl.counts, OWNER)).primary).toBe(0);
    });
});
