const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, getTtl: () => 0 } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Modules/Tasks/helpers/completionStore', () => ({
    forStatusChange: jest.fn(async () => null),
    recordWork: jest.fn(async () => null),
}));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const registry = require('../Modules/Agents/registry');
const actions = require('../Modules/Agents/actions');

const CID = '6a8ee973d625fca52e519a12';
const PROJECT_ID = '6a9954186dd786246031e47b';
const TASK_ID = '6f0000000000000000000701';
const AGENT_ID = '6f0000000000000000000a01';
const OWNER = '6f0000000000000000000001';
const MEMBER = '6f0000000000000000000002';
const MEMBER_ROLE = 3;

const actorFor = (userId) => ({ kind: 'agent', userId, agentId: AGENT_ID, agentName: 'Reviewer', runId: null, viaAccount: 'workspace' });

const seedRules = (type, grants, { projectId } = {}) => {
    const parent = mockDb.seed(type, { key: 'task', name: 'Task', isParent: true, ...(projectId ? { projectId } : {}) });
    Object.entries(grants).forEach(([key, permission]) => mockDb.seed(type, {
        key, name: key, isParent: false, parentId: parent._id, roles: [{ key: MEMBER_ROLE, permission }], ...(projectId ? { projectId } : {}),
    }));
};

const auditRows = () => mockDb.store[SCHEMA_TYPE.AUDIT_LOGS] || [];
const priorityUpdate = (userId) => actions.perform({ companyId: CID, actor: actorFor(userId), action: 'task.update', params: { taskId: TASK_ID, fields: { Task_Priority: 'HIGH' } } });

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    jest.clearAllMocks();
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: OWNER, roleType: 1 });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: MEMBER, roleType: MEMBER_ROLE });
    mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: PROJECT_ID, CompanyId: CID, isGlobalPermission: true });
    mockDb.seed(SCHEMA_TYPE.TASKS, { _id: TASK_ID, CompanyId: CID, ProjectID: PROJECT_ID, TaskName: 'Fix the thing', TaskKey: 'AR-1', Task_Priority: 'LOW' });
});

describe('perform() evaluates the permission catalogue of the person behind the agent', () => {
    it('refuses a member whose role holds the permission read-only, audits it, and writes nothing', async () => {
        seedRules(SCHEMA_TYPE.RULES, { task_priority: false, task_comment: true });

        await expect(priorityUpdate(MEMBER)).rejects.toMatchObject({ name: 'RefusedError', status: 403, message: expect.stringMatching(/permission_denied.*task\.task_priority/) });

        expect(mockDb.store[SCHEMA_TYPE.TASKS][0].Task_Priority).toBe('LOW');
        expect(auditRows()).toHaveLength(1);
        expect(auditRows()[0]).toMatchObject({ action: 'agent.action_refused', meta: { action: 'task.update', reason: expect.stringMatching(/task\.task_priority/), ran: false } });
    });

    it('lets the same action through for a member whose role grants it', async () => {
        seedRules(SCHEMA_TYPE.RULES, { task_priority: true });

        const out = await priorityUpdate(MEMBER);

        expect(out.auditId).toBeTruthy();
        expect(mockDb.store[SCHEMA_TYPE.TASKS][0].Task_Priority).toBe('HIGH');
        expect(auditRows().map((r) => r.action)).toEqual(['agent.action']);
    });

    it('lets an owner through without a catalogue row', async () => {
        const out = await priorityUpdate(OWNER);
        expect(out.auditId).toBeTruthy();
        expect(mockDb.store[SCHEMA_TYPE.TASKS][0].Task_Priority).toBe('HIGH');
    });

    it('refuses when no permission is granted at all (missing row), naming the permission', async () => {
        seedRules(SCHEMA_TYPE.RULES, { task_comment: true });
        await expect(priorityUpdate(MEMBER)).rejects.toMatchObject({ name: 'RefusedError', message: expect.stringMatching(/permission_denied: task\.task_priority/) });
    });

    it('checks every field of a task.update against its own catalogue entry', async () => {
        seedRules(SCHEMA_TYPE.RULES, { task_priority: true, task_due_date: false });
        await expect(actions.perform({ companyId: CID, actor: actorFor(MEMBER), action: 'task.update', params: { taskId: TASK_ID, fields: { Task_Priority: 'HIGH', DueDate: '2026-10-01' } } }))
            .rejects.toMatchObject({ name: 'RefusedError', message: expect.stringMatching(/permission_denied: task\.task_due_date/) });
        expect(mockDb.store[SCHEMA_TYPE.TASKS][0].Task_Priority).toBe('LOW');
    });

    it('uses the project\'s own rules when the project opted out of the global ones', async () => {
        seedRules(SCHEMA_TYPE.RULES, { task_priority: true });
        mockDb.store[SCHEMA_TYPE.PROJECTS][0].isGlobalPermission = false;
        seedRules(SCHEMA_TYPE.PROJECT_RULES, { task_priority: false }, { projectId: PROJECT_ID });

        await expect(priorityUpdate(MEMBER)).rejects.toMatchObject({ name: 'RefusedError', message: expect.stringMatching(/permission_denied: task\.task_priority/) });
        expect(mockDb.store[SCHEMA_TYPE.TASKS][0].Task_Priority).toBe('LOW');
    });

    it('refuses an agent with no person behind it', async () => {
        seedRules(SCHEMA_TYPE.RULES, { task_priority: true });
        await expect(priorityUpdate('')).rejects.toMatchObject({ name: 'RefusedError', message: expect.stringMatching(/permission_denied/) });
        expect(mockDb.store[SCHEMA_TYPE.TASKS][0].Task_Priority).toBe('LOW');
    });

    it('refuses someone who is not a member of the company', async () => {
        seedRules(SCHEMA_TYPE.RULES, { task_priority: true });
        await expect(priorityUpdate('6f00000000000000000000ff')).rejects.toMatchObject({ name: 'RefusedError', message: expect.stringMatching(/permission_denied/) });
    });

    it('applies the same check to a comment, the lowest-risk write', async () => {
        seedRules(SCHEMA_TYPE.RULES, { task_comment: false });
        await expect(actions.perform({ companyId: CID, actor: actorFor(MEMBER), action: 'task.comment', params: { taskId: TASK_ID, body: 'hi' } }))
            .rejects.toMatchObject({ name: 'RefusedError', message: expect.stringMatching(/permission_denied: task\.task_comment/) });
        expect(mockDb.store[SCHEMA_TYPE.COMMENTS] || []).toHaveLength(0);
    });

    it('gates reads too: tasks.search needs the task list', async () => {
        seedRules(SCHEMA_TYPE.RULES, { task_list: null });
        await expect(actions.authorizeRead({ companyId: CID, actor: actorFor(MEMBER), action: 'tasks.search', params: {} }))
            .rejects.toMatchObject({ name: 'RefusedError', message: expect.stringMatching(/permission_denied: task\.task_list/) });
        mockDb.store[SCHEMA_TYPE.RULES].find((r) => r.key === 'task_list').roles[0].permission = false;
        await expect(actions.authorizeRead({ companyId: CID, actor: actorFor(MEMBER), action: 'tasks.search', params: {} })).resolves.toBe(true);
    });
});

describe('the registry refuses an action without a permission mapping', () => {
    const entry = (over = {}) => ({ key: 'sprint.close', label: 'Close a sprint', risk: 'low', undoable: true, write: true, cost: 'write', ...over });

    it('every registered action maps to a catalogue entry', () => {
        registry.ACTIONS.forEach((a) => {
            const required = registry.permissionsFor(a.key, a.fields ? { fields: Object.fromEntries(a.fields.map((f) => [f, 1])) } : {});
            expect({ key: a.key, n: required.length > 0 }).toEqual({ key: a.key, n: true });
            required.forEach((p) => expect(p).toMatchObject({ key: expect.stringMatching(/^[a-z_]+\.[a-z_]+$/), write: expect.any(Boolean) }));
        });
    });

    it('throws at load for an entry with no mapping, an empty one, or a field left unmapped', () => {
        expect(() => registry.validate([entry()])).toThrow(/sprint\.close.*permission/);
        expect(() => registry.validate([entry({ permission: '' })])).toThrow(/sprint\.close.*permission/);
        expect(() => registry.validate([entry({ permission: 'not-a-catalogue-key' })])).toThrow(/sprint\.close.*permission/);
        expect(() => registry.validate([entry({ fields: ['a', 'b'], permission: { byField: { a: 'task.task_tag' } } })])).toThrow(/sprint\.close.*\bb\b/);
        expect(() => registry.validate([entry({ permission: 'project.project_sprint_create' })])).not.toThrow();
        expect(() => registry.validate([entry({ fields: ['a'], permission: { byField: { a: 'task.task_tag' } } })])).not.toThrow();
    });

    it('validates the shipped registry', () => {
        expect(() => registry.validate(registry.ACTIONS)).not.toThrow();
    });
});
