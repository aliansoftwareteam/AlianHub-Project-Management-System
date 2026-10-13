const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (companyId, q, method) => mockDb.crud(companyId, q, method),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0, flushAll: () => {} } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const world = require('./fixtures/accessWorld');
const actions = require('../Modules/Agents/actions');

const { CID, OWNER, ADMIN, INSIDER, OUTSIDER, GUEST, P_OPEN, P_PRIVATE, T_OPEN, T_SECRET, settle } = world;
const { seed, rows } = world.create(mockDb);

const P_NOWHERE = '6f0000000000000000000aff';
const T_NOWHERE = '6f0000000000000000000dff';
const AGENT = '6f0000000000000000000f01';
const RUN = '6f0000000000000000000f02';

/* A run of a workspace agent, started by `uid`. */
const startedBy = (uid) => ({ kind: 'agent', userId: uid, agentId: AGENT, agentName: 'Writer', runId: RUN, viaAccount: 'workspace', tokenId: null });

const draft = (uid, params) => actions.perform({ companyId: CID, actor: startedBy(uid), action: 'page.draft', params: { title: 'Plan', text: 'First', ...params }, reason: 'a run', allowedActions: ['page.draft'] })
    .then((out) => ({ saved: true, pageId: out.result.pageId }), (error) => ({ saved: false, name: error.name, reason: error.message }))
    .then(async (result) => { await settle(); return result; });

const pages = () => rows(SCHEMA_TYPE.PAGES);
const audits = (action) => rows(SCHEMA_TYPE.AUDIT_LOGS).filter((row) => row.action === action);

beforeEach(() => {
    seed();
    const parent = mockDb.seed(SCHEMA_TYPE.RULES, { key: 'project', name: 'Project', isParent: true, roles: [] });
    mockDb.seed(SCHEMA_TYPE.RULES, { key: 'project_details', name: 'project_details', isParent: false, parentId: String(parent._id), roles: [{ key: 3, permission: true }, { key: 0, permission: true }] });
});

describe('a doc an agent drafts in a run', () => {
    it.each([
        ['an owner', OWNER, { projectId: P_OPEN }],
        ['an admin', ADMIN, { projectId: P_PRIVATE }],
        ['a member', OUTSIDER, { projectId: P_OPEN }],
        ['a member of the private project', INSIDER, { projectId: P_PRIVATE }],
        ['a member, outside every project', OUTSIDER, {}],
    ])('is saved as a draft when %s started the run', async (label, uid, params) => {
        const out = await draft(uid, params);

        expect(out.saved).toBe(true);
        expect(pages()).toEqual([expect.objectContaining({ title: 'Plan', createdBy: uid, createdByAgent: true, agentStatus: 'draft', agentName: 'Writer' })]);
        expect(audits('agent.action')[0].meta).toMatchObject({ action: 'page.draft', state: 'applied' });
    });

    it.each([
        ['a guest, in a project they can open', GUEST, { projectId: P_OPEN }, /^permission_denied/],
        ['a guest, outside every project', GUEST, {}, /^permission_denied/],
        ['a member, in a project they cannot open', OUTSIDER, { projectId: P_PRIVATE }, /^not_visible/],
        ['a member, in a project that does not exist', OUTSIDER, { projectId: P_NOWHERE }, /^not_visible/],
    ])('is refused and recorded when %s started the run', async (label, uid, params, reason) => {
        const out = await draft(uid, params);

        expect(out).toMatchObject({ saved: false, name: 'RefusedError', reason: expect.stringMatching(reason) });
        expect(pages()).toEqual([]);
        expect(audits('agent.action')).toHaveLength(0);
        expect(audits('agent.action_refused')).toHaveLength(1);
        expect(audits('agent.action_refused')[0].meta).toMatchObject({ action: 'page.draft', ran: false });
    });

    it('answers a project its person cannot open as one that does not exist', async () => {
        expect((await draft(OUTSIDER, { projectId: P_PRIVATE })).reason).toBe((await draft(OUTSIDER, { projectId: P_NOWHERE })).reason);
    });

    it('is linked to the task it is for when the person who started the run can open that task', async () => {
        expect((await draft(INSIDER, { projectId: P_OPEN, taskId: T_SECRET })).saved).toBe(true);
        expect((await draft(OUTSIDER, { projectId: P_OPEN, taskId: T_OPEN })).saved).toBe(true);

        expect(pages().map((page) => page.linkedTasks.map(String))).toEqual([[T_SECRET], [T_OPEN]]);
    });

    it('for a task its person cannot open is refused as one for a task that does not exist', async () => {
        const hidden = await draft(OUTSIDER, { projectId: P_OPEN, taskId: T_SECRET });
        const missing = await draft(OUTSIDER, { projectId: P_OPEN, taskId: T_NOWHERE });

        expect(hidden).toMatchObject({ saved: false, name: 'RefusedError', reason: expect.stringMatching(/^not_visible/) });
        expect(hidden.reason).toBe(missing.reason);
        expect(pages()).toEqual([]);
    });
});
