process.env.STORAGE_TYPE = 'server';
jest.setTimeout(30000);
const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (companyId, q, method) => mockDb.crud(companyId, q, method),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0, flushAll: () => {} } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const world = require('./fixtures/accessWorld');

const { CID, OWNER, ADMIN, INSIDER, OUTSIDER, GUEST, P_OPEN, P_PRIVATE, P_PERSONAL, L_OPEN, L_SECRET, T_OPEN, T_SECRET } = world;
const { seed, rows, task } = world.create(mockDb);

const EVERYONE = [['the owner', OWNER], ['an admin', ADMIN], ['a member on everything private', INSIDER], ['a member', OUTSIDER], ['a guest', GUEST]];
const OPEN_PROJECTS = { [OWNER]: [P_OPEN, P_PRIVATE], [ADMIN]: [P_OPEN, P_PRIVATE], [INSIDER]: [P_OPEN, P_PRIVATE, P_PERSONAL], [OUTSIDER]: [P_OPEN], [GUEST]: [P_OPEN] };
const ON_SECRET_LIST = [OWNER, ADMIN, INSIDER];
const REPEAT_OPEN = '6f0000000000000000000e01';
const REPEAT_SECRET = '6f0000000000000000000e02';
const CONVERSATION = '6f0000000000000000000cd2';

const routesOf = (module) => {
    const table = {};
    const register = (method) => (path, ...handlers) => { table[`${method} ${path}`] = handlers; };
    require(module).init({ get: register('GET'), post: register('POST'), put: register('PUT'), patch: register('PATCH'), delete: register('DELETE'), use: register('USE') });
    return table;
};

/* The answer of a route, run through every check set before its handler; `only` stops before the handler. */
const call = async (module, route, req, { guardsOnly = false } = {}) => {
    const handlers = routesOf(module)[route];
    const res = { statusCode: 200, body: undefined };
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (answer) => { res.body = answer; return res; };
    res.send = res.json;
    const request = { headers: { companyid: CID }, aud: CID, params: {}, query: {}, body: {}, ...req };
    for (const handler of guardsOnly ? handlers.slice(0, -1) : handlers) {
        let advanced = false;
        await handler(request, res, () => { advanced = true; });
        if (!advanced) return { code: res.statusCode, body: res.body, reached: false };
    }
    return { code: res.statusCode, body: res.body, reached: true };
};

beforeEach(() => {
    jest.clearAllMocks();
    seed();
    const parent = rows(SCHEMA_TYPE.RULES).find((rule) => rule.isParent);
    mockDb.seed(SCHEMA_TYPE.RULES, { key: 'task_create', name: 'task_create', isParent: false, parentId: String(parent._id), roles: [{ key: 3, permission: true }, { key: 0, permission: true }] });
    [P_OPEN, P_PRIVATE, P_PERSONAL].forEach((projectId) => mockDb.seed(SCHEMA_TYPE.MILESTONE, { projectId, milestoneName: `Milestone of ${projectId}`, statusId: 'open', statusDate: 5, amount: 100 }));
    mockDb.seed(SCHEMA_TYPE.RECURRING_TASKS, { _id: REPEAT_OPEN, name: 'Open task', ProjectID: P_OPEN, sourceTaskId: T_OPEN, sprintId: L_OPEN, deletedStatusKey: 0, enabled: true });
    mockDb.seed(SCHEMA_TYPE.RECURRING_TASKS, { _id: REPEAT_SECRET, name: 'Secret task', ProjectID: P_OPEN, sourceTaskId: T_SECRET, sprintId: L_SECRET, deletedStatusKey: 0, enabled: true });
    mockDb.seed(SCHEMA_TYPE.TASKS, { _id: CONVERSATION, TaskName: 'Adam and Ian', mainChat: true, ProjectID: P_OPEN, sprintId: L_OPEN, AssigneeUserId: [ADMIN, INSIDER], deletedStatusKey: 0, DueDate: new Date('2026-09-21T10:00:00.000Z') });
    [T_OPEN, T_SECRET].forEach((id) => { task(id).DueDate = new Date('2026-09-21T10:00:00.000Z'); task(id).sprintArray = { id: String(task(id).sprintId) }; });
});

describe('the milestones of a project', () => {
    it.each(EVERYONE)('are read by %s, by the id of the project, only for a project they can open', async (who, uid) => {
        const read = [];
        for (const projectId of [P_OPEN, P_PRIVATE, P_PERSONAL]) {
            const { code, body } = await call('../Modules/Milestone/routes', 'GET /api/v1/milestone/:id', { uid, params: { id: projectId } });
            if (code === 200 && body && body.milestoneName) read.push(projectId);
        }
        expect(read).toEqual(OPEN_PROJECTS[uid].filter((id) => read.includes(id)));
        expect(read.sort()).toEqual([...OPEN_PROJECTS[uid]].sort());
    });

    it.each(EVERYONE)('are reported to %s only for the projects they can open, however the request names them', async (who, uid) => {
        for (const named of [(id) => id, (id) => [id]]) {
            const reported = [];
            for (const projectId of [P_OPEN, P_PRIVATE, P_PERSONAL]) {
                const { body } = await call('../Modules/Milestone/routes', 'POST /api/v1/milestoneReport', { uid, body: { element: named(projectId), startDate: 1, endDate: 9, cancel: 'cancelled' } });
                if (JSON.stringify(body).includes(`Milestone of ${projectId}`)) reported.push(projectId);
            }
            expect(reported.sort()).toEqual([...OPEN_PROJECTS[uid]].sort());
        }
    });
});

describe('the repeats set on the tasks of a project', () => {
    it.each(EVERYONE)('are listed for %s without those of a private list they are not on', async (who, uid) => {
        const { body } = await call('../Modules/RecurringTasks/routes', 'GET /api/v1/recurring-tasks/project/:pid', { uid, params: { pid: P_OPEN } });
        expect(body.data.map((row) => row.name).sort()).toEqual(ON_SECRET_LIST.includes(uid) ? ['Open task', 'Secret task'] : ['Open task']);
    });

    it.each(['PATCH /api/v1/recurring-tasks/:id', 'DELETE /api/v1/recurring-tasks/:id', 'POST /api/v1/recurring-tasks/:id/run-now'])('%s reaches a repeat of a private list only for a person on that list', async (route) => {
        for (const [, uid] of EVERYONE.filter(([, id]) => id !== GUEST)) {
            const secret = await call('../Modules/RecurringTasks/routes', route, { uid, params: { id: REPEAT_SECRET }, body: {} }, { guardsOnly: true });
            const open = await call('../Modules/RecurringTasks/routes', route, { uid, params: { id: REPEAT_OPEN }, body: {} }, { guardsOnly: true });
            expect([uid, secret.reached, secret.reached ? 200 : secret.code]).toEqual([uid, ON_SECRET_LIST.includes(uid), ON_SECRET_LIST.includes(uid) ? 200 : 404]);
            expect([uid, open.reached]).toEqual([uid, true]);
        }
        expect(rows(SCHEMA_TYPE.RECURRING_TASKS)).toHaveLength(2);
    });
});

describe('the leave board of a dashboard', () => {
    it.each(EVERYONE)('shows %s the tasks they can open, and no conversation', async (who, uid) => {
        const { body } = await call('../Modules/UserDashboard/routes', 'POST /api/v1/dashboard/on-leave', { uid, body: { projectIds: [P_OPEN], dateFrom: '2026-09-21T00:00:00.000Z', dateTo: '2026-09-21T23:59:59.000Z' } });
        const shown = body.data.rows.map((row) => row.taskName).sort();
        expect(shown).toEqual(ON_SECRET_LIST.includes(uid) ? ['Open task', 'Secret task'] : ['Open task']);
    });
});
