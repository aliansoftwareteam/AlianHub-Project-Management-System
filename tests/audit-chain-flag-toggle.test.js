const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({ ROLE_OWNER: 1, ROLE_ADMIN: 2, getRoleType: jest.fn(async (c, uid) => (uid === 'owner1' ? 1 : 3)), isPrivileged: (r) => r === 1 || r === 2 }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Modules/Agents/scope', () => ({ visibleProjectIds: jest.fn(async () => ['p1']) }));
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
const idempotency = require('../Modules/Workflows/idempotency');

/* Sprint 8 slice 5: a company whose audit rows were chained keeps reading their appended changes after
 * AUDIT_CHAIN is turned off, so undo, revert and workflow idempotency see the state those changes record. */

const C = '6f0000000000000000000c07';
const AGENT_ID = '6f0000000000000000000a01';
const TASK_ID = '6f0000000000000000000701';
const COMMENT_ID = '6f0000000000000000000801';
const KEY = 'toggle-test-audit-chain-key-0123456789';
const HOUR = 60 * 60 * 1000;
const owner = { kind: 'human', userId: 'owner1' };
const ctx = { undoHours: 24, visibleProjectIds: ['p1'], run: null };

const rows = (type) => mockDb.store[type] || [];
const runRow = (id) => rows(SCHEMA_TYPE.AGENT_RUNS).find((r) => String(r._id) === String(id));
const chainOn = () => { process.env.AUDIT_CHAIN = 'true'; process.env.AUDIT_CHAIN_KEY = KEY; };
const chainOff = ({ keepKey = true } = {}) => {
    process.env.AUDIT_CHAIN = 'false';
    if (keepKey) process.env.AUDIT_CHAIN_KEY = KEY; else delete process.env.AUDIT_CHAIN_KEY;
};

const seedRun = () => mockDb.seed(SCHEMA_TYPE.AGENT_RUNS, {
    agentId: AGENT_ID, agentName: 'Reviewer', taskId: TASK_ID, projectId: 'p1', status: 'done', startedBy: 'owner1',
    startedAt: new Date(Date.now() - 2 * HOUR), finishedAt: new Date(Date.now() - HOUR),
});
const agentActor = (run) => ({ kind: 'agent', userId: 'owner1', agentId: AGENT_ID, agentName: 'Reviewer', runId: run ? String(run._id) : null, viaAccount: 'workspace' });
const commentAction = (run) => audit.recordAction(C, agentActor(run), {
    action: 'task.comment', reason: 'test', params: { taskId: TASK_ID, projectId: 'p1' }, undo: { kind: 'comment', commentId: COMMENT_ID, taskId: TASK_ID }, entityType: 'task', entityId: TASK_ID,
});

beforeAll(() => {
    const schemas = require('../utils/mongo-handler/createSchema');
    mockDb.uniqueFromSchema(SCHEMA_TYPE.AUDIT_LOGS, schemas.auditLogsSchema);
    mockDb.unique(SCHEMA_TYPE.AUDIT_CHAIN_HEADS, ['_id']);
});

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.calls.length = 0;
    jest.clearAllMocks();
    mockDb.seed(SCHEMA_TYPE.TASKS, { _id: TASK_ID, ProjectID: 'p1' });
    mockDb.seed(SCHEMA_TYPE.COMMENTS, { _id: COMMENT_ID, isDeleted: false });
});

afterEach(async () => {
    await require('../Modules/Audit/chain').flushMirrors();
});

afterAll(() => {
    delete process.env.AUDIT_CHAIN;
    delete process.env.AUDIT_CHAIN_KEY;
});

describe('after AUDIT_CHAIN is turned off', () => {
    it.each([['with the key kept', true], ['with the key removed', false]])('an action undone under the chain stays undone, %s', async (label, keepKey) => {
        chainOn();
        const run = seedRun();
        const [undone, kept] = [await commentAction(run), await commentAction(run)];
        const first = await undo.undoAuditRow(C, await audit.findById(C, undone), owner, '', ctx);
        expect(first.ok).toBe(true);

        chainOff({ keepKey });
        const row = await audit.findById(C, undone);
        expect(row.meta).toMatchObject({ state: 'applied', undoneBy: 'owner1' });
        expect(row.meta.undoneAt).toBeTruthy();
        expect(await undo.undoAuditRow(C, row, owner, '', ctx)).toMatchObject({ ok: false, reason: 'already_undone' });

        const out = await revert.revertRun(C, run._id, { actor: owner, isPrivileged: true, ip: '' });
        if (keepKey) {
            expect(out).toMatchObject({ reverted: 1, alreadyUndone: 1, failed: [] });
            expect((await audit.findById(C, kept)).meta.undoneAt).toBeTruthy();
            expect(runRow(run._id).revertedAt).toBeInstanceOf(Date);
        } else {
            expect(out).toMatchObject({ reverted: 0, alreadyUndone: 1, failed: [expect.objectContaining({ auditId: kept })] });
            expect((await audit.findById(C, kept)).meta.undoneAt).toBeNull();
            expect(runRow(run._id).revertedAt).toBeUndefined();
        }
    });

    it('a workflow step applied under the chain is not run again', async () => {
        chainOn();
        const actor = agentActor(null);
        const entry = { action: 'task.comment', reason: 'wf', params: { taskId: TASK_ID }, entityId: TASK_ID };
        const step = jest.fn(async () => 'done');
        const key = idempotency.keyFor({ runId: 'run1', stepId: 'step1', action: 'task.comment' });
        expect(await idempotency.once(C, { key, actor, entry }, step)).toMatchObject({ replayed: false });

        chainOff();
        expect(await idempotency.once(C, { key, actor, entry }, step)).toMatchObject({ replayed: true });
        expect(step).toHaveBeenCalledTimes(1);
    });

    it('a row written before the chain and undone under it cannot be undone twice', async () => {
        chainOff();
        const id = await commentAction(null);
        expect(rows(SCHEMA_TYPE.AUDIT_LOGS)[0].chain).toBeUndefined();

        chainOn();
        expect((await undo.undoAuditRow(C, await audit.findById(C, id), owner, '', ctx)).ok).toBe(true);

        chainOff();
        expect(await undo.undoAuditRow(C, await audit.findById(C, id), owner, '', ctx)).toMatchObject({ ok: false, reason: 'already_undone' });
    });
});

describe('reverting a run', () => {
    it('does not mark the run reverted when an action could not be undone', async () => {
        chainOff();
        const run = seedRun();
        await commentAction(run);
        await commentAction(run);
        const real = mockDb.crud.getMockImplementation();
        mockDb.crud.mockImplementation(async (companyId, query, method) => {
            if (query.type === SCHEMA_TYPE.COMMENTS) throw new Error('comments offline');
            return real(companyId, query, method);
        });
        let out;
        try {
            out = await revert.revertRun(C, run._id, { actor: owner, isPrivileged: true, ip: '' });
        } finally {
            mockDb.crud.mockImplementation(real);
        }
        expect(out).toMatchObject({ reverted: 0, failed: [expect.objectContaining({ reason: 'comments offline' }), expect.objectContaining({ reason: 'comments offline' })] });
        expect(runRow(run._id).revertedAt).toBeUndefined();
        expect(runRow(run._id).revert).toEqual({ reverted: 0, failed: out.failed });

        const retried = await revert.revertRun(C, run._id, { actor: owner, isPrivileged: true, ip: '' });
        expect(retried).toMatchObject({ reverted: 2, failed: [] });
        expect(runRow(run._id).revertedAt).toBeInstanceOf(Date);
    });
});
