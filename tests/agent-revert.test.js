const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({ ROLE_OWNER: 1, ROLE_ADMIN: 2, getRoleType: jest.fn(async (c, uid) => (uid === 'owner1' ? 1 : 3)), isPrivileged: (r) => r === 1 || r === 2 }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Modules/Agents/actor', () => {
    const isAgent = (a) => a && a.kind === 'agent';
    return {
        isAgent,
        resolveActor: jest.fn(async (req) => (req.agent ? { kind: 'agent', userId: req.uid, agentId: 'a1', viaAccount: 'workspace' } : { kind: 'human', userId: req.uid })),
        attribution: (a) => (isAgent(a) ? { actorId: a.agentId, actorType: 'agent', agentId: a.agentId, viaAccount: a.viaAccount, label: a.agentName || 'Agent' } : { actorId: a.userId, actorType: 'human', label: '' }),
    };
});

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { dbCollections } = require('../Config/collections');
const socketEmitter = require('../event/socketEventEmitter');
const audit = require('../Modules/Agents/agentAudit');
const revert = require('../Modules/Agents/revert');
const ctrl = require('../Modules/Agents/controller');

const C = '6f0000000000000000000c01';
const AGENT_ID = '6f0000000000000000000a01';
const TASK_ID = '6f0000000000000000000701';
const SUBTASK_ID = '6f0000000000000000000702';
const COMMENT_ID = '6f0000000000000000000801';
const PAGE_ID = '6f0000000000000000000901';
const HOUR = 60 * 60 * 1000;
const owner = { kind: 'human', userId: 'owner1' };
const starter = { kind: 'human', userId: 'u1' };
const other = { kind: 'human', userId: 'u2' };
const as = (actor, isPrivileged = false) => ({ actor, isPrivileged, ip: '' });

const rows = (type) => mockDb.store[type] || [];
const runRow = (id) => rows(SCHEMA_TYPE.AGENT_RUNS).find((r) => String(r._id) === String(id));
const auditRows = (action) => rows(SCHEMA_TYPE.AUDIT_LOGS).filter((r) => r.action === action);

const seedRun = (over = {}) => mockDb.seed(SCHEMA_TYPE.AGENT_RUNS, {
    agentId: AGENT_ID, agentName: 'Reviewer', taskId: TASK_ID, projectId: 'p1', status: 'done', startedBy: 'u1',
    startedAt: new Date(Date.now() - 2 * HOUR), finishedAt: new Date(Date.now() - HOUR), ...over,
});

const actorFor = (run) => ({ kind: 'agent', userId: 'u1', agentId: AGENT_ID, agentName: 'Reviewer', runId: String(run._id), viaAccount: 'workspace', tokenId: null });

/* Six actions with six different undo kinds, in the order the run made them. */
const seedActions = async (run, { kinds } = {}) => {
    const list = [
        { action: 'task.status', undo: { kind: 'status', taskId: TASK_ID, previous: { status: 'Open', statusType: 'open', statusKey: 'open' } } },
        { action: 'task.assign', undo: { kind: 'assign', taskId: TASK_ID, previous: ['p1'] } },
        { action: 'task.update', undo: { kind: 'update', taskId: TASK_ID, previous: { Task_Priority: 'low', tagsArray: null } } },
        { action: 'subtask.create', undo: { kind: 'subtask', subtaskId: SUBTASK_ID, parentTaskId: TASK_ID } },
        { action: 'task.comment', undo: { kind: 'comment', commentId: COMMENT_ID } },
        { action: 'page.create', undo: { kind: 'page', pageId: PAGE_ID } },
    ];
    const ids = [];
    for (const [i, a] of list.entries()) {
        const undo = kinds && kinds[i] ? { ...a.undo, kind: kinds[i] } : a.undo;
        // eslint-disable-next-line no-await-in-loop
        ids.push(await audit.recordAction(C, actorFor(run), { action: a.action, reason: 'test', params: {}, undo, entityType: 'task', entityId: TASK_ID }));
    }
    return ids;
};

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.calls.length = 0;
    jest.clearAllMocks();
    mockDb.seed(SCHEMA_TYPE.TASKS, { _id: TASK_ID, status: 'Done', statusType: 'close', statusKey: 'done', AssigneeUserId: ['p2'], Task_Priority: 'high', tagsArray: ['x'], subTasks: 1 });
    mockDb.seed(SCHEMA_TYPE.TASKS, { _id: SUBTASK_ID, ParentTaskID: TASK_ID, deletedStatusKey: 0 });
    mockDb.seed(SCHEMA_TYPE.COMMENTS, { _id: COMMENT_ID, isDeleted: false });
    mockDb.seed(SCHEMA_TYPE.PAGES, { _id: PAGE_ID, deletedStatusKey: 0 });
});

describe('whole-run revert', () => {
    it('reverts all six actions newest first, marks the run and writes one audit row', async () => {
        const run = seedRun();
        const ids = await seedActions(run);
        const out = await revert.revertRun(C, run._id, as(owner, true));
        expect(out).toMatchObject({ reverted: 6, alreadyUndone: 0, failed: [] });
        expect(out.windowEndsAt.getTime()).toBe(new Date(run.finishedAt).getTime() + 24 * HOUR);

        const task = rows(SCHEMA_TYPE.TASKS).find((t) => t._id === TASK_ID);
        expect(task).toMatchObject({ status: 'Open', statusType: 'open', statusKey: 'open', AssigneeUserId: ['p1'], Task_Priority: 'low', subTasks: 0 });
        expect(task.tagsArray).toBeUndefined();
        expect(rows(SCHEMA_TYPE.TASKS).find((t) => t._id === SUBTASK_ID).deletedStatusKey).toBe(1);
        expect(rows(SCHEMA_TYPE.COMMENTS)[0].isDeleted).toBe(true);
        expect(rows(SCHEMA_TYPE.PAGES)[0].deletedStatusKey).toBe(1);

        expect(auditRows(audit.ACTION_DONE).every((r) => r.meta.undoneAt && r.meta.undoneBy === 'owner1')).toBe(true);
        expect(auditRows(audit.ACTION_UNDONE).map((r) => r.meta.originalAuditId)).toEqual([...ids].reverse());
        const reverted = auditRows(audit.RUN_REVERTED);
        expect(reverted).toHaveLength(1);
        expect(reverted[0]).toMatchObject({ entityType: 'agent_run', entityId: String(run._id), actorId: 'owner1', meta: { reverted: 6, failed: [], agentId: AGENT_ID, runId: String(run._id) } });

        expect(runRow(run._id)).toMatchObject({ revertedAt: expect.any(Date), revertedBy: 'owner1', revert: { reverted: 6, failed: [] } });
        expect(socketEmitter.emit).toHaveBeenCalledWith('update', expect.objectContaining({ module: 'agent', data: expect.objectContaining({ kind: 'run', run: expect.objectContaining({ revertedBy: 'owner1' }) }) }));
    });

    it('is refused after the window, which the company setting sets', async () => {
        const closed = seedRun({ finishedAt: new Date(Date.now() - 25 * HOUR) });
        await seedActions(closed);
        const out = await revert.revertRun(C, closed._id, as(owner, true));
        expect(out.status).toBe(409);
        expect(out.error).toMatch(/^The revert window closed at .* \(24 h after the run finished\)\.$/);
        expect(auditRows(audit.ACTION_DONE).some((r) => r.meta.undoneAt)).toBe(false);
        expect(runRow(closed._id).revertedAt).toBeUndefined();

        mockDb.seed(dbCollections.COMPANIES, { _id: C, agentUndoHours: 48 });
        expect(await revert.revertRun(C, closed._id, as(owner, true))).toMatchObject({ reverted: 6 });

        mockDb.store[dbCollections.COMPANIES][0].agentUndoHours = 1;
        const recent = seedRun({ finishedAt: new Date(Date.now() - 2 * HOUR) });
        await seedActions(recent);
        expect((await revert.revertRun(C, recent._id, as(owner, true))).error).toMatch(/1 h after the run finished/);
    });

    it('is refused while the run is still open, already reverted, or made no changes', async () => {
        const running = seedRun({ status: 'running', finishedAt: null });
        await seedActions(running);
        expect(await revert.revertRun(C, running._id, as(owner, true))).toEqual({ error: 'Run is still running — stop it first.', status: 409 });
        const waiting = seedRun({ status: 'waiting_approval' });
        expect((await revert.revertRun(C, waiting._id, as(owner, true))).error).toBe('Run is still waiting_approval — stop it first.');

        const done = seedRun();
        await seedActions(done);
        expect((await revert.revertRun(C, done._id, as(owner, true))).reverted).toBe(6);
        expect(await revert.revertRun(C, done._id, as(owner, true))).toMatchObject({ status: 409, error: expect.stringMatching(/already reverted/) });

        const empty = seedRun();
        expect(await revert.revertRun(C, empty._id, as(owner, true))).toEqual({ error: 'This run made no reversible changes.', status: 409 });
        expect(await revert.revertRun(C, '6f00000000000000000000ff', as(owner, true))).toEqual({ error: 'Run not found.', status: 404 });
    });

    it('keeps going past a failed undo and reports each failure with its reason', async () => {
        const run = seedRun();
        const ids = await seedActions(run, { kinds: { 2: 'teleport' } });
        const base = mockDb.crud.getMockImplementation();
        mockDb.crud.mockImplementation(async (...a) => { if (a[1].type === SCHEMA_TYPE.COMMENTS) throw new Error('comments offline'); return base(...a); });
        const out = await revert.revertRun(C, run._id, as(owner, true));
        mockDb.crud.mockImplementation(base);
        expect(out.reverted).toBe(4);
        expect(out.failed).toEqual([
            { action: 'task.comment', auditId: ids[4], reason: 'comments offline' },
            { action: 'task.update', auditId: ids[2], reason: 'not undoable' },
        ]);
        expect(rows(SCHEMA_TYPE.PAGES)[0].deletedStatusKey).toBe(1);
        expect(rows(SCHEMA_TYPE.TASKS).find((t) => t._id === TASK_ID).status).toBe('Open');
        expect(auditRows(audit.ACTION_DONE).filter((r) => r.meta.undoneAt)).toHaveLength(4);
        expect(runRow(run._id).revert).toEqual({ reverted: 4, failed: out.failed });
        expect(auditRows(audit.RUN_REVERTED)[0].meta.failed).toHaveLength(2);
    });

    it('skips rows a person already undid one by one and counts them separately', async () => {
        const run = seedRun();
        const ids = await seedActions(run);
        await audit.markUndone(C, ids[5], 'someone');
        const out = await revert.revertRun(C, run._id, as(owner, true));
        expect(out).toMatchObject({ reverted: 5, alreadyUndone: 1, failed: [] });
        expect(rows(SCHEMA_TYPE.PAGES)[0].deletedStatusKey).toBe(0);
    });

    it('lets the starter revert but nobody else without owner/admin', async () => {
        const run = seedRun();
        await seedActions(run);
        expect(await revert.revertRun(C, run._id, as(other))).toEqual({ error: 'Only an Owner, an Admin or the person who started the run can revert it.', status: 403 });
        expect(runRow(run._id).revertedAt).toBeUndefined();
        expect((await revert.revertRun(C, run._id, as(starter))).reverted).toBe(6);
        expect(runRow(run._id).revertedBy).toBe('u1');
    });
});

describe('POST /agents/runs/:id/revert', () => {
    const res = () => { const r = { code: 200, body: null }; r.status = (c) => { r.code = c; return r; }; r.send = (b) => { r.body = b; return r; }; return r; };
    const req = (id, over = {}) => ({ headers: { companyid: C }, params: { id: String(id) }, query: {}, body: {}, uid: 'owner1', ip: '', ...over });

    it('maps the module result onto the response and its status code', async () => {
        const run = seedRun();
        await seedActions(run);
        const denied = res();
        await ctrl.revertRun(req(run._id, { uid: 'u2' }), denied);
        expect(denied.code).toBe(403);
        expect(denied.body.status).toBe(false);

        const ok = res();
        await ctrl.revertRun(req(run._id), ok);
        expect(ok.code).toBe(200);
        expect(ok.body).toMatchObject({ status: true, statusText: 'Run reverted.', data: { reverted: 6, failed: [] } });

        const again = res();
        await ctrl.revertRun(req(run._id), again);
        expect(again.code).toBe(409);
    });

    it('refuses agents and malformed ids', async () => {
        const run = seedRun();
        const r = res();
        await ctrl.revertRun(req(run._id, { agent: true }), r);
        expect(r.code).toBe(403);
        expect(r.body.statusText).toBe('Agents cannot revert runs.');
        const bad = res();
        await ctrl.revertRun(req('nope'), bad);
        expect(bad.body.statusText).toBe('companyId and a valid run id are required.');
    });
});
