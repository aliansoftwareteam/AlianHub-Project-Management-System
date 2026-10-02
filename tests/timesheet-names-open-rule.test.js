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
jest.mock('../utils/companyMembers', () => ({ acceptedMemberIds: jest.fn(async (companyId, ids) => ids) }));
jest.mock('../Modules/Company/helpers/companyWeek', () => ({ workingDaysOf: jest.fn(async () => [1, 2, 3, 4, 5]), weekendOf: () => [0, 6] }));
jest.mock('../Modules/Audit/recorder', () => ({ recordAuditFromReq: jest.fn() }));

const verified = require('./fixtures/verifiedRequest');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const world = require('./fixtures/accessWorld');
const { getWeekTimesheet } = require('../Modules/TimeSheet/controller/weekTimesheet');
const { getWorkloadGrid } = require('../Modules/TimeSheet/controller/workloadGrid');
const { listRunningTimers } = require('../Modules/LogTime/controllerV2/webTimer');
const { getInvoice } = require('../Modules/Invoice/controller/projectInvoices');

const { CID, OWNER, ADMIN, INSIDER, OUTSIDER, GUEST, P_OPEN, P_PRIVATE, P_PERSONAL, T_OPEN, T_SECRET, T_PRIVATE, T_PERSONAL, OPENS, settle } = world;
const { seed } = world.create(mockDb);

const EVERYONE = [['the owner', OWNER], ['an admin', ADMIN], ['a member on everything private', INSIDER], ['a member', OUTSIDER], ['a guest', GUEST]];
const PLACES = { [T_OPEN]: [P_OPEN, 'Open task', 'Open'], [T_SECRET]: [P_OPEN, 'Secret task', 'Open'], [T_PRIVATE]: [P_PRIVATE, 'Private task', 'Private'], [T_PERSONAL]: [P_PERSONAL, 'Personal task', 'Personal'] };
const OPEN_PROJECTS = { [OWNER]: [P_OPEN, P_PRIVATE], [ADMIN]: [P_OPEN, P_PRIVATE], [INSIDER]: [P_OPEN, P_PRIVATE, P_PERSONAL], [OUTSIDER]: [P_OPEN], [GUEST]: [P_OPEN] };
const DAY = '2026-09-21';
const AT = Math.floor(Date.UTC(2026, 8, 21, 10) / 1000);
const INVOICE = '6f0000000000000000000f01';
/* Time rows an invoice line names: two of the invoice's own project, one of another. */
const LOGS = { '6f0000000000000000000f11': [T_OPEN, P_OPEN], '6f0000000000000000000f12': [T_SECRET, P_OPEN], '6f0000000000000000000f13': [T_PRIVATE, P_PRIVATE] };

/* Each person has time, a plan and a running timer kept against every task, whoever can open it. */
const seedRows = () => {
    seed();
    EVERYONE.forEach(([, uid]) => Object.entries(PLACES).forEach(([taskId, [projectId]], at) => {
        mockDb.seed(SCHEMA_TYPE.TIMESHEET, { TicketID: taskId, ProjectId: projectId, Loggeduser: uid, LogStartTime: AT + at, LogTimeDuration: 30 + at, startTimeTracker: Math.floor(Date.now() / 1000), billable: true });
        mockDb.seed(SCHEMA_TYPE.ESTIMATES_TIME, { TaskId: taskId, ProjectId: projectId, UserId: uid, Date: new Date(`${DAY}T09:00:00.000Z`), EstimatedTime: 60 + at });
    }));
    Object.entries(LOGS).forEach(([_id, [TicketID, ProjectId]]) => mockDb.seed(SCHEMA_TYPE.TIMESHEET, { _id, TicketID, ProjectId, Loggeduser: INSIDER, LogStartTime: AT - 86400 * 30, LogTimeDuration: 45, LogDescription: `note on ${TicketID}` }));
    mockDb.seed(SCHEMA_TYPE.PROJECT_INVOICES, { _id: INVOICE, ProjectID: P_OPEN, number: 'INV-1', deletedStatusKey: 0, lines: [{ id: 'l1', kind: 'time', label: 'September', taskIds: Object.keys(PLACES), timelogIds: Object.keys(LOGS) }] });
};

const answered = async (handler, req) => {
    const res = { statusCode: 200, body: null };
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (answer) => { res.body = answer; return res; };
    res.send = res.json;
    await handler(verified({ headers: { companyid: CID }, query: {}, params: {}, body: {}, ...req }), res);
    await settle();
    return res.body;
};

const shownFor = (uid, taskIds) => taskIds.map((taskId) => {
    const [projectId, taskName, projectName] = PLACES[taskId];
    return [taskId, OPENS[uid].includes(taskId) ? taskName : '', OPEN_PROJECTS[uid].includes(projectId) ? projectName : ''];
}).sort();

beforeEach(() => { jest.clearAllMocks(); seedRows(); });

describe('time and plans kept against a task', () => {
    it.each(EVERYONE)('keep their hours in the week of %s, and name the task and the project only where they can open them', async (who, uid) => {
        const { data } = await answered(getWeekTimesheet, { uid, query: { start: DAY, end: DAY } });
        const kept = Object.keys(PLACES).filter((taskId) => uid === INSIDER || taskId !== T_PERSONAL || ![OWNER, ADMIN].includes(uid));

        expect(data.rows.map((row) => [row.taskId, row.taskName, row.projectName]).sort()).toEqual(shownFor(uid, kept));
        expect(data.rows.map((row) => row.total).sort()).toEqual(kept.map((taskId) => 30 + Object.keys(PLACES).indexOf(taskId)).sort());
        expect(data.rows.filter((row) => !row.taskName).every((row) => row.sprintId === '')).toBe(true);
    });

    it.each(EVERYONE)('name a running timer of %s only where they can open its task and its project', async (who, uid) => {
        const { data } = await answered(listRunningTimers, { uid });
        expect(data.map((timer) => [timer.taskId, timer.taskName, timer.projectName]).sort()).toEqual(shownFor(uid, Object.keys(PLACES)));
        expect(data.filter((timer) => !timer.taskName).every((timer) => timer.sprintId === '')).toBe(true);
    });

    it.each(EVERYONE)('name a planned task on the workload of %s only where they can open it', async (who, uid) => {
        const { data } = await answered(getWorkloadGrid, { uid, body: { start: DAY, end: DAY, unit: 'hours' } });
        const chips = data.users.find((user) => user.userId === uid).days.flatMap((day) => day.chips);

        expect(chips.length).toBeGreaterThan(0);
        expect(chips.map((chip) => [chip.taskId, chip.name, chip.projectName]).sort()).toEqual(shownFor(uid, chips.map((chip) => chip.taskId)));
    });

    it.each(EVERYONE.filter(([, uid]) => uid !== GUEST))('are named behind an invoice line for %s only where they can open the task', async (who, uid) => {
        const { data } = await answered(getInvoice, { uid, params: { id: INVOICE } });
        expect(data.trace.tasks.map((task) => [task._id, task.name]).sort()).toEqual(Object.keys(PLACES).map((taskId) => [taskId, OPENS[uid].includes(taskId) ? PLACES[taskId][1] : '']).sort());
        expect(data.trace.tasks.filter((task) => !task.name).every((task) => task.key === '' && task.done === false)).toBe(true);
    });

    it.each(EVERYONE.filter(([, uid]) => uid !== GUEST))('behind an invoice line are, for %s, the time rows of the project of the invoice, with a note only where they can open the task', async (who, uid) => {
        const { data } = await answered(getInvoice, { uid, params: { id: INVOICE } });
        expect(data.trace.timelogs.map((log) => [log.taskId, log.minutes, log.note]).sort()).toEqual([
            [T_OPEN, 45, `note on ${T_OPEN}`],
            [T_SECRET, 45, OPENS[uid].includes(T_SECRET) ? `note on ${T_SECRET}` : ''],
        ]);
    });
});
