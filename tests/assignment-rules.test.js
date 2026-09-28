const verified = require('./fixtures/verifiedRequest');
const fakeMongo = require('./fixtures/fakeMongo');

let mockDb;
const mockUpdateAssignee = jest.fn();
jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (...args) => mockDb.crud(...args),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn((key) => require('../Config/config').myCache.del(key)) }));
jest.mock('../Modules/notification/prepare-notification-data/controllerV2', () => ({ handleNotificationtFun: jest.fn(async () => ({ status: true })) }));
jest.mock('../Modules/Tasks/helpers/task_class_Mongo', () => ({ taskMongo: { updateAssignee: (...args) => mockUpdateAssignee(...args) } }));
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
const adapter = require('../Modules/AICore/llmProvider/openaiProvider');
const aiSwitch = require('../Modules/AICore/aiSwitch');
const { FEATURES } = require('../Modules/AICore/features');
const engine = require('../Modules/AssignmentRules/engine');

const C = 'c00000000000000000000001';
const OWNER = 'a00000000000000000000001';
const EDITOR = 'a00000000000000000000002';
const PRIYA = 'a00000000000000000000003';
const SAM = 'a00000000000000000000004';
const OUTSIDER = 'a00000000000000000000005';
const FORMER = 'a00000000000000000000006';
const MEMBER_ROLE = 3;

const PROJECT_ROUTE = '/api/v2/assignment-rules/project/:projectId';
const DRAFT_ROUTE = '/api/v2/assignment-rules/project/:projectId/draft';
const TASK_ROUTE = '/api/v2/assignment-rules/task/:taskId';
const decisionRoute = (action) => `/api/v2/assignment-rules/task/:taskId/decisions/:decisionId/${action}`;

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
    return run(handlers, verified({ uid, params, body, query: {}, headers: { companyid: C } }));
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

const GRANTS = { 'project.private_projects': 1, 'project.project_details': true, 'task.task_assignee': true };

const seedProject = (doc = {}) => mockDb.seed(SCHEMA_TYPE.PROJECTS, {
    _id: oid(), ProjectName: 'Launch', ProjectCode: 'LCH', CompanyId: C, isPrivateSpace: true,
    AssigneeUserId: [OWNER, EDITOR, PRIYA, SAM, FORMER], isGlobalPermission: true, tagsArray: [{ uid: 'tag-ui', name: 'frontend' }], ...doc,
});

const seedTask = (project, doc = {}) => mockDb.seed(SCHEMA_TYPE.TASKS, {
    _id: oid(),
    ProjectID: String(project._id),
    CompanyId: C,
    TaskName: 'Button misaligned on the login page',
    rawDescription: 'The submit button overflows on Safari.',
    TaskType: 'Bug',
    TaskTypeKey: 2,
    tagsArray: ['tag-ui'],
    AssigneeUserId: [],
    sprintId: 'sprint-1',
    statusType: 'default_active',
    deletedStatusKey: 0,
    isParentTask: true,
    createdAt: new Date(),
    ...doc,
});

const RULE_BODY = (over = {}) => ({
    entries: [
        { userId: PRIYA, when: 'Frontend bugs and anything about the UI' },
        { userId: SAM, when: 'Backend, API and database work' },
    ],
    fallbackUserId: null,
    onCreate: true,
    onChange: false,
    mode: 'suggest',
    ...over,
});

const saveRules = (project, over = {}) => call('PUT', PROJECT_ROUTE, { params: { projectId: String(project._id) }, body: RULE_BODY(over) });

const answer = (content) => ({ content: typeof content === 'string' ? content : JSON.stringify(content), inputTokens: 300, outputTokens: 40, totalTokens: 340, model: 'gpt-4.1' });
const modelPicks = (userId, reason = 'matched her rule: frontend bugs') => adapter.chat.mockImplementation(async () => answer({ userId, reason }));

const store = (type) => mockDb.store[type] || [];
const decisions = () => store(SCHEMA_TYPE.ASSIGNMENT_DECISIONS);
const taskRow = (task) => store(SCHEMA_TYPE.TASKS).find((t) => String(t._id) === String(task._id));

let emitted;
beforeEach(() => {
    myCache.flushAll();
    aiSwitch.forget();
    mockDb = fakeMongo.create();
    mockDb.seed(dbCollections.COMPANIES, { _id: C });
    [[OWNER, 1], [EDITOR, MEMBER_ROLE], [PRIYA, MEMBER_ROLE], [SAM, MEMBER_ROLE], [OUTSIDER, MEMBER_ROLE]].forEach(([userId, roleType]) => {
        mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId, roleType, status: 2, isDelete: false });
    });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: FORMER, roleType: MEMBER_ROLE, status: 2, isDelete: true });
    [[OWNER, 'Olive'], [EDITOR, 'Eddie'], [PRIYA, 'Priya'], [SAM, 'Sam'], [OUTSIDER, 'Otto'], [FORMER, 'Fern']].forEach(([_id, Employee_Name]) => {
        mockDb.seed(SCHEMA_TYPE.USERS, { _id, Employee_Name });
    });
    process.env.PERMISSION_ENFORCEMENT_MODE = 'enforce';
    delete process.env.AI_ENABLED;
    delete process.env.LLM_PROVIDER;
    adapter.isConfigured = true;
    adapter.chat.mockReset();
    modelPicks(PRIYA);
    mockUpdateAssignee.mockReset();
    mockUpdateAssignee.mockImplementation(async ({ firebaseObj, taskData, type }) => {
        const row = store(SCHEMA_TYPE.TASKS).find((t) => String(t._id) === String(taskData._id));
        const id = firebaseObj.AssigneeUserId;
        if (type === 'assigneeAdd') row.AssigneeUserId = [...new Set([...(row.AssigneeUserId || []), id])];
        if (type === 'assigneRemove') row.AssigneeUserId = (row.AssigneeUserId || []).filter((x) => x !== id);
        return { status: true };
    });
    emitted = [];
    socketEmitter.on('update', (payload) => emitted.push(payload));
});

afterEach(() => {
    socketEmitter.removeAllListeners('update');
    delete process.env.PERMISSION_ENFORCEMENT_MODE;
});

describe('assignment rules: saving and reading', () => {
    it('saves one rule set per project in the company database, clears its cache and announces it', async () => {
        seedRules(GRANTS);
        const project = seedProject();

        const res = await saveRules(project);
        expect(res.body).toMatchObject({ status: true });
        const rows = store(SCHEMA_TYPE.ASSIGNMENT_RULES);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            projectId: String(project._id), fallbackUserId: null, onCreate: true, onChange: false, mode: 'suggest', updatedBy: EDITOR,
        });
        expect(rows[0].entries.map((e) => [e.userId, e.when])).toEqual([[PRIYA, 'Frontend bugs and anything about the UI'], [SAM, 'Backend, API and database work']]);
        expect(rows[0].updatedAt).toBeInstanceOf(Date);
        expect(removeCache).toHaveBeenCalledWith(`assignmentRules:${C}:${project._id}`);
        expect(emitted.some((e) => e.module === 'assignmentRules' && e.data.projectId === String(project._id))).toBe(true);
        expect(new Set(mockDb.calls.map((c) => c.companyId).filter((id) => id !== dbCollections.GLOBAL))).toEqual(new Set([C]));

        await saveRules(project, { mode: 'apply', onChange: true });
        expect(store(SCHEMA_TYPE.ASSIGNMENT_RULES)).toHaveLength(1);
        expect(store(SCHEMA_TYPE.ASSIGNMENT_RULES)[0]).toMatchObject({ mode: 'apply', onChange: true });

        const read = await call('GET', PROJECT_ROUTE, { uid: PRIYA, params: { projectId: String(project._id) } });
        expect(read.body.status).toBe(true);
        expect(read.body.data.rules).toMatchObject({ projectId: String(project._id), mode: 'apply' });
        expect(read.body.data.ai).toMatchObject({ state: 'on' });
    });

    it('refuses an editor without the project details permission', async () => {
        seedRules({ ...GRANTS, 'project.project_details': false });
        const project = seedProject();
        const res = await saveRules(project);
        expect(res.statusCode).toBe(403);
        expect(store(SCHEMA_TYPE.ASSIGNMENT_RULES)).toHaveLength(0);
    });

    it('hides the rules of a private project from someone who cannot open it', async () => {
        seedRules(GRANTS);
        const project = seedProject();
        await saveRules(project);
        const res = await call('GET', PROJECT_ROUTE, { uid: OUTSIDER, params: { projectId: String(project._id) } });
        expect(res.statusCode).toBe(404);
        expect(JSON.stringify(res.body)).not.toContain('Frontend bugs');
    });

    it.each([
        ['a person who cannot open the project', { entries: [{ userId: OUTSIDER, when: 'anything' }] }],
        ['a removed member', { entries: [{ userId: FORMER, when: 'anything' }] }],
        ['a fallback who cannot open the project', { fallbackUserId: OUTSIDER }],
        ['the same person twice', { entries: [{ userId: PRIYA, when: 'a' }, { userId: PRIYA, when: 'b' }] }],
        ['an empty sentence', { entries: [{ userId: PRIYA, when: '   ' }] }],
        ['an unknown mode', { mode: 'always' }],
    ])('refuses rules naming %s', async (_label, over) => {
        seedRules(GRANTS);
        const project = seedProject();
        const res = await saveRules(project, over);
        expect(res.statusCode).toBe(400);
        expect(res.body.status).toBe(false);
        expect(store(SCHEMA_TYPE.ASSIGNMENT_RULES)).toHaveLength(0);
    });
});

describe('assignment rules: deciding for a created task', () => {
    it('suggests the person the model picks, with its reason, through the shared AI core', async () => {
        seedRules(GRANTS);
        const project = seedProject();
        await saveRules(project);
        const task = seedTask(project);

        const out = await engine.decide({ companyId: C, taskId: String(task._id), trigger: 'create' });

        expect(adapter.chat).toHaveBeenCalledTimes(1);
        const request = adapter.chat.mock.calls[0][0];
        expect(request.spend).toMatchObject({ feature: FEATURES.ASSIGNMENT_RULES, companyId: C });
        const prompt = request.messages.map((m) => m.content).join('\n');
        expect(prompt).toContain('<workspace_data>');
        expect(prompt).toContain('Button misaligned on the login page');
        expect(prompt).toContain('frontend');
        expect(prompt).toContain('Frontend bugs and anything about the UI');
        expect(prompt).toContain(PRIYA);

        expect(out).toMatchObject({ state: 'suggested', userId: PRIYA });
        expect(decisions()).toHaveLength(1);
        expect(decisions()[0]).toMatchObject({
            taskId: String(task._id), projectId: String(project._id), state: 'suggested', userId: PRIYA, source: 'model',
            reason: 'matched her rule: frontend bugs', model: 'gpt-4.1', mode: 'suggest', trigger: 'create',
        });
        expect(mockUpdateAssignee).not.toHaveBeenCalled();
        expect(taskRow(task).AssigneeUserId).toEqual([]);

        const usage = store(SCHEMA_TYPE.AI_USAGE);
        expect(usage).toHaveLength(1);
        expect(usage[0]).toMatchObject({ companyId: C, feature: 'assignment_rules', model: 'gpt-4.1', billedToWorkspace: true });

        const history = store(SCHEMA_TYPE.HISTORY).filter((h) => h.TaskId === String(task._id));
        expect(history).toHaveLength(1);
        expect(history[0]).toMatchObject({ Type: 'task', Key: 'AI_Assignment_Suggested', ProjectId: String(project._id) });
        expect(history[0].Message).toContain('Priya');
        expect(history[0].Message).toContain('matched her rule: frontend bugs');
        expect(history[0].Message).toContain('gpt-4.1');

        const read = await call('GET', TASK_ROUTE, { uid: SAM, params: { taskId: String(task._id) } });
        expect(read.body.data.decision).toMatchObject({ state: 'suggested', userId: PRIYA, reason: 'matched her rule: frontend bugs' });
    });

    it('never calls the model for a task that already has an assignee', async () => {
        seedRules(GRANTS);
        const project = seedProject();
        await saveRules(project);
        const task = seedTask(project, { AssigneeUserId: [SAM] });

        await engine.decide({ companyId: C, taskId: String(task._id), trigger: 'create' });

        expect(adapter.chat).not.toHaveBeenCalled();
        expect(decisions()).toHaveLength(0);
        expect(taskRow(task).AssigneeUserId).toEqual([SAM]);
    });

    it('does not overwrite an assignee a person set while the model was answering', async () => {
        seedRules(GRANTS);
        const project = seedProject();
        await saveRules(project, { mode: 'apply' });
        const task = seedTask(project);
        adapter.chat.mockImplementation(async () => {
            taskRow(task).AssigneeUserId = [SAM];
            return answer({ userId: PRIYA, reason: 'frontend bug' });
        });

        const out = await engine.decide({ companyId: C, taskId: String(task._id), trigger: 'create' });

        expect(out.state).toBe('stale');
        expect(mockUpdateAssignee).not.toHaveBeenCalled();
        expect(taskRow(task).AssigneeUserId).toEqual([SAM]);
    });

    it('makes no call and no decision while AI is off for the workspace', async () => {
        seedRules(GRANTS);
        const project = seedProject();
        await saveRules(project, { fallbackUserId: SAM });
        store(dbCollections.COMPANIES)[0].aiSwitch = { enabled: false };
        aiSwitch.forget();
        const task = seedTask(project);

        await engine.decide({ companyId: C, taskId: String(task._id), trigger: 'create' });

        expect(adapter.chat).not.toHaveBeenCalled();
        expect(decisions()).toHaveLength(0);
        expect(store(SCHEMA_TYPE.AI_USAGE)).toHaveLength(0);
    });

    it('makes no call and no decision when no model is configured, fallback included', async () => {
        seedRules(GRANTS);
        const project = seedProject();
        await saveRules(project, { fallbackUserId: SAM });
        adapter.isConfigured = false;
        const task = seedTask(project);

        await engine.decide({ companyId: C, taskId: String(task._id), trigger: 'create' });

        expect(adapter.chat).not.toHaveBeenCalled();
        expect(decisions()).toHaveLength(0);
        expect(mockUpdateAssignee).not.toHaveBeenCalled();
    });

    it('decides once per task revision', async () => {
        seedRules(GRANTS);
        const project = seedProject();
        await saveRules(project, { onChange: true });
        const task = seedTask(project);

        await engine.decide({ companyId: C, taskId: String(task._id), trigger: 'create' });
        await engine.decide({ companyId: C, taskId: String(task._id), trigger: 'create' });
        expect(adapter.chat).toHaveBeenCalledTimes(1);

        await call('POST', decisionRoute('dismiss'), { uid: SAM, params: { taskId: String(task._id), decisionId: String(decisions()[0]._id) } });
        taskRow(task).TaskName = 'Login API returns 500';
        await engine.decide({ companyId: C, taskId: String(task._id), trigger: 'change' });
        expect(adapter.chat).toHaveBeenCalledTimes(2);
        expect(decisions()).toHaveLength(2);
    });

    it('stops at the daily limit', async () => {
        seedRules(GRANTS);
        const project = seedProject();
        await saveRules(project);
        for (let i = 0; i < engine.DAILY_DECISION_LIMIT; i += 1) {
            mockDb.seed(SCHEMA_TYPE.ASSIGNMENT_DECISIONS, { taskId: oid(), projectId: String(project._id), inputHash: `h${i}`, state: 'suggested', createdAt: new Date() });
        }
        const task = seedTask(project);

        const out = await engine.decide({ companyId: C, taskId: String(task._id), trigger: 'create' });

        expect(out).toMatchObject({ skipped: 'daily_limit' });
        expect(adapter.chat).not.toHaveBeenCalled();
    });
});

describe('assignment rules: what the model may pick', () => {
    it('falls back when the model names someone outside the rule list', async () => {
        seedRules(GRANTS);
        const project = seedProject();
        await saveRules(project, { fallbackUserId: SAM });
        modelPicks(OWNER, 'the owner handles everything');
        const task = seedTask(project);

        const out = await engine.decide({ companyId: C, taskId: String(task._id), trigger: 'create' });

        expect(out).toMatchObject({ state: 'suggested', userId: SAM, source: 'fallback' });
        expect(decisions()[0]).toMatchObject({ userId: SAM, source: 'fallback', rejectedUserId: OWNER });
    });

    it('falls back when the picked person cannot open the task', async () => {
        seedRules(GRANTS);
        const project = seedProject();
        await saveRules(project, { fallbackUserId: SAM });
        const sprint = mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: oid(), projectId: String(project._id), private: true, AssigneeUserId: [OWNER, SAM] });
        const task = seedTask(project, { sprintId: String(sprint._id) });

        const out = await engine.decide({ companyId: C, taskId: String(task._id), trigger: 'create' });

        expect(adapter.chat).toHaveBeenCalledTimes(1);
        const prompt = adapter.chat.mock.calls[0][0].messages.map((m) => m.content).join('\n');
        expect(prompt).not.toContain(PRIYA);
        expect(out).toMatchObject({ userId: SAM, source: 'fallback' });
    });

    it('records no match and shows nothing when the model matches nobody and there is no fallback', async () => {
        seedRules(GRANTS);
        const project = seedProject();
        await saveRules(project);
        modelPicks(null, 'no rule matches a billing question');
        const task = seedTask(project);

        const out = await engine.decide({ companyId: C, taskId: String(task._id), trigger: 'create' });

        expect(out).toMatchObject({ state: 'no_match', userId: null });
        const read = await call('GET', TASK_ROUTE, { uid: SAM, params: { taskId: String(task._id) } });
        expect(read.body.data.decision).toBeNull();
    });

    it('treats an unreadable answer as a failure, not a match', async () => {
        seedRules(GRANTS);
        const project = seedProject();
        await saveRules(project, { fallbackUserId: SAM });
        adapter.chat.mockImplementation(async () => answer('Priya, probably'));
        const task = seedTask(project);

        const out = await engine.decide({ companyId: C, taskId: String(task._id), trigger: 'create' });

        expect(out.state).toBe('failed');
        expect(mockUpdateAssignee).not.toHaveBeenCalled();
    });
});

describe('assignment rules: apply mode', () => {
    it('assigns through the normal assignee path and can be undone', async () => {
        seedRules(GRANTS);
        const project = seedProject();
        await saveRules(project, { mode: 'apply' });
        const task = seedTask(project);

        const out = await engine.decide({ companyId: C, taskId: String(task._id), trigger: 'create' });

        expect(out).toMatchObject({ state: 'applied', userId: PRIYA });
        expect(mockUpdateAssignee).toHaveBeenCalledTimes(1);
        const [assign] = mockUpdateAssignee.mock.calls[0];
        expect(assign).toMatchObject({
            firebaseObj: { AssigneeUserId: PRIYA }, type: 'assigneeAdd', isUpdateTask: true, employeeName: 'Priya',
            projectData: { _id: String(project._id), CompanyId: C, ProjectName: 'Launch' },
        });
        expect(String(assign.taskData._id)).toBe(String(task._id));
        expect(assign.userData).toMatchObject({ id: EDITOR, Employee_Name: 'Assignment rules' });
        expect(assign).toMatchObject({ actor: { kind: 'automation', userId: EDITOR }, depth: 1 });
        expect(taskRow(task).AssigneeUserId).toEqual([PRIYA]);

        const read = await call('GET', TASK_ROUTE, { uid: SAM, params: { taskId: String(task._id) } });
        expect(read.body.data.decision).toMatchObject({ state: 'applied', userId: PRIYA });

        const undo = await call('POST', decisionRoute('undo'), { uid: SAM, params: { taskId: String(task._id), decisionId: String(decisions()[0]._id) } });
        expect(undo.body.status).toBe(true);
        expect(mockUpdateAssignee).toHaveBeenCalledTimes(2);
        expect(mockUpdateAssignee.mock.calls[1][0]).toMatchObject({ firebaseObj: { AssigneeUserId: PRIYA }, type: 'assigneRemove', userData: { id: SAM }, actor: { kind: 'user', userId: SAM } });
        expect(taskRow(task).AssigneeUserId).toEqual([]);
        expect(decisions()[0]).toMatchObject({ state: 'undone', resolvedBy: SAM });
    });

    it('refuses an undo from someone who may not change assignees', async () => {
        seedRules({ ...GRANTS, 'task.task_assignee': false });
        const project = seedProject();
        mockDb.seed(SCHEMA_TYPE.ASSIGNMENT_RULES, { projectId: String(project._id), entries: [{ userId: PRIYA, when: 'Frontend bugs' }], fallbackUserId: null, onCreate: true, onChange: false, mode: 'apply', updatedBy: OWNER, updatedAt: new Date(), revision: 1 });
        const task = seedTask(project);
        await engine.decide({ companyId: C, taskId: String(task._id), trigger: 'create' });

        const undo = await call('POST', decisionRoute('undo'), { uid: SAM, params: { taskId: String(task._id), decisionId: String(decisions()[0]._id) } });
        expect(undo.statusCode).toBe(403);
        expect(taskRow(task).AssigneeUserId).toEqual([PRIYA]);
    });
});

describe('assignment rules: acting on a suggestion', () => {
    const suggested = async () => {
        seedRules(GRANTS);
        const project = seedProject();
        await saveRules(project);
        const task = seedTask(project);
        await engine.decide({ companyId: C, taskId: String(task._id), trigger: 'create' });
        return { project, task, params: { taskId: String(task._id), decisionId: String(decisions()[0]._id) } };
    };

    it('assigns the suggested person as the person who accepted it', async () => {
        const { task, params } = await suggested();
        const res = await call('POST', decisionRoute('accept'), { uid: SAM, params });
        expect(res.body.status).toBe(true);
        expect(mockUpdateAssignee).toHaveBeenCalledTimes(1);
        expect(mockUpdateAssignee.mock.calls[0][0]).toMatchObject({ firebaseObj: { AssigneeUserId: PRIYA }, type: 'assigneeAdd', userData: { id: SAM, Employee_Name: 'Sam' }, actor: { kind: 'user', userId: SAM } });
        expect(taskRow(task).AssigneeUserId).toEqual([PRIYA]);
        expect(decisions()[0]).toMatchObject({ state: 'accepted', resolvedBy: SAM });
    });

    it('leaves the task alone on dismiss and stops showing the suggestion', async () => {
        const { task, params } = await suggested();
        const res = await call('POST', decisionRoute('dismiss'), { uid: SAM, params });
        expect(res.body.status).toBe(true);
        expect(mockUpdateAssignee).not.toHaveBeenCalled();
        expect(decisions()[0]).toMatchObject({ state: 'dismissed', resolvedBy: SAM });
        const read = await call('GET', TASK_ROUTE, { uid: SAM, params: { taskId: String(task._id) } });
        expect(read.body.data.decision).toBeNull();
    });

    it('will not accept once someone else has assigned the task', async () => {
        const { task, params } = await suggested();
        taskRow(task).AssigneeUserId = [SAM];
        const res = await call('POST', decisionRoute('accept'), { uid: SAM, params });
        expect(res.statusCode).toBe(409);
        expect(mockUpdateAssignee).not.toHaveBeenCalled();
        expect(taskRow(task).AssigneeUserId).toEqual([SAM]);
    });

    it('does not show a suggestion to someone who cannot open the project', async () => {
        const { params } = await suggested();
        const res = await call('GET', TASK_ROUTE, { uid: OUTSIDER, params: { taskId: params.taskId } });
        expect(res.statusCode).toBe(404);
        const accept = await call('POST', decisionRoute('accept'), { uid: OUTSIDER, params });
        expect(accept.statusCode).toBe(404);
        expect(mockUpdateAssignee).not.toHaveBeenCalled();
    });
});

describe('assignment rules: the task events that wake the engine', () => {
    const envelope = (task, type, changedFields = []) => ({
        id: oid(), companyId: C, type, actor: { kind: 'user', userId: EDITOR }, depth: 0,
        entity: { kind: 'task', id: String(task._id) },
        data: { _id: String(task._id), AssigneeUserId: task.AssigneeUserId || [], ProjectID: String(task.ProjectID) },
        changedFields,
    });

    beforeAll(() => engine.start());

    it('decides after a task is created, off the request path', async () => {
        seedRules(GRANTS);
        const project = seedProject();
        await saveRules(project);
        const task = seedTask(project);

        domainEventBus.bus.emit('domain.event', envelope(task, 'task.created'));
        await engine.idle();

        expect(adapter.chat).toHaveBeenCalledTimes(1);
        expect(decisions()[0]).toMatchObject({ state: 'suggested', trigger: 'create' });
    });

    it('ignores created tasks when autofill on create is off', async () => {
        seedRules(GRANTS);
        const project = seedProject();
        await saveRules(project, { onCreate: false, onChange: true });
        const task = seedTask(project);

        domainEventBus.bus.emit('domain.event', envelope(task, 'task.created'));
        await engine.idle();

        expect(adapter.chat).not.toHaveBeenCalled();
    });

    it('reacts to a title, description, type or tag change only when auto update is on', async () => {
        seedRules(GRANTS);
        const project = seedProject();
        await saveRules(project);
        const task = seedTask(project);

        domainEventBus.bus.emit('domain.event', envelope(task, 'task.renamed', ['TaskName']));
        await engine.idle();
        expect(adapter.chat).not.toHaveBeenCalled();

        await saveRules(project, { onChange: true });
        domainEventBus.bus.emit('domain.event', envelope(task, 'task.updated', ['tagsArray']));
        await engine.idle();
        expect(adapter.chat).toHaveBeenCalledTimes(1);
        expect(decisions()[0]).toMatchObject({ trigger: 'change' });

        domainEventBus.bus.emit('domain.event', envelope(task, 'task.priority_changed', ['Task_Priority']));
        await engine.idle();
        expect(adapter.chat).toHaveBeenCalledTimes(1);
    });

    it('writes one level deeper than the event it answers, and never wakes on its own assignee write', async () => {
        seedRules(GRANTS);
        const project = seedProject();
        await saveRules(project, { mode: 'apply', onChange: true });
        const task = seedTask(project);

        domainEventBus.bus.emit('domain.event', { ...envelope(task, 'task.created'), depth: 1 });
        await engine.idle();
        expect(mockUpdateAssignee.mock.calls[0][0]).toMatchObject({ actor: { kind: 'automation' }, depth: 2 });

        const ownWrite = { ...envelope({ ...task, AssigneeUserId: [] }, 'task.assignee_changed', ['AssigneeUserId']), actor: { kind: 'automation', userId: EDITOR }, depth: 2 };
        domainEventBus.bus.emit('domain.event', ownWrite);
        await engine.idle();
        expect(adapter.chat).toHaveBeenCalledTimes(1);
    });

    it('stays out of an event chain that has reached the loop guard', async () => {
        seedRules(GRANTS);
        const project = seedProject();
        await saveRules(project);
        const task = seedTask(project);

        domainEventBus.bus.emit('domain.event', { ...envelope(task, 'task.created'), depth: domainEventBus.MAX_DEPTH });
        await engine.idle();
        expect(adapter.chat).not.toHaveBeenCalled();
    });
});

describe('assignment rules: drafting sentences', () => {
    it('drafts a sentence per person from the tasks the editor can see, without saving', async () => {
        seedRules(GRANTS);
        const project = seedProject();
        const hidden = mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: oid(), projectId: String(project._id), private: true, AssigneeUserId: [OWNER, PRIYA] });
        seedTask(project, { TaskName: 'Fix navbar wrapping', AssigneeUserId: [PRIYA] });
        seedTask(project, { TaskName: 'Secret pricing overhaul', AssigneeUserId: [PRIYA], sprintId: String(hidden._id) });
        seedTask(project, { TaskName: 'Tune slow orders query', AssigneeUserId: [SAM] });
        adapter.chat.mockImplementation(async () => answer({ rules: [{ userId: PRIYA, when: 'UI and layout bugs' }, { userId: SAM, when: 'Database performance' }, { userId: OWNER, when: 'everything' }] }));

        const res = await call('POST', DRAFT_ROUTE, { params: { projectId: String(project._id) }, body: { userIds: [PRIYA, SAM] } });

        expect(res.body.status).toBe(true);
        expect(res.body.data.drafts).toEqual([{ userId: PRIYA, when: 'UI and layout bugs' }, { userId: SAM, when: 'Database performance' }]);
        const request = adapter.chat.mock.calls[0][0];
        const prompt = request.messages.map((m) => m.content).join('\n');
        expect(prompt).toContain('Fix navbar wrapping');
        expect(prompt).toContain('Tune slow orders query');
        expect(prompt).not.toContain('Secret pricing overhaul');
        expect(request.spend).toMatchObject({ feature: FEATURES.ASSIGNMENT_RULES, companyId: C, userId: EDITOR });
        expect(store(SCHEMA_TYPE.ASSIGNMENT_RULES)).toHaveLength(0);
    });

    it('refuses to draft for someone without the project details permission', async () => {
        seedRules({ ...GRANTS, 'project.project_details': false });
        const project = seedProject();
        const res = await call('POST', DRAFT_ROUTE, { params: { projectId: String(project._id) }, body: { userIds: [PRIYA] } });
        expect(res.statusCode).toBe(403);
        expect(adapter.chat).not.toHaveBeenCalled();
    });
});
