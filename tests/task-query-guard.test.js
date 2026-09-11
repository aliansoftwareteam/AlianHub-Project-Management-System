const mockDb = require('./fixtures/fakeMongo').create();

/* fakeMongo compares ids as strings; the handlers build real ObjectIds. */
const mockPlain = (value) => {
    if (Array.isArray(value)) return value.map(mockPlain);
    if (value && value._bsontype === 'ObjectId') return value.toHexString();
    if (value instanceof Date || value instanceof RegExp) return value;
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, mockPlain(v)]));
    return value;
};
const mockRawCalls = [];

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (companyId, query, method) => {
        mockRawCalls.push({ companyId, query, method });
        return mockDb.crud(companyId, mockPlain(query), method);
    },
}));
jest.mock('../Config/permissionGuard', () => ({
    getRoleType: jest.fn(),
    isPrivileged: (roleType) => roleType === 1 || roleType === 2,
    evaluatePermission: jest.fn(),
    isWritable: (permission) => permission === true || permission === 1 || permission === 2,
}));
jest.mock('../Modules/Agents/scope', () => ({ visibleProjectIds: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn() }));
jest.mock('../utils/commonFunctions.js', () => ({ removeCache: jest.fn() }));
jest.mock('../Modules/service.js', () => ({}));
jest.mock('../Modules/serviceFunction.js', () => ({}));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { getRoleType, evaluatePermission } = require('../Config/permissionGuard');
const { visibleProjectIds } = require('../Modules/Agents/scope');
const { removeCache } = require('../utils/commonFunctions.js');
const socketEmitter = require('../event/socketEventEmitter');
const { MAX_LIMIT, validatePipeline, QueryRefused } = require('../Modules/Tasks/helpers/taskQueryGuard');
const { getTaskByQyery, updateTask } = require('../Modules/Tasks/helpers/getTasksData');

const C = '6f0000000000000000000c01';
const OTHER_COMPANY = '6f0000000000000000000c02';
const ME = '6f0000000000000000000001';
const MY_PROJECT = '6f0000000000000000000a01';
const HIDDEN_PROJECT = '6f0000000000000000000a02';
const SPRINT = '6f0000000000000000000b01';

const request = (body, over = {}) => ({ headers: { companyid: C }, uid: ME, aud: C, body, ...over });
const response = () => {
    const res = { statusCode: 200, body: undefined };
    res.status = jest.fn((code) => { res.statusCode = code; return res; });
    res.json = jest.fn((body) => { res.body = body; return res; });
    return res;
};
const run = async (handler, body, over) => {
    const res = response();
    await handler(request(body, over), res);
    return res;
};

const task = (over) => mockDb.seed(SCHEMA_TYPE.TASKS, { TaskName: 'task', deletedStatusKey: 0, AssigneeUserId: [ME], sprintId: SPRINT, ...over });
const tasks = () => mockDb.store[SCHEMA_TYPE.TASKS] || [];
const writes = () => mockDb.calls.filter((c) => !['find', 'findOne', 'aggregate', 'countDocuments'].includes(c.method));
const asRole = (roleType) => getRoleType.mockResolvedValue(roleType);

const QA_LOOKUP_PAYLOAD = [
    { $limit: 1 },
    { $lookup: { from: 'company_users', pipeline: [{ $project: { roleType: 1 } }], as: 'x' } },
    { $project: { n: { $size: '$x' } } },
];

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.calls.length = 0;
    mockRawCalls.length = 0;
    jest.clearAllMocks();
    asRole(3);
    visibleProjectIds.mockResolvedValue([MY_PROJECT]);
    evaluatePermission.mockResolvedValue(true);
});

describe('TSK-01 — the task query pipeline allowlist', () => {
    const refusal = (pipeline) => {
        try {
            validatePipeline(pipeline);
        } catch (error) {
            if (error instanceof QueryRefused) return error;
            throw error;
        }
        return null;
    };

    it('refuses the member $lookup into company_users with 400 and runs nothing', async () => {
        const res = await run(getTaskByQyery, { findQuery: QA_LOOKUP_PAYLOAD });
        expect(res.statusCode).toBe(400);
        expect(res.body).toMatchObject({ status: false, stage: '$lookup' });
        expect(res.body.message).toContain('company_users');
        expect(mockDb.calls.filter((c) => c.method === 'aggregate')).toHaveLength(0);
    });

    it.each(['company_users', 'users', 'userAuth', 'sessions', 'apiTokens', 'rules', 'companies', 'tasks', 'timesheets'])(
        'refuses a $lookup into %s',
        (from) => {
            expect(refusal([{ $lookup: { from, localField: 'ProjectID', foreignField: '_id', as: 'x' } }])).toMatchObject({ stage: '$lookup' });
        },
    );

    it.each(['$out', '$merge', '$unionWith', '$graphLookup', '$documents', '$collStats', '$currentOp', '$indexStats', '$set', '$replaceRoot', '$sample'])(
        'refuses the %s stage by name',
        (stage) => {
            expect(refusal([{ $match: {} }, { [stage]: 'x' }])).toMatchObject({ stage });
        },
    );

    it.each([
        ['$where', [{ $match: { $where: 'sleep(1000)' } }]],
        ['$function', [{ $match: { $expr: { $function: { body: 'function() { return true }', args: [], lang: 'js' } } } }]],
        ['$accumulator', [{ $group: { _id: null, x: { $accumulator: { init: 'function() {}', lang: 'js' } } } }]],
        ['$lookup', [{ $facet: { leak: [{ $lookup: { from: 'users', pipeline: [], as: 'u' } }] } }]],
        ['$lookup', [{ $lookup: { from: 'projects', localField: 'ProjectID', foreignField: '_id', as: 'p', pipeline: [{ $lookup: { from: 'users', pipeline: [], as: 'u' } }] } }]],
        ['$unionWith', [{ $facet: { leak: [{ $unionWith: 'users' }] } }]],
    ])('refuses %s wherever it is nested', (stage, pipeline) => {
        expect(refusal(pipeline)).toMatchObject({ stage });
    });

    it.each([
        ['a let join', { from: 'projects', let: { p: '$ProjectID' }, pipeline: [], as: 'p' }],
        ['a join with no localField', { from: 'projects', pipeline: [{ $project: { ProjectName: 1 } }], as: 'p' }],
        ['a join on another field', { from: 'projects', localField: 'AssigneeUserId', foreignField: '_id', as: 'p' }],
        ['a join into another foreign field', { from: 'sprints', localField: 'sprintId', foreignField: 'AssigneeUserId', as: 's' }],
    ])('refuses %s', (_, spec) => {
        expect(refusal([{ $lookup: spec }])).toMatchObject({ stage: '$lookup' });
    });

    it('caps $limit and refuses a non-positive one', () => {
        expect(validatePipeline([{ $limit: 1e9 }])).toEqual([{ $limit: MAX_LIMIT }]);
        expect(refusal([{ $limit: -1 }])).toMatchObject({ stage: '$limit' });
        expect(refusal([{ $skip: -5 }])).toMatchObject({ stage: '$skip' });
    });

    const lookups = [
        { $lookup: { from: 'projects', localField: 'ProjectID', foreignField: '_id', as: 'projectArr', pipeline: [{ $project: { ProjectName: 1 } }] } },
        { $unwind: { path: '$projectArr', preserveNullAndEmptyArrays: true } },
        { $lookup: { from: 'folders', localField: 'folderObjId', foreignField: '_id', as: 'folderArr', pipeline: [{ $project: { name: 1 } }] } },
        { $unwind: { path: '$folderArr', preserveNullAndEmptyArrays: true } },
        { $lookup: { from: 'sprints', localField: 'sprintId', foreignField: '_id', as: 'sprintArr', pipeline: [{ $project: { name: 1, folderId: 1 } }] } },
        { $unwind: '$sprintArr' },
    ];
    const INVENTORY = [
        ['desktop deep-link start', [{ $match: { objId: { _id: MY_PROJECT, CompanyId: C } } }, ...lookups]],
        ['desktop task search', [{ $match: { objId: { CompanyId: C }, AssigneeUserId: { $in: [ME] }, statusType: { $in: ['active'] }, deletedStatusKey: 0, TaskName: { $regex: 'a\\.b', $options: 'i' } } }, { $sort: { _id: -1 } }, { $skip: 20 }, { $limit: 20 }, ...lookups]],
        ['desktop home list', [{ $match: { $and: [{ objId: { CompanyId: C } }, { ProjectID: { objId: { $in: [MY_PROJECT] } } }], $or: [{ startDate: { dbDate: { $gte: 1, $lte: 2 } } }, { $and: [{ DueDate: { dbDate: { $gte: 1 } } }] }] } }, ...lookups, { $sort: { DueDate: -1, _id: 1 } }]],
        ['dashboard queue card facet', [{ $facet: { results: [{ $match: { $and: [{ AssigneeUserId: { $in: [ME] } }, { deletedStatusKey: 0 }] } }, { $skip: 0 }, { $limit: 10 }], count: [{ $match: { deletedStatusKey: 0 } }, { $count: 'count' }] } }]],
        ['tasks per sprint count', [{ $match: { objId: { sprintId: SPRINT }, deletedStatusKey: { $in: [0, 2, null] } } }, { $count: 'count' }]],
        ['home my work (bare object)', { $match: { mainChat: { $ne: true }, statusType: { $nin: ['done', 'close'] }, $or: [{ AssigneeUserId: ME }, { Task_Leader: ME }] } }],
        ['subtask estimate sum', [{ $match: { ParentTaskId: 'p' } }, { $group: { _id: null, estimate: { $sum: { $ifNull: ['$estimatedTime', 0] } } } }]],
        ['subtask progress', [{ $match: { ParentTaskId: 'p', deletedStatusKey: { $in: [0, null] } } }, { $group: { _id: null, total: { $sum: 1 }, completed: { $sum: { $cond: [{ $eq: ['$statusType', 'close'] }, 1, 0] } } } }]],
        ['page block task list', [{ $match: { ProjectID: { objId: { $in: [MY_PROJECT] } }, 'status.type': { $ne: 'close' } } }, { $project: { TaskName: 1, TaskKey: 1 } }, { $sort: { updatedAt: -1 } }, { $limit: 30 }]],
        ['dashboard pie by assignee', [{ $unwind: '$AssigneeUserId' }, { $match: { deletedStatusKey: { $in: [0] }, customField: { $elemMatch: { value: { $in: ['x'] } } } } }, { $group: { _id: '$AssigneeUserId', count: { $sum: 1 } } }, { $sort: { count: -1 } }, { $match: { _id: ME } }]],
        ['people directory', [{ $match: { statusType: { $ne: 'close' } } }, { $unwind: '$AssigneeUserId' }, { $group: { _id: '$AssigneeUserId', tasks: { $sum: 1 }, projects: { $addToSet: '$ProjectID' } } }, { $project: { tasks: 1, projects: { $size: '$projects' } } }]],
        ['sprints with matches', [{ $match: { legacyId: { $exists: false }, TaskName: { $regex: 'x', $options: 'i' } } }, { $group: { _id: '$sprintId' } }]],
        ['paginated board group', [{ $match: { objId: { sprintId: SPRINT, ProjectID: MY_PROJECT }, deletedStatusKey: 0, statusKey: { $eq: 1 } } }, { $sort: { groupByStatusIndex: 1, createdAt: 1, _id: 1 } }, { $facet: { result: [{ $skip: 0 }, { $limit: 35 }], count: [{ $count: 'count' }] } }]],
        ['log-time picker', [{ $match: { AssigneeUserId: { $in: [ME] } } }, { $sort: { updatedAt: -1 } }, { $limit: 30 }, { $project: { TaskName: 1 } }]],
    ];

    it.each(INVENTORY)('still accepts the %s pipeline unchanged', (_, pipeline) => {
        const stages = Array.isArray(pipeline) ? pipeline : [pipeline];
        expect(validatePipeline(pipeline)).toEqual(stages);
    });
});

describe('TSK-01 — tasks are bound to the projects the caller can see', () => {
    beforeEach(() => {
        task({ TaskName: 'mine', ProjectID: MY_PROJECT });
        task({ TaskName: 'hidden', ProjectID: HIDDEN_PROJECT });
    });
    const names = (res) => res.body.map((t) => t.TaskName).sort();

    it('a member sees only tasks in projects they belong to, with the scope as the first stage', async () => {
        const res = await run(getTaskByQyery, { findQuery: [{ $match: { deletedStatusKey: 0 } }] });
        expect(res.statusCode).toBe(200);
        expect(names(res)).toEqual(['mine']);
        expect(visibleProjectIds).toHaveBeenCalledWith(C, ME);
        const [pipeline] = mockRawCalls.find((c) => c.method === 'aggregate').query.data;
        expect(pipeline[0]).toEqual({ $match: { ProjectID: { $in: [expect.objectContaining({ _bsontype: 'ObjectId' })] } } });
        expect(String(pipeline[0].$match.ProjectID.$in[0])).toBe(MY_PROJECT);
    });

    it('a member cannot read a hidden task by id', async () => {
        const hidden = tasks().find((t) => t.TaskName === 'hidden');
        const res = await run(getTaskByQyery, { findQuery: { $match: { _id: hidden._id } } });
        expect(res.body).toEqual([]);
    });

    it.each([[1, 'owner'], [2, 'admin']])('roleType %s (%s) keeps full company visibility', async (roleType) => {
        asRole(roleType);
        const res = await run(getTaskByQyery, { findQuery: [{ $match: { deletedStatusKey: 0 } }] });
        expect(names(res)).toEqual(['hidden', 'mine']);
        expect(visibleProjectIds).not.toHaveBeenCalled();
    });

    it('someone who is not a member of the company sees nothing', async () => {
        asRole(null);
        const res = await run(getTaskByQyery, { findQuery: [{ $match: {} }] });
        expect(res.body).toEqual([]);
    });

    it('refuses a company outside the token audience', async () => {
        const res = await run(getTaskByQyery, { findQuery: [{ $match: {} }] }, { headers: { companyid: OTHER_COMPANY } });
        expect(res.statusCode).toBe(403);
        expect(res.body.status).toBe(false);
    });
});

describe('TSK-02 — PUT /api/v1/task only runs the project lifecycle cascade', () => {
    const cascade = (over = {}) => ({
        firstParameter: { objId: { ProjectID: MY_PROJECT }, deletedStatusKey: 0 },
        secondParameter: { $set: { deletedStatusKey: 8 } },
        key: 'updateMany',
        isConvertFirstParameter: true,
        isConvertSecondParameter: false,
        ...over,
    });

    beforeEach(() => {
        task({ TaskName: 'open', ProjectID: MY_PROJECT });
        task({ TaskName: 'already trashed', ProjectID: MY_PROJECT, deletedStatusKey: 1 });
        task({ TaskName: 'elsewhere', ProjectID: HIDDEN_PROJECT });
    });

    it.each(['deleteMany', 'deleteOne', 'findOneAndDelete', 'estimatedDocumentCount', 'drop', 'bulkWrite', 'updateOne', 'replaceOne', 'aggregate'])(
        'refuses key %s with 403 and touches nothing',
        async (key) => {
            const res = await run(updateTask, { firstParameter: {}, secondParameter: { _id: 1 }, key, isConvertFirstParameter: false });
            expect(res.statusCode).toBe(403);
            expect(res.body.status).toBe(false);
            expect(mockDb.calls).toHaveLength(0);
            expect(tasks()).toHaveLength(3);
        },
    );

    it.each([
        ['an empty filter', { firstParameter: {} }],
        ['an extra filter field', { firstParameter: { objId: { ProjectID: MY_PROJECT }, deletedStatusKey: 0, AssigneeUserId: ME } }],
        ['an operator in the filter', { firstParameter: { objId: { ProjectID: MY_PROJECT }, deletedStatusKey: { $ne: 5 } } }],
        ['a different update', { secondParameter: { $set: { TaskName: 'owned' } } }],
        ['an unsupported transition', { secondParameter: { $set: { deletedStatusKey: 2 } } }],
    ])('refuses updateMany with %s', async (_, over) => {
        const res = await run(updateTask, cascade(over));
        expect(res.statusCode).toBe(403);
        expect(writes()).toHaveLength(0);
    });

    it('runs a permitted cascade, scoped to the project and prior key, and emits each task', async () => {
        const emit = jest.spyOn(socketEmitter, 'emit');
        const res = await run(updateTask, cascade());
        expect(res.statusCode).toBe(200);
        expect(res.body).toMatchObject({ status: true, data: { modifiedCount: 1 } });
        expect(evaluatePermission).toHaveBeenCalledWith(C, ME, 'project.project_close', { projectId: MY_PROJECT });
        expect(Object.fromEntries(tasks().map((t) => [t.TaskName, t.deletedStatusKey]))).toEqual({ open: 8, 'already trashed': 1, elsewhere: 0 });
        const events = emit.mock.calls.filter(([name]) => name === 'update');
        expect(events).toHaveLength(1);
        expect(events[0][1]).toMatchObject({ type: 'update', module: 'task', updatedFields: { deletedStatusKey: 8 }, data: { deletedStatusKey: 8 } });
        expect(removeCache).toHaveBeenCalledWith('UserProjectData:', true);
        emit.mockRestore();
    });

    it.each([[8, 0, 'project.project_list'], [0, 1, 'project.project_delete'], [0, 7, 'project.project_delete']])(
        'checks the matching permission for %s → %s',
        async (from, to, key) => {
            await run(updateTask, cascade({ firstParameter: { objId: { ProjectID: MY_PROJECT }, deletedStatusKey: from }, secondParameter: { $set: { deletedStatusKey: to } } }));
            expect(evaluatePermission).toHaveBeenCalledWith(C, ME, key, { projectId: MY_PROJECT });
        },
    );

    it('refuses a member without the permission', async () => {
        evaluatePermission.mockResolvedValue(false);
        const res = await run(updateTask, cascade());
        expect(res.statusCode).toBe(403);
        expect(writes()).toHaveLength(0);
    });

    it('refuses a member cascading a project they cannot see', async () => {
        const res = await run(updateTask, cascade({ firstParameter: { objId: { ProjectID: HIDDEN_PROJECT }, deletedStatusKey: 0 } }));
        expect(res.statusCode).toBe(403);
        expect(writes()).toHaveLength(0);
        expect(tasks().find((t) => t.TaskName === 'elsewhere').deletedStatusKey).toBe(0);
    });

    it('lets an owner cascade any project', async () => {
        asRole(1);
        const res = await run(updateTask, cascade({ firstParameter: { objId: { ProjectID: HIDDEN_PROJECT }, deletedStatusKey: 0 } }));
        expect(res.statusCode).toBe(200);
        expect(visibleProjectIds).not.toHaveBeenCalled();
        expect(tasks().find((t) => t.TaskName === 'elsewhere').deletedStatusKey).toBe(8);
    });

    it('refuses a company outside the token audience', async () => {
        const res = await run(updateTask, cascade(), { headers: { companyid: OTHER_COMPANY } });
        expect(res.statusCode).toBe(403);
        expect(mockDb.calls).toHaveLength(0);
    });
});
