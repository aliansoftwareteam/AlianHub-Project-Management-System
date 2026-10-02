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

const { CID, OWNER, ADMIN, INSIDER, OUTSIDER, GUEST, P_OPEN, P_PRIVATE, P_PERSONAL, L_OPEN, L_SECRET, T_OPEN, T_SECRET, T_PRIVATE, T_PERSONAL, OPENS } = world;
const { seed } = world.create(mockDb);

const DM_SPACE = '6f0000000000000000000ca2';
const DM = '6f0000000000000000000cd1';
const CONVERSATION = '6f0000000000000000000cd2';
const MISSING = '6f0000000000000000000fff';
const IN_IT = [ADMIN, INSIDER];
const EVERYONE = [['the owner', OWNER], ['an admin who is in the conversations', ADMIN], ['a member who is in the conversations', INSIDER], ['a member', OUTSIDER], ['a guest', GUEST]];

const routesOf = (module) => {
    const table = {};
    const register = (method) => (path, ...handlers) => { table[`${method} ${path}`] = handlers; };
    require(module).init({ get: register('GET'), post: register('POST'), put: register('PUT'), patch: register('PATCH'), delete: register('DELETE'), use: register('USE') });
    return table;
};

/* [the route, how a request names its task]. Each is a read of what is kept against one task. */
const ROUTES = {
    'the time kept against a task': ['../Modules/TimeSheet/routes', 'GET /api/v1/timesheet/task/:taskId', (taskId) => ({ params: { taskId } })],
    'the repeat set on a task': ['../Modules/RecurringTasks/routes', 'GET /api/v1/recurring-tasks/task/:taskId', (taskId) => ({ params: { taskId } })],
    'who a task was given to and why': ['../Modules/AssignmentRules/routes', 'GET /api/v2/assignment-rules/task/:taskId', (taskId) => ({ params: { taskId } })],
    'time logged on a task': ['../Modules/LogTime/routes', 'POST /api/v2/manualLogtime', (ticketId) => ({ body: { ticketId } })],
};
const PANEL = ['../Modules/Project/routes', 'GET /api/v1/projectdata/taskData', (taskId) => ({ query: { taskId } })];

/* Whether the checks set before the handler let the request through, and what they answer when they do not. */
const reaches = async ([module, route, named], uid, taskId) => {
    const guards = routesOf(module)[route].slice(0, -1);
    const res = { statusCode: 200, body: null };
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (answer) => { res.body = answer; return res; };
    res.send = res.json;
    const req = { uid, headers: { companyid: CID }, aud: CID, params: {}, query: {}, body: {}, ...named(taskId) };
    for (const guard of guards) {
        let advanced = false;
        await guard(req, res, () => { advanced = true; });
        if (!advanced) return { through: false, code: res.statusCode, body: res.body };
    }
    return { through: true };
};

const conversation = (extra) => ({ TaskName: 'Adam and Ian', TaskKey: '--', CompanyId: CID, mainChat: true, isParentTask: true, AssigneeUserId: IN_IT, deletedStatusKey: 0, ...extra });

beforeEach(() => {
    jest.clearAllMocks();
    seed();
    mockDb.seed(SCHEMA_TYPE.MAIN_CHATS, { _id: DM_SPACE, ProjectName: 'Direct messages', default: true });
    mockDb.seed(SCHEMA_TYPE.TASKS, conversation({ _id: DM, ProjectID: DM_SPACE, sprintId: L_OPEN }));
    mockDb.seed(SCHEMA_TYPE.TASKS, conversation({ _id: CONVERSATION, ProjectID: P_OPEN, sprintId: L_OPEN }));
});

describe('a route that names a task by its id', () => {
    const cases = Object.keys(ROUTES).flatMap((name) => EVERYONE.map(([who, uid]) => [name, who, uid]));

    it.each(cases)('%s: is reached by %s for a task they can open, and no other', async (name, who, uid) => {
        const reached = [];
        for (const taskId of [T_OPEN, T_SECRET, T_PRIVATE, T_PERSONAL]) {
            if ((await reaches(ROUTES[name], uid, taskId)).through) reached.push(taskId);
        }
        expect(reached.sort()).toEqual([...OPENS[uid]].sort());
    });

    it.each(cases)('%s: answers %s the same for every task they cannot open', async (name, who, uid) => {
        const answers = [];
        for (const taskId of [T_SECRET, T_PRIVATE, T_PERSONAL, DM, CONVERSATION].filter((id) => !OPENS[uid].includes(id))) {
            answers.push(await reaches(ROUTES[name], uid, taskId));
        }
        expect(answers.every((answer) => answer.through === false && answer.code === 404)).toBe(true);
        expect(new Set(answers.map((answer) => JSON.stringify(answer.body))).size).toBe(1);
    });

    it.each(cases)('%s: a conversation is not a task there, for %s as for anyone', async (name, who, uid) => {
        expect((await reaches(ROUTES[name], uid, DM)).through).toBe(false);
        expect((await reaches(ROUTES[name], uid, CONVERSATION)).through).toBe(false);
    });

    it.each(Object.keys(ROUTES))('%s: an id that names nothing is left to the handler', async (name) => {
        expect((await reaches(ROUTES[name], OUTSIDER, MISSING)).through).toBe(true);
    });

    it.each(EVERYONE)('the task panel still opens a conversation for %s when they are in it', async (who, uid) => {
        expect((await reaches(PANEL, uid, CONVERSATION)).through).toBe(IN_IT.includes(uid));
        expect((await reaches(PANEL, uid, DM)).through).toBe(IN_IT.includes(uid));
        expect((await reaches(PANEL, uid, T_SECRET)).through).toBe(OPENS[uid].includes(T_SECRET));
    });
});

describe('a person\'s own time entry', () => {
    const OWN = '6f0000000000000000000f01';
    const OF_SOMEONE_ELSE = '6f0000000000000000000f02';
    const LOG = ['../Modules/LogTime/routes', 'POST /api/v2/manualLogtime', (body) => ({ body })];
    const REMOVE = ['../Modules/LogTime/routes', 'POST /api/v2/deleteManualLogtime', (body) => ({ body })];

    beforeEach(() => {
        mockDb.seed(SCHEMA_TYPE.TIMESHEET, { _id: OWN, TicketID: T_SECRET, ProjectId: P_OPEN, Loggeduser: OUTSIDER, LogTimeDuration: 30 });
        mockDb.seed(SCHEMA_TYPE.TIMESHEET, { _id: OF_SOMEONE_ELSE, TicketID: T_SECRET, ProjectId: P_OPEN, Loggeduser: INSIDER, LogTimeDuration: 30 });
    });

    it('is theirs to correct and to delete on a task they can no longer open', async () => {
        expect((await reaches(LOG, OUTSIDER, { isEdit: true, timeSheetId: OWN, ticketId: T_SECRET, projectId: P_OPEN })).through).toBe(true);
        expect((await reaches(REMOVE, OUTSIDER, { timeSheetId: OWN, ticketId: T_SECRET, projectId: P_OPEN })).through).toBe(true);
    });

    it.each([['correcting', LOG, { isEdit: true }], ['deleting', REMOVE, {}]])('stays where it is when %s it: the request names the entry\'s own project and list, or does not pass', async (what, route, extra) => {
        const named = (place) => reaches(route, OUTSIDER, { ...extra, timeSheetId: OWN, ticketId: T_SECRET, ...place });

        expect((await named({ projectId: P_OPEN })).through).toBe(true);
        expect((await named({ projectId: P_OPEN, sprintId: L_SECRET })).through).toBe(true);
        expect((await named({ projectId: P_PRIVATE })).through).toBe(false);
        expect((await named({ projectId: P_PERSONAL })).through).toBe(false);
        expect((await named({})).through).toBe(false);
        expect((await named({ projectId: P_OPEN, sprintId: L_OPEN })).through).toBe(false);
    });

    it('opens nothing else: not new time on that task, not another person\'s entry, not another task', async () => {
        expect((await reaches(LOG, OUTSIDER, { isEdit: false, timeSheetId: OWN, ticketId: T_SECRET, projectId: P_OPEN })).through).toBe(false);
        expect((await reaches(LOG, OUTSIDER, { isEdit: true, timeSheetId: OF_SOMEONE_ELSE, ticketId: T_SECRET, projectId: P_OPEN })).through).toBe(false);
        expect((await reaches(REMOVE, OUTSIDER, { timeSheetId: OF_SOMEONE_ELSE, ticketId: T_SECRET, projectId: P_OPEN })).through).toBe(false);
        expect((await reaches(LOG, OUTSIDER, { isEdit: true, timeSheetId: OWN, ticketId: T_PRIVATE, projectId: P_OPEN })).through).toBe(false);
    });
});
