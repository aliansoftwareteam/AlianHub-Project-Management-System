jest.setTimeout(30000);
const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (companyId, q, method) => mockDb.crud(companyId, q, method),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0, flushAll: () => {} } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../Modules/Agents/runs');
jest.mock('../Modules/Agents/proposals', () => ({}));
jest.mock('../Modules/Agents/actions', () => ({}));
jest.mock('../Modules/Workflows/store');
jest.mock('../Modules/Automations/engine/tools', () => ({ getTask: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const world = require('./fixtures/accessWorld');
const runs = require('../Modules/Agents/runs');
const tools = require('../Modules/Automations/engine/tools');
const { runAgent } = require('../Modules/Workflows/agentRun');

const { CID, OWNER, ADMIN, INSIDER, P_OPEN, L_OPEN, T_OPEN, T_SECRET, T_PRIVATE, T_PERSONAL, OPENS } = world;
const { seed, task } = world.create(mockDb);

const AGENT = '6f0000000000000000000e01';
const CONVERSATION = '6f0000000000000000000cd2';
const MISSING = '6f0000000000000000000fff';
const STARTERS = [['the owner', OWNER], ['an admin', ADMIN], ['the person whose personal list it is', INSIDER]];

const started = async (startedBy, taskId) => {
    runs.start.mockClear();
    const answer = await runAgent({ companyId: CID, workflowRunId: 'w1', stepId: 's1', agentId: AGENT, taskId, startedBy, depth: 0 }).then(() => 'started', (error) => error.message);
    return [runs.start.mock.calls.length === 1, String(answer).replace(taskId, '<task>')];
};

beforeEach(() => {
    jest.clearAllMocks();
    seed();
    mockDb.seed(SCHEMA_TYPE.TASKS, { _id: CONVERSATION, TaskName: 'Adam and Ian', mainChat: true, ProjectID: P_OPEN, sprintId: L_OPEN, AssigneeUserId: [ADMIN, INSIDER], deletedStatusKey: 0 });
    tools.getTask.mockImplementation(async (companyId, id) => task(id) || null);
    runs.getAgent.mockResolvedValue({ _id: AGENT, name: 'Helper', projectIds: [] });
    runs.canStart.mockResolvedValue({ ok: true });
    runs.skillSlugOf.mockReturnValue('triage');
    runs.TERMINAL = ['success'];
    runs.STATUS = { WAITING: 'waiting', FAILED: 'failed', STOPPED: 'stopped' };
    runs.start.mockResolvedValue({ run: { _id: 'r1', status: 'success' } });
});

describe('an agent step of a workflow', () => {
    it.each(STARTERS)('started by %s runs on a task they can open, and finds no other', async (who, uid) => {
        const missing = (await started(uid, MISSING))[1];
        for (const taskId of [T_OPEN, T_SECRET, T_PRIVATE, T_PERSONAL]) {
            expect([taskId, ...(await started(uid, taskId))]).toEqual(OPENS[uid].includes(taskId) ? [taskId, true, 'started'] : [taskId, false, missing]);
        }
    });

    it.each(STARTERS)('started by %s never runs on a conversation', async (who, uid) => {
        expect(await started(uid, CONVERSATION)).toEqual([false, (await started(uid, MISSING))[1]]);
    });
});
