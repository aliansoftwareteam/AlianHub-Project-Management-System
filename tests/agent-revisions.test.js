const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({ getRoleType: jest.fn(async (c, uid) => (uid === 'member1' ? 'member' : 'owner')), isPrivileged: (r) => r === 'owner' || r === 'admin' }));
jest.mock('../Modules/Agents/actor', () => ({ resolveActor: jest.fn(async (req) => ({ kind: req.agentToken ? 'agent' : 'human', userId: req.uid })), isAgent: (a) => a.kind === 'agent', attribution: (a) => ({ actorType: a.kind, actorId: a.userId, label: a.userId }) }));
jest.mock('../Modules/Automations/engine/tools', () => ({ getTask: jest.fn(async () => ({ _id: '6f0000000000000000000701', TaskName: 'Review', ProjectID: 'p1' })) }));
jest.mock('../Modules/AIProjectGenerator/usage', () => ({ checkConfiguredModelPriced: () => ({ ok: true, reason: '' }), unpricedMessage: (m) => m, UNPRICED_MODEL: 'unpriced_model', summarize: jest.fn(() => ({ costUsd: 0, totalTokens: 0, model: 'm' })) }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { agentRevisionsSchema } = require('../utils/mongo-handler/createSchema');
const revisions = require('../Modules/Agents/revisions');
const agentAudit = require('../Modules/Agents/agentAudit');
const runs = require('../Modules/Agents/runs');
const ctrl = require('../Modules/Agents/controller');
const routes = require('../Modules/Agents/routes');

const C = '6f0000000000000000000c01';
const AGENT_ID = '6f0000000000000000000a01';
const T = SCHEMA_TYPE.AGENT_REVISIONS;

const res = () => { const r = { code: 200, body: null }; r.status = (c) => { r.code = c; return r; }; r.send = (b) => { r.body = b; return r; }; return r; };
const req = (over = {}) => ({ headers: { companyid: C }, params: { id: AGENT_ID }, query: {}, body: {}, uid: 'owner1', ip: '1.1.1.1', ...over });
const call = async (fn, over) => { const r = res(); await fn(req(over), r); return r; };

const baseAgent = () => ({ _id: AGENT_ID, name: 'Reviewer', ownerId: 'owner1', autonomy: 1, spendCapUsd: 30, allowedActions: ['task.comment'], projectIds: [], skills: [{ key: 'qa-review', name: 'QA Review', enabled: true }], account: 'workspace', paused: false, deletedStatusKey: 0 });
const rows = () => [...mockDb.store[T]].sort((a, b) => a.n - b.n);
const audits = (action) => (mockDb.store[SCHEMA_TYPE.AUDIT_LOGS] || []).filter((r) => r.action === action);
const agentRow = () => mockDb.store[SCHEMA_TYPE.AGENTS].find((a) => a._id === AGENT_ID);

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.calls.length = 0;
    jest.clearAllMocks();
    mockDb.uniqueFromSchema(T, agentRevisionsSchema);
    mockDb.seed(SCHEMA_TYPE.AGENTS, baseAgent());
});

describe('the revision document', () => {
    it('declares the collection, a unique {agentId, n} index and the run pin fields', () => {
        expect(SCHEMA_TYPE.AGENT_REVISIONS).toBe('agent_revisions');
        const unique = agentRevisionsSchema.indexes().find(([fields, o]) => o && o.unique);
        expect(unique[0]).toEqual({ agentId: 1, n: 1 });
        const declared = require('../utils/mongo-handler/schema').schema;
        expect(Object.keys(declared.agentRevisions)).toEqual(expect.arrayContaining(['agentId', 'n', 'state', 'snapshot', 'serves', 'createdBy', 'promotedAt', 'supersededAt', 'note']));
        expect(Object.keys(declared.agentRuns)).toEqual(expect.arrayContaining(['agentRevision', 'skillRevision']));
    });

    it('snapshots only the fields that shape a run, and names the skills it serves with a code hash', () => {
        const snap = revisions.snapshotOf({ ...baseAgent(), spendMonth: { usd: 3 }, pausedReason: 'x', _id: 'ignored' });
        expect(Object.keys(snap).sort()).toEqual(['account', 'allowedActions', 'autonomy', 'name', 'projectIds', 'skills', 'spendCapUsd']);
        expect(revisions.skillKeysOf(snap)).toEqual(['qa-review']);
        const [ref] = revisions.skillRefsOf(snap);
        expect(ref).toEqual({ key: 'qa-review', hash: expect.stringMatching(/^[0-9a-f]{16}$/), n: null });
        expect(revisions.skillRefOf('no-such-skill')).toEqual({ key: 'no-such-skill', hash: null, n: null });
    });
});

describe('a settings save', () => {
    it('writes revision 1 as live on create', async () => {
        mockDb.store[SCHEMA_TYPE.AGENTS].length = 0;
        const r = await call(ctrl.createAgent, { body: { name: 'Planner', autonomy: 2 } });
        expect(r.body.status).toBe(true);
        expect(rows()).toHaveLength(1);
        expect(rows()[0]).toMatchObject({ agentId: String(r.body.data._id), n: 1, state: 'live', source: 'create', createdBy: 'owner1', snapshot: { name: 'Planner', autonomy: 2 } });
    });

    it('creates n+1 as live, supersedes the previous live and writes one audit row', async () => {
        await revisions.liveFor(C, baseAgent());
        const r = await call(ctrl.updateAgent, { body: { autonomy: 2 } });
        expect(r.body).toMatchObject({ status: true, revision: 2 });
        expect(rows().map((x) => [x.n, x.state])).toEqual([[1, 'superseded'], [2, 'live']]);
        expect(rows()[0].supersededAt).toBeInstanceOf(Date);
        expect(rows()[0].snapshot.autonomy).toBe(1);
        expect(rows()[1]).toMatchObject({ snapshot: { autonomy: 2, name: 'Reviewer' }, source: 'save', createdBy: 'owner1', promotedAt: expect.any(Date) });
        const [row] = audits(agentAudit.REVISION_PROMOTED);
        expect(row).toMatchObject({ entityType: 'agent', entityId: AGENT_ID, meta: { kind: 'save', from: 1, to: 2 } });
        expect(audits(agentAudit.REVISION_PROMOTED)).toHaveLength(1);
    });

    it('writes no revision when nothing a run reads changed', async () => {
        await revisions.liveFor(C, baseAgent());
        const out = await revisions.recordSave(C, baseAgent(), { ...baseAgent(), spendMonth: { usd: 9 } }, { actor: { userId: 'owner1' } });
        expect(out).toMatchObject({ changed: false, revision: { n: 1 } });
        expect(rows()).toHaveLength(1);
    });

    it('bootstraps revision 1 for an agent the migration never saw', async () => {
        const live = await revisions.liveFor(C, baseAgent());
        expect(live).toMatchObject({ n: 1, state: 'live', source: 'bootstrap' });
        expect((await revisions.liveFor(C, baseAgent())).n).toBe(1);
        expect(rows()).toHaveLength(1);
    });
});

describe('promote and rollback', () => {
    const seedHistory = async () => {
        await revisions.liveFor(C, baseAgent());
        await revisions.recordSave(C, baseAgent(), { ...baseAgent(), autonomy: 2 }, { actor: { userId: 'owner1' } });
        return revisions.createDraft(C, { ...baseAgent(), autonomy: 2 }, { fields: { autonomy: 3 }, state: 'candidate', note: 'try L3', actor: { userId: 'owner1' } });
    };

    it('a draft or candidate is reachable through POST /revisions, never through the plain save', async () => {
        await revisions.liveFor(C, baseAgent());
        const r = await call(ctrl.createRevision, { body: { state: 'candidate', autonomy: 3, note: 'try L3' } });
        expect(r.body.data).toMatchObject({ n: 2, state: 'candidate', note: 'try L3', snapshot: { autonomy: 3, name: 'Reviewer' } });
        expect(rows().map((x) => x.state)).toEqual(['live', 'candidate']);
        expect(agentRow().autonomy).toBe(1);
    });

    it('promote is a pointer move with an audit row and never rewrites an old revision', async () => {
        const candidate = await seedHistory();
        const before = JSON.stringify(rows().map(({ n, snapshot, createdAt, createdBy, source }) => ({ n, snapshot, createdAt, createdBy, source })));
        const r = await call(ctrl.promoteRevision, { params: { id: AGENT_ID, n: String(candidate.n) } });
        expect(r.body).toMatchObject({ status: true, data: { from: 2, revision: { n: 3, state: 'live' } } });
        expect(rows().map((x) => [x.n, x.state])).toEqual([[1, 'superseded'], [2, 'superseded'], [3, 'live']]);
        expect(JSON.stringify(rows().map(({ n, snapshot, createdAt, createdBy, source }) => ({ n, snapshot, createdAt, createdBy, source })))).toBe(before);
        expect(agentRow().autonomy).toBe(3);
        const row = audits(agentAudit.REVISION_PROMOTED).find((x) => x.meta.kind === 'promote');
        expect(row.meta).toMatchObject({ from: 2, to: 3, agentId: AGENT_ID });
    });

    it('refuses to promote a superseded revision and points at rollback', async () => {
        await seedHistory();
        const r = await call(ctrl.promoteRevision, { params: { id: AGENT_ID, n: '1' } });
        expect(r.code).toBe(409);
        expect(r.body.statusText).toMatch(/roll back/);
    });

    it('rollback creates n+1 as a copy of :n, promotes it, and leaves :n untouched', async () => {
        await seedHistory();
        const original = JSON.stringify(rows()[0]);
        const r = await call(ctrl.rollbackRevision, { params: { id: AGENT_ID, n: '1' } });
        expect(r.body).toMatchObject({ status: true, data: { from: 2, rollbackOf: 1, revision: { n: 4, state: 'live', rollbackOf: 1, source: 'rollback' } } });
        expect(rows().map((x) => [x.n, x.state])).toEqual([[1, 'superseded'], [2, 'superseded'], [3, 'candidate'], [4, 'live']]);
        expect(JSON.stringify(rows()[0])).toBe(original);
        expect(rows()[3].snapshot).toEqual(rows()[0].snapshot);
        expect(agentRow().autonomy).toBe(1);
        expect(audits(agentAudit.REVISION_ROLLED_BACK)).toHaveLength(1);
        expect(audits(agentAudit.REVISION_ROLLED_BACK)[0].meta).toMatchObject({ kind: 'rollback', from: 2, to: 4 });
    });

    it('is owner/admin only, like the settings page', async () => {
        await seedHistory();
        for (const fn of [ctrl.listRevisions, ctrl.getRevision, ctrl.createRevision, ctrl.promoteRevision, ctrl.rollbackRevision]) {
            // eslint-disable-next-line no-await-in-loop
            const r = await call(fn, { uid: 'member1', params: { id: AGENT_ID, n: '1' } });
            expect([r.code, r.body.statusText]).toEqual([403, 'Owner/admin only.']);
        }
        const agentToken = await call(ctrl.listRevisions, { agentToken: true });
        expect(agentToken.code).toBe(403);
    });

    it('lists every revision with who, when, state and a diff-able snapshot', async () => {
        await seedHistory();
        const r = await call(ctrl.listRevisions);
        expect(r.body.data.map((x) => [x.n, x.state, x.createdBy, x.source])).toEqual([[1, 'superseded', 'owner1', 'bootstrap'], [2, 'live', 'owner1', 'save'], [3, 'candidate', 'owner1', 'draft']]);
        expect(r.body.data[2]).toMatchObject({ note: 'try L3', snapshot: { autonomy: 3 }, serves: ['qa-review'], skillRefs: [{ key: 'qa-review' }] });
        const one = await call(ctrl.getRevision, { params: { id: AGENT_ID, n: '2' } });
        expect(one.body.data).toMatchObject({ n: 2, snapshot: { autonomy: 2 } });
        expect((await call(ctrl.getRevision, { params: { id: AGENT_ID, n: '9' } })).code).toBe(404);
    });

    it('registers the endpoints under the agents prefix', () => {
        const app = { use: jest.fn(), get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() };
        routes.init(app);
        const paths = (m) => app[m].mock.calls.map(([p]) => p);
        expect(paths('get')).toEqual(expect.arrayContaining(['/api/v2/agents/:id/revisions', '/api/v2/agents/:id/revisions/:n']));
        expect(paths('post')).toEqual(expect.arrayContaining(['/api/v2/agents/:id/revisions', '/api/v2/agents/:id/revisions/:n/promote', '/api/v2/agents/:id/revisions/:n/rollback']));
    });
});

describe('a run pins the live revision', () => {
    const TASK_ID = '6f0000000000000000000701';

    it('records agentRevision and the skill identity at start, and a later save does not change what the run reports', async () => {
        await revisions.liveFor(C, baseAgent());
        const run = await runs.create(C, { agent: baseAgent(), taskId: TASK_ID, projectId: 'p1', skill: 'qa-review', startedBy: 'u1' });
        expect(run.agentRevision).toBe(1);
        expect(run.skillRevision).toEqual({ key: 'qa-review', hash: expect.any(String), n: null });

        await revisions.recordSave(C, baseAgent(), { ...baseAgent(), autonomy: 3 }, { actor: { userId: 'owner1' } });
        expect((await revisions.liveFor(C, baseAgent())).n).toBe(2);

        const r = await call(ctrl.getRun, { params: { id: String(run._id) } });
        expect(r.body.data.run.agentRevision).toBe(1);
        expect(r.body.data.revision).toMatchObject({ n: 1, state: 'superseded', synthetic: false });
        const pinned = revisions.applyRevision({ ...baseAgent(), autonomy: 3 }, await revisions.forRun(C, run));
        expect(pinned.autonomy).toBe(1);
    });

    it('the engine reads the agent from the pinned snapshot, not the mutable record', async () => {
        await revisions.liveFor(C, baseAgent());
        const run = await runs.create(C, { agent: baseAgent(), taskId: TASK_ID, projectId: 'p1', skill: 'qa-review', startedBy: 'u1' });
        await revisions.recordSave(C, baseAgent(), { ...baseAgent(), autonomy: 3, allowedActions: ['task.delete'] }, { actor: { userId: 'owner1' } });
        const agentAsSeen = revisions.applyRevision(agentRow(), await revisions.forRun(C, run));
        expect(agentAsSeen).toMatchObject({ autonomy: 1, allowedActions: ['task.comment'] });
    });

    it('a run from before revisions resolves to a synthetic revision zero', async () => {
        const old = mockDb.seed(SCHEMA_TYPE.AGENT_RUNS, { agentId: AGENT_ID, status: 'done', startedAt: new Date() });
        expect(await revisions.forRun(C, old)).toMatchObject({ n: 0, synthetic: true, snapshot: null });
        const r = await call(ctrl.getRun, { params: { id: String(old._id) } });
        expect(r.body.data.run.agentRevision).toBe(0);
        expect(r.body.data.revision).toMatchObject({ n: 0, synthetic: true });
        expect(revisions.applyRevision(baseAgent(), await revisions.forRun(C, old)).autonomy).toBe(1);
    });
});
