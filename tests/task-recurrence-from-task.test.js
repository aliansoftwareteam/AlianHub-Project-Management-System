const verified = require('./fixtures/verifiedRequest');
const fakeMongo = require('./fixtures/fakeMongo');

let mockDb;
const mockCreate = jest.fn();
jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (...args) => mockDb.crud(...args),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Modules/Tasks/helpers/task_class_Mongo', () => ({ taskMongo: { create: (...args) => mockCreate(...args) } }));

const mongoose = require('mongoose');
const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const socketEmitter = require('../event/socketEventEmitter');
const helper = require('../Modules/RecurringTasks/helper');

const C = 'c00000000000000000000001';
const OTHER_COMPANY = 'c00000000000000000000002';
const OWNER = 'a00000000000000000000001';
const MEMBER = 'a00000000000000000000003';
const MEMBER_ROLE = 3;
const TASK_ROUTE = '/api/v1/recurring-tasks/task/:taskId';

const oid = () => new mongoose.Types.ObjectId().toString();

const routes = () => {
    const table = {};
    const register = (method) => (path, ...handlers) => { table[`${method} ${path}`] = handlers; };
    require('../Modules/RecurringTasks/routes').init({ get: register('GET'), post: register('POST'), put: register('PUT'), patch: register('PATCH'), delete: register('DELETE') });
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

const call = (method, path, { uid = MEMBER, params = {}, body = {}, headers = {} } = {}) => run(
    routes()[`${method} ${path}`],
    verified({ uid, params, body, query: {}, headers: { companyid: C, ...headers } }),
);

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

const GRANTS = { 'project.private_projects': 1, 'task.task_due_date': true, 'task.task_create': true };

const seedProject = (doc = {}) => mockDb.seed(SCHEMA_TYPE.PROJECTS, {
    _id: oid(), ProjectName: 'Launch', ProjectCode: 'LCH', CompanyId: C, isPrivateSpace: true, AssigneeUserId: [OWNER, MEMBER], isGlobalPermission: true, ...doc,
});

const seedTask = (project, doc = {}) => mockDb.seed(SCHEMA_TYPE.TASKS, {
    _id: oid(),
    ProjectID: String(project._id),
    TaskName: 'Weekly report',
    AssigneeUserId: [MEMBER],
    Task_Priority: 'HIGH',
    TaskType: 'task',
    TaskTypeKey: 1,
    sprintId: 'sprint-1',
    sprintArray: { id: 'sprint-1', name: 'Backlog' },
    statusType: 'default_active',
    deletedStatusKey: 0,
    ...doc,
});

const weekly = (extra = {}) => ({ freq: 'weekly', interval: 1, byweekday: [1, 4], missedPolicy: 'skip', ...extra });
const definitions = () => mockDb.store[SCHEMA_TYPE.RECURRING_TASKS] || [];

let emitted;
beforeEach(() => {
    myCache.flushAll();
    mockDb = fakeMongo.create();
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: OWNER, roleType: 1, status: 2, isDelete: false });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: MEMBER, roleType: MEMBER_ROLE, status: 2, isDelete: false });
    process.env.PERMISSION_ENFORCEMENT_MODE = 'enforce';
    mockCreate.mockReset();
    emitted = [];
    socketEmitter.on('update', (payload) => emitted.push(payload));
});

afterEach(() => {
    socketEmitter.removeAllListeners('update');
    delete process.env.PERMISSION_ENFORCEMENT_MODE;
});

describe('a repeat set from the task panel', () => {
    it('creates one rule in the recurring rules collection, built from the stored task', async () => {
        seedRules(GRANTS);
        const project = seedProject();
        const task = seedTask(project);
        const decoy = seedProject({ isPrivateSpace: false });

        const res = await call('PUT', TASK_ROUTE, { params: { taskId: String(task._id) }, body: { ...weekly(), projectData: { _id: String(decoy._id) } } });

        expect(res.body).toMatchObject({ status: true });
        expect(definitions()).toHaveLength(1);
        const [def] = definitions();
        expect(String(def.sourceTaskId)).toBe(String(task._id));
        expect(String(def.ProjectID)).toBe(String(project._id));
        expect(def).toMatchObject({ freq: 'weekly', interval: 1, byweekday: [1, 4], missedPolicy: 'skip', enabled: true, deletedStatusKey: 0 });
        expect(def.templateSnapshot).toMatchObject({ TaskName: 'Weekly report', AssigneeUserId: [MEMBER], Task_Priority: 'HIGH' });
        expect(String(def.lastInstanceTaskId)).toBe(String(task._id));
        expect(def.nextRunAt).toBeInstanceOf(Date);
        expect(new Set(mockDb.calls.map((c) => c.companyId).filter((id) => id !== 'global'))).toEqual(new Set([C]));
        expect(emitted.some((e) => e.module === 'recurringTasks' && String(e.data.sourceTaskId) === String(task._id))).toBe(true);
    });

    it('updates the same rule on a second save instead of adding another', async () => {
        seedRules(GRANTS);
        const task = seedTask(seedProject());
        await call('PUT', TASK_ROUTE, { params: { taskId: String(task._id) }, body: weekly() });
        const res = await call('PUT', TASK_ROUTE, { params: { taskId: String(task._id) }, body: { freq: 'monthly', interval: 2, monthday: 15, maxRuns: 6, missedPolicy: 'roll' } });

        expect(res.body).toMatchObject({ status: true });
        expect(definitions()).toHaveLength(1);
        expect(definitions()[0]).toMatchObject({ freq: 'monthly', interval: 2, monthday: 15, maxRuns: 6, missedPolicy: 'roll' });
    });

    it('reads the rule back for the task, and the project tab lists it', async () => {
        seedRules(GRANTS);
        const project = seedProject();
        const task = seedTask(project);
        await call('PUT', TASK_ROUTE, { params: { taskId: String(task._id) }, body: weekly({ until: '2027-01-31' }) });

        const read = await call('GET', TASK_ROUTE, { params: { taskId: String(task._id) } });
        expect(read.body).toMatchObject({ status: true, data: { freq: 'weekly', byweekday: [1, 4] } });

        const listed = await call('GET', '/api/v1/recurring-tasks/project/:pid', { params: { pid: String(project._id) } });
        expect(listed.body.data.map((d) => String(d.sourceTaskId))).toEqual([String(task._id)]);
    });

    it('removes the rule with a soft delete', async () => {
        seedRules(GRANTS);
        const task = seedTask(seedProject());
        await call('PUT', TASK_ROUTE, { params: { taskId: String(task._id) }, body: weekly() });

        const res = await call('DELETE', TASK_ROUTE, { params: { taskId: String(task._id) } });

        expect(res.body).toMatchObject({ status: true });
        expect(definitions()[0]).toMatchObject({ deletedStatusKey: 1, enabled: false });
        expect((await call('GET', TASK_ROUTE, { params: { taskId: String(task._id) } })).body).toMatchObject({ status: true, data: null });
    });

    it('refuses a member who may not change the due date, and writes nothing', async () => {
        seedRules({ ...GRANTS, 'task.task_due_date': false });
        const task = seedTask(seedProject());

        const res = await call('PUT', TASK_ROUTE, { params: { taskId: String(task._id) }, body: weekly() });

        expect(res.statusCode).toBe(403);
        expect(res.body).toMatchObject({ status: false, permission: 'task.task_due_date' });
        expect(definitions()).toHaveLength(0);
    });

    it('refuses a member who may not create tasks, since the rule creates them', async () => {
        seedRules({ ...GRANTS, 'task.task_create': false });
        const task = seedTask(seedProject());

        const res = await call('PUT', TASK_ROUTE, { params: { taskId: String(task._id) }, body: weekly() });

        expect(res.statusCode).toBe(403);
        expect(definitions()).toHaveLength(0);
    });

    it('answers 404 to a member outside the private project, for reads and writes', async () => {
        seedRules(GRANTS);
        const task = seedTask(seedProject({ AssigneeUserId: [OWNER] }));

        expect((await call('GET', TASK_ROUTE, { params: { taskId: String(task._id) } })).statusCode).toBe(404);
        expect((await call('PUT', TASK_ROUTE, { params: { taskId: String(task._id) }, body: weekly() })).statusCode).toBe(404);
        expect((await call('DELETE', TASK_ROUTE, { params: { taskId: String(task._id) } })).statusCode).toBe(404);
        expect(definitions()).toHaveLength(0);
    });

    it('refuses a body naming another company', async () => {
        seedRules(GRANTS);
        const task = seedTask(seedProject());

        const res = await call('PUT', TASK_ROUTE, { params: { taskId: String(task._id) }, body: { ...weekly(), companyId: OTHER_COMPANY } });

        expect(res.statusCode).toBe(403);
        expect(definitions()).toHaveLength(0);
    });

    it('answers 404 for a task the company does not have', async () => {
        seedRules(GRANTS);
        const res = await call('PUT', TASK_ROUTE, { uid: OWNER, params: { taskId: oid() }, body: weekly() });

        expect(res.statusCode).toBe(404);
        expect(definitions()).toHaveLength(0);
    });

    it('rejects a schedule the scheduler cannot run', async () => {
        seedRules(GRANTS);
        const task = seedTask(seedProject());

        for (const body of [{ freq: 'hourly' }, weekly({ interval: 0 }), weekly({ maxRuns: -2 }), weekly({ until: 'not a date' }), weekly({ byweekday: [9] })]) {
            const res = await call('PUT', TASK_ROUTE, { params: { taskId: String(task._id) }, body });
            expect(res.statusCode).toBe(400);
        }
        expect(definitions()).toHaveLength(0);
    });
});

describe('the scheduler honours "ends after N"', () => {
    it('stops a rule once it has created its last occurrence', async () => {
        const due = new Date('2026-10-01T09:00:00');
        const def = mockDb.seed(SCHEMA_TYPE.RECURRING_TASKS, {
            _id: new mongoose.Types.ObjectId(),
            name: 'Report', freq: 'daily', interval: 1, enabled: true, deletedStatusKey: 0,
            nextRunAt: due, runCount: 1, maxRuns: 2, missedPolicy: 'create', templateSnapshot: { TaskName: 'Report' }, ProjectID: oid(),
        });
        mockCreate.mockResolvedValue({ status: true, id: oid() });

        await helper.processDueForCompany(C, new Date('2026-10-01T10:00:00'));

        expect(mockCreate).toHaveBeenCalledTimes(1);
        expect(definitions().find((d) => String(d._id) === String(def._id))).toMatchObject({ runCount: 2, enabled: false });
    });

    it('does not create past the last occurrence', async () => {
        mockDb.seed(SCHEMA_TYPE.RECURRING_TASKS, {
            _id: new mongoose.Types.ObjectId(),
            name: 'Report', freq: 'daily', interval: 1, enabled: true, deletedStatusKey: 0,
            nextRunAt: new Date('2026-10-01T09:00:00'), runCount: 3, maxRuns: 3, missedPolicy: 'create', templateSnapshot: {}, ProjectID: oid(),
        });

        await helper.processDueForCompany(C, new Date('2026-10-01T10:00:00'));

        expect(mockCreate).not.toHaveBeenCalled();
        expect(definitions()[0]).toMatchObject({ enabled: false });
    });
});
