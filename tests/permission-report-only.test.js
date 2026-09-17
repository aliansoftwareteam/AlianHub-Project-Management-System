const { EventEmitter } = require('events');

const mockDb = require('./fixtures/fakeMongo').create();
const mockFailing = { rules: false, seats: false, decisions: false, decisionsThrow: false };

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (companyId, q, method) => {
        if (mockFailing.rules && q.type === 'rules') return Promise.reject(new Error('rules unreadable'));
        if (mockFailing.seats && q.type === 'company_users') return Promise.reject(new Error('seats unreadable'));
        if (q.type === 'permission_decisions') {
            if (mockFailing.decisionsThrow) throw new Error('decisions store exploded');
            if (mockFailing.decisions) return Promise.reject(new Error('decisions store down'));
        }
        return mockDb.crud(companyId, q, method);
    },
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0 } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../Modules/settings/Members/controller', () => {
    const reached = (req, res) => res.status(200).json({ status: true, reached: true });
    return new Proxy({}, { get: () => reached });
});

const express = require('express');
const logger = require('../Config/loggerConfig');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { requireRole, requirePermission, requireTaskActionPermission } = require('../Config/permissionGuard');
const { requireProjectAccess } = require('../Config/projectAccess');

const CID = '6f00000000000000000000c1';
const OWNER = '6f0000000000000000000001';
const MEMBER = '6f0000000000000000000003';
const GUEST = '6f0000000000000000000004';
const OUTSIDER = '6f0000000000000000000009';
const INVITEE = '6f000000000000000000000a';
const OWNER_SEAT = '6f0000000000000000000c01';
const MEMBER_SEAT = '6f0000000000000000000c03';
const INVITE_SEAT = '6f0000000000000000000c0a';
const GLOBAL_PROJECT = '6f0000000000000000000a01';
const OWN_RULES_PROJECT = '6f0000000000000000000a02';
const NULL_FLAG_PROJECT = '6f0000000000000000000a03';
const NULL_FLAG_NARROW_PROJECT = '6f0000000000000000000a04';
const TASK_IN_OWN_RULES = '6f0000000000000000000b01';
const TASK_IN_NULL_FLAG = '6f0000000000000000000b03';
const TASK_IN_NULL_FLAG_NARROW = '6f0000000000000000000b04';
const MISSING_TASK = '6f0000000000000000000bff';
const BODY_MARKER = 'body-marker-7d1f';
const QUERY_MARKER = 'query-marker-3c9a';

const decisions = () => mockDb.store.permission_decisions || [];
const audits = () => (mockDb.store.audit_logs || []).filter((row) => row.action === 'permission.refused');
const settle = async () => { for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setImmediate(resolve)); };

const ENV_KEYS = ['PERMISSION_ENFORCEMENT_MODE', 'DISABLE_PERMISSION_ENFORCEMENT', 'PERMISSION_ENFORCEMENT_CACHE_TTL_SECONDS'];

const seedRules = (type, grants, extra = {}) => {
    const parents = {};
    ['project', 'task', 'settings'].forEach((key) => {
        parents[key] = mockDb.seed(type, { key, name: key, isParent: true, roles: [], ...extra });
    });
    Object.entries(grants).forEach(([key, roles]) => mockDb.seed(type, {
        key, name: key, isParent: false, parentId: String(parents[key.split('_')[0]]._id), roles, ...extra,
    }));
};

const response = () => {
    const res = new EventEmitter();
    res.statusCode = 200;
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (body) => { res.body = body; res.emit('finish'); return res; };
    return res;
};

/* The handler answers when the guard passes, so 'finish' follows either way, as it does in Express. */
const run = async (middleware, req, { finish = true } = {}) => {
    const res = response();
    let passed = false;
    await middleware(req, res, () => { passed = true; });
    if (passed && finish) res.emit('finish');
    await settle();
    return { passed, code: res.statusCode, body: res.body, res };
};

const session = (uid, { method = 'POST', route = '/api/v1/createproject', body = {} } = {}) => ({
    uid,
    method,
    baseUrl: '',
    route: { path: route },
    originalUrl: `${route}?probe=${QUERY_MARKER}`,
    url: `${route}?probe=${QUERY_MARKER}`,
    query: { probe: QUERY_MARKER },
    headers: { companyid: CID },
    body,
});
const token = (uid, options) => ({ ...session(uid, options), apiToken: { _id: 't' } });

const createProject = () => requirePermission('project.project_create');
const setInstanceMode = (mode) => { process.env.PERMISSION_ENFORCEMENT_MODE = mode; };
const setWorkspaceMode = (stored) => {
    mockDb.store.companies = [stored === undefined ? { _id: CID } : { _id: CID, permissionEnforcement: stored }];
};

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.calls.length = 0;
    Object.keys(mockFailing).forEach((k) => { mockFailing[k] = false; });
    ENV_KEYS.forEach((k) => { delete process.env[k]; });
    jest.clearAllMocks();
    setWorkspaceMode(undefined);
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { _id: OWNER_SEAT, userId: OWNER, roleType: 1, status: 2, isDelete: false });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { _id: MEMBER_SEAT, userId: MEMBER, roleType: 3, status: 2, isDelete: false });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { _id: INVITE_SEAT, userId: '', userEmail: 'invitee@example.test', roleType: 3, status: 1, isDelete: false });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: GUEST, roleType: 0, status: 2, isDelete: false });
    mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: GLOBAL_PROJECT, isGlobalPermission: true, isPrivateSpace: false, AssigneeUserId: [MEMBER] });
    mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: OWN_RULES_PROJECT, isGlobalPermission: false });
    mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: NULL_FLAG_PROJECT, isGlobalPermission: null });
    mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: NULL_FLAG_NARROW_PROJECT, isGlobalPermission: null });
    mockDb.seed(SCHEMA_TYPE.TASKS, { _id: TASK_IN_OWN_RULES, ProjectID: OWN_RULES_PROJECT });
    mockDb.seed(SCHEMA_TYPE.TASKS, { _id: TASK_IN_NULL_FLAG, ProjectID: NULL_FLAG_PROJECT });
    mockDb.seed(SCHEMA_TYPE.TASKS, { _id: TASK_IN_NULL_FLAG_NARROW, ProjectID: NULL_FLAG_NARROW_PROJECT });
    seedRules(SCHEMA_TYPE.RULES, {
        project_create: [{ key: 3, permission: null }, { key: 0, permission: null }],
        project_name_edit: [{ key: 3, permission: null }],
        task_create: [{ key: 3, permission: true }],
        task_status: [{ key: 3, permission: null }],
        task_priority: [{ key: 3, permission: true }],
        settings_security_permissions: [{ key: 3, permission: false }],
        settings_member_list: [{ key: 3, permission: null }],
    });
    seedRules(SCHEMA_TYPE.PROJECT_RULES, { task_priority: [{ key: 3, permission: false }] }, { projectId: OWN_RULES_PROJECT });
    seedRules(SCHEMA_TYPE.PROJECT_RULES, { task_status: [{ key: 3, permission: true }] }, { projectId: NULL_FLAG_PROJECT });
    seedRules(SCHEMA_TYPE.PROJECT_RULES, { task_status: [{ key: 3, permission: null }] }, { projectId: NULL_FLAG_NARROW_PROJECT });
});

afterAll(() => ENV_KEYS.forEach((k) => { delete process.env[k]; }));

describe('off, the default', () => {
    test('passes a browser session the permission would refuse and records nothing', async () => {
        const result = await run(createProject(), session(MEMBER));
        expect(result.passed).toBe(true);
        expect(decisions()).toEqual([]);
        expect(audits()).toEqual([]);
    });

    test('does not run the permission check for a browser session', async () => {
        setInstanceMode('off');
        await run(requireTaskActionPermission(), session(MEMBER, { method: 'PATCH', route: '/api/v2/tasks', body: { action: 'updatePriority', taskData: { _id: TASK_IN_OWN_RULES } } }));
        await run(requireRole(), session(MEMBER, { route: '/api/v1/owner-only' }));
        const checked = mockDb.calls.map((call) => call.type).filter((type) => type !== 'companies');
        expect(checked).toEqual([]);
    });
});

describe('report', () => {
    beforeEach(() => setInstanceMode('report'));

    test('never refuses: a would-be denial passes and writes one row once the response is out', async () => {
        const res = response();
        let passed = false;
        await createProject()(session(MEMBER), res, () => { passed = true; });
        await settle();
        expect(passed).toBe(true);
        expect(res.body).toBeUndefined();
        expect(decisions()).toEqual([]);

        res.emit('finish');
        await settle();
        expect(decisions()).toHaveLength(1);
        const [row] = decisions();
        expect(row).toMatchObject({
            mode: 'report',
            method: 'POST',
            route: '/api/v1/createproject',
            permission: 'project.project_create',
            role: 3,
            scope: 'global',
            reason: 'denied',
            count: 1,
            userIds: [MEMBER],
        });
        expect(row.firstSeen).toBeInstanceOf(Date);
        expect(row.lastSeen).toBeInstanceOf(Date);
        expect(row.day.getTime()).toBe(Date.UTC(row.firstSeen.getUTCFullYear(), row.firstSeen.getUTCMonth(), row.firstSeen.getUTCDate()));
        expect(audits()).toEqual([]);
    });

    test('a second identical would-be denial increments count on the same row', async () => {
        await run(createProject(), session(MEMBER));
        await run(createProject(), session(MEMBER));
        expect(decisions()).toHaveLength(1);
        expect(decisions()[0]).toMatchObject({ count: 2, userIds: [MEMBER] });
        expect(decisions()[0].lastSeen.getTime()).toBeGreaterThanOrEqual(decisions()[0].firstSeen.getTime());
    });

    test('a different permission key, role or reason makes a new row', async () => {
        await run(createProject(), session(MEMBER));
        await run(requirePermission('settings.settings_security_permissions'), session(MEMBER, { method: 'PUT', route: '/api/v1/securityPermissions' }));
        await run(createProject(), session(GUEST));
        await run(createProject(), session(OUTSIDER));
        const keys = decisions().map((row) => `${row.permission}|${row.role}|${row.reason}|${row.count}`).sort();
        expect(keys).toEqual([
            'project.project_create|0|denied|1',
            'project.project_create|3|denied|1',
            'project.project_create|null|no_seat|1',
            'settings.settings_security_permissions|3|denied|1',
        ]);
    });

    test('an allowed request records nothing', async () => {
        const result = await run(requirePermission('task.task_create'), session(MEMBER, { route: '/api/v2/tasks', body: { data: { ProjectID: GLOBAL_PROJECT } } }));
        expect(result.passed).toBe(true);
        expect(decisions()).toEqual([]);
    });

    test('a task action records its key and the project whose rules refused it', async () => {
        const result = await run(requireTaskActionPermission(), session(MEMBER, { method: 'PATCH', route: '/api/v2/tasks', body: { action: 'updatePriority', taskData: { _id: TASK_IN_OWN_RULES } } }));
        expect(result.passed).toBe(true);
        expect(decisions()).toEqual([expect.objectContaining({ method: 'PATCH', route: '/api/v2/tasks', permission: 'task.task_priority', scope: OWN_RULES_PROJECT, reason: 'denied' })]);
    });

    test('a role guard records the roles it wanted', async () => {
        const result = await run(requireRole(), session(MEMBER, { method: 'PUT', route: '/api/v1/owner-only' }));
        expect(result.passed).toBe(true);
        expect(decisions()).toEqual([expect.objectContaining({ permission: 'role:1,2', role: 3, scope: 'global', reason: 'role_not_allowed' })]);
    });

    test('a check that throws is recorded as check_failed and the request passes', async () => {
        mockFailing.rules = true;
        const result = await run(createProject(), session(MEMBER));
        expect(result.passed).toBe(true);
        expect(decisions()).toEqual([expect.objectContaining({ permission: 'project.project_create', reason: 'check_failed' })]);
    });

    describe('tags the would-be denials that are not plain denials', () => {
        test('no_seat: the caller holds no active seat', async () => {
            await run(createProject(), session(OUTSIDER));
            expect(decisions()).toEqual([expect.objectContaining({ role: null, reason: 'no_seat', userIds: [OUTSIDER] })]);
        });

        test('tasks_not_found: the body names only tasks that do not exist', async () => {
            await run(requireTaskActionPermission(), session(MEMBER, { method: 'PATCH', route: '/api/v2/tasks', body: { action: 'updateStatus', task: { _id: MISSING_TASK } } }));
            expect(decisions()).toEqual([expect.objectContaining({ permission: 'task.task_status', scope: 'global', reason: 'tasks_not_found' })]);
        });

        test('null_global_flag: a null flag the web app reads as project rules that would allow', async () => {
            await run(requireTaskActionPermission(), session(MEMBER, { method: 'PATCH', route: '/api/v2/tasks', body: { action: 'updateStatus', task: { _id: TASK_IN_NULL_FLAG } } }));
            expect(decisions()).toEqual([expect.objectContaining({ permission: 'task.task_status', scope: NULL_FLAG_PROJECT, reason: 'null_global_flag' })]);
        });

        test('a null flag whose project rules refuse too is a plain denial', async () => {
            await run(requireTaskActionPermission(), session(MEMBER, { method: 'PATCH', route: '/api/v2/tasks', body: { action: 'updateStatus', task: { _id: TASK_IN_NULL_FLAG_NARROW } } }));
            expect(decisions()).toEqual([expect.objectContaining({ scope: NULL_FLAG_NARROW_PROJECT, reason: 'denied' })]);
        });
    });

    describe('a failure while recording never affects the response', () => {
        test('a rejected write', async () => {
            mockFailing.decisions = true;
            const result = await run(createProject(), session(MEMBER));
            expect(result.passed).toBe(true);
            expect(result.body).toBeUndefined();
            expect(logger.error).toHaveBeenCalled();
        });

        test('a write that throws', async () => {
            mockFailing.decisionsThrow = true;
            const result = await run(createProject(), session(MEMBER));
            expect(result.passed).toBe(true);
            expect(result.body).toBeUndefined();
        });

        test('a response that cannot report when it finished', async () => {
            const req = session(MEMBER);
            let passed = false;
            const res = { status: () => res, json: () => res };
            await createProject()(req, res, () => { passed = true; });
            await settle();
            expect(passed).toBe(true);
            expect(decisions()).toEqual([]);
        });
    });

    test('never stores a request body or query string', async () => {
        const body = { ProjectName: BODY_MARKER, secret: BODY_MARKER, data: { note: BODY_MARKER } };
        await run(createProject(), session(MEMBER, { body }));
        await run(requireTaskActionPermission(), session(MEMBER, { method: 'PATCH', route: '/api/v2/tasks', body: { action: 'updateStatus', note: BODY_MARKER, task: { _id: MISSING_TASK } } }));
        expect(decisions()).toHaveLength(2);
        const stored = JSON.stringify(decisions());
        expect(stored).not.toContain(BODY_MARKER);
        expect(stored).not.toContain(QUERY_MARKER);
        expect(stored).not.toContain('?');
    });

    test('keeps at most five distinct user ids on a row, and each user once', async () => {
        const members = Array.from({ length: 7 }, (_, i) => `6f${String(100 + i).padStart(22, '0')}`);
        members.forEach((userId) => mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId, roleType: 3, status: 2, isDelete: false }));
        for (const uid of [members[0], members[0], ...members]) {
            await run(createProject(), session(uid));
        }
        expect(decisions()).toHaveLength(1);
        const [row] = decisions();
        expect(row.count).toBe(9);
        expect(row.userIds).toEqual(members.slice(0, 5));
    });
});

describe('enforce', () => {
    beforeEach(() => setInstanceMode('enforce'));

    test('refuses a browser session that lacks the permission, records it and writes a permission.refused audit row', async () => {
        const result = await run(createProject(), session(MEMBER, { body: { ProjectName: BODY_MARKER } }));
        expect(result.passed).toBe(false);
        expect(result.code).toBe(403);
        expect(result.body).toEqual({ status: false, statusText: 'You do not have permission to perform this action.', error: 'Forbidden', permission: 'project.project_create' });
        expect(decisions()).toEqual([expect.objectContaining({ mode: 'enforce', permission: 'project.project_create', reason: 'denied', count: 1 })]);
        expect(audits()).toEqual([expect.objectContaining({
            action: 'permission.refused',
            actorId: MEMBER,
            entityType: 'permission',
            entityId: 'project.project_create',
            meta: expect.objectContaining({ method: 'POST', route: '/api/v1/createproject', reason: 'denied', scope: 'global', role: 3 }),
        })]);
        expect(JSON.stringify(audits())).not.toContain(BODY_MARKER);
        expect(JSON.stringify(audits())).not.toContain(QUERY_MARKER);
    });

    test('passes a browser session that holds the permission', async () => {
        const result = await run(requirePermission('task.task_create'), session(MEMBER, { route: '/api/v2/tasks', body: { data: { ProjectID: GLOBAL_PROJECT } } }));
        expect(result.passed).toBe(true);
        expect(decisions()).toEqual([]);
    });

    test('passes an owner on every guard', async () => {
        expect((await run(createProject(), session(OWNER))).passed).toBe(true);
        expect((await run(requireRole(), session(OWNER))).passed).toBe(true);
    });

    test('refuses a task action the task\'s project refuses', async () => {
        const result = await run(requireTaskActionPermission(), session(MEMBER, { method: 'PATCH', route: '/api/v2/tasks', body: { action: 'updatePriority', taskData: { _id: TASK_IN_OWN_RULES } } }));
        expect(result.passed).toBe(false);
        expect(result.body).toMatchObject({ status: false, permission: 'task.task_priority' });
    });

    test('refuses a member on a role guard', async () => {
        const result = await run(requireRole(), session(MEMBER));
        expect(result.passed).toBe(false);
        expect(result.body).toEqual({ status: false, statusText: 'You do not have permission to perform this action.', error: 'Forbidden' });
    });

    test('refuses when the check throws, and records check_failed', async () => {
        mockFailing.rules = true;
        const result = await run(createProject(), session(MEMBER));
        expect(result.passed).toBe(false);
        expect(result.body).toMatchObject({ status: false, statusText: 'Permission check failed.', permission: 'project.project_create' });
        expect(decisions()).toEqual([expect.objectContaining({ mode: 'enforce', reason: 'check_failed' })]);
    });

    test('a failure while recording leaves the refusal unchanged', async () => {
        mockFailing.decisions = true;
        const result = await run(createProject(), session(MEMBER));
        expect(result.code).toBe(403);
        expect(result.body).toMatchObject({ status: false, permission: 'project.project_create' });
    });
});

describe('the mode a workspace resolves to', () => {
    test('a workspace set to report overrides an instance default of off', async () => {
        setInstanceMode('off');
        setWorkspaceMode({ mode: 'report' });
        const result = await run(createProject(), session(MEMBER));
        expect(result.passed).toBe(true);
        expect(decisions()).toEqual([expect.objectContaining({ mode: 'report' })]);
    });

    test('a workspace set to enforce overrides an instance default of report', async () => {
        setInstanceMode('report');
        setWorkspaceMode('ENFORCE');
        expect((await run(createProject(), session(MEMBER))).code).toBe(403);
    });

    test('a workspace set to off overrides an instance default of enforce', async () => {
        setInstanceMode('enforce');
        setWorkspaceMode({ mode: 'Off' });
        expect((await run(createProject(), session(MEMBER))).passed).toBe(true);
        expect(decisions()).toEqual([]);
    });

    test.each([
        ['absent', undefined],
        ['null', null],
        ['garbage', 'strict'],
        ['an object with a garbage mode', { mode: 'yes' }],
    ])('a workspace value that is %s inherits the instance default', async (_, stored) => {
        setInstanceMode('enforce');
        setWorkspaceMode(stored);
        expect((await run(createProject(), session(MEMBER))).code).toBe(403);
    });

    test('an unrecognised instance value reads as off', async () => {
        setInstanceMode('strict');
        expect((await run(createProject(), session(MEMBER))).passed).toBe(true);
        expect(decisions()).toEqual([]);
    });

    test('the kill switch turns enforce into report, from the instance default and from a workspace', async () => {
        process.env.DISABLE_PERMISSION_ENFORCEMENT = 'true';
        setInstanceMode('enforce');
        expect((await run(createProject(), session(MEMBER))).passed).toBe(true);

        setInstanceMode('off');
        setWorkspaceMode({ mode: 'enforce' });
        expect((await run(createProject(), session(MEMBER))).passed).toBe(true);

        expect(decisions()).toEqual([expect.objectContaining({ mode: 'report', count: 2 })]);
        expect(audits()).toEqual([]);
    });
});

const routesOf = (modulePath) => {
    const table = {};
    const register = (method) => (routePath, ...handlers) => { table[`${method} ${routePath}`] = handlers; };
    require(modulePath).init({ get: register('GET'), post: register('POST'), put: register('PUT'), patch: register('PATCH'), delete: register('DELETE'), use: register('USE') });
    return table;
};
const memberRoutes = routesOf('../Modules/settings/Members/routes');
const routeGuard = (key) => memberRoutes[key][0];
const withoutCompany = (req) => ({ ...req, headers: {} });

const acceptInvitation = (uid, data = { userId: uid, status: 2 }) => withoutCompany(session(uid, {
    method: 'PUT', route: '/api/v1/root-members', body: { id: INVITE_SEAT, data, companyId: CID },
}));
const updateMember = (uid, id, data) => session(uid, { method: 'PUT', route: '/api/v1/members', body: { id, data } });

describe('accepting an invitation (PUT /api/v1/root-members, sent without a company header)', () => {
    test.each(['off', 'report', 'enforce'])('passes under an instance default of %s and records nothing', async (mode) => {
        setInstanceMode(mode);
        const result = await run(routeGuard('PUT /api/v1/root-members'), acceptInvitation(INVITEE));
        expect(result.passed).toBe(true);
        expect(decisions()).toEqual([]);
    });

    test.each([
        ['another account', { userId: MEMBER, status: 2 }],
        ['a role', { userId: INVITEE, roleType: 1 }],
        ['a status other than active', { userId: INVITEE, status: 3 }],
    ])('is not exempt when the body links %s', async (_, data) => {
        setInstanceMode('enforce');
        const result = await run(routeGuard('PUT /api/v1/root-members'), acceptInvitation(INVITEE, data));
        expect(result.passed).toBe(false);
        expect(result.code).toBe(403);
    });

    test('an invited seat gets no exemption on other member routes', async () => {
        setInstanceMode('enforce');
        const result = await run(routeGuard('PUT /api/v1/members'), withoutCompany(updateMember(INVITEE, INVITE_SEAT, { userId: INVITEE, status: 2 })));
        expect(result.passed).toBe(false);
    });

    test('API tokens are judged as before', async () => {
        const req = { ...acceptInvitation(INVITEE), apiToken: { _id: 't' } };
        for (const mode of ['off', 'report', 'enforce']) {
            setInstanceMode(mode);
            const result = await run(routeGuard('PUT /api/v1/root-members'), req);
            expect(result).toMatchObject({ passed: false, code: 403 });
        }
    });
});

describe('a decision with no resolvable company', () => {
    const globalWrites = () => mockDb.calls.filter((call) => call.type === 'permission_decisions' && call.method === 'updateOne').map((call) => call.companyId);

    test.each([['no company header', {}], ['a malformed company header', { companyid: 'not-a-company' }]])('is recorded in the instance bucket in report mode (%s)', async (_, headers) => {
        setInstanceMode('report');
        const req = { ...acceptInvitation(INVITEE, { userId: MEMBER, status: 2 }), headers };
        const result = await run(routeGuard('PUT /api/v1/root-members'), req);
        expect(result.passed).toBe(true);
        expect(decisions()).toEqual([expect.objectContaining({ mode: 'report', route: '/api/v1/root-members', permission: 'settings.settings_member_list', role: null, scope: 'global', reason: 'no_seat', count: 1 })]);
        expect(new Set(globalWrites())).toEqual(new Set(['global']));
        expect(JSON.stringify(decisions())).not.toContain('not-a-company');
    });

    test('is refused and recorded in the instance bucket in enforce mode, with no tenant audit row', async () => {
        setInstanceMode('enforce');
        const result = await run(routeGuard('PUT /api/v1/root-members'), acceptInvitation(INVITEE, { userId: MEMBER, status: 2 }));
        expect(result.code).toBe(403);
        expect(decisions()).toEqual([expect.objectContaining({ mode: 'enforce', reason: 'no_seat' })]);
        expect(new Set(globalWrites())).toEqual(new Set(['global']));
        expect(mockDb.store.audit_logs || []).toEqual([]);
    });
});

describe('a member changing their own preferences (PUT /api/v1/members, Home.vue dashboard lock)', () => {
    test.each(['off', 'report', 'enforce'])('may lock their own dashboard in %s without the member list permission', async (mode) => {
        setInstanceMode(mode);
        const result = await run(routeGuard('PUT /api/v1/members'), updateMember(MEMBER, MEMBER_SEAT, { dashboardLocked: true }));
        expect(result.passed).toBe(true);
        expect(decisions()).toEqual([]);
    });

    test('still needs the permission to change another member, in report and in enforce', async () => {
        setInstanceMode('report');
        expect((await run(routeGuard('PUT /api/v1/members'), updateMember(MEMBER, OWNER_SEAT, { dashboardLocked: true }))).passed).toBe(true);
        expect(decisions()).toEqual([expect.objectContaining({ permission: 'settings.settings_member_list', reason: 'denied' })]);

        setInstanceMode('enforce');
        const result = await run(routeGuard('PUT /api/v1/members'), updateMember(MEMBER, OWNER_SEAT, { dashboardLocked: true }));
        expect(result).toMatchObject({ passed: false, code: 403 });
    });

    test.each([
        ['a field that is not a preference', { roleType: 1 }],
        ['a preference and a field that is not', { dashboardLocked: true, managerId: OWNER }],
        ['an update operator', { $set: { dashboardLocked: true } }],
    ])('still needs the permission for %s on their own row', async (_, data) => {
        setInstanceMode('enforce');
        const result = await run(routeGuard('PUT /api/v1/members'), updateMember(MEMBER, MEMBER_SEAT, data));
        expect(result).toMatchObject({ passed: false, code: 403 });
    });

    test('API tokens are judged as before', async () => {
        for (const mode of ['off', 'report', 'enforce']) {
            setInstanceMode(mode);
            const result = await run(routeGuard('PUT /api/v1/members'), { ...updateMember(MEMBER, MEMBER_SEAT, { dashboardLocked: true }), apiToken: { _id: 't' } });
            expect(result).toMatchObject({ passed: false, code: 403 });
        }
    });
});

describe('a role lookup that fails is a failed check, not a missing seat', () => {
    test('report records check_failed and lets the request through', async () => {
        setInstanceMode('report');
        mockFailing.seats = true;
        expect((await run(createProject(), session(MEMBER))).passed).toBe(true);
        expect((await run(requireRole(), session(MEMBER))).passed).toBe(true);
        expect(decisions().map((row) => `${row.permission}|${row.reason}`).sort()).toEqual(['project.project_create|check_failed', 'role:1,2|check_failed']);
    });

    test('enforce fails closed with "Permission check failed."', async () => {
        setInstanceMode('enforce');
        mockFailing.seats = true;
        const result = await run(createProject(), session(MEMBER));
        expect(result).toMatchObject({ passed: false, code: 403, body: { status: false, statusText: 'Permission check failed.', permission: 'project.project_create' } });
        expect((await run(requireRole(), session(MEMBER))).body).toMatchObject({ statusText: 'Permission check failed.' });
    });

    test('API tokens keep today\'s answer', async () => {
        setInstanceMode('enforce');
        mockFailing.seats = true;
        const result = await run(createProject(), token(MEMBER));
        expect(result.body).toMatchObject({ statusText: 'You do not have permission to perform this action.' });
    });
});

describe('refusal audit rows', () => {
    beforeEach(() => setInstanceMode('enforce'));

    test('are written at most once a minute per decision key', async () => {
        for (let i = 0; i < 3; i += 1) await run(createProject(), session(MEMBER));
        expect(decisions()).toEqual([expect.objectContaining({ count: 3 })]);
        expect(audits()).toHaveLength(1);

        await run(requirePermission('settings.settings_security_permissions'), session(MEMBER, { method: 'PUT', route: '/api/v1/securityPermissions' }));
        expect(audits()).toHaveLength(2);

        const row = decisions().find((r) => r.permission === 'project.project_create');
        row.lastAuditedAt = new Date(Date.now() - 61000);
        await run(createProject(), session(MEMBER));
        expect(audits()).toHaveLength(3);
        await run(createProject(), session(MEMBER));
        expect(audits()).toHaveLength(3);
    });
});

describe('the stored route', () => {
    const serve = async (app) => {
        const server = app.listen(0, '127.0.0.1');
        await new Promise((resolve) => server.once('listening', resolve));
        return { base: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((resolve) => server.close(resolve)) };
    };

    test('is the pattern Express matched, never the concrete path or its query string', async () => {
        setInstanceMode('report');
        const app = express();
        app.use(express.json());
        app.use((req, res, next) => { req.uid = MEMBER; next(); });
        app.put('/api/v1/x/:id', createProject(), (req, res) => res.json({ status: true }));
        const router = express.Router();
        router.patch('/items/:itemId/notes/:noteId', createProject(), (req, res) => res.json({ status: true }));
        app.use('/api/v2/things', router);
        const { base, close } = await serve(app);
        try {
            const headers = { 'content-type': 'application/json', companyid: CID };
            const first = await fetch(`${base}/api/v1/x/${GLOBAL_PROJECT}?probe=${QUERY_MARKER}`, { method: 'PUT', headers, body: JSON.stringify({ note: BODY_MARKER }) });
            expect(first.status).toBe(200);
            const second = await fetch(`${base}/api/v2/things/items/abc/notes/42?probe=${QUERY_MARKER}`, { method: 'PATCH', headers, body: '{}' });
            expect(second.status).toBe(200);
            const deadline = Date.now() + 2000;
            while (decisions().length < 2 && Date.now() < deadline) await settle();
        } finally {
            await close();
        }
        expect(decisions().map((row) => row.route).sort()).toEqual(['/api/v1/x/:id', '/api/v2/things/items/:itemId/notes/:noteId']);
        const stored = JSON.stringify(decisions());
        [GLOBAL_PROJECT, 'abc', '/42', QUERY_MARKER, BODY_MARKER, '?'].forEach((value) => expect(stored).not.toContain(value));
    });
});

/* Every setting a browser-session mode can take, with the kill switch on and off. */
const MODE_SETTINGS = [
    ['off', () => setInstanceMode('off')],
    ['report', () => setInstanceMode('report')],
    ['enforce', () => setInstanceMode('enforce')],
    ['a workspace in report', () => setWorkspaceMode({ mode: 'report' })],
    ['a workspace in enforce', () => setWorkspaceMode('enforce')],
];

const outcome = ({ passed, code, body }) => ({ passed, code, body });

const outcomesInEveryMode = async (scenarios) => {
    const byMode = {};
    for (const [name, applyMode] of MODE_SETTINGS) {
        delete process.env.PERMISSION_ENFORCEMENT_MODE;
        setWorkspaceMode(undefined);
        applyMode();
        byMode[name] = [];
        for (const [, scenario] of scenarios) byMode[name].push(outcome(await scenario()));
    }
    return byMode;
};

describe('API tokens behave identically in every mode', () => {
    const scenarios = [
        ['a member creating a project', () => run(createProject(), token(MEMBER))],
        ['a member creating a task', () => run(requirePermission('task.task_create'), token(MEMBER, { route: '/api/v2/tasks', body: { data: { ProjectID: GLOBAL_PROJECT } } }))],
        ['a task action the project refuses', () => run(requireTaskActionPermission(), token(MEMBER, { method: 'PATCH', route: '/api/v2/tasks', body: { action: 'updatePriority', taskData: { _id: TASK_IN_OWN_RULES } } }))],
        ['a member on a role guard', () => run(requireRole(), token(MEMBER))],
        ['an owner on a role guard', () => run(requireRole(), token(OWNER))],
        ['unreadable rules', async () => { mockFailing.rules = true; const r = await run(createProject(), token(MEMBER)); mockFailing.rules = false; return r; }],
    ];

    test.each([false, true])('with the kill switch %s', async (killSwitch) => {
        if (killSwitch) process.env.DISABLE_PERMISSION_ENFORCEMENT = 'true';
        const outcomes = await outcomesInEveryMode(scenarios);
        expect(outcomes.off[0]).toMatchObject(killSwitch ? { passed: true } : { passed: false, code: 403 });
        expect(outcomes.off[3]).toMatchObject({ passed: false, code: 403 });
        Object.values(outcomes).forEach((list) => expect(list).toEqual(outcomes.off));
        expect(decisions()).toEqual([]);
        expect(audits()).toEqual([]);
    });
});

describe('requireProjectAccess is unchanged in every mode', () => {
    const scenarios = [
        ['a member renaming a public project they may not rename', () => run(requireProjectAccess({ projectIds: () => GLOBAL_PROJECT, permissions: () => ['project.project_name_edit'] }), session(MEMBER, { method: 'PUT', route: '/api/v1/project/:id' }))],
        ['a member reading that project', () => run(requireProjectAccess({ mode: 'read', projectIds: () => GLOBAL_PROJECT }), session(MEMBER, { method: 'GET', route: '/api/v1/project/:id' }))],
        ['an outsider reading it', () => run(requireProjectAccess({ mode: 'read', projectIds: () => GLOBAL_PROJECT }), session(OUTSIDER, { method: 'GET', route: '/api/v1/project/:id' }))],
        ['an owner renaming it', () => run(requireProjectAccess({ projectIds: () => GLOBAL_PROJECT, permissions: () => ['project.project_name_edit'] }), session(OWNER, { method: 'PUT', route: '/api/v1/project/:id' }))],
    ];

    test.each([false, true])('with the kill switch %s', async (killSwitch) => {
        if (killSwitch) process.env.DISABLE_PERMISSION_ENFORCEMENT = 'true';
        const outcomes = await outcomesInEveryMode(scenarios);
        expect(outcomes.off.map((o) => o.code)).toEqual(killSwitch ? [200, 200, 404, 200] : [403, 200, 404, 200]);
        Object.values(outcomes).forEach((list) => expect(list).toEqual(outcomes.off));
        expect(decisions()).toEqual([]);
        expect(audits()).toEqual([]);
    });
});
