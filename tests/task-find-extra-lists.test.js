/* Task 046 M3, slice L4: the rows of a list hold the tasks that live in it and the tasks added to
   it, each for a reader who may read that task where it lives and may look at the list. The routes
   are the real ones over a fake database per company; the queries are the ones the web app sends. */
process.env.STORAGE_TYPE = 'server';

const path = require('path');
const mockWorld = require('./fixtures/extraListsWorld').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (companyId, query, method) => mockWorld.crud(companyId, query, method),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0 } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
const mockStub = () => new Proxy({}, {
    get: (target, name) => {
        if (name === 'then' || name === '__esModule') return undefined;
        target[name] = target[name] || jest.fn(() => Promise.resolve({}));
        return target[name];
    },
});
jest.mock('../Modules/Sprints/controller', () => mockStub());
jest.mock('../Modules/Tasks/helpers/handleNotification', () => mockStub());
jest.mock('../Modules/Company/eventController', () => mockStub());
jest.mock('../Modules/Company/controller/updateCompany', () => mockStub());
jest.mock('../Modules/notification-count/controller', () => mockStub());
jest.mock('../Modules/Comments/controller', () => mockStub());
jest.mock('../Modules/MainChats/controller', () => mockStub());
jest.mock('../Modules/LogTime/controllerV2.js', () => mockStub());
jest.mock('../Modules/CustomField/controller', () => mockStub());
jest.mock('../Modules/Audit/recorder', () => mockStub());
jest.mock('../utils/planHelper', () => mockStub());
jest.mock('../utils/commonFunctions.js', () => mockStub());
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../common-storage/common-server.js', () => mockStub());

const mongoose = require('mongoose');
const { COMPANY, uidOf, P, L, T, routeCaller, routesOf } = require('./fixtures/extraListsWorld');
const { runNarrowed } = require('../Config/tokenNarrowing');
const { withExtraListRows } = require('../Modules/Tasks/helpers/taskQueryGuard');
const { getTaskByQyery } = require('../Modules/Tasks/helpers/getTasksData');
const { listEverything } = require('../Modules/Tasks/controller/everything');
const Q = require('../frontend/src/store/ProjectData/taskQueries');

const call = routeCaller(routesOf(path.join(__dirname, '../Modules/Tasks/routes')));
const { place, task } = mockWorld;

const EVERYONE = ['OWNER', 'ADMIN', 'ON_BOTH', 'HOME_ONLY', 'LIST_ONLY', 'GUEST', 'OUTSIDER'];
const THERE_TASK = `6f${'0'.repeat(19)}b20`;
const PRIVATE_THERE_TASK = `6f${'0'.repeat(19)}b21`;

const find = (who, findQuery, extra = {}) => call('POST /api/v1/task/find', uidOf[who] || who, { body: { findQuery, ...extra } });
const idsOf = (res) => {
    expect(res.code).toBe(200);
    return res.body.map((row) => String(row._id)).sort();
};
const listQuery = (pid, sprintId) => [{ $match: Q.sprintTaskMatch({ pid, sprintId }) }];
const anyProjectQuery = (sprintId) => [{ $match: { objId: { sprintId }, deletedStatusKey: 0 } }];
const rowsOf = async (who, pid, sprintId) => idsOf(await find(who, listQuery(pid, sprintId), { inList: sprintId }));
const seenBy = async (people, read) => Object.fromEntries(await Promise.all(people.map(async (who) => [who, await read(who)])));

const everything = (who, body = {}) => call('POST /api/v2/tasks/everything', uidOf[who] || who, { body });
const everythingRows = async (who, body) => {
    const res = await everything(who, body);
    expect(res.code).toBe(200);
    return res.body.data.rows;
};

const narrowed = (who, projectIds, handler, body) => runNarrowed({ userId: uidOf[who], projectIds }, () => new Promise((resolve) => {
    const res = { statusCode: 200 };
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (answer) => { resolve({ code: res.statusCode, body: answer }); return res; };
    handler({ headers: { companyid: COMPANY }, aud: COMPANY, uid: uidOf[who], body }, res);
}));

beforeEach(() => {
    mockWorld.reset();
    jest.clearAllMocks();
    task(THERE_TASK, P.ELSEWHERE, L.THERE, { TaskName: 'Lives there' });
    task(PRIVATE_THERE_TASK, P.ELSEWHERE, L.THERE_PRIVATE, { TaskName: 'Lives in the private list' });
});

describe('the rows of a list in the task\'s own project', () => {
    beforeEach(() => place(T.TASK, [[P.HOME, L.HOME_SECOND]]));

    test('hold a task added to the list, for everyone who can read that task', async () => {
        expect(await seenBy(EVERYONE, (who) => rowsOf(who, P.HOME, L.HOME_SECOND))).toEqual({
            OWNER: [T.TASK], ADMIN: [T.TASK], ON_BOTH: [T.TASK], HOME_ONLY: [T.TASK], GUEST: [T.TASK], LIST_ONLY: [], OUTSIDER: [],
        });
    });

    test('only when the list is asked for by name: the same query without it answers as before', async () => {
        expect(idsOf(await find('OWNER', listQuery(P.HOME, L.HOME_SECOND)))).toEqual([]);
        expect(idsOf(await find('OWNER', listQuery(P.HOME, L.HOME_SECOND), { inList: L.HOME }))).toEqual([]);
    });

    test('hold the task once in the list it lives in', async () => {
        expect((await rowsOf('OWNER', P.HOME, L.HOME)).filter((id) => id === T.TASK)).toEqual([T.TASK]);
    });

    test('leave out a task whose home is a private list the reader is not on', async () => {
        place(T.IN_PRIVATE_SPRINT, [[P.HOME, L.HOME_SECOND]]);

        expect(await seenBy(['OWNER', 'HOME_ONLY', 'ON_BOTH', 'GUEST'], (who) => rowsOf(who, P.HOME, L.HOME_SECOND))).toEqual({
            OWNER: [T.IN_PRIVATE_SPRINT, T.TASK].sort(), HOME_ONLY: [T.IN_PRIVATE_SPRINT, T.TASK].sort(), ON_BOTH: [T.TASK], GUEST: [T.TASK],
        });
    });

    test('are not given for a private list the reader is not on, whatever was added to it', async () => {
        place(T.TASK, [[P.HOME, L.HOME_PRIVATE]]);

        expect(await seenBy(['OWNER', 'HOME_ONLY', 'ON_BOTH', 'GUEST'], (who) => rowsOf(who, P.HOME, L.HOME_PRIVATE))).toEqual({
            OWNER: [T.IN_PRIVATE_SPRINT, T.TASK].sort(), HOME_ONLY: [T.IN_PRIVATE_SPRINT, T.TASK].sort(), ON_BOTH: [], GUEST: [],
        });
    });

    test('leave out a task in the trash or the archive, as the list\'s own rows do', async () => {
        place(T.DELETED, [[P.HOME, L.HOME_SECOND]]);
        place(T.ARCHIVED, [[P.HOME, L.HOME_SECOND]]);

        expect(await rowsOf('OWNER', P.HOME, L.HOME_SECOND)).toEqual([T.TASK]);
    });

    test('follow the role\'s right to list tasks in that project', async () => {
        mockWorld.setRule('task_list', 3, null);

        expect(await seenBy(['OWNER', 'ON_BOTH', 'GUEST'], (who) => rowsOf(who, P.HOME, L.HOME_SECOND))).toEqual({ OWNER: [T.TASK], ON_BOTH: [], GUEST: [T.TASK] });
    });
});

describe('the rows of a list in another project', () => {
    beforeEach(() => place(T.TASK, [[P.ELSEWHERE, L.THERE], [P.ELSEWHERE, L.THERE_PRIVATE]]));

    test('a query that names the list\'s project brings the tasks of that project only', async () => {
        expect(await rowsOf('OWNER', P.ELSEWHERE, L.THERE)).toEqual([THERE_TASK]);
    });

    test('a query for the list alone brings an added task to a reader of its home, and to nobody else', async () => {
        const read = async (who) => idsOf(await find(who, anyProjectQuery(L.THERE), { inList: L.THERE }));

        expect(await seenBy(EVERYONE, read)).toEqual({
            OWNER: [THERE_TASK, T.TASK].sort(), ADMIN: [THERE_TASK, T.TASK].sort(), ON_BOTH: [THERE_TASK, T.TASK].sort(), GUEST: [THERE_TASK, T.TASK].sort(),
            LIST_ONLY: [THERE_TASK], HOME_ONLY: [], OUTSIDER: [],
        });
    });

    test('a person on the list but not on the task\'s project gets no trace of the task', async () => {
        const res = await find('LIST_ONLY', anyProjectQuery(L.THERE_PRIVATE), { inList: L.THERE_PRIVATE });

        expect(idsOf(res)).toEqual([PRIVATE_THERE_TASK]);
        expect(JSON.stringify(res.body)).not.toMatch(new RegExp(`${T.TASK}|Write the brief`));
    });

    test('a private list is not read through by a person who is not on it', async () => {
        expect(idsOf(await find('ON_BOTH', anyProjectQuery(L.THERE_PRIVATE), { inList: L.THERE_PRIVATE }))).toEqual([]);
        expect(idsOf(await find('OWNER', anyProjectQuery(L.THERE_PRIVATE), { inList: L.THERE_PRIVATE }))).toEqual([PRIVATE_THERE_TASK, T.TASK].sort());
    });

    test('a token limited to some projects needs the task\'s home inside it, and the list\'s project too', async () => {
        const read = (projectIds) => narrowed('OWNER', projectIds, getTaskByQyery, { findQuery: anyProjectQuery(L.THERE), inList: L.THERE });

        expect(idsOf(await read([P.ELSEWHERE]))).toEqual([THERE_TASK]);
        expect(idsOf(await read([P.HOME]))).toEqual([]);
        expect(idsOf(await read([P.HOME, P.ELSEWHERE]))).toEqual([THERE_TASK, T.TASK].sort());
    });
});

describe('the request', () => {
    test.each([['a word', 'launch'], ['an object', { $ne: null }], ['a list of ids', [L.THERE]]])('refuses %s for the list', async (_, inList) => {
        const res = await find('OWNER', listQuery(P.HOME, L.HOME), { inList });

        expect(res.code).toBe(400);
        expect(res.body).toMatchObject({ status: false, statusText: 'Query refused', stage: 'inList' });
    });

    test('a list that is missing, in the trash or in another company answers as the plain query does', async () => {
        place(T.TASK, [[P.ELSEWHERE, L.DELETED], [P.ELSEWHERE, L.MISSING]]);

        expect(idsOf(await find('OWNER', anyProjectQuery(L.DELETED), { inList: L.DELETED }))).toEqual([]);
        expect(idsOf(await find('OWNER', anyProjectQuery(L.MISSING), { inList: L.MISSING }))).toEqual([]);
    });

    test('widens only the list named at the top of a match', () => {
        const id = new mongoose.Types.ObjectId(L.THERE);
        const widened = { $match: { deletedStatusKey: 0, $and: [{ $or: [{ sprintId: id }, { extraLists: { $elemMatch: { sprintId: id } } }] }] } };

        expect(withExtraListRows([{ $match: { sprintId: id, deletedStatusKey: 0 } }], L.THERE)).toEqual([widened]);
        expect(withExtraListRows([{ $match: { sprintId: L.THERE, deletedStatusKey: 0 } }], L.THERE)[0].$match.$and[0].$or[0]).toEqual({ sprintId: L.THERE });
        const untouched = [
            { $match: { sprintId: new mongoose.Types.ObjectId(L.HOME) } },
            { $match: { sprintId: { $in: [id] } } },
            { $match: { $or: [{ sprintId: id }] } },
            { $facet: { inside: [{ $match: { sprintId: id } }] } },
        ];
        expect(withExtraListRows(untouched, L.THERE)).toEqual(untouched);
        expect(withExtraListRows(untouched, 'launch')).toBe(untouched);
    });

    test('finds the list under $and too, as the Table names it', async () => {
        const id = new mongoose.Types.ObjectId(L.THERE);
        const inList = { $or: [{ sprintId: { $eq: id } }, { extraLists: { $elemMatch: { sprintId: id } } }] };

        expect(withExtraListRows([{ $match: { $and: [{ $and: [{ ProjectID: 1 }, { sprintId: { $eq: id } }] }, { statusKey: 1 }] } }], L.THERE)).toEqual([
            { $match: { $and: [{ $and: [{ ProjectID: 1 }, { $and: [inList] }] }, { statusKey: 1 }] } },
        ]);

        place(T.TASK, [[P.HOME, L.HOME_SECOND]]);
        const tableQuery = [{ $match: { $and: [{ $and: [{ ProjectID: { objId: { $in: [P.HOME] } } }, { sprintId: { objId: { $eq: L.HOME_SECOND } } }, { deletedStatusKey: { $in: [0] } }, { isParentTask: true }] }, {}] } }];
        expect(idsOf(await find('OWNER', tableQuery, { inList: L.HOME_SECOND }))).toEqual([T.TASK]);
        expect(idsOf(await find('LIST_ONLY', tableQuery, { inList: L.HOME_SECOND }))).toEqual([]);
        expect(idsOf(await find('OWNER', tableQuery))).toEqual([]);
    });

    test('keeps the conditions the match already had', () => {
        const id = new mongoose.Types.ObjectId(L.THERE);
        const [{ $match }] = withExtraListRows([{ $match: { sprintId: id, $and: [{ statusKey: 1 }], AssigneeUserId: { $in: ['u1'] } } }], L.THERE);

        expect($match.$and[0]).toEqual({ statusKey: 1 });
        expect($match.$and).toHaveLength(2);
        expect($match.AssigneeUserId).toEqual({ $in: ['u1'] });
        expect($match).not.toHaveProperty('sprintId');
    });
});

describe('counts', () => {
    const status = (key) => ({ searchKey: 'statusKey', searchValue: key, conditions: [{ statusKey: key }] });
    const counted = async (who, pid, sprintId, totals) => {
        const res = await find(who, Q.groupCountsQuery({ pid, sprintId, items: [status(1)], totals }), { inList: sprintId });
        expect(res.code).toBe(200);
        return res.body[0];
    };
    const countOf = async (who, pid, sprintId) => Q.readGroupCounts([status(1)], await counted(who, pid, sprintId)).statusKey_1;

    beforeEach(() => place(T.TASK, [[P.HOME, L.HOME_SECOND]]));

    test('a group of a list counts the rows the reader gets in it', async () => {
        place(T.IN_PRIVATE_SPRINT, [[P.HOME, L.HOME_SECOND]]);

        expect(await seenBy(['OWNER', 'ON_BOTH', 'LIST_ONLY'], (who) => countOf(who, P.HOME, L.HOME_SECOND))).toEqual({ OWNER: 2, ON_BOTH: 1, LIST_ONLY: 0 });
        expect(await countOf('OWNER', P.HOME, L.HOME)).toBe(2);
    });

    test('a group total sums an added task once in each list it is shown in', async () => {
        mockWorld.stored(T.TASK).estimate = 5;
        mockWorld.stored(T.SECOND).estimate = 2;
        const totals = [{ id: 'estimate', path: 'estimate', wrapped: false }];
        const totalOf = async (sprintId) => Q.readGroupTotals([status(1)], await counted('OWNER', P.HOME, sprintId, totals), totals).statusKey_1.estimate;

        expect([await totalOf(L.HOME), await totalOf(L.HOME_SECOND)]).toEqual([7, 5]);
    });

    test('a count over the whole project holds the task once', async () => {
        const projectCount = [{ $match: { objId: { ProjectID: P.HOME }, deletedStatusKey: 0, isParentTask: true } }, { $count: 'count' }];
        const plain = (await find('OWNER', projectCount)).body[0].count;

        expect(plain).toBeGreaterThan(1);
        expect((await find('OWNER', projectCount, { inList: L.HOME_SECOND })).body[0].count).toBe(plain);
    });
});

describe('the list refreshed after a tab comes back', () => {
    const status = { searchKey: 'statusKey', searchValue: 1, indexName: 'groupByStatusIndex', conditions: [{ statusKey: 1 }] };
    const refresh = (who, sprintId, extra = {}) => call('POST /api/v1/tabSyncTask', uidOf[who], { body: { pid: P.HOME, sprintId, istableTask: false, tabLeaveTime: 0, item: status, ...extra } });
    const listOf = async (who, sprintId) => {
        const res = await refresh(who, sprintId);
        expect(res.code).toBe(200);
        return { rows: res.body[0].result.map((row) => String(row._id)).sort(), count: res.body[0].count[0]?.count || 0 };
    };

    beforeEach(() => place(T.TASK, [[P.HOME, L.HOME_SECOND], [P.HOME, L.HOME_PRIVATE]]));

    test('holds a task added to the list and counts it, for a reader of the task', async () => {
        expect(await seenBy(['OWNER', 'ON_BOTH', 'LIST_ONLY'], (who) => listOf(who, L.HOME_SECOND))).toEqual({
            OWNER: { rows: [T.TASK], count: 1 }, ON_BOTH: { rows: [T.TASK], count: 1 }, LIST_ONLY: { rows: [], count: 0 },
        });
    });

    test('holds nothing of a private list for a person who is not on it', async () => {
        expect(await seenBy(['HOME_ONLY', 'ON_BOTH'], (who) => listOf(who, L.HOME_PRIVATE))).toEqual({
            HOME_ONLY: { rows: [T.IN_PRIVATE_SPRINT, T.TASK].sort(), count: 2 }, ON_BOTH: { rows: [], count: 0 },
        });
    });

    test('the Table\'s refresh holds it too', async () => {
        const rows = async (who) => (await refresh(who, L.HOME_SECOND, { istableTask: true })).body.map((row) => String(row._id));

        expect(await seenBy(['OWNER', 'LIST_ONLY'], rows)).toEqual({ OWNER: [T.TASK], LIST_ONLY: [] });
    });

    test('leaves the subtasks of a task as they are read', async () => {
        const res = await refresh('OWNER', L.HOME, { parentId: T.TASK });

        expect(res.body[0].result.map((row) => String(row._id))).toEqual([T.SUBTASK]);
    });
});

describe('the Everything rows', () => {
    const listsOf = (rows, taskId) => (rows.find((row) => String(row._id) === taskId) || {}).extraLists;
    const entry = (projectId, sprintId) => expect.objectContaining({ projectId, sprintId });
    const named = (projectId, sprintId, name, projectName) => ({ projectId, sprintId, addedBy: uidOf.OWNER, addedAt: expect.anything(), name, projectName });
    const bare = (projectId, sprintId) => ({ projectId, sprintId, addedBy: uidOf.OWNER, addedAt: expect.anything() });

    beforeEach(() => place(T.TASK, [[P.ELSEWHERE, L.THERE], [P.ELSEWHERE, L.THERE_PRIVATE], [P.HOME, L.HOME_SECOND]]));

    test('carry a task\'s lists: the ids for every reader of the task, a name only for a list that reader can open', async () => {
        expect(listsOf(await everythingRows('OWNER'), T.TASK)).toEqual([
            named(P.ELSEWHERE, L.THERE, 'Launch plan', 'Project 02'), named(P.ELSEWHERE, L.THERE_PRIVATE, 'Board papers', 'Project 02'), named(P.HOME, L.HOME_SECOND, 'Design queue', 'Project 01'),
        ]);
        expect(listsOf(await everythingRows('ON_BOTH'), T.TASK)).toEqual([
            named(P.ELSEWHERE, L.THERE, 'Launch plan', 'Project 02'), bare(P.ELSEWHERE, L.THERE_PRIVATE), named(P.HOME, L.HOME_SECOND, 'Design queue', 'Project 01'),
        ]);
        const homeOnly = await everythingRows('HOME_ONLY');
        expect(listsOf(homeOnly, T.TASK)).toEqual([bare(P.ELSEWHERE, L.THERE), bare(P.ELSEWHERE, L.THERE_PRIVATE), named(P.HOME, L.HOME_SECOND, 'Design queue', 'Project 01')]);
        expect(JSON.stringify(homeOnly)).not.toMatch(/Launch plan|Board papers|Project 02/);
    });

    test('leave a task in no other list as it was', async () => {
        const row = (await everythingRows('OWNER')).find((item) => String(item._id) === T.SECOND);

        expect(row).toBeDefined();
        expect(row).not.toHaveProperty('extraLists');
    });

    test('filtered by a list hold the tasks that live in it and the ones added to it, for a reader of each', async () => {
        const read = async (who) => (await everythingRows(who, { filter: { sprintIds: [L.THERE] } })).map((row) => String(row._id)).sort();

        expect(await seenBy(EVERYONE, read)).toEqual({
            OWNER: [THERE_TASK, T.TASK].sort(), ADMIN: [THERE_TASK, T.TASK].sort(), ON_BOTH: [THERE_TASK, T.TASK].sort(), GUEST: [THERE_TASK, T.TASK].sort(),
            LIST_ONLY: [THERE_TASK], HOME_ONLY: [], OUTSIDER: [],
        });
    });

    test('filtered by a private list the reader is not on hold nothing, and a person on it gets no task whose home is closed to them', async () => {
        const read = async (who) => (await everythingRows(who, { filter: { sprintIds: [L.THERE_PRIVATE] } })).map((row) => String(row._id)).sort();

        expect(await seenBy(['OWNER', 'ON_BOTH', 'LIST_ONLY', 'HOME_ONLY'], read)).toEqual({
            OWNER: [PRIVATE_THERE_TASK, T.TASK].sort(), ON_BOTH: [], LIST_ONLY: [PRIVATE_THERE_TASK], HOME_ONLY: [],
        });
    });

    test('filtered by a list count each task once', async () => {
        const res = await everything('OWNER', { filter: { sprintIds: [L.THERE, L.THERE_PRIVATE, L.HOME_SECOND] } });

        expect(res.body.data.groups).toEqual([{ key: null, count: 3 }]);
        expect(res.body.data.rows.filter((row) => String(row._id) === T.TASK)).toHaveLength(1);
        expect(listsOf(res.body.data.rows, T.TASK)).toEqual([entry(P.ELSEWHERE, L.THERE), entry(P.ELSEWHERE, L.THERE_PRIVATE), entry(P.HOME, L.HOME_SECOND)]);
    });

    test('a token limited to some projects', async () => {
        const read = async (projectIds) => (await narrowed('OWNER', projectIds, listEverything, { filter: { sprintIds: [L.THERE] } })).body.data.rows.map((row) => String(row._id)).sort();

        expect(await read([P.ELSEWHERE])).toEqual([THERE_TASK]);
        expect(await read([P.HOME])).toEqual([]);
        expect(await read([P.HOME, P.ELSEWHERE])).toEqual([THERE_TASK, T.TASK].sort());
    });

    test.each([['a word', ['launch']], ['not a list', L.THERE], ['a number', [7]]])('refuse %s as a list filter', async (_, sprintIds) => {
        const res = await everything('OWNER', { filter: { sprintIds } });

        expect(res.code).toBe(400);
        expect(res.body).toMatchObject({ status: false, field: 'filter.sprintIds' });
    });
});
