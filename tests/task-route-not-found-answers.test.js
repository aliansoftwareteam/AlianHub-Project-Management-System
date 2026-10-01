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
jest.mock('../Modules/Sprints/controller', () => mockStub());
jest.mock('../Modules/Tasks/helpers/handleNotification', () => mockStub());
jest.mock('../Modules/Company/eventController', () => mockStub());
jest.mock('../Modules/Company/controller/updateCompany', () => mockStub());
jest.mock('../Modules/notification-count/controller', () => mockStub());
jest.mock('../Modules/Comments/controller', () => mockStub());
jest.mock('../Modules/MainChats/controller', () => mockStub());
jest.mock('../Modules/LogTime/controllerV2.js', () => mockStub());
jest.mock('../Modules/CustomField/controller', () => mockStub());
jest.mock('../utils/planHelper', () => mockStub());
jest.mock('../utils/commonFunctions.js', () => mockStub());
jest.mock('../common-storage/common-server.js', () => mockStub());
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));

const { EventEmitter } = require('events');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const world = require('./fixtures/accessWorld');

const { CID, OWNER, ADMIN, INSIDER, OUTSIDER, GUEST, P_OPEN, P_PRIVATE, L_OPEN, L_PRIVATE, T_OPEN, T_SECRET, T_PRIVATE, T_PERSONAL, settle } = world;
const { seed, rows, task } = world.create(mockDb);

const P_RULED = '6f0000000000000000000a09';
const L_RULED = '6f0000000000000000000b09';
const T_RULED = '6f0000000000000000000d09';
const T_NOWHERE = '6f0000000000000000000dff';
const P_NOWHERE = '6f0000000000000000000aff';
const MODES = ['off', 'report', 'enforce'];
const RULE_KEYS = ['task_list', 'task_status', 'task_priority', 'task_tag', 'task_move', 'task_create'];

const routes = {};
const register = (method) => (routePath, ...handlers) => { routes[`${method} ${routePath}`] = handlers; };
require('../Modules/Tasks/routes').init({ get: register('GET'), post: register('POST'), put: register('PUT'), patch: register('PATCH'), delete: register('DELETE'), use: register('USE') });

const session = (uid) => ({ uid });
const personalToken = (uid) => ({ uid, apiToken: { _id: '6f0000000000000000000102', name: 'A script', userId: uid, scopes: ['read', 'write'] } });
const agentToken = (uid) => ({ uid, apiToken: { _id: '6f0000000000000000000101', kind: 'agent', name: 'Claude', userId: uid, scopes: ['read', 'write'] } });

const send = (route, caller, body, params = {}) => new Promise((resolve) => {
    const [method, url] = route.split(' ');
    const res = new EventEmitter();
    res.statusCode = 200;
    res.status = (code) => { res.statusCode = code; return res; };
    res.send = (answer) => { res.emit('finish'); resolve({ code: res.statusCode, body: answer }); return res; };
    res.json = res.send;
    const req = { ...caller, method, originalUrl: url, url, baseUrl: '', route: { path: url }, query: {}, params, headers: { companyid: CID }, aud: CID, ip: '1.1.1.1', body };
    const handlers = routes[route];
    const step = (at) => Promise.resolve(handlers[at](req, res, () => step(at + 1)));
    step(0);
}).then(async (result) => { await settle(); return result; });

const status = (key, name, type) => ({ status: { key, text: name, type, value: '' }, statusKey: key, statusType: type });

/* Each request names one task; `ask(caller, taskId)` sends it. */
const REQUESTS = {
    'reading a task': (caller, taskId) => send('GET /api/v1/task/:id', caller, {}, { id: taskId }),
    'reading the lists of a task': (caller, taskId) => send('GET /api/v2/tasks/:id/lists', caller, {}, { id: taskId }),
    'tagging a task': (caller, taskId) => send('PATCH /api/v2/tasks', caller, { action: 'updateTags', companyId: CID, taskId, tagId: 'tag-1', operation: 'add' }),
    'setting a priority': (caller, taskId) => send('PATCH /api/v2/tasks', caller, { action: 'updatePriority', firebaseObj: { Task_Priority: 'HIGH' }, projectData: {}, taskData: { _id: taskId }, priorityObj: {}, isUpdateTask: true }),
    'setting a status': (caller, taskId) => send('PATCH /api/v2/tasks', caller, { action: 'updateStatus', newStatus: status(3, 'In Progress', 'active'), prevStatus: { taskId }, projectData: {}, task: { _id: taskId }, isUpdateTask: true }),
    'moving a task': (caller, taskId) => send('PATCH /api/v2/tasks', caller, { action: 'moveTask', companyId: CID, moveTaskId: taskId, projectData: { id: P_OPEN }, sprintObj: { id: L_OPEN, name: 'x' }, oldSprintObj: { id: L_OPEN }, oldProject: {}, assignee: [], watcher: [] }),
    'tagging many tasks': (caller, taskId) => send('POST /api/v2/tasks/bulk', caller, { action: 'bulkUpdateTags', companyId: CID, taskIds: [taskId], tagId: 'tag-1', operation: 'add' }),
    'tagging many tasks, one of them open': (caller, taskId) => send('POST /api/v2/tasks/bulk', caller, { action: 'bulkUpdateTags', companyId: CID, taskIds: [T_OPEN, taskId], tagId: 'tag-1', operation: 'add' }),
    'listing the links of a task': (caller, taskId) => send('POST /api/v2/tasks/relations', caller, { action: 'list', taskId }),
    'linking a task': (caller, taskId) => send('POST /api/v2/tasks/relations', caller, { action: 'add', taskId, relatedTaskId: T_OPEN, type: 'relates_to' }),
    'linking to a task': (caller, taskId) => send('POST /api/v2/tasks/relations', caller, { action: 'add', taskId: T_OPEN, relatedTaskId: taskId, type: 'relates_to' }),
    'unlinking from a task': (caller, taskId) => send('POST /api/v2/tasks/relations', caller, { action: 'remove', taskId: T_OPEN, relatedTaskId: taskId }),
};
const AGENT_REFUSED_ROUTES = ['tagging many tasks', 'tagging many tasks, one of them open'];

const ownRules = (projectId, grant) => {
    rows(SCHEMA_TYPE.PROJECTS).find((project) => String(project._id) === projectId).isGlobalPermission = false;
    const parent = mockDb.seed(SCHEMA_TYPE.PROJECT_RULES, { key: 'task', name: 'Task', isParent: true, roles: [], projectId });
    RULE_KEYS.forEach((key) => mockDb.seed(SCHEMA_TYPE.PROJECT_RULES, {
        key, name: key, isParent: false, parentId: String(parent._id), projectId, roles: [{ key: 3, permission: grant(key) }, { key: 0, permission: grant(key) }],
    }));
};

/* Each refusal of an agent is its own audit row. */
const withoutAuditId = ({ code, body }) => ({ code, body: body && typeof body === 'object' ? { ...body, auditId: undefined } : body });
const written = () => JSON.stringify(rows(SCHEMA_TYPE.TASKS));
const setMode = (mode) => { process.env.PERMISSION_ENFORCEMENT_MODE = mode; };

beforeEach(() => {
    const { seedTask, project, list } = seed();
    const companyTaskRules = rows(SCHEMA_TYPE.RULES).find((rule) => rule.key === 'task');
    mockDb.seed(SCHEMA_TYPE.RULES, { key: 'task_create', name: 'task_create', isParent: false, parentId: String(companyTaskRules._id), roles: [{ key: 3, permission: true }, { key: 0, permission: true }] });
    ownRules(P_PRIVATE, (key) => (key === 'task_list' ? true : null));
    project(P_RULED, 'Ruled');
    list(L_RULED, 'List of the project with its own rules', P_RULED);
    seedTask(T_RULED, 'Task nobody but an owner lists', P_RULED, L_RULED);
    ownRules(P_RULED, () => null);
    task(T_OPEN).relations = [T_PRIVATE, T_SECRET, T_RULED, T_PERSONAL].map((taskId) => ({ taskId, type: 'relates_to', createdBy: INSIDER, createdAt: new Date('2026-09-01T00:00:00.000Z') }));
});
afterEach(() => { delete process.env.PERMISSION_ENFORCEMENT_MODE; });

const UNOPENABLE = [
    ['a task in a private project with its own rules, for a member outside it', OUTSIDER, T_PRIVATE],
    ['a task in a private project with its own rules, for a guest', GUEST, T_PRIVATE],
    ['a task on a private list, for a member outside it', OUTSIDER, T_SECRET],
    ['a task on a private list, for a guest', GUEST, T_SECRET],
    ['a task whose project lets a member list no tasks', INSIDER, T_RULED],
    ['a task whose project lets a guest list no tasks', GUEST, T_RULED],
    ['a task on another person\'s personal list, for an owner', OWNER, T_PERSONAL],
    ['a task on another person\'s personal list, for an admin', ADMIN, T_PERSONAL],
];
const CALLERS = [['signed in', session], ['with a personal token', personalToken], ['with an agent token', agentToken]];

describe.each(MODES)('with permission enforcement %s', (mode) => {
    beforeEach(() => setMode(mode));

    describe.each(CALLERS)('a caller %s', (how, as) => {
        describe.each(Object.keys(REQUESTS))('%s', (name) => {
            it.each(UNOPENABLE)('answers for %s as for a task that does not exist', async (label, uid, taskId) => {
                const before = JSON.stringify(task(taskId));

                const answer = await REQUESTS[name](as(uid), taskId);
                const missing = await REQUESTS[name](as(uid), T_NOWHERE);

                expect(withoutAuditId(answer)).toEqual(withoutAuditId(missing));
                expect(JSON.stringify(task(taskId))).toBe(before);
                if (as === agentToken && AGENT_REFUSED_ROUTES.includes(name)) return;
                expect(JSON.stringify(answer.body)).not.toMatch(/permission/i);
            });
        });
    });
});

describe('a task write into a project the caller cannot open', () => {
    const create = (caller, projectId) => send('POST /api/v2/tasks', caller, {
        data: { TaskName: 'New', ProjectID: projectId, sprintId: L_PRIVATE, AssigneeUserId: [], watchers: [] }, projectData: { _id: projectId, CompanyId: CID }, user: {},
    });

    it.each(MODES.flatMap((mode) => [[mode, 'a member outside it', OUTSIDER], [mode, 'a guest', GUEST]]))('answers, with enforcement %s and for %s, as for a project that does not exist', async (mode, label, uid) => {
        setMode(mode);
        const before = written();

        for (const as of [session, personalToken]) {
            expect(await create(as(uid), P_PRIVATE)).toEqual(await create(as(uid), P_NOWHERE));
        }
        expect(written()).toBe(before);
    });
});

describe('a person who can open the task', () => {
    it('is still told which key the project\'s own rules withhold', async () => {
        setMode('enforce');

        const tagged = await REQUESTS['tagging a task'](session(INSIDER), T_PRIVATE);
        const many = await REQUESTS['tagging many tasks, one of them open'](session(INSIDER), T_PRIVATE);

        expect(tagged).toMatchObject({ code: 403, body: { permission: 'task.task_tag' } });
        expect(many).toMatchObject({ code: 403, body: { permission: 'task.task_tag|task.task_status' } });
        for (const as of [session, personalToken]) {
            expect(await REQUESTS['setting a priority'](as(INSIDER), T_PRIVATE)).toMatchObject({ code: 403, body: { permission: 'task.task_priority' } });
        }
    });

    it('is still told so with a personal token whatever the enforcement mode', async () => {
        for (const mode of MODES) {
            setMode(mode);
            expect(await REQUESTS['setting a priority'](personalToken(INSIDER), T_PRIVATE)).toMatchObject({ code: 403, body: { permission: 'task.task_priority' } });
        }
    });

    it.each([
        ['an owner', OWNER],
        ['an admin', ADMIN],
    ])('writes through when they are %s, whom no rule holds back', async (label, uid) => {
        setMode('enforce');

        expect((await REQUESTS['tagging a task'](session(uid), T_PRIVATE)).code).toBe(200);
        expect((await REQUESTS['setting a priority'](personalToken(uid), T_PRIVATE)).code).toBe(200);
        expect(task(T_PRIVATE)).toMatchObject({ tagsArray: ['tag-1'], Task_Priority: 'HIGH' });
        expect((await REQUESTS['listing the links of a task'](session(uid), T_RULED)).code).toBe(200);
    });

    it('writes through where the rules grant the key', async () => {
        setMode('enforce');

        expect((await REQUESTS['tagging a task'](session(OUTSIDER), T_OPEN)).code).toBe(200);
        expect((await REQUESTS['tagging a task'](session(GUEST), T_OPEN)).code).toBe(200);
        expect((await REQUESTS['listing the links of a task'](session(INSIDER), T_PRIVATE)).body.status).toBe(true);
    });
});
