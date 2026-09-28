/* Task 040 phase 1: a time log stores its project id as text, and an aggregate casts neither side,
   so a custom report scoped to a limited viewer's projects must match every stored form of each id. */
process.env.STORAGE_TYPE = 'server';
const mongoose = require('mongoose');
const sift = require('sift');

const mockRoles = {};
const mockVisible = {};
const mockHidden = [];
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({
    getRoleType: jest.fn(async (companyId, uid) => (uid in mockRoles ? mockRoles[uid] : null)),
    isPrivileged: (roleType) => roleType === 1 || roleType === 2,
}));
jest.mock('../Modules/Agents/scope', () => ({ visibleProjectIds: jest.fn(async (companyId, uid) => mockVisible[uid] || []) }));
jest.mock('../Modules/Sprints/helpers/sprintVisibility', () => ({
    ...jest.requireActual('../Modules/Sprints/helpers/sprintVisibility'),
    hiddenSprintFilter: jest.fn(async () => (mockHidden.length ? { sprintId: { $nin: mockHidden } } : {})),
}));

const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const reports = require('../Modules/CustomReports/controller');
const verified = require('./fixtures/verifiedRequest');

const oid = (id) => new mongoose.Types.ObjectId(id);
const COMPANY = '6a9954186dd786246031e47b';
const OWNER = '6a9954186dd786246031e47c';
const MEMBER = '6a9954186dd786246031e47d';
const MINE = '6a9954186dd786246031e47e';
const OTHER = '6a9954186dd786246031e47f';
const OPEN_SPRINT = '6a9954186dd786246031e480';
const HIDDEN_SPRINT = '6a9954186dd786246031e481';
Object.assign(mockRoles, { [OWNER]: 1, [MEMBER]: 3 });
Object.assign(mockVisible, { [MEMBER]: [MINE] });
mockHidden.push(oid(HIDDEN_SPRINT));

const LOGS = [
    { _id: 'mine-as-text', ProjectId: MINE },
    { _id: 'mine-as-object-id', ProjectId: oid(MINE) },
    { _id: 'other-as-text', ProjectId: OTHER },
    { _id: 'other-as-object-id', ProjectId: oid(OTHER) },
];
const TASKS = [
    { _id: 'mine', ProjectID: oid(MINE), sprintId: oid(OPEN_SPRINT) },
    { _id: 'mine-private-sprint', ProjectID: oid(MINE), sprintId: oid(HIDDEN_SPRINT) },
    { _id: 'other', ProjectID: oid(OTHER), sprintId: oid(OPEN_SPRINT) },
].map((task) => ({ ...task, deletedStatusKey: 0, isParentTask: true }));

/* The server compares BSON types strictly: an ObjectId equals only an ObjectId. Tagging ids as
   plain objects keeps sift from reading them as their hex text. */
const bson = (value) => {
    if (value instanceof mongoose.Types.ObjectId) return { objectId: value.toHexString() };
    if (Array.isArray(value)) return value.map(bson);
    if (value && typeof value === 'object' && !(value instanceof Date) && !(value instanceof RegExp)) {
        return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, bson(v)]));
    }
    return value;
};
const matched = (rows, pipeline) => pipeline.filter((stage) => stage.$match)
    .reduce((left, stage) => left.filter((row) => sift(bson(stage.$match))(bson(row))), rows)
    .map((row) => row._id).sort();

const run = async (uid, body) => {
    const res = { status: jest.fn(() => res), json: jest.fn(() => res) };
    await reports.runReport(verified({ headers: { companyid: COMPANY }, uid, body, params: {}, query: {} }), res);
    const call = MongoDbCrudOpration.mock.calls.find(([, query, method]) => method === 'aggregate');
    return { res, call };
};

const logReport = (filters = {}) => ({ source: 'timelogs', dimension: 'project', metric: 'hours', chartType: 'bar', filters });
const taskReport = (filters = {}) => ({ source: 'tasks', dimension: 'status', metric: 'count', chartType: 'bar', filters });

beforeEach(() => {
    MongoDbCrudOpration.mockReset();
    MongoDbCrudOpration.mockResolvedValue([]);
});

describe('a time-log report for a limited viewer', () => {
    test('finds their project\'s time logs whichever form stored the project id', async () => {
        const { res, call } = await run(MEMBER, logReport());
        expect(res.status).not.toHaveBeenCalled();
        const [companyId, { type, data: [pipeline] }] = call;
        expect([companyId, type]).toEqual([COMPANY, SCHEMA_TYPE.TIMESHEET]);
        expect(matched(LOGS, pipeline)).toEqual(['mine-as-object-id', 'mine-as-text']);
    });

    test('filtered to their project, finds it in either form', async () => {
        const { call } = await run(MEMBER, logReport({ project: MINE }));
        expect(matched(LOGS, call[1].data[0])).toEqual(['mine-as-object-id', 'mine-as-text']);
    });

    test('never shows another project\'s rows, even when asked for it', async () => {
        const { call } = await run(MEMBER, logReport({ project: OTHER }));
        expect(matched(LOGS, call[1].data[0])).toEqual([]);
    });

    test('an owner still reads every project', async () => {
        const { call } = await run(OWNER, logReport());
        expect(matched(LOGS, call[1].data[0])).toEqual(LOGS.map((log) => log._id).sort());
    });
});

/* Just enough of the server to run a report pipeline: $match, $group on a field or on $convert to
   text, $sum, $sort and $limit. Anything else throws, so the test cannot pass on an operator it
   does not understand. */
const evaluate = (expr, row) => {
    if (typeof expr === 'string' && expr.startsWith('$')) return row[expr.slice(1)];
    if (expr && expr.$convert && expr.$convert.to === 'string') {
        const input = evaluate(expr.$convert.input, row);
        if (input === undefined || input === null) return evaluate(expr.$convert.onNull ?? null, row);
        if (input instanceof mongoose.Types.ObjectId) return input.toHexString();
        if (['string', 'number', 'boolean'].includes(typeof input)) return String(input);
        return evaluate(expr.$convert.onError, row);
    }
    if (expr === null || typeof expr !== 'object') return expr;
    throw new Error(`unsupported expression ${JSON.stringify(expr)}`);
};
const groupKey = (value) => (value instanceof mongoose.Types.ObjectId ? `oid:${value}` : `${typeof value}:${value}`);
const aggregate = (rows, pipeline) => pipeline.reduce((docs, stage) => {
    if (stage.$match) return docs.filter((row) => sift(bson(stage.$match))(bson(row)));
    if (stage.$group) {
        const groups = new Map();
        docs.forEach((row) => {
            const _id = evaluate(stage.$group._id, row);
            const group = groups.get(groupKey(_id)) || { _id, value: 0 };
            const { $sum } = stage.$group.value;
            group.value += typeof $sum === 'number' ? $sum : Number(evaluate($sum, row)) || 0;
            groups.set(groupKey(_id), group);
        });
        return [...groups.values()];
    }
    if (stage.$sort) return [...docs].sort((a, b) => b.value - a.value);
    if (stage.$limit) return docs.slice(0, stage.$limit);
    throw new Error(`unsupported stage ${Object.keys(stage)[0]}`);
}, rows);

describe('a time-log report by project', () => {
    const LOGGED = [
        { _id: 'as-text', ProjectId: MINE, LogTimeDuration: 60 },
        { _id: 'as-object-id', ProjectId: oid(MINE), LogTimeDuration: 30 },
    ];

    test.each([['a limited viewer', MEMBER], ['an owner', OWNER]])('shows one row per project for %s while records hold both forms', async (who, uid) => {
        MongoDbCrudOpration.mockImplementation(async (companyId, { type, data }, method) => {
            if (method === 'aggregate' && type === SCHEMA_TYPE.TIMESHEET) return aggregate(LOGGED, data[0]);
            if (type === SCHEMA_TYPE.PROJECTS) return [{ _id: oid(MINE), ProjectName: 'Mine' }];
            return [];
        });
        const { res } = await run(uid, logReport());
        const { result } = res.json.mock.calls[0][0].data;
        expect(result).toEqual([{ key: MINE, label: 'Mine', value: 1.5 }]);
    });
});

describe('a task report for a limited viewer keeps its scope', () => {
    test('their project only, minus the private sprints they are not on', async () => {
        const { call } = await run(MEMBER, taskReport());
        const [companyId, { type, data: [pipeline] }] = call;
        expect([companyId, type]).toEqual([COMPANY, SCHEMA_TYPE.TASKS]);
        expect(matched(TASKS, pipeline)).toEqual(['mine']);
    });

    test('never shows another project\'s tasks, even when asked for it', async () => {
        const { call } = await run(MEMBER, taskReport({ project: OTHER }));
        expect(matched(TASKS, call[1].data[0])).toEqual([]);
    });
});
