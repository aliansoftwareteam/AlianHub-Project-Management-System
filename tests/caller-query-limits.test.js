process.env.STORAGE_TYPE = process.env.STORAGE_TYPE || 'server';

const mockCrud = jest.fn(async () => []);

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (...args) => mockCrud(...args),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({
    ...jest.requireActual('../Config/permissionGuard'),
    getRoleType: jest.fn(),
    evaluatePermission: jest.fn(),
}));
jest.mock('../Modules/Agents/scope', () => ({ ...jest.requireActual('../Modules/Agents/scope'), visibleProjectIds: jest.fn() }));
jest.mock('../Modules/PersonalList/ownership', () => ({ ...jest.requireActual('../Modules/PersonalList/ownership'), othersPersonalListIds: jest.fn(async () => []) }));
jest.mock('../Modules/Agents/privateWork', () => ({
    ...jest.requireActual('../Modules/Agents/privateWork'),
    privateWorkOf: jest.fn(async (companyId, uid) => ({ uid: String(uid), personalLists: [], directSpaces: [], myChats: [], myRuns: [] })),
}));
jest.mock('../Modules/Project/helpers/projectItemHistory', () => ({
    recordChecklistChange: jest.fn(async () => undefined),
    recordTagDefinitionChange: jest.fn(async () => undefined),
}));
jest.mock('../utils/commonFunctions', () => ({ ...jest.requireActual('../utils/commonFunctions'), removeCache: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../Config/projectPeople', () => ({ ...jest.requireActual('../Config/projectPeople'), namedPeopleRefusal: jest.fn(async () => '') }));

const { getRoleType, evaluatePermission } = require('../Config/permissionGuard');
const { visibleProjectIds } = require('../Modules/Agents/scope');
const { FORBIDDEN_OPERATORS, queryRefusal, isItemId, isObjectIdText } = require('../Modules/Company/helpers/callerQueryRules');
const aggregateSheet = require('../Modules/TimeSheet/controller/getTimeSheetByAggregate');
const timeLog = require('../Modules/TimeSheet/controller/timeLog');
const estimates = require('../Modules/EstimatedTime/controller');
const { handleChecklist } = require('../Modules/Project/controller/checklist');
const { handleTags } = require('../Modules/Project/controller/tags');

const C = '6f0000000000000000000c01';
const ME = '6f0000000000000000000001';
const OTHER = '6f0000000000000000000002';
const P1 = '6f0000000000000000000b01';
const T1 = '6f0000000000000000000a01';
const OWNER_ROLE = 1;
const MEMBER_ROLE = 3;

const NESTINGS = [
    ['inside $and', (operator) => ({ $and: [{ status: { $in: ['open'] } }, { [operator]: 'x' }] })],
    ['inside $or inside $and', (operator) => ({ $and: [{ $or: [{ [operator]: 'x' }] }] })],
    ['inside $expr', (operator) => ({ $expr: { $eq: [{ [operator]: { body: 'x', args: [], lang: 'js' } }, true] } })],
    ['inside $facet', (operator) => ({ $facet: { rows: [{ [operator]: { from: 'users', as: 'u', pipeline: [] } }] } })],
    ['inside an array', (operator) => ({ status: { $in: [['open', { [operator]: 'x' }]] } })],
];
const REFUSED_FILTERS = [
    ...FORBIDDEN_OPERATORS.map((operator) => [`${operator} inside $and`, NESTINGS[0][1](operator)]),
    ...NESTINGS.slice(1).map(([label, nest]) => [`$function ${label}`, nest('$function')]),
    ['$where at the top', { $where: 'true' }],
];

const answer = () => {
    const res = { code: 200, body: undefined };
    res.status = (code) => { res.code = code; return res; };
    res.json = (payload) => { res.body = payload; return res; };
    res.send = res.json;
    return res;
};

const call = async (handler, body, uid = ME) => {
    const res = answer();
    await handler({ headers: { companyid: C }, aud: C, body, query: {}, params: {}, uid }, res);
    return res;
};

const chainOf = (modulePath, route) => {
    const table = {};
    const register = (method) => (path, ...handlers) => { table[`${method} ${path}`] = handlers; };
    require(modulePath).init({ get: register('GET'), post: register('POST'), put: register('PUT'), delete: register('DELETE'), patch: register('PATCH') });
    return table[route];
};

/* The check is the first handler of the route: a refused body never reaches the handlers that read the database. */
const throughCheck = (modulePath, route, body) => {
    const [check] = chainOf(modulePath, route);
    const res = answer();
    const req = { headers: { companyid: C }, aud: C, body, query: {}, params: {}, uid: ME };
    let passed = false;
    check(req, res, () => { passed = true; });
    return { passed, res, req };
};

const asRole = (roleType) => {
    getRoleType.mockResolvedValue(roleType);
    evaluatePermission.mockResolvedValue(roleType === OWNER_ROLE ? true : 1);
};

beforeEach(() => {
    jest.clearAllMocks();
    mockCrud.mockImplementation(async () => []);
    visibleProjectIds.mockResolvedValue([P1]);
});

describe('a query sent by a caller', () => {
    it.each(FORBIDDEN_OPERATORS.flatMap((operator) => NESTINGS.map(([label, nest]) => [operator, label, nest(operator)])))(
        'never holds %s, %s', (operator, label, query) => {
            expect(queryRefusal(query)).toBe(`${operator} is not allowed in a query.`);
        });

    it.each([
        [{ $and: [{ status: { $in: ['open'] } }, { DueDate: { $gte: 1, $lte: 2 } }] }],
        [{ $or: [{ AssigneeUserId: { $elemMatch: { id: { $in: [ME] } } } }, { TaskName: { $regex: 'a', $options: 'i' } }] }],
        [{ $expr: { $eq: ['$_id', '$$taskIdRef'] } }],
        [[{ $match: {} }, { $group: { _id: '$UserId', totalCount: { $sum: '$EstimatedTime' } } }]],
        ['text'], [undefined], [null], [7],
    ])('may hold %j', (query) => {
        expect(queryRefusal(query)).toBeNull();
    });

    it('is refused when it is nested too deeply to check', () => {
        const deep = Array.from({ length: 60 }).reduce((inner) => ({ $and: [inner] }), { status: 'open' });
        expect(queryRefusal(deep)).toMatch(/nested/);
    });

    it('names a list item by text or a number, and a record by a 24-character id', () => {
        expect(['Ab3dE9', 12, 'x'.repeat(128)].every(isItemId)).toBe(true);
        expect([{ $ne: null }, ['Ab3dE9'], '', null, undefined, true, NaN, 'x'.repeat(129)].some(isItemId)).toBe(false);
        expect(isObjectIdText(P1)).toBe(true);
        expect([{ $ne: null }, [P1], 'abc', undefined].some(isObjectIdText)).toBe(false);
    });
});

describe('POST /api/v1/project/search', () => {
    const ROUTE = ['../Modules/Project/routes', 'POST /api/v1/project/search'];

    it.each([
        ['the archived list', { search: '', type: 'showArchiveOnly', showArchived: false }],
        ['a search by project name', { search: 'Launch', type: 'projectName', showArchived: false, fields: '_id' }],
        ['a filtered search', { search: 'Launch', type: 'projectFilter_projectName', showArchived: false, fields: '_id', sortByField: { value: 'name' }, sortByOrder: { value: 'asc' },
            query: { $and: [{ status: { $in: ['close'] } }, { createdAt: { $gt: '2026-01-01T00:00:00.000Z', $lte: '2026-12-31T00:00:00.000Z' } }, { 'LeadUserId': { $in: [ME] } }] } }],
        ['a filtered search joined by or', { search: '', type: 'projectFilter', fields: '_id', sortByField: {}, sortByOrder: {}, query: { $or: [{ ProjectType: { $nin: ['fix'] } }] } }],
    ])('passes %s on as sent', (label, body) => {
        const sent = JSON.parse(JSON.stringify(body));
        const { passed, req } = throughCheck(...ROUTE, body);
        expect(passed).toBe(true);
        expect(req.body).toEqual(sent);
    });

    it.each([...REFUSED_FILTERS, ['a query that is a list', [{ status: 'open' }]], ['a query that is not JSON', '{']])('answers 400 to a query with %s', (label, query) => {
        const { passed, res } = throughCheck(...ROUTE, { search: '', type: 'projectFilter', fields: '_id', sortByField: {}, sortByOrder: {}, query });
        expect(passed).toBe(false);
        expect(res.code).toBe(400);
        expect(res.body).toEqual(expect.objectContaining({ status: false, message: expect.any(String) }));
        expect(mockCrud).not.toHaveBeenCalled();
    });
});

describe.each(['tasks', 'comments', 'projects', 'files', 'links'])('POST /api/v1/advance/filter/search/%s', (what) => {
    const ROUTE = ['../Modules/AdvancedGlobalFilter/routes', `POST /api/v1/advance/filter/search/${what}`];
    const filterQuery = { $and: [{ statusKey: { $in: [1, 2] } }, { AssigneeUserId: { $in: [ME] } }, { DueDate: { dbDate: { $gte: '2026-01-01T00:00:00.000Z' } } }] };
    const visibility = { publicQuery: { isPrivateSpace: false }, privateQuery: { isPrivateSpace: true, AssigneeUserId: { $in: [ME] } } };

    it.each([
        ['a search without a filter', { searchText: 'launch', pids: [P1], skip: 0, batchSize: 20, sortBy: 'createdAt' }],
        ['a search with a filter', { searchText: '', pids: [P1], filterQuery, ...visibility }],
        ['a search by project ids', { sortBy: 'last_update', skipValue: 0, batchSizeValue: 10, filterQuery: { $and: [{ _id: { objId: { $in: [P1] } } }] } }],
    ])('passes %s on as sent', (label, body) => {
        const sent = JSON.parse(JSON.stringify(body));
        const { passed, req } = throughCheck(...ROUTE, body);
        expect(passed).toBe(true);
        expect(req.body).toEqual(sent);
    });

    it('reads a filter sent as JSON text and passes it on as the object', () => {
        const { passed, req } = throughCheck(...ROUTE, { searchText: '', pids: [P1], filterQuery: JSON.stringify(filterQuery) });
        expect(passed).toBe(true);
        expect(req.body.filterQuery).toEqual(filterQuery);
    });

    it.each(['filterQuery', 'publicQuery', 'privateQuery'].flatMap((field) => [
        ...REFUSED_FILTERS.map(([label, filter]) => [field, label, filter]),
        [field, 'JSON text of a filter with $where', JSON.stringify({ $and: [{ $where: 'true' }] })],
        [field, 'a list', [{ status: 'open' }]],
        [field, 'text that is not JSON', '{'],
    ]))('answers 400 to %s with %s', (field, label, filter) => {
        const { passed, res } = throughCheck(...ROUTE, { searchText: '', pids: [P1], ...visibility, [field]: filter });
        expect(passed).toBe(false);
        expect(res.code).toBe(400);
        expect(mockCrud).not.toHaveBeenCalled();
    });
});

describe.each([
    'employee-workload', 'project-utilization-summary', 'team-tasktype-breakdown', 'team-logged-vs-eta', 'project-metrics', 'on-leave', 'milestone-summary',
    'my-next-tasks', 'my-achievements', 'my-leave', 'my-due-soon', 'my-time', 'at-risk', 'tasks-by-status',
])('POST /api/v1/dashboard/%s', (card) => {
    const ROUTE = ['../Modules/UserDashboard/routes', `POST /api/v1/dashboard/${card}`];
    const taskMatch = { $and: [{ statusKey: { $in: [1, 2] } }, { AssigneeUserId: { $nin: [OTHER] } }, { tagsArray: { $elemMatch: { uid: { $in: ['Ab3dE9'] } } } }],
        $or: [{ DueDate: { dbDate: { $gte: '2026-01-01T00:00:00.000Z', $lte: '2026-01-31T23:59:59.999Z' } } }, { createdAt: { $gt: 1767225600 } }] };

    it.each([
        ['a card without a filter', { dateFrom: '2026-01-01', dateTo: '2026-01-31', projectId: [], projectMode: 'all', taskMatch: null, limit: 8 }],
        ['a card with a filter', { dateFrom: '2026-01-01', dateTo: '2026-01-31', projectId: [P1], projectIds: [P1], projectMode: 'include', taskMatch, statusKeys: [1, 2], days: 7 }],
        ['a card with no body', undefined],
    ])('passes %s on as sent', (label, body) => {
        const sent = body && JSON.parse(JSON.stringify(body));
        const { passed, req } = throughCheck(...ROUTE, body);
        expect(passed).toBe(true);
        expect(req.body).toEqual(sent);
    });

    it.each(REFUSED_FILTERS)('answers 400 to a task filter with %s', (label, filter) => {
        const { passed, res } = throughCheck(...ROUTE, { dateFrom: '2026-01-01', dateTo: '2026-01-31', projectMode: 'all', taskMatch: filter });
        expect(passed).toBe(false);
        expect(res.code).toBe(400);
        expect(mockCrud).not.toHaveBeenCalled();
    });

    it('answers 400 wherever in the body the operator sits', () => {
        const { passed, res } = throughCheck(...ROUTE, { projectId: [{ $where: 'true' }], statusKeys: { $function: {} } });
        expect(passed).toBe(false);
        expect(res.code).toBe(400);
    });
});

const tasksJoin = (input, extra = {}) => ({
    $lookup: {
        from: 'tasks',
        let: { taskIdRef: { $convert: { input, to: 'objectId', onError: null } } },
        pipeline: [{ $match: { $expr: { $eq: ['$_id', '$$taskIdRef'] }, ...extra } }],
        as: 'matchedTasks',
    },
});

/* TotalTaskCardComponent.vue, TimeEstimatedWorkloadComp.vue, ProjectTimesheet.vue, and the desktop tracker's home.jsx, useTodayLogged.js and logentry.jsx. */
const TIME_QUERIES = [
    ['the tracked-time card', [
        { $match: { ProjectId: { $in: [P1] }, LogStartTime: { $gte: 0, $lte: 999 }, Loggeduser: { $in: [ME] } } },
        tasksJoin('$TicketID', { statusKey: { $in: [1] } }),
        { $match: { matchedTasks: { $ne: [] } } },
        { $group: { _id: null, totalCount: { $sum: '$LogTimeDuration' }, averageCount: { $avg: '$LogTimeDuration' } } },
    ]],
    ['the workload card', [
        { $match: { $and: [{ Loggeduser: { $in: [ME, OTHER] }, ProjectId: { $in: [P1] }, LogStartTime: { $gte: 0, $lte: 999 } }] } },
        { $group: { _id: { user: '$Loggeduser' }, totalCount: { $sum: '$LogTimeDuration' } } },
    ]],
    ['the desktop tracker\'s list of today\'s tasks', [
        { $match: { $and: [{ Loggeduser: { $in: [ME] } }, { ProjectId: { $in: [P1] } }, { LogStartTime: { $gte: 0, $lte: 999 } }, { logAddType: { $in: [0, 1] } }] } },
        { $sort: { TicketID: 1, LogStartTime: -1 } },
        { $group: { _id: '$TicketID', doc: { $first: '$$ROOT' } } },
        { $replaceRoot: { newRoot: '$doc' } },
        { $addFields: { TaskId: { $toObjectId: '$TicketID' } } },
        {
            $lookup: {
                from: 'tasks',
                localField: 'TaskId',
                foreignField: '_id',
                as: 'taskData',
                pipeline: [
                    { $lookup: { from: 'folders', localField: 'folderObjId', foreignField: '_id', as: 'folderArray', pipeline: [{ $project: { name: 1 } }] } },
                    { $lookup: { from: 'sprints', localField: 'sprintId', foreignField: '_id', as: 'sprintData', pipeline: [{ $project: { name: 1, folderId: 1 } }] } },
                ],
            },
        },
        { $unwind: '$taskData' },
    ]],
    ['the desktop tracker\'s minutes per task', [
        { $match: { $and: [{ Loggeduser: { $in: [ME] } }, { LogStartTime: { $gte: 0, $lte: 999 } }, { logAddType: { $in: [0, 1] } }] } },
        { $group: { _id: '$TicketID', minutes: { $sum: '$LogTimeDuration' } } },
    ]],
    ['the desktop tracker\'s total for today', [
        { $match: { $and: [{ Loggeduser: { $in: [ME] } }, { LogStartTime: { $gte: 0, $lte: 999 } }, { logAddType: { $in: [0, 1] } }] } },
        { $project: { LogTimeDuration: 1 } },
    ]],
];
const ESTIMATE_QUERIES = [
    ['the planned-time card', [
        { $match: { ProjectId: { $in: [P1] }, Date: { dbDate: { $gte: 0, $lte: 999000 } }, UserId: { $in: [ME] } } },
        tasksJoin('$TaskId'),
        { $match: { matchedTasks: { $ne: [] } } },
        { $group: { _id: null, totalCount: { $sum: '$EstimatedTime' } } },
    ]],
    ['the estimate card', [
        { $match: { $and: [{ userId: { $in: [ME] }, ProjectId: { $in: [P1] }, Date: { dbDate: { $gte: 0, $lte: 999000 } } }] } },
        { $group: { _id: { user: '$UserId' }, totalCount: { $sum: '$EstimatedTime' } } },
    ]],
    ['the project timesheet\'s plan', [
        { $match: { $and: [{ ProjectId: { $in: [P1] }, Date: { dbDate: { $gte: 0, $lte: 999000 } } }] } },
        { $group: { _id: { date: '$Date', projectId: '$ProjectId' }, data: { $push: { projectId: '$ProjectId', taskId: '$TaskId', logMinutes: '$EstimatedTime', userId: '$UserId', date: '$Date' } },
            user: { $first: '$UserId' }, totalCount: { $sum: '$EstimatedTime' } } },
    ]],
    ['the desktop tracker\'s plan for today', [{ $match: { userId: ME, Date: { dbDate: { $gte: '2026-01-01T00:00:00.000Z', $lte: '2026-01-01T23:59:59.000Z' } } } }]],
];

const join = (from, spec = {}) => ({ $lookup: { from, as: 'rows', pipeline: [], ...spec } });
const REFUSED_PIPELINES = [
    ['$out', [{ $match: {} }, { $out: 'copy' }]],
    ['$merge', [{ $limit: 1 }, { $merge: { into: 'copy' } }]],
    ['$unionWith', [{ $limit: 1 }, { $unionWith: 'users' }]],
    ['$graphLookup', [{ $graphLookup: { from: 'users', startWith: '$Loggeduser', connectFromField: '_id', connectToField: '_id', as: 'u' } }]],
    ['$where', [{ $match: { $where: 'true' } }]],
    ['$function', [{ $project: { x: { $function: { body: 'function(){return 1}', args: [], lang: 'js' } } } }]],
    ['$accumulator', [{ $group: { _id: null, x: { $accumulator: { init: 'function(){}', accumulate: 'function(){}', accumulateArgs: [], merge: 'function(){}', lang: 'js' } } } }]],
    ['$collStats', [{ $collStats: { count: {} } }]],
    ['$indexStats', [{ $indexStats: {} }]],
    ['$changeStream', [{ $changeStream: {} }]],
    ['a join of users', [join('users')]],
    ['a join of apiTokens', [join('apiTokens')]],
    ['a join of webhooks', [join('webhooks')]],
    ['a join of secrets', [join('secrets')]],
    ['a join of comments', [join('comments')]],
    ['a join of the time rows themselves', [join('timesheets')]],
    ['a join of folders outside a tasks join', [join('folders')]],
    ['a join of users inside a tasks join', [join('tasks', { pipeline: [join('users')] })]],
    ['a join of users inside a sprints join', [join('tasks', { pipeline: [join('sprints', { pipeline: [join('company_users')] })] })]],
    ['a join whose collection is not text', [join({ db: 'global', coll: 'users' })]],
    ['a $function inside $expr', [{ $match: { $expr: { $function: { body: 'function(){return true}', args: [], lang: 'js' } } } }]],
    ['a $where inside $and', [{ $match: { $and: [{ $where: 'true' }] } }]],
    ['a join of users inside $facet', [{ $facet: { a: [join('users')] } }]],
    ['a $merge inside $facet', [{ $facet: { a: [{ $merge: { into: 'tasks' } }] } }]],
    ['a $unionWith inside a tasks join', [join('tasks', { pipeline: [{ $unionWith: 'users' }] })]],
    ['a $function inside an array', [{ $addFields: { x: [[{ $function: { body: 'x', args: [], lang: 'js' } }]] } }]],
    ['a query that is not a pipeline', 'Loggeduser'],
];

describe.each([
    ['POST /api/v1/timesheet', aggregateSheet.getTimeSheetByAggregate, TIME_QUERIES],
    ['POST /api/v1/estimatedTime', estimates.getEstimateByAggregate, ESTIMATE_QUERIES],
])('%s', (route, handler, queries) => {
    describe.each([['an owner', OWNER_ROLE], ['a member', MEMBER_ROLE]])('for %s', (who, roleType) => {
        it.each(queries)('runs %s', async (label, queryeta) => {
            asRole(roleType);
            const res = await call(handler, { queryeta });
            expect(res.code).toBe(200);
            const aggregates = mockCrud.mock.calls.filter(([, , method]) => method === 'aggregate');
            expect(aggregates).toHaveLength(1);
            const sent = aggregates[0][1].data[0];
            expect(sent.slice(-queryeta.length).map((stage) => Object.keys(stage)[0])).toEqual(queryeta.map((stage) => Object.keys(stage)[0]));
        });

        it.each(REFUSED_PIPELINES)('answers 400 to %s', async (label, queryeta) => {
            asRole(roleType);
            const res = await call(handler, { queryeta });
            expect(res.code).toBe(400);
            expect(mockCrud.mock.calls.filter(([, , method]) => method === 'aggregate')).toHaveLength(0);
        });
    });
});

describe('POST /api/v1/timesheet/timelog', () => {
    const taskIds = [{ TicketID: T1 }];
    const named = {
        sort: { $sort: { LogStartTime: -1 } },
        group: { $group: { _id: '$TicketID', minutes: { $sum: '$LogTimeDuration' } } },
        addFields: { $addFields: { TaskId: { $toObjectId: '$TicketID' } } },
        facet: { $facet: { rows: [{ $limit: 20 }], total: [{ $count: 'count' }] } },
    };

    describe.each([['an owner', OWNER_ROLE], ['a member', MEMBER_ROLE]])('for %s', (who, roleType) => {
        it.each([
            ['the tasks and the date range', { taskIds, startDate: '2026-01-01', endDate: '2026-01-31', usersFilterIDsArray: [ME] }],
            ['every named stage', { taskIds, ...named }],
            ['a facet that joins tasks', { taskIds, facet: { $facet: { rows: [join('tasks', { localField: 'TicketID', foreignField: '_id' })] } } }],
        ])('runs %s', async (label, body) => {
            asRole(roleType);
            const res = await call(timeLog.getTimeLogTimeSheet, body);
            expect(res.code).toBe(200);
            expect(mockCrud.mock.calls.filter(([, , method]) => method === 'aggregate')).toHaveLength(1);
        });

        it.each([
            ['a $unionWith passed as facet', { facet: { $unionWith: 'timesheets' } }],
            ['a join of users inside the facet', { facet: { $facet: { a: [join('users')] } } }],
            ['a join of apiTokens inside a tasks join inside the facet', { facet: { $facet: { a: [join('tasks', { pipeline: [join('apiTokens')] })] } } }],
            ['a $function inside $expr inside the facet', { facet: { $facet: { a: [{ $match: { $expr: { $function: { body: 'x', args: [], lang: 'js' } } } }] } } }],
            ['a $where inside $and inside the facet', { facet: { $facet: { a: [{ $match: { $and: [{ $where: 'true' }] } }] } } }],
            ['an $accumulator in the group', { group: { $group: { _id: null, x: { $accumulator: {} } } } }],
            ['a $function inside an array in addFields', { addFields: { $addFields: { x: [{ $function: {} }] } } }],
            ['a $merge next to the sort', { sort: { $sort: { LogStartTime: 1 }, $merge: { into: 'copy' } } }],
        ])('answers 400 to %s', async (label, extra) => {
            asRole(roleType);
            const res = await call(timeLog.getTimeLogTimeSheet, { taskIds, ...extra });
            expect(res.code).toBe(400);
            expect(mockCrud.mock.calls.filter(([, , method]) => method === 'aggregate')).toHaveLength(0);
        });
    });
});

describe('POST /api/v1/project/checklist', () => {
    const item = { AssigneeUserId: [], id: 'Ab3dE9', name: 'Checklist', isChecked: false, isExpand: false };
    const written = () => mockCrud.mock.calls.filter(([, , method]) => method === 'findOneAndUpdate').map(([, sent]) => sent.data);

    beforeEach(() => {
        mockCrud.mockImplementation(async (companyId, sent, method) => (method === 'findOneAndUpdate' ? { _id: P1, checklistArray: [item] } : []));
    });

    /* CheckList.vue and Comments.vue. */
    it.each([
        ['a new checklist', { id: P1, checklistItem: item, operation: 'push' }],
        ['a new item', { id: P1, checklistItem: { ...item, id: 'Zz91Qa', parentId: 'Ab3dE9', name: 'Write the brief' }, operation: 'push' }],
        ['an item from a comment', { id: P1, checklistItem: { ...item, id: 'Qq22Ws' }, operation: 'push', origin: 'comment' }],
        ['ticking an item', { id: P1, checklistItem: [{ ...item, isChecked: true }], operation: 'update', key: 'isChecked' }],
        ['renaming an item', { id: P1, checklistItem: { ...item, name: 'Renamed' }, operation: 'update', key: 'name' }],
        ['assigning an item', { id: P1, checklistItem: { id: 'Ab3dE9', uid: ME }, operation: 'update', key: 'assigneeAdd' }],
        ['unassigning an item', { id: P1, checklistItem: { id: 'Ab3dE9', uid: ME }, operation: 'update', key: 'assigneeRemove' }],
        ['removing items', { id: P1, checklistItem: ['Ab3dE9', 'Zz91Qa'], operation: 'delete' }],
    ])('writes %s', async (label, body) => {
        const res = await call(handleChecklist, body);
        expect(res.code).toBe(200);
        expect(written()).toHaveLength(1);
    });

    it('names the renamed item by its id in the array filter', async () => {
        await call(handleChecklist, { id: P1, checklistItem: { ...item, name: 'Renamed' }, operation: 'update', key: 'name' });
        expect(written()[0][2]).toEqual({ arrayFilters: [{ 'elem.id': 'Ab3dE9' }] });
    });

    it.each([
        ['a rename whose id is an operator', { checklistItem: { id: { $ne: null }, name: 'Renamed' }, operation: 'update', key: 'name' }],
        ['a rename whose id is a list', { checklistItem: { id: ['Ab3dE9'], name: 'Renamed' }, operation: 'update', key: 'name' }],
        ['a rename without an id', { checklistItem: { name: 'Renamed' }, operation: 'update', key: 'name' }],
        ['a rename whose name is not text', { checklistItem: { id: 'Ab3dE9', name: { $each: [] } }, operation: 'update', key: 'name' }],
        ['an assignment whose id is an operator', { checklistItem: { id: { $exists: true }, uid: ME }, operation: 'update', key: 'assigneeAdd' }],
        ['an assignment whose person is not text', { checklistItem: { id: 'Ab3dE9', uid: { $each: [ME, OTHER] } }, operation: 'update', key: 'assigneeAdd' }],
        ['an unassignment whose person is an operator', { checklistItem: { id: 'Ab3dE9', uid: { $ne: null } }, operation: 'update', key: 'assigneeRemove' }],
        ['an update with no item', { operation: 'update', key: 'name' }],
        ['ticking with something that is not the list', { checklistItem: { $each: [] }, operation: 'update', key: 'isChecked' }],
        ['a removal that is not a list', { checklistItem: { $nin: [] }, operation: 'delete' }],
        ['a removal whose list holds an operator', { checklistItem: ['Ab3dE9', { $ne: null }], operation: 'delete' }],
    ])('answers 400 to %s and writes nothing', async (label, body) => {
        const res = await call(handleChecklist, { id: P1, ...body });
        expect(res.code).toBe(400);
        expect(mockCrud).not.toHaveBeenCalled();
    });
});

describe('POST /api/v1/project/tags', () => {
    const tag = { tagBgColor: '#ff000035', tagColor: '#ff0000', tagName: 'Urgent', uid: 'Ab3dE9Zz91Qa' };
    const written = () => mockCrud.mock.calls.filter(([, , method]) => method === 'findOneAndUpdate').map(([, sent]) => sent.data);

    beforeEach(() => {
        mockCrud.mockImplementation(async (companyId, sent, method) => (method === 'findOneAndUpdate' ? { _id: P1, tagsArray: [tag] } : []));
    });

    /* TagList/helper.js. */
    it.each([
        ['a new tag', { id: P1, items: tag, operation: 'push' }],
        ['a renamed tag', { id: P1, items: { id: tag.uid, tagName: 'Later', tagColor: tag.tagColor }, operation: 'update', key: 'tagName' }],
        ['a recoloured tag', { id: P1, items: { id: tag.uid, tagName: tag.tagName, tagColor: '#00ff00' }, operation: 'update', key: 'tagColor' }],
        ['a removed tag', { id: P1, items: { id: tag.uid }, operation: 'delete' }],
        ['a tag with a numeric id', { id: P1, items: { id: 1712345678901 }, operation: 'delete' }],
    ])('writes %s', async (label, body) => {
        const res = await call(handleTags, body);
        expect(res.code).toBe(200);
        expect(written()).toHaveLength(1);
    });

    it('names the changed tag by its id in the array filter', async () => {
        await call(handleTags, { id: P1, items: { id: tag.uid, tagName: 'Later', tagColor: tag.tagColor }, operation: 'update', key: 'tagName' });
        expect(written()[0][2]).toEqual({ arrayFilters: [{ 'elem.uid': tag.uid }] });
    });

    it.each([
        ['a rename whose id is an operator', { items: { id: { $ne: null }, tagName: 'Later' }, operation: 'update', key: 'tagName' }],
        ['a rename whose name is not text', { items: { id: tag.uid, tagName: { $ne: null } }, operation: 'update', key: 'tagName' }],
        ['a recolour whose colour is not text', { items: { id: tag.uid, tagColor: ['#00ff00'] }, operation: 'update', key: 'tagColor' }],
        ['a removal whose id is an operator', { items: { id: { $exists: true } }, operation: 'delete' }],
        ['a removal whose id is a list', { items: { id: [tag.uid] }, operation: 'delete' }],
        ['a removal with no tag', { operation: 'delete' }],
        ['an update with no tag', { operation: 'update', key: 'tagName' }],
    ])('answers 400 to %s and writes nothing', async (label, body) => {
        const res = await call(handleTags, { id: P1, ...body });
        expect(res.code).toBe(400);
        expect(mockCrud).not.toHaveBeenCalled();
    });
});
