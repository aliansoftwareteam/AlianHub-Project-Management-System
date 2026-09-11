const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({ getRoleType: jest.fn(async () => 'owner'), isPrivileged: (r) => r === 'owner' || r === 'admin' }));
jest.mock('../Modules/Agents/actor', () => ({ resolveActor: jest.fn(async (req) => ({ kind: 'human', userId: req.uid })), isAgent: (a) => a.kind === 'agent' }));
jest.mock('../Modules/Automations/engine/tools', () => ({ getTask: jest.fn() }));
jest.mock('../Modules/AICore/usage', () => ({ checkConfiguredModelPriced: () => ({ ok: true, reason: '' }), unpricedMessage: (m) => `No price on file for ${m}`, UNPRICED_MODEL: 'unpriced_model', summarize: jest.fn(() => ({ costUsd: 0, totalTokens: 0, model: 'm' })) }));
jest.mock('../Modules/Agents/budget', () => ({ check: jest.fn(async () => ({ ok: true })), alertIfCrossed: jest.fn(async () => {}), settings: jest.fn(), provider: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { agentRunsSchema } = require('../utils/mongo-handler/createSchema');
const tools = require('../Modules/Automations/engine/tools');
const runs = require('../Modules/Agents/runs');
const ctrl = require('../Modules/Agents/controller');

const C = '6f0000000000000000000c01';
const AGENT_ID = '6f0000000000000000000a01';
const TASK = { _id: '6f0000000000000000000701', TaskName: 'Review', TaskKey: 'AR-1', ProjectID: 'p1' };
const agent = (over = {}) => ({ _id: AGENT_ID, name: 'Reviewer', autonomy: 1, allowedActions: [], account: 'workspace', spendCapUsd: 10, paused: false, deletedStatusKey: 0, ...over });
const res = () => { const r = { code: 200, body: null }; r.status = (c) => { r.code = c; return r; }; r.send = (b) => { r.body = b; return r; }; return r; };
const req = (body, headers = {}) => ({ headers: { companyid: C, ...headers }, params: {}, query: {}, body, uid: 'u1' });
const flush = () => new Promise((resolve) => setImmediate(resolve));
const startRun = async (body, headers) => { const r = res(); await ctrl.startRun(req({ agentId: AGENT_ID, taskId: TASK._id, ...body }, headers), r); await flush(); return r; };
const runRows = () => mockDb.store[SCHEMA_TYPE.AGENT_RUNS] || [];

beforeAll(() => mockDb.uniqueFromSchema(SCHEMA_TYPE.AGENT_RUNS, agentRunsSchema));

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    jest.clearAllMocks();
    jest.spyOn(runs, 'executeSkill').mockResolvedValue({ status: 'done' });
    tools.getTask.mockResolvedValue(TASK);
    mockDb.seed(SCHEMA_TYPE.AGENTS, agent());
});

describe('agent_runs declares the indexes that make a start idempotent', () => {
    const indexes = agentRunsSchema.indexes();
    it('one open run per agent and task', () => {
        const [, options] = indexes.find(([fields]) => Object.keys(fields).join(',') === 'agentId,taskId,status');
        expect(options.unique).toBe(true);
        expect(options.partialFilterExpression).toEqual({ taskId: { $type: 'string' }, status: { $in: runs.OPEN } });
    });
    it('one run per idempotency key', () => {
        const [, options] = indexes.find(([fields]) => Object.keys(fields).join(',') === 'idempotencyKey');
        expect(options.unique).toBe(true);
        expect(options.partialFilterExpression).toEqual({ idempotencyKey: { $type: 'string' } });
    });
});

describe('defect 12: a run starts once', () => {
    it('two concurrent starts for the same agent and task yield one run', async () => {
        const opts = { agent: agent(), taskId: TASK._id, projectId: 'p1', skill: 'qa-review', trigger: 'manual', startedBy: 'u1' };
        const [a, b] = await Promise.all([runs.start(C, opts), runs.start(C, opts)]);
        expect(runRows()).toHaveLength(1);
        expect(String(a.run._id)).toBe(String(b.run._id));
        expect([a.deduplicated, b.deduplicated].sort()).toEqual([false, true]);
    });

    it('a finished run does not block the next start', async () => {
        mockDb.seed(SCHEMA_TYPE.AGENT_RUNS, { agentId: AGENT_ID, taskId: TASK._id, status: 'done', startedAt: new Date() });
        const out = await runs.start(C, { agent: agent(), taskId: TASK._id, projectId: 'p1', skill: 'qa-review', trigger: 'manual' });
        expect(out.deduplicated).toBe(false);
        expect(runRows()).toHaveLength(2);
    });

    it('a rule redelivered with the same automation run returns the existing run even after it finished', async () => {
        const opts = { agent: agent(), taskId: TASK._id, projectId: 'p1', skill: 'qa-review', trigger: 'rule', ref: 'auto1' };
        const first = await runs.start(C, opts);
        await runs.finish(C, first.run._id, { status: 'done' });
        const again = await runs.start(C, opts);
        expect(again.deduplicated).toBe(true);
        expect(String(again.run._id)).toBe(String(first.run._id));
        expect(first.run.idempotencyKey).toBe(`${AGENT_ID}:${TASK._id}:rule:auto1`);
    });

    it('scheduled starts share a key within a time bucket', () => {
        const opts = { agent: agent(), taskId: TASK._id, trigger: 'schedule' };
        const key = runs.idempotencyKeyFor({ ...opts, now: new Date('2026-09-11T10:20:00Z') });
        expect(key).toBe(runs.idempotencyKeyFor({ ...opts, now: new Date('2026-09-11T10:59:00Z') }));
        expect(key).not.toBe(runs.idempotencyKeyFor({ ...opts, now: new Date('2026-09-11T11:00:00Z') }));
    });

    it('a manual start without a reference has no derived key', () => {
        expect(runs.idempotencyKeyFor({ agent: agent(), taskId: TASK._id, trigger: 'manual' })).toBeNull();
    });
});

describe('POST /agents/runs', () => {
    it('honours a caller-supplied Idempotency-Key and executes once', async () => {
        const first = await startRun({}, { 'idempotency-key': 'click-1' });
        const second = await startRun({}, { 'idempotency-key': 'click-1' });
        expect(first.code).toBe(200);
        expect(first.body.data.deduplicated).toBe(false);
        expect(second.code).toBe(200);
        expect(second.body).toMatchObject({ status: true, data: { deduplicated: true, _id: first.body.data._id } });
        expect(runRows()).toHaveLength(1);
        expect(runs.executeSkill).toHaveBeenCalledTimes(1);
    });

    it('accepts the key in the body too', async () => {
        const first = await startRun({ idempotencyKey: 'body-1' });
        const second = await startRun({ idempotencyKey: 'body-1' });
        expect(second.body.data.deduplicated).toBe(true);
        expect(String(second.body.data._id)).toBe(String(first.body.data._id));
    });

    it('a double click without a key still starts one run', async () => {
        const [first, second] = await Promise.all([startRun(), startRun()]);
        expect([first.body.data.deduplicated, second.body.data.deduplicated].sort()).toEqual([false, true]);
        expect(runRows()).toHaveLength(1);
        expect(runs.executeSkill).toHaveBeenCalledTimes(1);
    });

    it('rejects a key that is not a short string', async () => {
        const r = await startRun({}, { 'idempotency-key': 'x'.repeat(201) });
        expect(r.code).toBe(400);
        expect(runRows()).toHaveLength(0);
    });
});
