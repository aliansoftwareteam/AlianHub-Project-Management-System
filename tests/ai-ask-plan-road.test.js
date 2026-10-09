/* Task 047, AI-2 and AI-3 (the Ask box): a sentence planned with the server's model goes down the road a connected agent's
   change takes. It is filed for the person and never performed, and approval runs it on the approver's own rights. */
process.env.STORAGE_TYPE = 'server';
const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (companyId, q, method) => mockDb.crud(companyId, q, method),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0, flushAll: () => {} } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
const mockStub = () => new Proxy({}, {
    get: (target, name) => {
        if (name === 'then' || name === '__esModule') return undefined;
        target[name] = target[name] || jest.fn(() => Promise.resolve({}));
        return target[name];
    },
});
jest.mock('../Modules/Tasks/helpers/handleNotification', () => mockStub());
jest.mock('../Modules/notification/prepare-notification-data/controllerV2', () => mockStub());
jest.mock('../Modules/Company/eventController', () => mockStub());
jest.mock('../Modules/Company/controller/updateCompany', () => mockStub());
jest.mock('../Modules/notification-count/controller', () => mockStub());
jest.mock('../Modules/Comments/controller', () => mockStub());
jest.mock('../Modules/MainChats/controller', () => mockStub());
jest.mock('../Modules/LogTime/controllerV2.js', () => mockStub());
jest.mock('../Modules/CustomField/aiFields/controller', () => mockStub());
jest.mock('../utils/planHelper', () => ({ getCachedCompanyData: jest.fn(async () => ({ data: {} })) }));
jest.mock('../utils/commonFunctions.js', () => mockStub());
jest.mock('../common-storage/common-server.js', () => mockStub());
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../Modules/Tasks/helpers/completionStore', () => ({ recordWork: jest.fn(async () => null), forStatusChange: jest.fn(async () => null) }));
jest.mock('../Modules/Agents/engine/graph', () => ({ resumeGraph: jest.fn(async () => ({ resumed: false })) }));
jest.mock('../Modules/AICore/persistence', () => {
    const deleteThread = jest.fn(async () => {});
    return { deleteThread, saverFor: jest.fn(() => ({ deleteThread })), storeFor: jest.fn(() => { throw new Error('no store in this suite'); }), ready: jest.fn(async () => {}) };
});
jest.mock('../Config/jwt', () => ({ verifyCompanyMembership: jest.fn(async () => true) }));
jest.mock('../Modules/ApiTokens/controller', () => ({ verifyToken: jest.fn(), logTokenActivity: jest.fn() }));

const mockChat = jest.fn();
jest.mock('../Modules/AICore/llmProvider', () => ({ isAnyProviderConfigured: () => true, getProvider: () => ({ chat: (...a) => mockChat(...a) }) }));
jest.mock('../Modules/AICore/usage', () => ({ ...jest.requireActual('../Modules/AICore/usage'), checkConfiguredModelPriced: () => ({ ok: true }) }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const world = require('./fixtures/mcpWorkWorld');
const actions = require('../Modules/Agents/actions');
const proposals = require('../Modules/Agents/proposals');
const memory = require('../Modules/Agents/memory');
const askPlan = require('../Modules/AI/askPlan');

const { CID, OWNER, INSIDER, OUTSIDER, GUEST, P_OPEN, P_PRIVATE, FLAGS, settle } = world;
const { seed, rows, setRule } = world.create(mockDb);

const fields = () => rows(SCHEMA_TYPE.CUSTOM_FIELDS);
const waiting = () => rows(SCHEMA_TYPE.AGENT_PROPOSALS).filter((row) => row.status === 'pending');
const human = (userId) => ({ kind: 'human', userId });
const approve = (id, uid = OWNER) => proposals.approve(CID, id, { decider: human(uid), isPrivileged: uid === OWNER, ip: '' });
const req = (uid) => ({ headers: { companyid: CID }, uid, ip: '1.1.1.1' });
const plan = (uid, steps, over = {}) => {
    mockChat.mockResolvedValue({ content: JSON.stringify({ summary: 'Track the commercial side', steps, cannot: [], ...over }), totalTokens: 100, model: 'claude-sonnet-5-5' });
    return askPlan.planSentence(req(uid), { sentence: 'Add a Budget field' });
};
const BUDGET = { tool: 'fields.create', arguments: { projectId: P_OPEN, fields: [{ name: 'Budget', type: 'money' }] } };

beforeEach(() => {
    seed();
    const parent = rows(SCHEMA_TYPE.RULES).find((rule) => rule.isParent && rule.key === 'project');
    mockDb.seed(SCHEMA_TYPE.RULES, { key: 'project_custom_field', name: 'project_custom_field', isParent: false, parentId: String(parent._id), roles: [{ key: 3, permission: true }, { key: 0, permission: false }] });
    setRule('task_custom_field', false, [0]);
    const task = mockDb.seed(SCHEMA_TYPE.RULES, { key: 'task', name: 'Task', isParent: true, roles: [] });
    mockDb.seed(SCHEMA_TYPE.RULES, { key: 'task_create', name: 'task_create', isParent: false, parentId: String(task._id), roles: [{ key: 3, permission: true }, { key: 0, permission: false }] });
    jest.spyOn(memory, 'rememberApprovedChanges').mockResolvedValue([]);
});
afterEach(async () => { await settle(); jest.restoreAllMocks(); mockChat.mockReset(); });
afterAll(() => { FLAGS.forEach((flag) => { delete process.env[flag]; }); });

describe('a planned sentence waits for a person', () => {
    it('files the field as one Ask proposal and makes nothing', async () => {
        const perform = jest.spyOn(actions, 'perform');
        const out = await plan(INSIDER, [BUDGET]);

        expect(out.data).toMatchObject({ planned: true, summary: 'Track the commercial side', cannot: [] });
        expect(out.data.changes).toHaveLength(1);
        expect(fields()).toHaveLength(0);
        expect(perform).not.toHaveBeenCalled();
        expect(waiting()).toHaveLength(1);
        expect(waiting()[0]).toMatchObject({ source: 'ask', requestedBy: INSIDER, projectId: P_OPEN, agentName: 'Ask' });
        expect(String(waiting()[0]._id)).toBe(out.data.proposalId);
        expect(waiting()[0].changes[0]).toMatchObject({ action: 'fields.create', params: { projectId: P_OPEN, definitions: [{ name: 'Budget', type: 'money' }] } });
    });

    it('holds a task create too, though the project would let an agent make it at once', async () => {
        const perform = jest.spyOn(actions, 'perform');
        const out = await plan(INSIDER, [{ tool: 'task.create', arguments: { projectId: P_OPEN, title: 'Fix the login bug' } }]);

        expect(out.data.planned).toBe(true);
        expect(perform).not.toHaveBeenCalled();
        expect(waiting()).toHaveLength(1);
        expect(rows(SCHEMA_TYPE.TASKS).some((task) => task.TaskName === 'Fix the login bug')).toBe(false);
    });

    it('runs on approval as the approver\'s own rights, and the field is made then', async () => {
        const { data } = await plan(INSIDER, [BUDGET]);

        const approved = await approve(data.proposalId, OWNER);

        expect(approved.error).toBeUndefined();
        expect(approved.applied).toEqual([expect.objectContaining({ action: 'fields.create', ok: true })]);
        expect(fields().map((field) => field.fieldTitle)).toEqual(['Budget']);
    });

    it('is refused at approval for a decider who could not make the field by hand', async () => {
        const { data } = await plan(INSIDER, [BUDGET]);
        setRule('project_custom_field', false, [3, 0]);
        setRule('task_custom_field', false, [3, 0]);

        const refused = await approve(data.proposalId, OUTSIDER);

        expect(refused.error).toBeTruthy();
        expect(fields()).toHaveLength(0);
    });
});

describe('the Ask box asks no more than the person could', () => {
    it('files nothing for a person the field form refuses, and says which step', async () => {
        setRule('project_custom_field', false, [3, 0]);
        setRule('task_custom_field', false, [3, 0]);
        for (const uid of [OUTSIDER, GUEST]) {
            const out = await plan(uid, [BUDGET]);
            expect(out.data).toMatchObject({ planned: false, code: 'nothing_planned' });
            expect(out.data.cannot[0]).toMatchObject({ text: 'Add custom fields', reason: expect.stringMatching(/permission_denied: project\.project_custom_field/) });
        }
        expect(waiting()).toHaveLength(0);
        expect(fields()).toHaveLength(0);
    });

    it('answers a project the person cannot open as a project that does not exist', async () => {
        const out = await plan(OUTSIDER, [{ ...BUDGET, arguments: { ...BUDGET.arguments, projectId: P_PRIVATE } }]);
        expect(out.data.planned).toBe(false);
        expect(out.data.cannot[0].reason).toMatch(/not_visible/);
        expect(waiting()).toHaveLength(0);
    });

    it('never names a project the person cannot open to the model', async () => {
        await plan(OUTSIDER, []);
        const prompt = mockChat.mock.calls[0][0].messages[0].content;
        expect(prompt).toContain(P_OPEN);
        expect(prompt).not.toContain(P_PRIVATE);
    });

    it('refuses a tool the Ask box does not plan with', async () => {
        const out = await plan(OWNER, [{ tool: 'task.archive', arguments: { taskId: 'x' } }]);
        expect(out.data.planned).toBe(false);
        expect(waiting()).toHaveLength(0);
    });
});
