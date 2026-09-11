const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({ ROLE_OWNER: 1, ROLE_ADMIN: 2, getRoleType: jest.fn(async (c, uid) => (uid === 'owner1' ? 1 : 3)), isPrivileged: (r) => r === 1 || r === 2 }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Modules/Agents/scope', () => ({ visibleProjectIds: jest.fn(async (c, uid) => (uid === 'outsider' ? ['p9'] : ['p1'])) }));
jest.mock('../Modules/Agents/actor', () => {
    const isAgent = (a) => a && a.kind === 'agent';
    return {
        isAgent,
        resolveActor: jest.fn(async (req) => ({ kind: 'human', userId: req.uid })),
        attribution: (a) => (isAgent(a) ? { actorId: a.agentId, actorType: 'agent', agentId: a.agentId, viaAccount: a.viaAccount, label: a.agentName || 'Agent' } : { actorId: a.userId, actorType: 'human', label: '' }),
    };
});

const { SCHEMA_TYPE } = require('../Config/schemaType');

beforeAll(() => require('../Modules/AICore/persistence').useInMemory());
const audit = require('../Modules/Agents/agentAudit');
const undo = require('../Modules/Agents/undo');
const revert = require('../Modules/Agents/revert');
const auditCtrl = require('../Modules/Audit/controller');
const agentCtrl = require('../Modules/Agents/controller');

const C = '6f0000000000000000000c01';
const AGENT_ID = '6f0000000000000000000a01';
const TASK_ID = '6f0000000000000000000701';
const HOUR = 60 * 60 * 1000;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const rows = (type) => mockDb.store[type] || [];
const auditRows = (action) => rows(SCHEMA_TYPE.AUDIT_LOGS).filter((r) => r.action === action);
const res = () => { const r = { code: 200, body: null }; r.status = (c) => { r.code = c; return r; }; r.send = (b) => { r.body = b; return r; }; r.json = r.send; return r; };
const req = (id, uid, over = {}) => ({ headers: { companyid: C }, params: { id: String(id) }, query: {}, body: {}, uid, ip: '', ...over });

const seedRun = (over = {}) => mockDb.seed(SCHEMA_TYPE.AGENT_RUNS, {
    agentId: AGENT_ID, agentName: 'Reviewer', taskId: TASK_ID, projectId: 'p1', status: 'done', startedBy: 'u1',
    startedAt: new Date(Date.now() - 2 * HOUR), finishedAt: new Date(Date.now() - HOUR), ...over,
});
const agentActor = (run) => ({ kind: 'agent', userId: 'u1', agentId: AGENT_ID, agentName: 'Reviewer', runId: run ? String(run._id) : null, viaAccount: 'workspace', tokenId: null });
const seedStatusAction = async (run, { createdAt } = {}) => {
    const id = await audit.recordAction(C, agentActor(run), { action: 'task.status', reason: 'test', params: {}, entityType: 'task', entityId: TASK_ID, undo: { kind: 'status', taskId: TASK_ID, previous: { status: 'Open', statusType: 'open', statusKey: 'open' } } });
    const row = rows(SCHEMA_TYPE.AUDIT_LOGS).find((r) => String(r._id) === String(id));
    if (createdAt) row.createdAt = createdAt;
    return row;
};

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.calls.length = 0;
    jest.clearAllMocks();
    mockDb.seed(SCHEMA_TYPE.TASKS, { _id: TASK_ID, ProjectID: 'p1', status: 'Done', statusType: 'close', statusKey: 'done' });
});

describe('undo window', () => {
    it('refuses a single-row undo once the window has passed and says when it closed', async () => {
        const run = seedRun({ finishedAt: new Date(Date.now() - 25 * HOUR) });
        const row = await seedStatusAction(run, { createdAt: new Date(Date.now() - 26 * HOUR) });

        const out = await undo.undoAuditRow(C, row, { kind: 'human', userId: 'u1' }, '');
        expect(out.ok).toBe(false);
        expect(out.reason).toBe('undo_window_passed');
        expect(out.undoUntil).toBe(new Date(new Date(run.finishedAt).getTime() + 24 * HOUR).toISOString());
        expect(rows(SCHEMA_TYPE.TASKS)[0].statusType).toBe('close');
        expect(auditRows(audit.ACTION_UNDONE)).toHaveLength(0);
        expect(auditRows(audit.ACTION_REFUSED)).toHaveLength(1);
        expect(auditRows(audit.ACTION_REFUSED)[0].meta.reason).toBe('undo_window_passed');

        const r = res();
        await auditCtrl.undoAuditLog(req(row._id, 'u1'), r);
        expect(r.code).toBe(410);
        expect(r.body).toMatchObject({ status: false, reason: 'undo_window_passed', undoUntil: out.undoUntil });
        expect(typeof r.body.message).toBe('string');
    });

    it('anchors a row outside any run on the row itself', async () => {
        const stale = await seedStatusAction(null, { createdAt: new Date(Date.now() - 25 * HOUR) });
        const out = await undo.undoAuditRow(C, stale, { kind: 'human', userId: 'u1' }, '');
        expect(out).toMatchObject({ ok: false, reason: 'undo_window_passed', undoUntil: new Date(new Date(stale.createdAt).getTime() + 24 * HOUR).toISOString() });

        const fresh = await seedStatusAction(null);
        expect((await undo.undoAuditRow(C, fresh, { kind: 'human', userId: 'u1' }, '')).ok).toBe(true);
    });

    it('refuses whole-run revert after the window with the same reason and deadline', async () => {
        const run = seedRun({ finishedAt: new Date(Date.now() - 25 * HOUR) });
        await seedStatusAction(run);
        const out = await revert.revertRun(C, run._id, { actor: { kind: 'human', userId: 'owner1' }, isPrivileged: true, ip: '' });
        expect(out).toMatchObject({ status: 409, reason: 'undo_window_passed', undoUntil: expect.stringMatching(ISO) });

        const r = res();
        await agentCtrl.revertRun(req(run._id, 'owner1'), r);
        expect(r.code).toBe(409);
        expect(r.body).toMatchObject({ status: false, reason: 'undo_window_passed', undoUntil: out.undoUntil });
    });
});

describe('project visibility', () => {
    it('refuses undo by a member who cannot see the project, and revert likewise', async () => {
        const run = seedRun();
        const row = await seedStatusAction(run);
        const out = await undo.undoAuditRow(C, row, { kind: 'human', userId: 'outsider' }, '');
        expect(out).toMatchObject({ ok: false, reason: 'project_not_visible' });
        expect(rows(SCHEMA_TYPE.TASKS)[0].statusType).toBe('close');
        expect(auditRows(audit.ACTION_REFUSED).map((r) => r.meta.reason)).toEqual(['project_not_visible']);

        const r = res();
        await auditCtrl.undoAuditLog(req(row._id, 'outsider'), r);
        expect(r.code).toBe(403);
        expect(r.body).toMatchObject({ status: false, reason: 'project_not_visible' });

        const denied = await revert.revertRun(C, run._id, { actor: { kind: 'human', userId: 'outsider' }, isPrivileged: true, ip: '' });
        expect(denied).toMatchObject({ status: 403, reason: 'project_not_visible' });
        expect(rows(SCHEMA_TYPE.AGENT_RUNS)[0].revertedAt).toBeUndefined();
    });

    it('lets a member who can see the project undo inside the window', async () => {
        const run = seedRun();
        const row = await seedStatusAction(run);
        const r = res();
        await auditCtrl.undoAuditLog(req(row._id, 'u2'), r);
        expect(r.code).toBe(200);
        expect(r.body.status).toBe(true);
        expect(rows(SCHEMA_TYPE.TASKS)[0].statusType).toBe('open');
        expect(auditRows(audit.ACTION_UNDONE)).toHaveLength(1);
        expect(auditRows(audit.ACTION_REFUSED)).toHaveLength(0);
    });
});

describe('GET /agents/runs/:id exposes the deadline', () => {
    it('carries undoUntil, undoable and undoReason on the run and on each action row', async () => {
        const run = seedRun();
        const row = await seedStatusAction(run);
        const until = new Date(new Date(run.finishedAt).getTime() + 24 * HOUR).toISOString();

        const mine = res();
        await agentCtrl.getRun(req(run._id, 'u1'), mine);
        expect(mine.body.data.run).toMatchObject({ undoUntil: until, undoable: true, undoReason: '' });
        expect(mine.body.data.audit.find((a) => String(a._id) === String(row._id))).toMatchObject({ undoUntil: until, undoable: true, undoReason: '' });

        const other = res();
        await agentCtrl.getRun(req(run._id, 'u2'), other);
        expect(other.body.data.run).toMatchObject({ undoUntil: until, undoable: false, undoReason: 'not_permitted' });

        const hidden = res();
        await agentCtrl.getRun(req(run._id, 'outsider'), hidden);
        expect(hidden.body.data.run).toMatchObject({ undoable: false, undoReason: 'project_not_visible' });
        expect(hidden.body.data.audit[0]).toMatchObject({ undoable: false, undoReason: 'project_not_visible' });

        const closed = seedRun({ finishedAt: new Date(Date.now() - 25 * HOUR) });
        await seedStatusAction(closed);
        const late = res();
        await agentCtrl.getRun(req(closed._id, 'owner1'), late);
        expect(late.body.data.run).toMatchObject({ undoable: false, undoReason: 'undo_window_passed', undoUntil: expect.stringMatching(ISO) });
        expect(late.body.data.audit[0]).toMatchObject({ undoable: false, undoReason: 'undo_window_passed' });
    });
});
