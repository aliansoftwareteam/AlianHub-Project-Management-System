const verified = require('./fixtures/verifiedRequest');
const fakeMongo = require('./fixtures/fakeMongo');

let mockDb;
jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (...args) => mockDb.crud(...args),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn((key) => require('../Config/config').myCache.del(key)) }));
jest.mock('../Modules/notification/prepare-notification-data/controllerV2', () => ({ handleNotificationtFun: jest.fn(async () => ({ status: true })) }));
jest.mock('../Modules/Audit/recorder', () => ({ recordAudit: jest.fn(), recordAuditFromReq: jest.fn() }));
jest.mock('../Modules/AICore/llmProvider/openaiProvider', () => ({ name: 'openai', model: 'gpt-4.1', isConfigured: true, chat: jest.fn() }));
jest.mock('../Modules/AICore/llmProvider/anthropicProvider', () => ({ name: 'anthropic', model: null, isConfigured: false, chat: jest.fn() }));
jest.mock('../Modules/AICore/llmProvider/deepseekProvider', () => ({ name: 'deepseek', model: null, isConfigured: false, chat: jest.fn() }));

const mongoose = require('mongoose');
const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { dbCollections } = require('../Config/collections');
const socketEmitter = require('../event/socketEventEmitter');
const domainEventBus = require('../event/domainEventBus');
const { removeCache } = require('../utils/commonFunctions');
const { recordAudit } = require('../Modules/Audit/recorder');
const adapter = require('../Modules/AICore/llmProvider/openaiProvider');
const gate = require('../Modules/AssignmentRules/dispatcher/gate');
const guess = require('../Modules/AssignmentRules/dispatcher/guess');

const C = 'c00000000000000000000001';
const OWNER = 'a00000000000000000000001';
const EDITOR = 'a00000000000000000000002';
const VIEWER = 'a00000000000000000000003';
const MEMBER_ROLE = 3;
const TRIAGER = 'it-company/bug-triager';
const REVIEWER = 'it-company/code-reviewer';
const BUG = 2;
const FEATURE = 3;

const SETTINGS_ROUTE = '/api/v2/assignment-rules/dispatcher/project/:projectId';
const RULES_ROUTE = '/api/v2/assignment-rules/dispatcher/project/:projectId/rules';
const NEEDS_ROUTE = '/api/v2/assignment-rules/dispatcher/project/:projectId/needs-routing';
const TASK_ROUTE = '/api/v2/assignment-rules/dispatcher/task/:taskId';
const actionRoute = (action) => `/api/v2/assignment-rules/dispatcher/task/:taskId/decisions/:decisionId/${action}`;

const oid = () => new mongoose.Types.ObjectId().toString();

const routes = () => {
    const table = {};
    const register = (method) => (path, ...handlers) => { table[`${method} ${path}`] = handlers; };
    require('../Modules/AssignmentRules/routes').init({ get: register('GET'), post: register('POST'), put: register('PUT'), patch: register('PATCH'), delete: register('DELETE') });
    return table;
};

const response = () => {
    const res = { statusCode: 200, body: undefined };
    res.status = jest.fn((code) => { res.statusCode = code; return res; });
    res.json = jest.fn((body) => { res.body = body; return res; });
    res.send = res.json;
    return res;
};

const run = async (handlers, req) => {
    const res = response();
    for (const handler of handlers) {
        let advanced = false;
        await handler(req, res, () => { advanced = true; });
        if (!advanced) break;
    }
    return res;
};

const call = (method, path, { uid = EDITOR, params = {}, body = {} } = {}) => {
    const handlers = routes()[`${method} ${path}`];
    if (!handlers) throw new Error(`no route ${method} ${path}`);
    return run(handlers, verified({ uid, method, originalUrl: path, params, body, query: {}, headers: { companyid: C } }));
};

const seedRules = (grants = {}) => {
    const parents = {};
    const parentOf = (section) => {
        if (!parents[section]) parents[section] = mockDb.seed(SCHEMA_TYPE.RULES, { key: section, isParent: true, roles: [{ key: MEMBER_ROLE, permission: true }] });
        return parents[section];
    };
    Object.entries(grants).forEach(([path, permission]) => {
        const [section, key] = path.split('.');
        mockDb.seed(SCHEMA_TYPE.RULES, { key, isParent: false, parentId: String(parentOf(section)._id), roles: [{ key: MEMBER_ROLE, permission }] });
    });
};

const GRANTS = { 'project.private_projects': 1, 'project.project_details': true, 'task.task_list': true, 'task.task_assignee': true };

const seedProject = (doc = {}) => mockDb.seed(SCHEMA_TYPE.PROJECTS, {
    _id: oid(), ProjectName: 'Launch', ProjectCode: 'LCH', CompanyId: C, isPrivateSpace: true,
    AssigneeUserId: [OWNER, EDITOR, VIEWER], isGlobalPermission: true, tagsArray: [{ uid: 'tag-bug', name: 'bug' }], ...doc,
});

const seedTask = (project, doc = {}) => mockDb.seed(SCHEMA_TYPE.TASKS, {
    _id: oid(),
    ProjectID: String(project._id),
    CompanyId: C,
    TaskName: 'Login button overflows on Safari',
    TaskKey: 'LCH-1',
    rawDescription: 'The submit button overflows.',
    TaskType: 'Bug',
    TaskTypeKey: BUG,
    tagsArray: ['tag-bug'],
    Task_Priority: 'HIGH',
    statusKey: 1,
    AssigneeUserId: [],
    sprintId: 'sprint-1',
    statusType: 'default_active',
    deletedStatusKey: 0,
    isParentTask: true,
    createdAt: new Date(),
    ...doc,
});

const SETTINGS = (over = {}) => ({
    mode: 'suggest',
    threshold: 80,
    roles: [TRIAGER, REVIEWER],
    rules: [
        { role: TRIAGER, when: { taskTypeKeys: [BUG], tags: ['tag-bug'] } },
        { role: REVIEWER, when: { priorities: ['LOW'] } },
    ],
    ...over,
});

const saveSettings = (project, over = {}, uid = EDITOR) => call('PUT', SETTINGS_ROUTE, { uid, params: { projectId: String(project._id) }, body: SETTINGS(over) });

const store = (type) => mockDb.store[type] || [];
const decisions = () => store(SCHEMA_TYPE.DISPATCH_DECISIONS);
const queueRows = () => store(SCHEMA_TYPE.PROJECT_FINDINGS).filter((row) => row.rule === 'handed_over');
const audited = (action) => recordAudit.mock.calls.filter(([, entry]) => entry.action === action).map(([companyId, entry]) => ({ companyId, ...entry }));
const routeTask = (task, trigger = 'create') => gate.route({ companyId: C, taskId: String(task._id), trigger });
const act = (action, task, decision, { uid = EDITOR, body = {} } = {}) => call('POST', actionRoute(action), {
    uid, params: { taskId: String(task._id), decisionId: String(decision._id) }, body,
});

let emitted;
beforeEach(() => {
    myCache.flushAll();
    mockDb = fakeMongo.create();
    mockDb.seed(dbCollections.COMPANIES, { _id: C });
    [[OWNER, 1], [EDITOR, MEMBER_ROLE], [VIEWER, MEMBER_ROLE]].forEach(([userId, roleType]) => {
        mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId, roleType, status: 2, isDelete: false });
    });
    [[OWNER, 'Olive'], [EDITOR, 'Eddie'], [VIEWER, 'Vic']].forEach(([_id, Employee_Name]) => mockDb.seed(SCHEMA_TYPE.USERS, { _id, Employee_Name }));
    process.env.PERMISSION_ENFORCEMENT_MODE = 'enforce';
    process.env.DISPATCHER = 'on';
    adapter.isConfigured = true;
    adapter.chat.mockReset();
    recordAudit.mockClear();
    removeCache.mockClear();
    guess.use(null);
    emitted = [];
    socketEmitter.on('update', (payload) => emitted.push(payload));
});

afterEach(() => {
    socketEmitter.removeAllListeners('update');
    delete process.env.PERMISSION_ENFORCEMENT_MODE;
    delete process.env.DISPATCHER;
});

describe('dispatcher: settings', () => {
    it('saves the settings on the project rule row, clears the cache, announces and logs it', async () => {
        seedRules(GRANTS);
        const project = seedProject();
        const res = await saveSettings(project);
        expect(res.body).toMatchObject({ status: true, data: { mode: 'suggest', threshold: 80, roles: [TRIAGER, REVIEWER], revision: 1 } });
        expect(store(SCHEMA_TYPE.ASSIGNMENT_RULES)).toHaveLength(1);
        expect(store(SCHEMA_TYPE.ASSIGNMENT_RULES)[0].dispatcher).toMatchObject({ mode: 'suggest', updatedBy: EDITOR });
        expect(removeCache).toHaveBeenCalledWith(`assignmentRules:${C}:${project._id}`);
        expect(emitted.some((e) => e.module === 'dispatcherSettings' && e.companyId === C && e.data.projectId === String(project._id))).toBe(true);
        expect(audited('dispatcher.settings_changed')).toEqual([expect.objectContaining({ companyId: C, actorId: EDITOR, entityId: String(project._id) })]);

        const read = await call('GET', SETTINGS_ROUTE, { uid: VIEWER, params: { projectId: String(project._id) } });
        expect(read.body.data).toMatchObject({ on: true, settings: { mode: 'suggest' } });
        expect(read.body.data.roles.map((role) => role.key)).toEqual(expect.arrayContaining([TRIAGER, REVIEWER]));
    });

    it('refuses an unknown role, a rule without a condition and a bad mode', async () => {
        seedRules(GRANTS);
        const project = seedProject();
        expect((await saveSettings(project, { roles: ['it-company/nobody'] })).statusCode).toBe(400);
        expect((await saveSettings(project, { rules: [{ role: TRIAGER, when: {} }] })).statusCode).toBe(400);
        expect((await saveSettings(project, { mode: 'always' })).statusCode).toBe(400);
        expect(store(SCHEMA_TYPE.ASSIGNMENT_RULES)).toHaveLength(0);
    });

    it('refuses someone who may not change the project details', async () => {
        seedRules({ ...GRANTS, 'project.project_details': false });
        const project = seedProject();
        expect((await saveSettings(project)).statusCode).toBe(403);
        expect(store(SCHEMA_TYPE.ASSIGNMENT_RULES)).toHaveLength(0);
    });
});

describe('dispatcher: the gate', () => {
    it('suggests the role of the first matching rule, logs it, announces it and touches only its company', async () => {
        seedRules(GRANTS);
        const project = seedProject();
        await saveSettings(project);
        const task = seedTask(project);
        emitted = [];

        const decision = await routeTask(task);
        expect(decision).toMatchObject({ state: 'suggested', role: TRIAGER, source: 'rule', ruleIndex: 0, mode: 'suggest', taskTypeKey: BUG, agentId: null });
        expect(queueRows()).toHaveLength(0);
        expect(audited('dispatcher.routed')).toEqual([expect.objectContaining({ companyId: C, entityId: String(task._id), meta: expect.objectContaining({ state: 'suggested', role: TRIAGER, source: 'rule' }) })]);
        expect(emitted.some((e) => e.module === 'dispatchDecisions' && e.companyId === C && e.data.state === 'suggested')).toBe(true);
        expect(new Set(mockDb.calls.map((c) => c.companyId).filter((id) => id !== dbCollections.GLOBAL))).toEqual(new Set([C]));

        const shown = await call('GET', TASK_ROUTE, { uid: VIEWER, params: { taskId: String(task._id) } });
        expect(shown.body.data).toMatchObject({ on: true, decision: { state: 'suggested', role: TRIAGER, roleName: 'Bug Triager' } });

        expect(await routeTask(task)).toEqual({ skipped: 'decided' });
    });

    it('matches priority, status, list and custom field values', async () => {
        seedRules(GRANTS);
        const project = seedProject();
        await saveSettings(project, {
            rules: [{ role: REVIEWER, when: { priorities: ['LOW'], statusKeys: [4], sprintIds: ['sprint-2'], fields: [{ id: 'cf-stage', value: 'Review' }] } }],
        });
        const near = seedTask(project, { Task_Priority: 'LOW', statusKey: 4, sprintId: 'sprint-2', customField: { 'cf-stage': { fieldValue: 'Design' } } });
        const hit = seedTask(project, { Task_Priority: 'LOW', statusKey: 4, sprintId: 'sprint-2', customField: { 'cf-stage': { fieldValue: 'Review' } } });
        expect(await routeTask(near)).toMatchObject({ state: 'needs_routing' });
        expect(await routeTask(hit)).toMatchObject({ state: 'suggested', role: REVIEWER });
    });

    it('sends a task no rule matches to Needs routing, listed to people who can open it', async () => {
        seedRules(GRANTS);
        const project = seedProject();
        await saveSettings(project);
        const task = seedTask(project, { TaskTypeKey: FEATURE, Task_Priority: 'HIGH' });
        expect(await routeTask(task)).toMatchObject({ state: 'needs_routing', role: null });

        const listed = await call('GET', NEEDS_ROUTE, { uid: VIEWER, params: { projectId: String(project._id) } });
        expect(listed.body.data.items).toEqual([expect.objectContaining({ task: expect.objectContaining({ _id: String(task._id) }), decision: expect.objectContaining({ state: 'needs_routing' }) })]);
    });

    it('routes nothing while agents are paused in the project or the workspace', async () => {
        seedRules(GRANTS);
        const project = seedProject({ agentLimits: { paused: true } });
        await saveSettings(project);
        expect(await routeTask(seedTask(project))).toEqual({ skipped: 'paused' });

        const other = seedProject();
        await saveSettings(other);
        mockDb.store[dbCollections.COMPANIES][0].agentPolicy = { connectedPaused: true };
        expect(await routeTask(seedTask(other))).toEqual({ skipped: 'paused' });
        expect(decisions()).toHaveLength(0);
    });

    it('skips a rule whose role is unknown or off for the project, and says so', async () => {
        seedRules(GRANTS);
        const project = seedProject();
        await saveSettings(project, { roles: [REVIEWER], rules: [{ role: TRIAGER, when: { taskTypeKeys: [BUG] } }, { role: REVIEWER, when: { tags: ['tag-bug'] } }] });
        mockDb.store[SCHEMA_TYPE.ASSIGNMENT_RULES][0].dispatcher.rules.unshift({ role: 'it-company/retired-role', when: { taskTypeKeys: [BUG] } });
        myCache.flushAll();

        const decision = await routeTask(seedTask(project));
        expect(decision).toMatchObject({ state: 'suggested', role: REVIEWER, ruleIndex: 2 });
        expect(decision.skipped).toEqual([
            { ruleIndex: 0, role: 'it-company/retired-role', why: 'unknown_role' },
            { ruleIndex: 1, role: TRIAGER, why: 'role_off' },
        ]);
    });

    it('puts the task in the role queue at once in apply mode, to the least loaded agent of the role', async () => {
        seedRules(GRANTS);
        const project = seedProject();
        await saveSettings(project, { mode: 'apply' });
        const busy = mockDb.seed(SCHEMA_TYPE.AGENTS, { name: 'Triage A', role: TRIAGER });
        const free = mockDb.seed(SCHEMA_TYPE.AGENTS, { name: 'Triage B', role: TRIAGER });
        mockDb.seed(SCHEMA_TYPE.PROJECT_FINDINGS, { projectId: String(project._id), key: 'handed_over:other', rule: 'handed_over', status: 'open', taskIds: [], facts: { agentId: String(busy._id) } });
        const task = seedTask(project);

        expect(await routeTask(task)).toMatchObject({ state: 'applied', role: TRIAGER, agentId: String(free._id) });
        const row = queueRows().find((r) => r.taskId === String(task._id));
        expect(row).toMatchObject({ status: 'open', key: `handed_over:${task._id}`, facts: expect.objectContaining({ role: TRIAGER, agentId: String(free._id) }) });
        expect(await routeTask(seedTask(project, { TaskName: 'Another' }))).toMatchObject({ state: 'applied' });
        expect(task.AssigneeUserId).toEqual([]);
    });

    it('never picks an agent of the role that is limited to other projects', async () => {
        seedRules(GRANTS);
        const project = seedProject();
        await saveSettings(project, { mode: 'apply' });
        mockDb.seed(SCHEMA_TYPE.AGENTS, { name: 'Elsewhere', role: TRIAGER, projectIds: [oid()] });
        const here = mockDb.seed(SCHEMA_TYPE.AGENTS, { name: 'Here', role: TRIAGER, projectIds: [String(project._id)] });
        mockDb.seed(SCHEMA_TYPE.PROJECT_FINDINGS, { projectId: String(project._id), key: 'handed_over:x', rule: 'handed_over', status: 'open', taskIds: [], facts: { agentId: String(here._id) } });
        expect(await routeTask(seedTask(project))).toMatchObject({ agentId: String(here._id) });
    });

    it('lets an agent play a known role only', async () => {
        const { roleOf } = require('../Modules/Agents/agentRole');
        expect(roleOf(TRIAGER)).toBe(TRIAGER);
        expect(roleOf('')).toBe('');
        expect(() => roleOf('it-company/nobody')).toThrow(/no role/);
        expect(() => roleOf('a/b/c')).toThrow(/no role/);
        const { createAgentRecord } = require('../Modules/Agents/agentRecord');
        await expect(createAgentRecord(C, { name: 'Bad', role: 'it-company/nobody' }, { ownerId: OWNER })).rejects.toThrow(/no role/);
        expect(store(SCHEMA_TYPE.AGENTS)).toHaveLength(0);
    });

    it('takes a model guess only at or above the threshold, without calling a model itself', async () => {
        seedRules(GRANTS);
        const project = seedProject();
        await saveSettings(project, { modelGuess: true, rules: [], threshold: 80 });
        const guesser = jest.fn(async () => ({ role: REVIEWER, confidence: 70 }));
        guess.use(guesser);
        expect(await routeTask(seedTask(project))).toMatchObject({ state: 'needs_routing' });
        guesser.mockImplementation(async () => ({ role: REVIEWER, confidence: 85 }));
        expect(await routeTask(seedTask(project, { TaskName: 'Second' }))).toMatchObject({ state: 'suggested', role: REVIEWER, source: 'model', confidence: 85 });
        expect(guesser.mock.calls[0][0].task).toEqual({ title: expect.any(String), type: 'Bug', tags: ['bug'], description: expect.any(String) });
        expect(adapter.chat).not.toHaveBeenCalled();
    });

    it('never routes a task that is done or closed', async () => {
        seedRules(GRANTS);
        const project = seedProject();
        await saveSettings(project, { mode: 'apply' });
        expect(await routeTask(seedTask(project, { statusType: 'close' }))).toEqual({ skipped: 'closed' });
        expect(await routeTask(seedTask(project, { statusType: 'done' }))).toEqual({ skipped: 'closed' });
        expect(decisions()).toHaveLength(0);
        expect(queueRows()).toHaveLength(0);
    });

    it('does not put back a task an agent finished, withdrew or a person took back; a lead can', async () => {
        seedRules(GRANTS);
        const project = seedProject();
        await saveSettings(project, { mode: 'apply' });
        const task = seedTask(project);
        const row = mockDb.seed(SCHEMA_TYPE.PROJECT_FINDINGS, {
            projectId: String(project._id), key: `handed_over:${task._id}`, rule: 'handed_over', status: 'closed', taskId: String(task._id), taskIds: [String(task._id)],
            facts: { role: TRIAGER }, leftQueue: { why: 'finished', at: new Date() },
        });
        expect(await routeTask(task)).toEqual({ skipped: 'left_queue' });
        const queue = require('../Modules/AssignmentRules/dispatcher/queue');
        expect(await queue.put(C, task, { role: TRIAGER, by: 'dispatcher' })).toBe(false);
        expect(row.status).toBe('closed');
        expect(await queue.put(C, task, { role: TRIAGER, by: EDITOR, byPerson: true })).toBe(true);
        expect(queueRows()[0]).toMatchObject({ status: 'open', facts: expect.objectContaining({ role: TRIAGER, handedBy: EDITOR }) });
    });

    it('does nothing with the flag off', async () => {
        seedRules(GRANTS);
        const project = seedProject();
        await saveSettings(project);
        delete process.env.DISPATCHER;
        const task = seedTask(project);
        expect(await routeTask(task)).toEqual({ skipped: 'flag_off' });
        expect(decisions()).toHaveLength(0);
        expect((await call('GET', TASK_ROUTE, { params: { taskId: String(task._id) } })).body.data).toEqual({ on: false, decision: null, roles: [] });
        expect((await saveSettings(project, { mode: 'apply' })).statusCode).toBe(404);
    });

    it('does nothing in a project whose dispatcher is off', async () => {
        seedRules(GRANTS);
        const project = seedProject();
        await saveSettings(project, { mode: 'off' });
        expect(await routeTask(seedTask(project))).toEqual({ skipped: 'off' });
    });

    it('routes a created task off the request path', async () => {
        seedRules(GRANTS);
        const project = seedProject();
        await saveSettings(project);
        const task = seedTask(project);
        gate.start();
        domainEventBus.bus.emit('domain.event', { id: oid(), companyId: C, type: 'task.created', actor: { kind: 'user', userId: EDITOR }, depth: 0, entity: { kind: 'task', id: String(task._id) }, changedFields: [] });
        await gate.idle();
        expect(decisions()).toEqual([expect.objectContaining({ taskId: String(task._id), state: 'suggested' })]);
    });
});

describe('dispatcher: a lead decides', () => {
    const suggested = async (doc = {}) => {
        seedRules(GRANTS);
        const project = seedProject();
        await saveSettings(project);
        const task = seedTask(project, doc);
        const decision = await routeTask(task);
        return { project, task, decision };
    };

    it('accepting puts the task in the role queue and logs it', async () => {
        const { task, decision } = await suggested();
        const res = await act('accept', task, decision);
        expect(res.body).toMatchObject({ status: true, data: { decision: { state: 'accepted', role: TRIAGER } } });
        expect(queueRows()).toEqual([expect.objectContaining({ taskId: String(task._id), status: 'open', facts: expect.objectContaining({ role: TRIAGER, handedBy: EDITOR }) })]);
        expect(audited('dispatcher.suggestion.accept')).toEqual([expect.objectContaining({ companyId: C, actorId: EDITOR, entityId: String(task._id) })]);
        expect(emitted.some((e) => e.module === 'dispatchDecisions' && e.data.state === 'accepted')).toBe(true);
        expect((await act('accept', task, decision)).statusCode).toBe(409);
    });

    it('dismissing leaves the queue alone and logs it', async () => {
        const { task, decision } = await suggested();
        const res = await act('dismiss', task, decision);
        expect(res.body.data.decision.state).toBe('dismissed');
        expect(queueRows()).toHaveLength(0);
        expect(audited('dispatcher.suggestion.dismiss')).toEqual([expect.objectContaining({ actorId: EDITOR, entityId: String(task._id) })]);
    });

    it('leaves accept, dismiss and route to leads, who may change the project details', async () => {
        seedRules({ ...GRANTS, 'project.project_details': false });
        const project = seedProject();
        await saveSettings(project, {}, OWNER);
        const task = seedTask(project);
        const decision = await routeTask(task);
        for (const action of ['accept', 'dismiss', 'route']) {
            // eslint-disable-next-line no-await-in-loop
            expect((await act(action, task, decision, { body: { role: REVIEWER } })).statusCode).toBe(403);
        }
        expect(decisions()[0].state).toBe('suggested');
        expect(queueRows()).toHaveLength(0);
        expect((await act('accept', task, decision, { uid: OWNER })).statusCode).toBe(200);
    });

    it('refuses to act on an old suggestion once the project turns the dispatcher off, and says why', async () => {
        const { project, task, decision } = await suggested();
        await saveSettings(project, { mode: 'off' });
        for (const action of ['accept', 'dismiss', 'route']) {
            // eslint-disable-next-line no-await-in-loop
            const res = await act(action, task, decision, { body: { role: REVIEWER } });
            expect(res.statusCode).toBe(409);
            expect(res.body.statusText).toMatch(/dispatcher is off/);
        }
        expect(queueRows()).toHaveLength(0);
    });

    it('gives the decision back to the leads when the queue write fails', async () => {
        const queue = require('../Modules/AssignmentRules/dispatcher/queue');
        const { task, decision } = await suggested();
        const spy = jest.spyOn(queue, 'put').mockRejectedValueOnce(new Error('queue down'));
        expect((await act('accept', task, decision)).statusCode).toBe(500);
        spy.mockRestore();
        expect(decisions()[0].state).toBe('suggested');
        expect(decisions()[0].resolvedAt).toBeUndefined();
        expect(decisions()[0].resolvedBy).toBe('');
        expect((await act('accept', task, decision)).statusCode).toBe(200);
    });

    it('will not route a task that is done', async () => {
        const { task, decision } = await suggested();
        store(SCHEMA_TYPE.TASKS).find((row) => String(row._id) === String(task._id)).statusType = 'close';
        const res = await act('accept', task, decision);
        expect(res.statusCode).toBe(409);
        expect(queueRows()).toHaveLength(0);
    });

    it('will not accept once agents are paused in the project', async () => {
        const { project, task, decision } = await suggested();
        mockDb.store[SCHEMA_TYPE.PROJECTS].find((p) => String(p._id) === String(project._id)).agentLimits = { paused: true };
        expect((await act('accept', task, decision)).statusCode).toBe(409);
        expect(queueRows()).toHaveLength(0);
    });

    it('offers a rule after the same override three times, and never adds it', async () => {
        seedRules(GRANTS);
        const project = seedProject();
        await saveSettings(project);
        const offers = [];
        for (let n = 0; n < 3; n += 1) {
            const task = seedTask(project, { TaskName: `Bug ${n}` });
            // eslint-disable-next-line no-await-in-loop
            const decision = await routeTask(task);
            // eslint-disable-next-line no-await-in-loop
            const res = await act('route', task, decision, { body: { role: REVIEWER } });
            expect(res.body.data.decision).toMatchObject({ state: 'routed', chosenRole: REVIEWER, resolvedBy: EDITOR, roleName: 'Code Reviewer' });
            offers.push(res.body.data.offer);
        }
        expect(offers.slice(0, 2)).toEqual([null, null]);
        expect(offers[2]).toMatchObject({ role: { key: REVIEWER }, when: { taskTypeKeys: [BUG] }, times: 3 });
        expect(store(SCHEMA_TYPE.ASSIGNMENT_RULES)[0].dispatcher.rules).toHaveLength(2);
        expect(audited('dispatcher.suggestion.route')).toHaveLength(3);

        const added = await call('POST', RULES_ROUTE, { params: { projectId: String(project._id) }, body: { role: REVIEWER, when: offers[2].when } });
        expect(added.body.data.rules).toHaveLength(3);
        expect(audited('dispatcher.rule_added')).toHaveLength(1);
    });

    it('routes a task from Needs routing to the role a lead picks', async () => {
        const { task, decision } = await suggested({ TaskTypeKey: FEATURE });
        expect(decision.state).toBe('needs_routing');
        const res = await act('route', task, decision, { body: { role: REVIEWER } });
        expect(res.body.data.decision).toMatchObject({ state: 'routed', chosenRole: REVIEWER });
        expect(queueRows()[0].facts.role).toBe(REVIEWER);
        expect((await act('route', task, decision, { body: { role: 'it-company/nobody' } })).statusCode).toBe(409);
    });

    it('refuses a role that is off for the project', async () => {
        const { task, decision } = await suggested({ TaskTypeKey: FEATURE });
        expect((await act('route', task, decision, { body: { role: 'it-company/brand-guardian' } })).statusCode).toBe(409);
        expect(queueRows()).toHaveLength(0);
    });
});
