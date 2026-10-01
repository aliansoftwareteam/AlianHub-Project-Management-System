/* The List asks for each group's column totals in the request that already brings its counts. The query is
   built in the frontend and run by the task find endpoint, so both ends are checked here. */
const mockDb = require('./fixtures/fakeMongo').create();

/* fakeMongo compares ids as strings; the handlers build real ObjectIds. */
const mockPlain = (value) => {
    if (Array.isArray(value)) return value.map(mockPlain);
    if (value && value._bsontype === 'ObjectId') return value.toHexString();
    if (value instanceof Date || value instanceof RegExp) return value;
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, mockPlain(v)]));
    return value;
};

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (companyId, query, method) => mockDb.crud(companyId, mockPlain(query), method),
}));
jest.mock('../Config/permissionGuard', () => ({
    getRoleType: jest.fn(),
    isPrivileged: (roleType) => roleType === 1 || roleType === 2,
    evaluatePermission: jest.fn(),
    isWritable: (permission) => permission === true,
}));
jest.mock('../Modules/Agents/scope', () => ({ visibleProjectIds: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn() }));
jest.mock('../utils/commonFunctions.js', () => ({ removeCache: jest.fn() }));
jest.mock('../Modules/service.js', () => ({}));
jest.mock('../Modules/serviceFunction.js', () => ({}));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { getRoleType } = require('../Config/permissionGuard');
const { visibleProjectIds } = require('../Modules/Agents/scope');
const { validatePipeline } = require('../Modules/Tasks/helpers/taskQueryGuard');
const { getTaskByQyery } = require('../Modules/Tasks/helpers/getTasksData');
const Q = require('../frontend/src/store/ProjectData/taskQueries');

const C = '6f0000000000000000000c01';
const ME = '6f0000000000000000000001';
const SOMEONE = '6f0000000000000000000002';
const MY_PROJECT = '6f0000000000000000000a01';
const CLOSED_PROJECT = '6f0000000000000000000a02';
const SPRINT = '6f0000000000000000000b01';
const PRIVATE_SPRINT = '6f0000000000000000000b02';
const CLOSED_SPRINT = '6f0000000000000000000b03';
const COST = '6f0000000000000000000f01';
const BUG = 2;

const COST_TOTAL = { id: `cf:${COST}`, path: `customField.${COST}`, wrapped: true, taskTypes: [] };
const POINTS_TOTAL = { id: 'points', path: 'points', wrapped: false, taskTypes: [] };
const todo = { searchKey: 'statusKey', searchValue: 1, conditions: [{ statusKey: { $eq: 1 } }] };
const done = { searchKey: 'statusKey', searchValue: 2, conditions: [{ statusKey: { $eq: 2 } }] };

const cost = (fieldValue) => ({ [COST]: { fieldValue, _id: COST } });
const task = (over) => mockDb.seed(SCHEMA_TYPE.TASKS, {
    TaskName: 'task', deletedStatusKey: 0, isParentTask: true, statusKey: 1, AssigneeUserId: [ME], ProjectID: MY_PROJECT, sprintId: SPRINT, TaskTypeKey: 1, ...over,
});

const totalsFor = async ({ pid = MY_PROJECT, sprintId = SPRINT, items = [todo, done], totals = [COST_TOTAL], query } = {}) => {
    const findQuery = query || Q.groupCountsQuery({ pid, sprintId, items, totals });
    const res = { statusCode: 200, body: undefined };
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (body) => { res.body = body; return res; };
    await getTaskByQyery({ headers: { companyid: C }, uid: ME, aud: C, body: { findQuery } }, res);
    expect(res.statusCode).toBe(200);
    return { counts: Q.readGroupCounts(items, res.body[0]), totals: Q.readGroupTotals(items, res.body[0], totals) };
};

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    jest.clearAllMocks();
    getRoleType.mockResolvedValue(3);
    visibleProjectIds.mockResolvedValue([MY_PROJECT]);
    mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: PRIVATE_SPRINT, projectId: MY_PROJECT, private: true, AssigneeUserId: [SOMEONE] });
});

describe('the group totals query', () => {
    test('is the group counts query when no column is totalled', () => {
        expect(Q.groupCountsQuery({ pid: MY_PROJECT, sprintId: SPRINT, items: [todo], totals: [] }))
            .toEqual(Q.groupCountsQuery({ pid: MY_PROJECT, sprintId: SPRINT, items: [todo] }));
    });

    test('passes the task query guard', () => {
        const query = Q.groupCountsQuery({ pid: MY_PROJECT, sprintId: SPRINT, items: [todo, done], totals: [COST_TOTAL, POINTS_TOTAL] });
        expect(() => validatePipeline(query)).not.toThrow();
    });

    test('reads 0 for a group that brought nothing back', () => {
        expect(Q.readGroupTotals([todo, done], { g0: [{ count: 2, t0: 150 }], g1: [] }, [COST_TOTAL]))
            .toEqual({ statusKey_1: { [COST_TOTAL.id]: 150 }, statusKey_2: { [COST_TOTAL.id]: 0 } });
    });
});

describe('the totals of a group', () => {
    test('add every task of the group, whatever was typed into the field', async () => {
        task({ customField: cost('120') });
        task({ customField: cost(30) });
        task({ customField: cost('') });
        task({ customField: cost('n/a') });
        task({});
        task({ statusKey: 2, customField: cost('7.5') });
        const answer = await totalsFor();
        expect(answer.counts).toEqual({ statusKey_1: 5, statusKey_2: 1 });
        expect(answer.totals).toEqual({ statusKey_1: { [COST_TOTAL.id]: 150 }, statusKey_2: { [COST_TOTAL.id]: 7.5 } });
    });

    test('leave subtasks out, as the story point total does', async () => {
        task({ points: 5, customField: cost('100') });
        task({ points: 3, isParentTask: false, customField: cost('40') });
        const answer = await totalsFor({ totals: [COST_TOTAL, POINTS_TOTAL] });
        expect(answer.totals.statusKey_1).toEqual({ [COST_TOTAL.id]: 100, points: 5 });
    });

    test('leave out a task whose type the field is not for', async () => {
        task({ TaskTypeKey: BUG, customField: cost('10') });
        task({ TaskTypeKey: 1, customField: cost('99') });
        const answer = await totalsFor({ totals: [{ ...COST_TOTAL, taskTypes: [BUG] }] });
        expect(answer.totals.statusKey_1).toEqual({ [COST_TOTAL.id]: 10 });
    });
});

describe('the totals follow what the caller may open', () => {
    beforeEach(() => {
        task({ customField: cost('100') });
        task({ sprintId: PRIVATE_SPRINT, customField: cost('1000') });
        task({ ProjectID: CLOSED_PROJECT, sprintId: CLOSED_SPRINT, customField: cost('10000') });
    });

    test('a member gets the sum of their own sprint', async () => {
        expect((await totalsFor()).totals.statusKey_1).toEqual({ [COST_TOTAL.id]: 100 });
    });

    test('a member gets nothing for a private sprint they are not on', async () => {
        const answer = await totalsFor({ sprintId: PRIVATE_SPRINT });
        expect(answer.counts.statusKey_1).toBe(0);
        expect(answer.totals.statusKey_1).toEqual({ [COST_TOTAL.id]: 0 });
    });

    test('a member gets nothing for a project they cannot open', async () => {
        const answer = await totalsFor({ pid: CLOSED_PROJECT, sprintId: CLOSED_SPRINT });
        expect(answer.counts.statusKey_1).toBe(0);
        expect(answer.totals.statusKey_1).toEqual({ [COST_TOTAL.id]: 0 });
    });

    test('a query that names no project still adds only what the member may open', async () => {
        const [, ...rest] = Q.groupCountsQuery({ pid: MY_PROJECT, sprintId: SPRINT, items: [todo], totals: [COST_TOTAL] });
        const answer = await totalsFor({ items: [todo], query: [{ $match: { deletedStatusKey: 0 } }, ...rest] });
        expect(answer.totals.statusKey_1).toEqual({ [COST_TOTAL.id]: 100 });
    });

    test('someone on the private sprint gets its sum', async () => {
        mockDb.store[SCHEMA_TYPE.SPRINTS][0].AssigneeUserId = [ME];
        expect((await totalsFor({ sprintId: PRIVATE_SPRINT })).totals.statusKey_1).toEqual({ [COST_TOTAL.id]: 1000 });
    });
});
