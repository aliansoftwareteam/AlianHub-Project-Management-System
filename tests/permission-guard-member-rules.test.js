const mockDb = require('./fixtures/fakeMongo').create();
const mockFailing = { rules: false };

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (companyId, q, method) => {
        if (mockFailing.rules && q.type === 'rules') return Promise.reject(new Error('rules unreadable'));
        return mockDb.crud(companyId, q, method);
    },
}));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, getTtl: () => 0 } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { evaluatePermission, requirePermission, requireTaskActionPermission } = require('../Config/permissionGuard');
const { holderMay } = require('../Modules/Agents/permissions');

const CID = '6f00000000000000000000c1';
const OWNER = '6f0000000000000000000001';
const ADMIN = '6f0000000000000000000002';
const MEMBER = '6f0000000000000000000003';
const OUTSIDER = '6f0000000000000000000009';
const GLOBAL_PROJECT = '6f0000000000000000000a01';
const OWN_RULES_PROJECT = '6f0000000000000000000a02';
const TASK_IN_OWN_RULES = '6f0000000000000000000b01';

const seedRules = (type, grants, extra = {}) => {
    const project = mockDb.seed(type, { key: 'project', name: 'Project', isParent: true, roles: [{ key: 3, permission: false }], ...extra });
    const task = mockDb.seed(type, { key: 'task', name: 'Task', isParent: true, roles: [{ key: 3, permission: true }], ...extra });
    Object.entries(grants).forEach(([key, roles]) => mockDb.seed(type, {
        key, name: key, isParent: false, parentId: String(key.startsWith('project') ? project._id : task._id), roles, ...extra,
    }));
};

const run = async (middleware, req) => {
    const res = { code: 200 };
    res.status = (c) => { res.code = c; return res; };
    res.json = (b) => { res.body = b; return res; };
    let passed = false;
    await middleware(req, res, () => { passed = true; });
    return { passed, code: res.code, body: res.body };
};
const patRequest = (uid, body) => ({ apiToken: { _id: 't' }, uid, headers: { companyid: CID }, body });

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockFailing.rules = false;
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: OWNER, roleType: 1, status: 2, isDelete: false });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: ADMIN, roleType: 2, status: 2, isDelete: false });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: MEMBER, roleType: 3, status: 2, isDelete: false });
    mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: GLOBAL_PROJECT, isGlobalPermission: true });
    mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: OWN_RULES_PROJECT, isGlobalPermission: false });
    mockDb.seed(SCHEMA_TYPE.TASKS, { _id: TASK_IN_OWN_RULES, ProjectID: OWN_RULES_PROJECT });
    seedRules(SCHEMA_TYPE.RULES, {
        task_create: [{ key: 3, permission: true }],
        task_comment: [{ key: 3, permission: false }],
        task_priority: [{ key: 3, permission: true }],
        task_delete: [{ key: 3, permission: null }],
        task_move: [{ key: 0, permission: false }],
        project_create: [],
    });
    seedRules(SCHEMA_TYPE.PROJECT_RULES, {
        task_create: [{ key: 3, permission: null }],
        task_priority: [{ key: 3, permission: false }],
        task_comment: [{ key: 3, permission: true }],
    }, { projectId: OWN_RULES_PROJECT });
});

describe('the truth table the Security & Permissions matrix shows', () => {
    test.each([
        ['owner bypasses', OWNER, 'task.task_delete', true],
        ['admin bypasses', ADMIN, 'project.project_create', true],
        ['a non-member gets nothing', OUTSIDER, 'task.task_create', null],
        ['a member with true may write', MEMBER, 'task.task_create', true],
        ['a member with false may read', MEMBER, 'task.task_comment', false],
        ['a member with null gets nothing', MEMBER, 'task.task_delete', null],
        ['a member with no entry gets nothing (the matrix shows None)', MEMBER, 'task.task_move', null],
        ['a rule with no roles gets nothing', MEMBER, 'project.project_create', null],
        ['a rule that does not exist gets nothing', MEMBER, 'task.task_nonexistent', null],
    ])('%s', async (_, uid, path, expected) => {
        expect(await evaluatePermission(CID, uid, path, { projectId: GLOBAL_PROJECT })).toBe(expected);
    });

    test('a project with its own rules is evaluated against them, as checkPermission(path, false) does', async () => {
        expect(await evaluatePermission(CID, MEMBER, 'task.task_create', { projectId: OWN_RULES_PROJECT })).toBeNull();
        expect(await evaluatePermission(CID, MEMBER, 'task.task_comment', { projectId: OWN_RULES_PROJECT })).toBe(true);
        expect(await evaluatePermission(CID, MEMBER, 'task.task_move', { projectId: OWN_RULES_PROJECT })).toBeNull();
        expect(await evaluatePermission(CID, MEMBER, 'project.project_list', { projectId: OWN_RULES_PROJECT })).toBe(true);
        expect(await evaluatePermission(CID, OWNER, 'task.task_create', { projectId: OWN_RULES_PROJECT })).toBe(true);
    });
});

describe('the API guards follow the same table for PAT requests', () => {
    test('task create is allowed in a global-rules project and refused where the project rules say None', async () => {
        const allowed = await run(requirePermission('task.task_create'), patRequest(MEMBER, { data: { ProjectID: GLOBAL_PROJECT } }));
        expect(allowed.passed).toBe(true);

        const refused = await run(requirePermission('task.task_create'), patRequest(MEMBER, { data: { ProjectID: OWN_RULES_PROJECT } }));
        expect(refused.passed).toBe(false);
        expect(refused.code).toBe(403);
        expect(refused.body).toMatchObject({ status: false, permission: 'task.task_create' });
    });

    test('a task update is judged by the task\'s own project, not a project id the client claims', async () => {
        const req = patRequest(MEMBER, { action: 'updatePriority', projectId: GLOBAL_PROJECT, taskData: { _id: TASK_IN_OWN_RULES } });
        const result = await run(requireTaskActionPermission(), req);
        expect(result.passed).toBe(false);
        expect(result.code).toBe(403);
    });

    test('a rules read failure refuses instead of letting the request through', async () => {
        mockFailing.rules = true;
        const result = await run(requirePermission('task.task_create'), patRequest(MEMBER, { data: { ProjectID: GLOBAL_PROJECT } }));
        expect(result.passed).toBe(false);
        expect(result.code).toBe(403);
    });

    test('web sessions are still not gated here', async () => {
        const result = await run(requirePermission('project.project_create'), { uid: MEMBER, headers: { companyid: CID }, body: {} });
        expect(result.passed).toBe(true);
    });

    test('the agent holder check uses the same evaluator', async () => {
        const verdict = await holderMay(CID, { kind: 'agent', userId: MEMBER }, 'task.update', { taskId: TASK_IN_OWN_RULES, fields: { Task_Priority: 'HIGH' } });
        expect(verdict.allowed).toBe(false);
        expect(verdict.reason).toContain('task_priority');
    });
});
