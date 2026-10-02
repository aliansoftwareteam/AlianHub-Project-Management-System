process.env.STORAGE_TYPE = 'server';
jest.setTimeout(60000);
const mockDb = require('./fixtures/fakeMongo').create();
const mockCache = new Map();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (companyId, q, method) => mockDb.crud(companyId, q, method),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/config', () => ({
    myCache: { get: (key) => mockCache.get(key), set: (key, value) => { mockCache.set(key, value); }, del: (key) => mockCache.delete(key), keys: () => [...mockCache.keys()], getTtl: () => 0, flushAll: () => mockCache.clear() },
}));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../utils/companyMembers', () => ({ acceptedMemberIds: jest.fn(async (companyId, ids) => ids) }));
jest.mock('../Modules/Company/helpers/companyWeek', () => ({ workingDaysOf: jest.fn(async () => [1, 2, 3, 4, 5]), weekendOf: () => [0, 6] }));
jest.mock('../Modules/Inbox/helpers/approvalQueue', () => ({ readQueue: jest.fn(async () => []), readApplied: jest.fn(async () => []), waitingCount: () => 0 }));
jest.mock('../Modules/Workflows/queue');
jest.mock('../Modules/Workflows/store');

const verified = require('./fixtures/verifiedRequest');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const world = require('./fixtures/accessWorld');
const inbox = require('../Modules/Inbox/controller');
const { getWeekTimesheet } = require('../Modules/TimeSheet/controller/weekTimesheet');
const { getWorkloadGrid } = require('../Modules/TimeSheet/controller/workloadGrid');
const { resolveSheetScope, SHEET_PERMISSION } = require('../Modules/TimeSheet/helpers/timeScope');
const store = require('../Modules/Workflows/store');
const workflows = require('../Modules/Workflows/controller');

const { CID, OWNER, OUTSIDER, P_OPEN, L_SECRET, settle } = world;
const { seed } = world.create(mockDb);

/* Reads a screen may make however many rows, lists and projects it shows. A count above these means a check went
 * back to asking once for each row or each place. */
const INBOX_PAGE = 18;
const INBOX_COUNTS = 23;
const WEEK = 14;
const WORKLOAD = 17;
const RUN_LIST = 12;
const SHEET_SCOPE = 6;

const id = (prefix, n) => `${prefix}${String(n).padStart(24 - prefix.length, '0')}`;
const answered = async (handler, req) => {
    const res = { statusCode: 200, body: null };
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (answer) => { res.body = answer; return res; };
    res.send = res.json;
    await handler(verified({ headers: { companyid: CID }, query: {}, params: {}, body: {}, ip: '', ...req }), res);
    await settle();
    return res.body;
};
const READS = ['find', 'findOne', 'aggregate', 'distinct', 'countDocuments'];
const readsOf = async (run) => {
    mockCache.clear();
    const from = mockDb.calls.length;
    const answer = await run();
    return { answer, reads: mockDb.calls.slice(from).filter((call) => READS.includes(call.method)).length };
};
const PEOPLE = [['a member', OUTSIDER], ['the owner', OWNER]];

const savedFlag = process.env.WORKFLOW_ENGINE;
beforeEach(() => { jest.clearAllMocks(); mockCache.clear(); process.env.WORKFLOW_ENGINE = 'on'; });
afterAll(() => { if (savedFlag === undefined) delete process.env.WORKFLOW_ENGINE; else process.env.WORKFLOW_ENGINE = savedFlag; });

describe('the cost of the open-rule checks does not grow with what a screen shows', () => {
    it.each(PEOPLE)('an inbox page of 50 rows over 50 lists, for %s', async (who, uid) => {
        const { seedTask, list } = seed();
        for (let i = 0; i < 50; i += 1) {
            list(id('6f00000000000000000b1', i), `List ${i}`, P_OPEN);
            seedTask(id('6f00000000000000000d1', i), `Task ${i}`, P_OPEN, id('6f00000000000000000b1', i));
            mockDb.seed(SCHEMA_TYPE.NOTIFICATIONS, {
                key: 'task_edit', type: 'tasks', message: `notice ${i}`, userId: OWNER, receiverID: uid, assigneeUsers: [uid], notSeen: [uid], notificationType: 'push', companyId: CID,
                projectId: P_OPEN, sprintId: id('6f00000000000000000b1', i), taskId: id('6f00000000000000000d1', i), createdAt: new Date(Date.UTC(2026, 8, 20, 10, i)),
            });
        }
        const page = await readsOf(() => answered(inbox.list, { uid, query: { tab: 'all', limit: '50' } }));
        const counts = await readsOf(() => answered(inbox.counts, { uid }));

        expect(page.answer.data.items.filter((item) => item.taskName)).toHaveLength(50);
        expect(page.reads).toBeLessThanOrEqual(INBOX_PAGE);
        expect(counts.reads).toBeLessThanOrEqual(INBOX_COUNTS);
    });

    it.each(PEOPLE)('a week of 200 tasks over 20 lists in 5 projects, and the same on the workload grid, for %s', async (who, uid) => {
        const { seedTask, list, project } = seed();
        const at = Math.floor(Date.UTC(2026, 8, 21, 10) / 1000);
        for (let p = 0; p < 5; p += 1) {
            project(id('6f00000000000000000a1', p), `Project ${p}`);
            for (let l = 0; l < 4; l += 1) {
                list(id('6f00000000000000000b2', p * 10 + l), `List ${p}.${l}`, id('6f00000000000000000a1', p));
                for (let t = 0; t < 10; t += 1) {
                    const taskId = id('6f00000000000000000d2', p * 100 + l * 10 + t);
                    seedTask(taskId, `Task ${p}.${l}.${t}`, id('6f00000000000000000a1', p), id('6f00000000000000000b2', p * 10 + l));
                    mockDb.seed(SCHEMA_TYPE.TIMESHEET, { TicketID: taskId, ProjectId: id('6f00000000000000000a1', p), Loggeduser: uid, LogStartTime: at + t, LogTimeDuration: 30, billable: true });
                    mockDb.seed(SCHEMA_TYPE.ESTIMATES_TIME, { TaskId: taskId, ProjectId: id('6f00000000000000000a1', p), UserId: uid, Date: new Date('2026-09-21T09:00:00.000Z'), EstimatedTime: 30 });
                }
            }
        }
        const week = await readsOf(() => answered(getWeekTimesheet, { uid, query: { start: '2026-09-21', end: '2026-09-27' } }));
        const grid = await readsOf(() => answered(getWorkloadGrid, { uid, body: { start: '2026-09-21', end: '2026-09-27', unit: 'hours', userIds: [uid] } }));

        expect(week.answer.data.rows.filter((row) => row.taskName && row.projectName)).toHaveLength(200);
        expect(week.reads).toBeLessThanOrEqual(WEEK);
        expect(grid.answer.data.users.find((user) => user.userId === uid).days.flatMap((day) => day.chips).filter((chip) => chip.name)).toHaveLength(200);
        expect(grid.reads).toBeLessThanOrEqual(WORKLOAD);
    });

    it('a list of 50 workflow runs on 50 tasks, for a member', async () => {
        const { seedTask, list } = seed();
        const runs = [];
        for (let i = 0; i < 50; i += 1) {
            list(id('6f00000000000000000b3', i), `List ${i}`, P_OPEN);
            seedTask(id('6f00000000000000000d3', i), `Task ${i}`, P_OPEN, id('6f00000000000000000b3', i));
            runs.push({ _id: id('6f00000000000000000e3', i), status: 'running', projectId: P_OPEN, taskId: id('6f00000000000000000d3', i), startedBy: OWNER });
        }
        store.listRuns.mockResolvedValue(runs);
        const listed = await readsOf(() => answered(workflows.listRuns, { uid: OUTSIDER }));

        expect(listed.answer.data).toHaveLength(50);
        expect(listed.reads).toBeLessThanOrEqual(RUN_LIST);
    });

    it('the time scope of a member reads no task of the private lists they are not on unless it is asked for them', async () => {
        const { seedTask } = seed();
        for (let t = 0; t < 300; t += 1) seedTask(id('6f00000000000000000d4', t), `Task ${t}`, P_OPEN, L_SECRET);
        const from = mockDb.calls.length;
        const scope = await resolveSheetScope(CID, OUTSIDER, SHEET_PERMISSION.user);
        const made = mockDb.calls.slice(from);

        expect(scope.everyone).toBe(false);
        expect(made.filter((call) => call.type === SCHEMA_TYPE.TASKS)).toHaveLength(0);
        expect(made.length).toBeLessThanOrEqual(SHEET_SCOPE);
    });
});
