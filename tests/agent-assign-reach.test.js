const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (companyId, q, method) => mockDb.crud(companyId, q, method),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0, flushAll: () => {} } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../Modules/AICore/llmProvider', () => ({ getProvider: jest.fn(), isAnyProviderConfigured: jest.fn(() => true) }));
jest.mock('../Modules/Agents/memory', () => ({ contextFor: jest.fn(async () => '') }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const world = require('./fixtures/accessWorld');
const actions = require('../Modules/Agents/actions');

const { CID, OWNER, INSIDER, OUTSIDER, T_OPEN, T_PRIVATE, settle } = world;
const { seed, rows } = world.create(mockDb);

const AGENT = '6f0000000000000000000f01';
const startedBy = (uid) => ({ kind: 'agent', userId: uid, agentId: AGENT, agentName: 'Writer', runId: '6f0000000000000000000f02', viaAccount: 'workspace', tokenId: null });
const assign = (uid, taskId, assigneeIds) => actions.perform({ companyId: CID, actor: startedBy(uid), action: 'task.assign', params: { taskId, assigneeIds }, reason: 'a run', allowedActions: ['task.assign'] })
    .then((out) => ({ done: true, result: out.result }), (error) => ({ done: false, reason: error.message }))
    .then(async (outcome) => { await settle(); return outcome; });
const assigneesOf = (taskId) => rows(SCHEMA_TYPE.TASKS).find((task) => String(task._id) === taskId).AssigneeUserId.map(String);

beforeEach(() => seed());

describe('who an agent gives a task to', () => {
    it('can be a member who opens the task\'s project', async () => {
        expect((await assign(INSIDER, T_OPEN, [OUTSIDER])).done).toBe(true);
        expect(assigneesOf(T_OPEN)).toEqual([INSIDER, OUTSIDER]);
        expect((await assign(INSIDER, T_PRIVATE, [OWNER])).done).toBe(true);
    });

    it('cannot be a member who does not open the task\'s project', async () => {
        const out = await assign(INSIDER, T_PRIVATE, [OUTSIDER]);
        expect(out).toMatchObject({ done: false, reason: expect.stringMatching(/cannot open this project/) });
        expect(assigneesOf(T_PRIVATE)).toEqual([INSIDER]);
    });
});
