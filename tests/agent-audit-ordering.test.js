const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({ ROLE_OWNER: 1, ROLE_ADMIN: 2, getRoleType: jest.fn(async () => 1), isPrivileged: (r) => r === 1 || r === 2 }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Modules/Tasks/helpers/completionStore', () => ({ forStatusChange: jest.fn(async () => null), recordWork: jest.fn(async () => null) }));
jest.mock('../Modules/Agents/engine/orchestrator', () => ({ gather: jest.fn(async () => ({ status: 'gathered', context: {} })), analyse: jest.fn() }));
jest.mock('../Modules/Agents/engine/findingMemory', () => ({ load: jest.fn(async () => new Map()), decide: jest.fn(), record: jest.fn(), touch: jest.fn() }));
jest.mock('../Modules/Agents/memory', () => ({
    DECLINE_REASON_TEXT: {},
    contextFor: jest.fn(async () => ''),
    recordEpisode: jest.fn(async () => null),
    preferenceCandidate: jest.fn(async () => null),
    rememberApprovedChanges: jest.fn(async () => null),
}));
jest.mock('../Modules/Agents/scope', () => ({ visibleProjectIds: jest.fn(async () => ['6a9954186dd786246031e47b']) }));
jest.mock('../Modules/AIProjectGenerator/usage', () => ({ summarize: jest.fn(() => ({ costUsd: 0.01, totalTokens: 100, model: 'm' })) }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const logger = require('../Config/loggerConfig');
const persistence = require('../Modules/Agents/engine/persistence');
const orchestrator = require('../Modules/Agents/engine/orchestrator');
const findingMemory = require('../Modules/Agents/engine/findingMemory');
const actions = require('../Modules/Agents/actions');
const proposals = require('../Modules/Agents/proposals');
const runs = require('../Modules/Agents/runs');
const revert = require('../Modules/Agents/revert');
const undo = require('../Modules/Agents/undo');

const CID = '6a8ee973d625fca52e519a12';
const TASK_ID = '6f0000000000000000000701';
const AGENT_ID = '6f0000000000000000000a01';
const RUN_ID = '6f0000000000000000000c01';
const PROJECT_ID = '6a9954186dd786246031e47b';

const agentActor = { kind: 'agent', userId: 'u1', agentId: AGENT_ID, agentName: 'Code Reviewer', runId: RUN_ID, viaAccount: 'workspace', tokenId: null };
const task = () => ({ _id: TASK_ID, CompanyId: CID, ProjectID: PROJECT_ID, TaskName: 'Fix the thing', TaskKey: 'AR-1', Task_Priority: 'LOW' });
const agent = (over = {}) => ({ _id: AGENT_ID, name: 'Code Reviewer', autonomy: 2, allowedActions: [], projectIds: [], account: 'workspace', spendCapUsd: 10, ...over });

const rows = (type) => mockDb.store[type] || [];
const auditRows = () => rows(SCHEMA_TYPE.AUDIT_LOGS);
const comments = () => rows(SCHEMA_TYPE.COMMENTS);
const runRow = (id) => rows(SCHEMA_TYPE.AGENT_RUNS).find((r) => String(r._id) === String(id));

const auditSaves = [];
const snapshotting = (real) => async (companyId, q, m) => {
    if (q.type === SCHEMA_TYPE.AUDIT_LOGS && m === 'save') auditSaves.push({ at: mockDb.calls.length, data: JSON.parse(JSON.stringify(q.data)) });
    return real(companyId, q, m);
};
const failAudit = (method) => {
    const real = mockDb.crud.getMockImplementation();
    mockDb.crud.mockImplementation(async (companyId, q, m) => {
        if (q.type === SCHEMA_TYPE.AUDIT_LOGS && m === method) throw new Error('audit store down');
        return real(companyId, q, m);
    });
};

let realCrud;
let mem;
beforeAll(() => { realCrud = snapshotting(mockDb.crud.getMockImplementation()); });
beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.calls.length = 0;
    auditSaves.length = 0;
    jest.clearAllMocks();
    mockDb.crud.mockImplementation(realCrud);
    mem = persistence.useInMemory();
    mockDb.seed(SCHEMA_TYPE.TASKS, task());
    mockDb.seed(SCHEMA_TYPE.AGENTS, agent());
});
afterEach(() => { mem.reset(); persistence.useMongo(); });

const comment = () => actions.perform({ companyId: CID, actor: agentActor, action: 'task.comment', params: { taskId: TASK_ID, body: 'Looks good' }, reason: 'qa-review finding' });

describe('the audit row is written before the action and gates it', () => {
    it('when the audit row cannot be written the action is not performed and the caller gets audit_unavailable', async () => {
        failAudit('save');

        await expect(comment()).rejects.toMatchObject({ name: 'AuditUnavailableError', reason: 'audit_unavailable', message: expect.stringContaining('audit_unavailable') });
        expect(comments()).toHaveLength(0);
        expect(auditRows()).toHaveLength(0);
    });

    it('a healthy write leaves one row that goes pending before the mutation and applied, with the undo descriptor, after it', async () => {
        const out = await comment();

        const commentSave = mockDb.calls.findIndex((c) => c.type === SCHEMA_TYPE.COMMENTS && c.method === 'save');
        expect(auditSaves).toHaveLength(1);
        expect(auditSaves[0].data.meta).toMatchObject({ state: 'pending', undo: null, undoable: false, action: 'task.comment' });
        expect(auditSaves[0].at).toBeLessThan(commentSave);

        expect(auditRows()).toHaveLength(1);
        expect(auditRows()[0]).toMatchObject({
            _id: out.auditId, action: 'agent.action', entityId: TASK_ID,
            meta: { state: 'applied', undoable: true, undo: { kind: 'comment', commentId: out.result.commentId, taskId: TASK_ID } },
        });
    });

    it('when the row cannot be marked applied the action is reported failed, logged loudly, and the pending row is not undoable', async () => {
        failAudit('updateOne');

        await expect(comment()).rejects.toMatchObject({ name: 'AuditUnmarkedError', reason: 'audit_unmarked', auditId: expect.any(String) });
        expect(comments()).toHaveLength(1);
        expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('audit_unmarked'));
        expect(auditRows()[0].meta).toMatchObject({ state: 'pending', undoable: false });
        expect(await undo.undoAuditRow(CID, auditRows()[0], { kind: 'human', userId: 'u1' }, '')).toMatchObject({ ok: false, reason: 'action_pending', message: expect.stringMatching(/never confirmed/) });
    });

    it('an executor that throws closes its row as failed so a revert does not treat it as a change', async () => {
        await expect(actions.perform({ companyId: CID, actor: agentActor, action: 'task.comment', params: { taskId: 'missing', body: 'x' } })).rejects.toBeTruthy();
        expect(auditRows()).toHaveLength(1);
        expect(auditRows()[0].meta).toMatchObject({ state: 'failed', undoable: false, failed: expect.any(String) });
    });

    it('an approved proposal reports the step failed with audit_unavailable and applies nothing', async () => {
        const created = await proposals.create(CID, {
            agent: agent(), taskId: TASK_ID, projectId: PROJECT_ID, runId: null, what: 'Comment', why: 'because',
            changes: [{ action: 'task.comment', label: 'Comment', reversible: true, params: { taskId: TASK_ID, body: 'hi' } }],
        });
        failAudit('save');

        const out = await proposals.approve(CID, created._id, { decider: { kind: 'human', userId: 'u9' }, isPrivileged: true, ip: '' });
        expect(out.error).toBeUndefined();
        expect(comments()).toHaveLength(0);
        expect(rows(SCHEMA_TYPE.AGENT_PROPOSALS)[0].auditIds).toEqual([]);
        expect(out.applied).toEqual([{ action: 'task.comment', ok: false, error: expect.stringContaining('audit_unavailable') }]);
    });
});

describe('a run whose act phase cannot audit', () => {
    const subtask = (title) => ({ action: 'subtask.create', label: `Subtask: ${title}`, reversible: true, params: { taskId: TASK_ID, title } });

    beforeEach(() => {
        findingMemory.load.mockResolvedValue(new Map());
        findingMemory.decide.mockImplementation(async (companyId, taskId, findings) => findings.map((f) => ({ finding: f, action: 'file', reason: 'new' })));
        orchestrator.analyse.mockResolvedValue({ status: 'success', skill: 'plan', changes: [subtask('One'), subtask('Two')], summary: 'planned', usage: { totalTokens: 100 }, model: 'm' });
    });

    it('reports the step failed, fails the run, mutates nothing, and leaves the revert path nothing undocumented', async () => {
        const a = agent();
        const run = await runs.create(CID, { agent: a, taskId: TASK_ID, projectId: PROJECT_ID, skill: 'plan', startedBy: 'u1' });
        failAudit('save');

        const out = await runs.executeSkill(CID, run, a, task(), { proposals, actions, actor: { ...agentActor, runId: String(run._id) } });
        expect(out).toMatchObject({ status: 'failed', error: expect.stringContaining('audit_unavailable') });

        const row = runRow(run._id);
        expect(row.status).toBe('failed');
        expect(row.actions).toHaveLength(1);
        expect(row.actions[0]).toMatchObject({ action: 'subtask.create', ok: false, auditId: null, error: expect.stringContaining('audit_unavailable') });
        expect(rows(SCHEMA_TYPE.TASKS).filter((t) => t.ParentTaskID)).toHaveLength(0);
        expect(auditRows()).toHaveLength(0);

        mockDb.crud.mockImplementation(realCrud);
        expect(await revert.revertRun(CID, run._id, { actor: { kind: 'human', userId: 'u1' }, isPrivileged: true, ip: '' })).toMatchObject({ status: 409, error: 'This run made no reversible changes.' });
    });
});
