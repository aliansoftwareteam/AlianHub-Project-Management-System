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
const { getlogDetailTimeSheet } = require('../Modules/TimeSheet/controller/logDetailView');
const { getTimeLogTimeSheet } = require('../Modules/TimeSheet/controller/timeLog');
const { getTimeSheetByAggregate } = require('../Modules/TimeSheet/controller/getTimeSheetByAggregate');
const { getEstimatedTime, getEstimateByAggregate } = require('../Modules/EstimatedTime/controller');
const { resolveSheetScope, SHEET_PERMISSION } = require('../Modules/TimeSheet/helpers/timeScope');
const { scopeTimesheetPipeline, scopeEstimatePipeline, checkStages, withJoinScope } = require('../Modules/TimeSheet/helpers/timesheetQueryScope');
const { matches } = require('./fixtures/fakeMongo');

const { CID, OWNER, ADMIN, INSIDER, OUTSIDER, GUEST, P_OPEN, T_OPEN, T_SECRET, OPENS, settle } = world;
const { seed, rows } = world.create(mockDb);

const EVERYONE = [['the owner', OWNER], ['an admin', ADMIN], ['a member on the private list', INSIDER], ['a member', OUTSIDER], ['a guest', GUEST]];
const TASKS = [T_OPEN, T_SECRET];
const AT = 1790000000;

/* Every role reads everyone's time and plans in the projects it can open, as the sheet settings let a workspace choose. */
const seedRows = () => {
    seed();
    const sheets = mockDb.seed(SCHEMA_TYPE.RULES, { key: 'sheet_settings', name: 'Sheet settings', isParent: true, roles: [] });
    ['user_timesheet', 'project_timesheet', 'workload_timesheet', 'tracker_timesheet'].forEach((key) => mockDb.seed(SCHEMA_TYPE.RULES, {
        key, name: key, isParent: false, parentId: String(sheets._id), roles: [{ key: 3, permission: 2 }, { key: 0, permission: 2 }],
    }));
    [INSIDER, OUTSIDER].forEach((uid) => TASKS.forEach((taskId) => {
        mockDb.seed(SCHEMA_TYPE.TIMESHEET, { TicketID: taskId, ProjectId: P_OPEN, Loggeduser: uid, LogStartTime: AT, LogTimeDuration: 30, LogDescription: `time of ${uid} on ${taskId}` });
        mockDb.seed(SCHEMA_TYPE.ESTIMATES_TIME, { TaskId: taskId, ProjectId: P_OPEN, UserId: uid, Date: new Date('2026-09-21T09:00:00.000Z'), EstimatedTime: 60 });
    }));
};

const answered = async (handler, req) => {
    const res = { statusCode: 200, body: null };
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (answer) => { res.body = answer; return res; };
    res.send = res.json;
    await handler({ headers: { companyid: CID }, aud: CID, query: {}, params: {}, body: {}, ...req }, res);
    await settle();
    return res.body;
};

/* [task, whose row]: a person reads their own rows, and another person's on a task they can open. */
const readBy = (uid) => [INSIDER, OUTSIDER].flatMap((owner) => TASKS.filter((taskId) => owner === uid || OPENS[uid].includes(taskId)).map((taskId) => `${taskId} ${owner}`)).sort();
const timeIn = (list) => list.map((row) => `${row.TicketID} ${row.Loggeduser}`).sort();
const plansIn = (list) => list.map((row) => `${row.TaskId} ${row.UserId}`).sort();

beforeEach(() => { jest.clearAllMocks(); seedRows(); });

describe('the time and the plans other people keep against a task', () => {
    it.each(EVERYONE)('are read by %s, task by task, only for a task they can open', async (who, uid) => {
        const time = [];
        const picked = [];
        const plans = [];
        for (const taskId of TASKS) {
            time.push(...await answered(getlogDetailTimeSheet, { uid, body: { taskId, projectId: P_OPEN, startDate: AT - 10, endDate: AT + 10 } }));
            picked.push(...await answered(getTimeLogTimeSheet, { uid, body: { taskIds: [{ TicketID: taskId }] } }));
            plans.push(...await answered(getEstimatedTime, { uid, params: { pid: P_OPEN, tid: taskId } }));
        }
        expect(timeIn(time)).toEqual(readBy(uid));
        expect(timeIn(picked)).toEqual(readBy(uid));
        expect(plansIn(plans)).toEqual(readBy(uid));
    });

    it.each(EVERYONE)('are read by %s across a project without those of a private list they are not on', async (who, uid) => {
        const time = await answered(getTimeSheetByAggregate, { uid, body: { queryeta: [{ $match: { LogStartTime: AT } }] } });
        const plans = await answered(getEstimateByAggregate, { uid, body: { queryeta: [{ $match: { EstimatedTime: 60 } }] } });

        expect(timeIn(time)).toEqual(readBy(uid));
        expect(plansIn(plans)).toEqual(readBy(uid));
    });

    it.each(EVERYONE)('carry the task they are joined to, for %s, only when they can open it', async (who, uid) => {
        const join = { $lookup: { from: 'tasks', localField: 'TicketID', foreignField: '_id', as: 'task', pipeline: [{ $project: { TaskName: 1 } }] } };
        const time = await answered(getTimeSheetByAggregate, { uid, body: { queryeta: [{ $match: { LogStartTime: AT } }, join] } });
        const lists = await answered(getTimeSheetByAggregate, { uid, body: { queryeta: [{ $match: { LogStartTime: AT } }, { $lookup: { from: 'tasks', localField: 'TicketID', foreignField: '_id', as: 'task', pipeline: [{ $lookup: { from: 'sprints', localField: 'sprintId', foreignField: '_id', as: 'list', pipeline: [] } }] } }] } });

        expect(time.length).toBeGreaterThan(0);
        expect([...new Set(time.flatMap((row) => row.task.map((task) => task.TaskName)))].sort()).toEqual(TASKS.filter((id) => OPENS[uid].includes(id)).map((id) => (id === T_OPEN ? 'Open task' : 'Secret task')).sort());
        expect([...new Set(lists.flatMap((row) => row.task.flatMap((task) => task.list.map((list) => list.name))))].sort()).toEqual(OPENS[uid].includes(T_SECRET) ? ['Open list', 'Private list'] : ['Open list']);
        expect(rows(SCHEMA_TYPE.TIMESHEET)).toHaveLength(4);
    });
});

/* A join that names no field to join on reads the whole collection, so what it starts from is all that holds it. */
describe('a join a time or plan query makes without tying it to its rows', () => {
    const TASKS_JOIN = { $lookup: { from: 'tasks', as: 'tasks', pipeline: [{ $project: { TaskName: 1 } }] } };
    const LISTS_JOIN = { $lookup: { from: 'tasks', as: 'tasks', pipeline: [{ $lookup: { from: 'sprints', as: 'lists', pipeline: [] } }] } };
    const joinOf = (stages) => stages.map((stage) => stage.$lookup || (stage.$facet && Object.values(stage.$facet)[0][0].$lookup)).find(Boolean);
    const ROADS = {
        'the timesheet query': (scope, join) => withJoinScope(CID, scope, [join], (joinScope) => scopeTimesheetPipeline([join], joinScope)),
        'the plan query': (scope, join) => withJoinScope(CID, scope, [join], (joinScope) => scopeEstimatePipeline([join], joinScope)),
        'a facet of the time log read': (scope, join) => withJoinScope(CID, scope, [{ $facet: { rows: [join] } }], (joinScope) => checkStages([{ $facet: { rows: [join] } }], joinScope)),
    };
    const cases = Object.keys(ROADS).flatMap((road) => EVERYONE.filter(([, uid]) => ![OWNER, ADMIN].includes(uid)).map(([who, uid]) => [road, who, uid]));

    it.each(cases)('%s: gives %s the tasks and the lists they can open, and no other', async (road, who, uid) => {
        const scope = await resolveSheetScope(CID, uid, [SHEET_PERMISSION.tracker, SHEET_PERMISSION.workload]);
        const [tasksFirst] = joinOf(await ROADS[road](scope, TASKS_JOIN)).pipeline;
        const [, listsJoin] = joinOf(await ROADS[road](scope, LISTS_JOIN)).pipeline;
        const [listsFirst] = listsJoin.$lookup.pipeline;

        expect(rows(SCHEMA_TYPE.TASKS).filter((row) => matches(row, tasksFirst.$match)).map((row) => String(row._id)).sort()).toEqual([...OPENS[uid]].sort());
        expect(rows(SCHEMA_TYPE.SPRINTS).filter((row) => matches(row, listsFirst.$match)).map((row) => row.name).sort())
            .toEqual(uid === INSIDER ? ['List of the private project', 'Open list', 'Personal list', 'Private list'] : ['Open list']);
    });
});

describe('text typed into a stage of the time log read', () => {
    const typed = { $addFields: { hit: { $regexMatch: { input: '$LogDescription', regex: '(a+)+$', options: 'i' } } } };

    it('is matched as text, never run as a pattern', async () => {
        mockDb.calls.length = 0;
        await answered(getTimeLogTimeSheet, { uid: OUTSIDER, body: { taskIds: [{ TicketID: T_OPEN }], addFields: typed } });
        const [pipeline] = mockDb.calls.filter((call) => call.type === SCHEMA_TYPE.TIMESHEET && call.method === 'aggregate').pop().data;

        expect(pipeline.find((stage) => stage.$addFields).$addFields.hit.$regexMatch.regex).toBe('\\(a\\+\\)\\+\\$');
    });

    it('is refused when it is too long to be text someone typed', async () => {
        const res = { statusCode: 200 };
        res.status = (code) => { res.statusCode = code; return res; };
        res.json = () => res;
        await getTimeLogTimeSheet({ uid: OUTSIDER, headers: { companyid: CID }, body: { taskIds: [{ TicketID: T_OPEN }], addFields: { $addFields: { hit: { $regexMatch: { input: '$LogDescription', regex: 'a'.repeat(5000) } } } } } }, res);
        expect(res.statusCode).toBe(400);
    });
});
