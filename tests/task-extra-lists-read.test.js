/* Task 046 M3, slice L2: what a reader gets of a task's extra lists, and what the readers that
   exist today make of the field. A task is read by the people who can open its home and by nobody
   else; every list, count and search keeps counting it once, where it lives. The handlers are the
   real ones over a fake database per company. */
process.env.STORAGE_TYPE = 'server';

const fs = require('fs');
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

const { COMPANY, uidOf, NO_SEAT, P, L, T, routeCaller, routesOf } = require('./fixtures/extraListsWorld');
const { runNarrowed } = require('../Config/tokenNarrowing');
const { computeLiveTaskCount } = require('../Modules/Tasks/helpers/reconcileTaskCount');
const { globalSearch } = require('../Modules/GlobalSearch/controller');
const { listsForViewer } = require('../Modules/Tasks/helpers/taskExtraLists');
const Q = require('../frontend/src/store/ProjectData/taskQueries');

const call = routeCaller(routesOf(path.join(__dirname, '../Modules/Tasks/routes')));
const { stored, place } = mockWorld;

const readTask = (who, taskId) => call('GET /api/v1/task/:id', uidOf[who] || who, { params: { id: taskId } });
const readLists = (who, taskId) => call('GET /api/v2/tasks/:id/lists', uidOf[who] || who, { params: { id: taskId } });
const find = (who, findQuery) => call('POST /api/v1/task/find', uidOf[who] || who, { body: { findQuery } });
const everything = (who, body = {}) => call('POST /api/v2/tasks/everything', uidOf[who] || who, { body });

const ADDED = new Date('2026-09-30T00:00:00.000Z');
const bare = (projectId, sprintId) => ({ projectId, sprintId, addedBy: uidOf.OWNER, addedAt: ADDED });
const named = (projectId, sprintId, name) => ({ ...bare(projectId, sprintId), name, projectName: `Project ${projectId.slice(-2)}` });
const TASK_NOT_FOUND = { code: 404, body: { status: false, statusText: 'Task not found.', message: 'Task not found.' } };

beforeEach(() => {
    mockWorld.reset();
    jest.clearAllMocks();
    place(T.TASK, [[P.ELSEWHERE, L.THERE], [P.ELSEWHERE, L.THERE_PRIVATE], [P.HOME, L.HOME_SECOND]]);
});

describe('a task\'s extra lists, as each reader gets them', () => {
    test('a person who can open every list gets each with its name and its project\'s name', async () => {
        const lists = [named(P.ELSEWHERE, L.THERE, 'Launch plan'), named(P.ELSEWHERE, L.THERE_PRIVATE, 'Board papers'), named(P.HOME, L.HOME_SECOND, 'Design queue')];

        expect(await readLists('OWNER', T.TASK)).toEqual({ code: 200, body: { status: true, statusText: 'Task lists.', data: { taskId: T.TASK, extraLists: lists } } });
        expect((await readTask('OWNER', T.TASK)).body.extraLists).toEqual(lists);
    });

    test('a list the reader is not on is given by its ids alone', async () => {
        const lists = [named(P.ELSEWHERE, L.THERE, 'Launch plan'), bare(P.ELSEWHERE, L.THERE_PRIVATE), named(P.HOME, L.HOME_SECOND, 'Design queue')];

        expect((await readLists('ON_BOTH', T.TASK)).body.data.extraLists).toEqual(lists);
        expect((await readTask('ON_BOTH', T.TASK)).body.extraLists).toEqual(lists);
    });

    test('so is every list of a project the reader cannot open', async () => {
        const lists = [bare(P.ELSEWHERE, L.THERE), bare(P.ELSEWHERE, L.THERE_PRIVATE), named(P.HOME, L.HOME_SECOND, 'Design queue')];

        expect((await readLists('HOME_ONLY', T.TASK)).body.data.extraLists).toEqual(lists);
        expect((await readTask('HOME_ONLY', T.TASK)).body.extraLists).toEqual(lists);
        expect(JSON.stringify((await readTask('HOME_ONLY', T.TASK)).body)).not.toMatch(/Launch plan|Board papers|Project a2/);
    });

    test.each([
        ['an archived list', [P.ELSEWHERE, L.ARCHIVED]],
        ['a deleted list', [P.ELSEWHERE, L.DELETED]],
        ['a list in a deleted project', [P.GONE, L.GONE]],
        ['a list that is no longer there', [P.ELSEWHERE, L.MISSING]],
        ['a list paired with a project that is not its own', [P.OPEN, L.THERE]],
        ['someone else\'s personal list', [P.PERSONAL_THEIRS, L.PERSONAL_THEIRS]],
    ])('%s is given by its ids alone, to an owner too', async (_, [projectId, sprintId]) => {
        place(T.TASK, [[projectId, sprintId]]);

        expect((await readLists('OWNER', T.TASK)).body.data.extraLists).toEqual([bare(projectId, sprintId)]);
    });

    test('a list in a closed project keeps its name', async () => {
        place(T.TASK, [[P.CLOSED, L.CLOSED]]);

        expect((await readLists('OWNER', T.TASK)).body.data.extraLists).toEqual([named(P.CLOSED, L.CLOSED, `List ${L.CLOSED.slice(-2)}`)]);
    });

    test('a token limited to some projects names only the lists inside them', async () => {
        const lists = await runNarrowed({ userId: uidOf.OWNER, projectIds: [P.HOME] }, () => listsForViewer(COMPANY, uidOf.OWNER, stored(T.TASK)));

        expect(lists).toEqual([bare(P.ELSEWHERE, L.THERE), bare(P.ELSEWHERE, L.THERE_PRIVATE), named(P.HOME, L.HOME_SECOND, 'Design queue')]);
    });

    test('a task in no extra list is read as it is stored', async () => {
        const res = await readTask('ON_BOTH', T.SECOND);

        expect(res.code).toBe(200);
        expect(res.body).not.toHaveProperty('extraLists');
        expect((await readLists('ON_BOTH', T.SECOND)).body.data).toEqual({ taskId: T.SECOND, extraLists: [] });
    });

    test('an id that is not one is refused', async () => {
        expect((await readLists('OWNER', 'launch')).code).toBe(400);
    });
});

describe('an extra list gives nobody the task', () => {
    test.each(['LIST_ONLY', 'OUTSIDER', NO_SEAT])('%s can open a list the task is in, or nothing, and cannot read the task or its lists', async (who) => {
        expect(await readTask(who, T.TASK)).toEqual(TASK_NOT_FOUND);
        expect(await readLists(who, T.TASK)).toEqual(TASK_NOT_FOUND);
        expect(await readLists(who, T.MISSING)).toEqual(TASK_NOT_FOUND);
    });

    test('a query for the tasks in a list brings only the ones whose home the caller can open', async () => {
        const inList = [{ $match: { extraLists: { $elemMatch: { sprintId: L.THERE } } } }];

        expect((await find('OWNER', inList)).body.map((row) => String(row._id))).toEqual([T.TASK]);
        expect((await find('ON_BOTH', inList)).body.map((row) => String(row._id))).toEqual([T.TASK]);
        expect((await find('LIST_ONLY', inList)).body).toEqual([]);
        expect((await find('OUTSIDER', inList)).body).toEqual([]);
    });

    test('the Everything view of a person on the list\'s project only does not hold it', async () => {
        const rows = (await everything('LIST_ONLY')).body.data.rows;

        expect(rows.map((row) => String(row._id))).not.toContain(T.TASK);
    });

    test('a task in a private list of its home stays out of reach of a person on the list it was added to', async () => {
        place(T.IN_PRIVATE_SPRINT, [[P.HOME, L.HOME_SECOND]]);

        expect(await readTask('ON_BOTH', T.IN_PRIVATE_SPRINT)).toEqual(TASK_NOT_FOUND);
        expect((await find('ON_BOTH', [{ $match: { extraLists: { $elemMatch: { sprintId: L.HOME_SECOND } } } }])).body.map((row) => String(row._id))).toEqual([T.TASK]);
    });
});

describe('a task in extra lists is counted once, at its home', () => {
    const status = (key) => ({ searchKey: 'statusKey', searchValue: key, conditions: [{ statusKey: key }] });
    const answered = (res) => {
        expect(res.code).toBe(200);
        return res.body;
    };
    const rowsOf = async (who, pid, sprintId) => answered(await find(who, [{ $match: Q.sprintTaskMatch({ pid, sprintId }) }])).map((row) => String(row._id));
    const countOf = async (who, pid, sprintId) => Q.readGroupCounts([status(1)], answered(await find(who, Q.groupCountsQuery({ pid, sprintId, items: [status(1)] })))[0]).statusKey_1;

    test('the rows of a list are the tasks that live in it', async () => {
        expect(await rowsOf('OWNER', P.ELSEWHERE, L.THERE)).toEqual([]);
        expect(await rowsOf('OWNER', P.HOME, L.HOME_SECOND)).toEqual([]);
        expect((await rowsOf('OWNER', P.HOME, L.HOME)).filter((id) => id === T.TASK)).toEqual([T.TASK]);
    });

    test('the group counts of a list count them and no others', async () => {
        expect(await countOf('OWNER', P.ELSEWHERE, L.THERE)).toBe(0);
        expect(await countOf('OWNER', P.HOME, L.HOME)).toBe(2);
    });

    test('the stored counter of a list, when it is recounted', async () => {
        expect(await computeLiveTaskCount(COMPANY, L.THERE)).toBe(0);
        expect(await computeLiveTaskCount(COMPANY, L.HOME_SECOND)).toBe(0);
        expect(await computeLiveTaskCount(COMPANY, L.HOME)).toBe(3);
    });

    test('the Everything view holds one row for it, under its home project', async () => {
        const all = (await everything('OWNER')).body.data.rows.filter((row) => String(row._id) === T.TASK);
        const elsewhere = (await everything('OWNER', { filter: { projectIds: [P.ELSEWHERE] } })).body.data.rows;

        expect(all).toHaveLength(1);
        expect(String(all[0].ProjectID)).toBe(P.HOME);
        expect(elsewhere.map((row) => String(row._id))).not.toContain(T.TASK);
    });

    test('search finds it once, with its home', async () => {
        const res = { statusCode: 200 };
        res.status = (code) => { res.statusCode = code; return res; };
        res.send = (body) => { res.body = body; return res; };

        await globalSearch({ headers: { companyid: COMPANY }, uid: uidOf.OWNER, body: { query: 'Write the brief' } }, res);

        expect(res.body.data.tasks.map((row) => [String(row._id), String(row.ProjectID), String(row.sprintId)])).toEqual([[T.TASK, P.HOME, L.HOME]]);
    });

    /* Reports, exports, velocity, burndown, portfolio, dashboards, timesheets, automations and the socket
       relay all read a task by ProjectID and sprintId. None of them names the new field, so none can count
       a task under a list it does not live in; a reader that starts to must be added here on purpose.
       The writers that move or convert a task are here because they take entries away; the list rows,
       the Everything rows and the relay are here because they show a task under a list it was added
       to, each only to a reader of the task's home (tests/task-find-extra-lists.test.js,
       tests/socket-extra-list-relay.test.js). */
    test('no other server file reads the field', () => {
        const ROOT = path.join(__dirname, '..');
        const KNOWN = [
            'Modules/Agents/actions.js',
            'Modules/Agents/undo.js',
            'Modules/Tasks/controller/everything.js',
            'Modules/Tasks/controller/getTabSyncTasks.js',
            'Modules/Tasks/helpers/everythingQuery.js',
            'Modules/Tasks/helpers/getTasksData.js',
            'Modules/Tasks/helpers/mongo_helper.js',
            'Modules/Tasks/helpers/taskExtraLists.js',
            'Modules/Tasks/helpers/taskExtraListsRules.js',
            'Modules/Tasks/helpers/taskMongo/extraLists.js',
            'Modules/Tasks/helpers/taskMongo/structural.js',
            'Modules/Tasks/helpers/taskQueryGuard.js',
            'Modules/Tasks/helpers/taskWriteFields.js',
            'Modules/Tasks/helpers/task_class_Mongo.js',
            'migrations/069-task-extra-lists-index.js',
            'socket/controller/taskSocket.js',
            'utils/mongo-handler/createSchema.js',
            'utils/mongo-handler/schema.js',
        ];
        const files = [];
        const walk = (dir) => fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).forEach((entry) => {
            const relative = `${dir}/${entry.name}`;
            if (entry.isDirectory()) {
                if (entry.name !== 'node_modules') walk(relative);
            } else if (entry.name.endsWith('.js')) {
                files.push(relative);
            }
        });
        ['Config', 'Modules', 'common-storage', 'event', 'middlewares', 'migrations', 'socket', 'utils'].filter((dir) => fs.existsSync(path.join(ROOT, dir))).forEach(walk);

        expect(files.length).toBeGreaterThan(500);
        expect(files.filter((file) => /extraLists/i.test(fs.readFileSync(path.join(ROOT, file), 'utf8'))).sort()).toEqual(KNOWN);
    });
});
