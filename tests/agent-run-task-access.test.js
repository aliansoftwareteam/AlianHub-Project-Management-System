process.env.STORAGE_TYPE = 'server';

const mockStores = { a: require('./fixtures/fakeMongo').create(), b: require('./fixtures/fakeMongo').create() };
const mockState = { companyB: '', roles: {} };

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (companyId, ...rest) => (String(companyId) === mockState.companyB ? mockStores.b : mockStores.a).crud(companyId, ...rest),
}));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../Modules/Tasks/helpers/taskListProjects', () => require('./fixtures/taskListRules').taskListHeldEverywhere());
jest.mock('../Config/permissionGuard', () => ({
    getRoleType: jest.fn(async (companyId, uid) => {
        const roles = mockState.roles[String(companyId)] || {};
        return uid in roles ? roles[uid] : null;
    }),
    isPrivileged: (r) => r === 1 || r === 2,
    evaluatePermission: jest.fn(async () => 1),
    fineGrainedEnforced: () => false,
    isWritable: () => true,
    isReadable: () => true,
}));
jest.mock('../Modules/AICore/aiSwitch', () => ({ AI_OFF: 'ai_off', allowed: jest.fn(async () => true), assertAllowed: jest.fn(async () => {}), isAiOff: () => false }));
jest.mock('../Modules/AICore/usage', () => ({ checkConfiguredModelPriced: () => ({ ok: true, reason: '' }), summarize: jest.fn(() => ({ costUsd: 0, totalTokens: 0, model: 'm' })) }));
jest.mock('../Modules/AICore/llmProvider', () => ({ getProvider: jest.fn(() => { throw new Error('not configured'); }), isAnyProviderConfigured: jest.fn(() => false) }));
jest.mock('../Modules/notification/prepare-notification-data/controllerV2', () => ({ handleNotificationtFun: jest.fn(async () => ({ status: true })) }));
jest.mock('../Modules/Audit/recorder', () => ({ recordAudit: jest.fn(async () => null) }));

const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const llmProvider = require('../Modules/AICore/llmProvider');
const runs = require('../Modules/Agents/runs');
const ctrl = require('../Modules/Agents/controller');

const A = '6f0000000000000000000c01';
const B = '6f0000000000000000000c02';
const PRIVATE_PROJECT = '6f00000000000000000000a1';
const OPEN_PROJECT = '6f00000000000000000000a2';
const PROJECT_IN_B = '6f00000000000000000000b1';
const HIDDEN_SPRINT = '6f00000000000000000000e1';
const OWNER = '6f0000000000000000000d01';
const ADMIN = '6f0000000000000000000d02';
const ON_PROJECT = '6f0000000000000000000d03';
const OFF_PROJECT = '6f0000000000000000000d04';
const GUEST = '6f0000000000000000000d05';
const PRIVATE_TASK = '6f0000000000000000000701';
const SPRINT_TASK = '6f0000000000000000000702';
const OPEN_TASK = '6f0000000000000000000703';
const TASK_IN_B = '6f0000000000000000000704';
const AGENT = '6f0000000000000000000a01';
const AGENT_IN_B = '6f0000000000000000000a02';

const agent = (over) => ({ _id: AGENT, name: 'Reviewer', autonomy: 1, allowedActions: [], account: 'workspace', spendCapUsd: 10, paused: false, deletedStatusKey: 0, projectIds: [], skills: [{ key: 'qa-review', name: 'QA', enabled: true }], ...over });
const task = (over) => ({ CompanyId: A, TaskName: 'Review https://example.com', TaskKey: 'AR-1', AssigneeUserId: [], ...over });

const res = () => {
    const r = { code: 200, body: null };
    r.status = (c) => { r.code = c; return r; };
    r.send = (b) => { r.body = b; return r; };
    r.json = (b) => { r.body = b; return r; };
    return r;
};
const flush = () => new Promise((resolve) => setImmediate(resolve));
const runRows = (store = mockStores.a) => store.store[SCHEMA_TYPE.AGENT_RUNS] || [];

const start = async (uid, body, { companyId = A, agentActor } = {}) => {
    const r = res();
    await ctrl.startRun({ headers: { companyid: companyId }, uid, query: {}, params: {}, body: { agentId: AGENT, ...body }, ...(agentActor ? { agentActor } : {}) }, r);
    await flush();
    return r;
};

const expectNothingStarted = (r) => {
    expect(r.code).toBe(404);
    expect(r.body).toMatchObject({ status: false, statusText: 'Task not found.' });
    expect(runRows()).toHaveLength(0);
    expect(runRows(mockStores.b)).toHaveLength(0);
    expect(runs.executeSkill).not.toHaveBeenCalled();
    expect(llmProvider.getProvider).not.toHaveBeenCalled();
};

beforeAll(() => require('../Modules/AICore/persistence').useInMemory());

beforeEach(() => {
    Object.values(mockStores).forEach((db) => Object.keys(db.store).forEach((k) => { db.store[k].length = 0; }));
    jest.clearAllMocks();
    mockState.companyB = B;
    mockState.roles = {
        [A]: { [OWNER]: 1, [ADMIN]: 2, [ON_PROJECT]: 3, [OFF_PROJECT]: 3, [GUEST]: 0 },
        [B]: { [OWNER]: 1 },
    };
    jest.spyOn(runs, 'executeSkill').mockResolvedValue({ status: 'done' });
    const oid = (id) => new mongoose.Types.ObjectId(id);
    mockStores.a.seed(SCHEMA_TYPE.PROJECTS, { _id: oid(PRIVATE_PROJECT), isPrivateSpace: true, AssigneeUserId: [ON_PROJECT, GUEST] });
    mockStores.a.seed(SCHEMA_TYPE.PROJECTS, { _id: oid(OPEN_PROJECT), isPrivateSpace: false, AssigneeUserId: [] });
    mockStores.a.seed(SCHEMA_TYPE.SPRINTS, { _id: oid(HIDDEN_SPRINT), projectId: oid(OPEN_PROJECT), private: true, AssigneeUserId: [ON_PROJECT] });
    mockStores.a.seed(SCHEMA_TYPE.TASKS, task({ _id: PRIVATE_TASK, ProjectID: PRIVATE_PROJECT }));
    mockStores.a.seed(SCHEMA_TYPE.TASKS, task({ _id: SPRINT_TASK, ProjectID: OPEN_PROJECT, sprintId: HIDDEN_SPRINT }));
    mockStores.a.seed(SCHEMA_TYPE.TASKS, task({ _id: OPEN_TASK, ProjectID: OPEN_PROJECT }));
    mockStores.a.seed(SCHEMA_TYPE.AGENTS, agent());
    mockStores.b.seed(SCHEMA_TYPE.PROJECTS, { _id: oid(PROJECT_IN_B), isPrivateSpace: true, AssigneeUserId: [] });
    mockStores.b.seed(SCHEMA_TYPE.TASKS, task({ _id: TASK_IN_B, CompanyId: B, ProjectID: PROJECT_IN_B }));
    mockStores.b.seed(SCHEMA_TYPE.AGENTS, agent({ _id: AGENT_IN_B }));
});

afterEach(() => runs.executeSkill.mockRestore());

describe('a run a person starts needs access to its task', () => {
    it.each([
        ['a manual run', { trigger: 'manual' }],
        ['a run with no trigger', {}],
        ['a run with a trigger the server does not know', { trigger: 'from-a-script' }],
    ])('refuses %s on a task the member cannot open, and starts nothing', async (label, body) => {
        expectNothingStarted(await start(OFF_PROJECT, { taskId: PRIVATE_TASK, ...body }));
    });

    it('refuses a member on the project a task in a private sprint they are not on', async () => {
        expectNothingStarted(await start(OFF_PROJECT, { taskId: SPRINT_TASK, trigger: 'manual' }));
    });

    it('refuses a guest, as it does for mention and assignment runs', async () => {
        expectNothingStarted(await start(GUEST, { taskId: PRIVATE_TASK, trigger: 'manual' }));
    });

    it('answers a task the member cannot open exactly as a task that does not exist', async () => {
        const hidden = await start(OFF_PROJECT, { taskId: PRIVATE_TASK });
        const missing = await start(OFF_PROJECT, { taskId: '6f0000000000000000000799' });
        expect(hidden.code).toBe(missing.code);
        expect(hidden.body).toEqual(missing.body);
    });

    it.each([
        ['on a private project they are on', ON_PROJECT, PRIVATE_TASK],
        ['in a private sprint they are on', ON_PROJECT, SPRINT_TASK],
        ['on an open project', OFF_PROJECT, OPEN_TASK],
    ])('starts a manual run for a member who can open the task %s', async (label, uid, taskId) => {
        const r = await start(uid, { taskId, trigger: 'manual' });
        expect(r.body.status).toBe(true);
        expect(runRows()).toHaveLength(1);
        expect(runRows()[0]).toMatchObject({ agentId: AGENT, taskId, trigger: 'manual', startedBy: uid });
        expect(runs.executeSkill).toHaveBeenCalledTimes(1);
    });

    it.each([['an owner', OWNER], ['an admin', ADMIN]])('lets %s run on a private project and a private sprint they are not on', async (label, uid) => {
        expect((await start(uid, { taskId: PRIVATE_TASK })).body.status).toBe(true);
        expect((await start(uid, { taskId: SPRINT_TASK, trigger: 'manual' })).body.status).toBe(true);
        expect(runRows()).toHaveLength(2);
    });
});

describe('company scoping', () => {
    it('does not start a run on another company\'s task through this company', async () => {
        expectNothingStarted(await start(OWNER, { taskId: TASK_IN_B, trigger: 'manual' }));
    });

    it('refuses a person with no role in the company whose task it is', async () => {
        expectNothingStarted(await start(ON_PROJECT, { agentId: AGENT_IN_B, taskId: TASK_IN_B, trigger: 'manual' }, { companyId: B }));
    });

    it('starts the run in the task\'s own company for someone who can open it there', async () => {
        const r = await start(OWNER, { agentId: AGENT_IN_B, taskId: TASK_IN_B, trigger: 'manual' }, { companyId: B });
        expect(r.body.status).toBe(true);
        expect(runRows(mockStores.b)).toHaveLength(1);
        expect(runRows()).toHaveLength(0);
    });
});

describe('agent-token callers', () => {
    const agentOf = (userId) => ({ kind: 'agent', userId, agentId: AGENT, agentName: 'Reviewer', runId: null, viaAccount: 'workspace', tokenId: null });

    it.each([
        ['on a private project the person is not on', OFF_PROJECT, PRIVATE_TASK],
        ['in a private sprint the person is not on', OFF_PROJECT, SPRINT_TASK],
        ['for a guest', GUEST, PRIVATE_TASK],
    ])('start nothing %s', async (label, uid, taskId) => {
        expectNothingStarted(await start(uid, { taskId, trigger: 'manual' }, { agentActor: agentOf(uid) }));
    });

    it('start a run on a task the person behind the token can open', async () => {
        const r = await start(ON_PROJECT, { taskId: PRIVATE_TASK, trigger: 'manual' }, { agentActor: agentOf(ON_PROJECT) });
        expect(r.body.status).toBe(true);
        expect(runRows()).toHaveLength(1);
        expect(runRows()[0]).toMatchObject({ taskId: PRIVATE_TASK, startedBy: ON_PROJECT });
    });
});
