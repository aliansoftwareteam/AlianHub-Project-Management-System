/* Task 046 M3, slices L1 and L2: a task can be added to more lists, and its home alone decides who
   reads it. The routes are the real ones with their guards in front, over a fake database per
   company; every person, project and list below is judged by the code the app uses elsewhere. */
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

const { COMPANY, OTHER_COMPANY, GLOBAL, uidOf, NO_SEAT, P, L, T, FOREIGN, routeCaller, routesOf } = require('./fixtures/extraListsWorld');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { runNarrowed } = require('../Config/tokenNarrowing');
const { holdNarrowedToken } = require('../Config/narrowedTokenRoutes');
const { updateSprintFun } = require('../Modules/Sprints/controller');
const socketEmitter = require('../event/socketEventEmitter');
const { taskMongo } = require('../Modules/Tasks/helpers/task_class_Mongo');
const { MAX_EXTRA_LISTS } = require('../Modules/Tasks/helpers/taskExtraListsRules');
const { TASK_ACTIONS, requirementsOf } = require('../Config/taskWritePermissions');

const call = routeCaller(routesOf(path.join(__dirname, '../Modules/Tasks/routes')));
const PATCH = 'PATCH /api/v2/tasks';
const BULK = 'POST /api/v2/tasks/bulk';

const { stored, listsOf, place, setRule, rows } = mockWorld;
const add = (who, taskId, sprintId, extra = {}) => call(PATCH, uidOf[who] || who, { body: { action: 'addToList', taskId, sprintId, ...extra } });
const remove = (who, taskId, sprintId, extra = {}) => call(PATCH, uidOf[who] || who, { body: { action: 'removeFromList', taskId, sprintId, ...extra } });
const bulkAdd = (who, taskIds, sprintId, extra = {}) => call(BULK, uidOf[who] || who, { body: { action: 'bulkAddToList', taskIds, sprintId, ...extra } });

const TASK_NOT_FOUND = { code: 404, body: { status: false, statusText: 'Task not found' } };
const LIST_NOT_FOUND = { code: 404, body: { status: false, statusText: 'List not found', code: 'LIST_NOT_FOUND' } };
const NOT_PERMITTED = { code: 403, body: { status: false, statusText: 'You do not have permission to perform this action.', code: 'NOT_PERMITTED' } };
const ruled = (code) => ({ code: 400, body: { status: false, statusText: expect.any(String), code } });
const history = () => rows(SCHEMA_TYPE.HISTORY);
const taskEvents = () => socketEmitter.emit.mock.calls.filter(([name, payload]) => name === 'update' && payload.module === 'task').map(([, payload]) => payload);

beforeEach(() => {
    mockWorld.reset();
    jest.clearAllMocks();
});

describe('adding a task to another list', () => {
    test.each(['OWNER', 'ADMIN', 'ON_BOTH'])('%s can add a task they can move to a list they can open', async (who) => {
        const res = await add(who, T.TASK, L.THERE);

        expect(res).toEqual({
            code: 200,
            body: {
                status: true,
                statusText: 'Task updated successfully.',
                data: { taskId: T.TASK, extraLists: [{ projectId: P.ELSEWHERE, sprintId: L.THERE, addedBy: uidOf[who], addedAt: expect.any(Date), name: 'Launch plan', projectName: `Project ${P.ELSEWHERE.slice(-2)}` }] },
            },
        });
        expect(stored(T.TASK).extraLists.map((entry) => [String(entry.projectId), String(entry.sprintId), entry.addedBy])).toEqual([[P.ELSEWHERE, L.THERE, uidOf[who]]]);
    });

    test('the home of the task does not change', async () => {
        const before = { ...stored(T.TASK) };
        await add('ON_BOTH', T.TASK, L.THERE);

        const after = { ...stored(T.TASK) };
        delete after.extraLists;
        expect(after).toEqual(before);
        expect([String(after.ProjectID), String(after.sprintId)]).toEqual([P.HOME, L.HOME]);
    });

    test('a list in the same project is taken too', async () => {
        expect((await add('HOME_ONLY', T.TASK, L.HOME_SECOND)).code).toBe(200);
        expect(listsOf(T.TASK)).toEqual([L.HOME_SECOND]);
    });

    test('a person who can open the task but not the list is told the list is not there', async () => {
        const hidden = await add('HOME_ONLY', T.TASK, L.THERE);
        const missing = await add('HOME_ONLY', T.TASK, L.MISSING);

        expect(hidden).toEqual(LIST_NOT_FOUND);
        expect(hidden).toEqual(missing);
        expect(stored(T.TASK).extraLists).toBeUndefined();
    });

    test.each(['LIST_ONLY', 'OUTSIDER', NO_SEAT])('%s cannot open the task and is told it is not there', async (who) => {
        const hidden = await add(who, T.TASK, L.THERE);
        const missing = await add(who, T.MISSING, L.THERE);

        expect(hidden).toEqual(TASK_NOT_FOUND);
        expect(hidden).toEqual(missing);
        expect(stored(T.TASK).extraLists).toBeUndefined();
    });

    test('a guest is judged by the rules of their role, like anyone else', async () => {
        expect(await add('GUEST', T.TASK, L.THERE)).toEqual(NOT_PERMITTED);

        setRule('task_move', 0, true);
        expect((await add('GUEST', T.TASK, L.THERE)).code).toBe(200);
    });

    test('moving tasks must be allowed at the home', async () => {
        setRule('task_move', 3, false);

        expect(await add('ON_BOTH', T.TASK, L.THERE)).toEqual(NOT_PERMITTED);
        expect(stored(T.TASK).extraLists).toBeUndefined();
    });

    test('by the rules of the home project, when it has its own', async () => {
        const inOwnRules = T.SECOND.replace(/..$/, 'f3');
        mockWorld.task(inOwnRules, P.OWN_RULES, L.OWN_RULES);

        expect(await add('ON_BOTH', inOwnRules, L.OPEN)).toEqual(NOT_PERMITTED);

        setRule('task_move', 3, true, P.OWN_RULES);
        expect((await add('ON_BOTH', inOwnRules, L.OPEN)).code).toBe(200);
    });

    test('and in the project of the list, by that project\'s own rules', async () => {
        expect(await add('ON_BOTH', T.TASK, L.OWN_RULES)).toEqual(NOT_PERMITTED);

        setRule('task_move', 3, true, P.OWN_RULES);
        expect((await add('ON_BOTH', T.TASK, L.OWN_RULES)).code).toBe(200);
    });

    test('a role that lists every private project may see a list there but not add to it', async () => {
        mockWorld.task(T.SECOND.replace(/..$/, 'f1'), P.OPEN, L.OPEN);

        expect(await add('LISTER', T.SECOND.replace(/..$/, 'f1'), L.THERE)).toEqual(NOT_PERMITTED);
        expect(await add('LISTER', T.SECOND.replace(/..$/, 'f1'), L.THERE_PRIVATE)).toEqual(LIST_NOT_FOUND);
    });
});

describe('lists a task cannot be added to', () => {
    test('a private list the person is not on is not there; an owner reads past it', async () => {
        expect(await add('ON_BOTH', T.TASK, L.THERE_PRIVATE)).toEqual(LIST_NOT_FOUND);
        expect((await add('OWNER', T.TASK, L.THERE_PRIVATE)).code).toBe(200);
    });

    test.each(['ON_BOTH', 'OWNER', 'ADMIN'])('someone else\'s personal list is not there for %s', async (who) => {
        expect(await add(who, T.TASK, L.PERSONAL_THEIRS)).toEqual(LIST_NOT_FOUND);
        expect(stored(T.TASK).extraLists).toBeUndefined();
    });

    test('a person\'s own personal list is refused by name', async () => {
        expect(await add('ON_BOTH', T.TASK, L.PERSONAL_MINE)).toEqual(ruled('PERSONAL_LIST'));
    });

    test.each([
        ['a chat channel', L.CHANNEL],
        ['a deleted list', L.DELETED],
        ['a list in a deleted project', L.GONE],
        ['a list of another company', FOREIGN.LIST],
    ])('%s is not there, for an owner too', async (_, sprintId) => {
        expect(await add('OWNER', T.TASK, sprintId)).toEqual(LIST_NOT_FOUND);
    });

    test.each([
        ['a Scrum sprint', L.SCRUM, 'SCRUM_LIST'],
        ['a backlog', L.BACKLOG, 'SCRUM_LIST'],
        ['an archived list', L.ARCHIVED, 'LIST_NOT_LIVE'],
        ['a list in a closed project', L.CLOSED, 'PROJECT_NOT_OPEN'],
        ['the list the task lives in', L.HOME, 'HOME_LIST'],
    ])('%s is refused with the reason', async (_, sprintId, code) => {
        expect(await add('OWNER', T.TASK, sprintId)).toEqual(ruled(code));
        expect(stored(T.TASK).extraLists).toBeUndefined();
    });

    test('a list holds a task once', async () => {
        await add('ON_BOTH', T.TASK, L.THERE);

        expect(await add('ON_BOTH', T.TASK, L.THERE)).toEqual(ruled('ALREADY_IN_LIST'));
        expect(listsOf(T.TASK)).toEqual([L.THERE]);
    });

    test(`a task is in ${MAX_EXTRA_LISTS} extra lists at most`, async () => {
        const many = Array.from({ length: MAX_EXTRA_LISTS }, (_, at) => L.OPEN.replace(/..$/, (0x80 + at).toString(16)));
        many.forEach((sprintId) => mockWorld.list(sprintId, P.OPEN));
        place(T.TASK, many.slice(0, MAX_EXTRA_LISTS - 1).map((sprintId) => [P.OPEN, sprintId]));

        expect((await add('OWNER', T.TASK, many[MAX_EXTRA_LISTS - 1])).code).toBe(200);
        expect(await add('OWNER', T.TASK, L.THERE)).toEqual(ruled('TOO_MANY_LISTS'));
        expect(listsOf(T.TASK)).toHaveLength(MAX_EXTRA_LISTS);
    });
});

describe('tasks that cannot be added anywhere', () => {
    test('a task in a private list the person is not on is not there; an owner reads past it', async () => {
        expect(await add('ON_BOTH', T.IN_PRIVATE_SPRINT, L.HOME_SECOND)).toEqual(TASK_NOT_FOUND);
        expect((await add('OWNER', T.IN_PRIVATE_SPRINT, L.HOME_SECOND)).code).toBe(200);
    });

    test.each(['ON_BOTH', 'OWNER', 'ADMIN'])('a task in someone else\'s personal list is not there for %s', async (who) => {
        expect(await add(who, T.IN_THEIR_PERSONAL, L.OPEN)).toEqual(TASK_NOT_FOUND);
        expect(stored(T.IN_THEIR_PERSONAL).extraLists).toBeUndefined();
    });

    test('a task in a person\'s own personal list is refused by name', async () => {
        expect(await add('ON_BOTH', T.IN_MY_PERSONAL, L.OPEN)).toEqual(ruled('HOME_PERSONAL_LIST'));
    });

    test('a chat conversation is refused for the people in it and is not there for anyone else', async () => {
        expect(await add('ON_BOTH', T.CHAT_ROW, L.OPEN)).toEqual(ruled('CHAT_ROW'));
        expect(await add('OWNER', T.CHAT_ROW, L.OPEN)).toEqual(TASK_NOT_FOUND);
    });

    test.each([
        ['a subtask', T.SUBTASK, 'SUBTASK'],
        ['an archived task', T.ARCHIVED, 'TASK_NOT_LIVE'],
        ['a task in a closed project', T.IN_CLOSED, 'HOME_PROJECT_NOT_OPEN'],
    ])('%s is refused with the reason', async (_, taskId, code) => {
        expect(await add('OWNER', taskId, L.OPEN)).toEqual(ruled(code));
        expect(stored(taskId).extraLists).toBeUndefined();
    });

    test.each([
        ['a deleted task', T.DELETED],
        ['a task of another company', FOREIGN.TASK],
    ])('%s is not there', async (_, taskId) => {
        expect(await add('OWNER', taskId, L.OPEN)).toEqual(TASK_NOT_FOUND);
    });
});

describe('the request', () => {
    test.each([
        ['a field the action does not take', { projectId: P.OPEN }, 'UNKNOWN_FIELD'],
        ['the stored field itself', { extraLists: [{ projectId: P.OPEN, sprintId: L.OPEN }] }, 'UNKNOWN_FIELD'],
    ])('%s is refused', async (_, extra, code) => {
        expect(await add('OWNER', T.TASK, L.THERE, extra)).toEqual(ruled(code));
        expect(stored(T.TASK).extraLists).toBeUndefined();
    });

    test.each([
        ['no list', { taskId: T.TASK }],
        ['no task', { sprintId: L.THERE }],
        ['a list id that is not an id', { taskId: T.TASK, sprintId: 'launch' }],
        ['a query in place of the list id', { taskId: T.TASK, sprintId: { $ne: '' } }],
    ])('%s is refused', async (_, body) => {
        const res = await call(PATCH, uidOf.OWNER, { body: { action: 'addToList', ...body } });

        expect(res).toMatchObject({ code: 400, body: { status: false } });
        expect(stored(T.TASK).extraLists).toBeUndefined();
    });

    test('every read and write is made in the company of the session', async () => {
        await add('ON_BOTH', T.TASK, L.THERE, { companyId: OTHER_COMPANY });
        await remove('ON_BOTH', T.TASK, L.THERE);

        expect(mockWorld.dbFor(OTHER_COMPANY).calls).toEqual([]);
        expect(mockWorld.dbFor(OTHER_COMPANY).store[SCHEMA_TYPE.TASKS][0].extraLists).toBeUndefined();
    });

    test('a session of another company is refused before anything is read', async () => {
        const res = await call(PATCH, uidOf.OWNER, { company: OTHER_COMPANY, body: { action: 'addToList', taskId: FOREIGN.TASK, sprintId: FOREIGN.LIST } });

        expect(res.code).not.toBe(200);
        expect(mockWorld.dbFor(OTHER_COMPANY).store[SCHEMA_TYPE.TASKS][0].extraLists).toBeUndefined();
    });
});

describe('what an addition leaves behind', () => {
    test('one task update, for the room of the home list only', async () => {
        await add('ON_BOTH', T.TASK, L.THERE);

        const events = taskEvents();
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({ type: 'update', module: 'task' });
        expect([String(events[0].data._id), String(events[0].data.ProjectID), String(events[0].data.sprintId)]).toEqual([T.TASK, P.HOME, L.HOME]);
        expect(events[0].updatedFields.extraLists.map((entry) => String(entry.sprintId))).toEqual([L.THERE]);
    });

    test('no list counts it: the counters are not written', async () => {
        const before = JSON.stringify(rows(SCHEMA_TYPE.SPRINTS));
        await add('ON_BOTH', T.TASK, L.THERE);
        await remove('ON_BOTH', T.TASK, L.THERE);

        expect(updateSprintFun).not.toHaveBeenCalled();
        expect(JSON.stringify(rows(SCHEMA_TYPE.SPRINTS))).toBe(before);
    });

    test('a history line on the task, under its home project, naming a list of that project', async () => {
        await add('HOME_ONLY', T.TASK, L.HOME_SECOND);

        expect(history()).toHaveLength(1);
        expect(history()[0]).toMatchObject({ Type: 'task', Key: 'Task_Extra_List', UserId: uidOf.HOME_ONLY, TaskId: T.TASK });
        expect(String(history()[0].ProjectId)).toBe(P.HOME);
        expect(history()[0].Message).toBe('<b>Hana Home</b> has added <b>Write the brief</b> to the list <b>Design queue</b>.');
    });

    test.each([
        ['a list in another project', 'OWNER', L.THERE, 'Launch plan', 'a list in another project'],
        ['a private list of the same project', 'HOME_ONLY', L.HOME_PRIVATE, 'Salary review', 'a private list'],
    ])('the history line does not name %s', async (_, who, sprintId, name, phrase) => {
        await add(who, T.TASK, sprintId);
        await remove(who, T.TASK, sprintId);

        expect(history().map((row) => row.Message)).toEqual([
            expect.stringContaining(`has added <b>Write the brief</b> to ${phrase}.`),
            expect.stringContaining(`has removed <b>Write the brief</b> from ${phrase}.`),
        ]);
        history().forEach((row) => expect(row.Message).not.toContain(name));
    });

    test('a name is written as text, never as markup', async () => {
        stored(T.TASK).TaskName = '<img src=x onerror=alert(1)>';
        rows(SCHEMA_TYPE.SPRINTS).find((row) => row._id === L.HOME_SECOND).name = '<script>x</script>';

        await add('HOME_ONLY', T.TASK, L.HOME_SECOND);

        expect(history()[0].Message).not.toMatch(/<img|<script/);
    });
});

describe('removing a task from a list', () => {
    beforeEach(() => place(T.TASK, [[P.ELSEWHERE, L.THERE], [P.OPEN, L.OPEN]]));

    test.each(['OWNER', 'ADMIN', 'ON_BOTH'])('%s can take it out; the other lists and the home stay', async (who) => {
        const res = await remove(who, T.TASK, L.THERE);

        expect(res).toMatchObject({ code: 200, body: { status: true, data: { taskId: T.TASK, extraLists: [{ projectId: P.OPEN, sprintId: L.OPEN, name: 'Open list' }] } } });
        expect(listsOf(T.TASK)).toEqual([L.OPEN]);
        expect([String(stored(T.TASK).ProjectID), String(stored(T.TASK).sprintId)]).toEqual([P.HOME, L.HOME]);
        expect(taskEvents()).toHaveLength(1);
        expect(history()).toHaveLength(1);
    });

    test('the right to move the task at its home is enough, for a list the person cannot open', async () => {
        expect((await remove('HOME_ONLY', T.TASK, L.THERE)).code).toBe(200);
        expect(listsOf(T.TASK)).toEqual([L.OPEN]);
    });

    test('so is the same right in the project of the list, for a person who can read the task', async () => {
        place(T.TASK, [[P.OWN_RULES, L.OWN_RULES], [P.ELSEWHERE, L.THERE]]);
        setRule('task_move', 3, false);
        setRule('task_move', 3, true, P.OWN_RULES);

        expect((await remove('ON_BOTH', T.TASK, L.OWN_RULES)).code).toBe(200);
        expect(await remove('ON_BOTH', T.TASK, L.THERE)).toEqual(NOT_PERMITTED);
        expect(listsOf(T.TASK)).toEqual([L.THERE]);
    });

    test('that right does not count for a private list the person is not on', async () => {
        place(T.TASK, [[P.ELSEWHERE, L.THERE_PRIVATE]]);
        setRule('task_move', 0, true);
        mockWorld.rows(SCHEMA_TYPE.PROJECTS).find((row) => row._id === P.HOME).isGlobalPermission = false;
        mockWorld.db().seed(SCHEMA_TYPE.PROJECT_RULES, { key: 'task', name: 'task', isParent: true, roles: [], projectId: P.HOME, _id: 'home-task' });
        mockWorld.db().seed(SCHEMA_TYPE.PROJECT_RULES, { key: 'task_move', name: 'task_move', isParent: false, parentId: 'home-task', roles: [{ key: 0, permission: null }], projectId: P.HOME });

        expect(await remove('GUEST', T.TASK, L.THERE_PRIVATE)).toEqual(NOT_PERMITTED);
        expect(listsOf(T.TASK)).toEqual([L.THERE_PRIVATE]);
    });

    test.each(['LIST_ONLY', 'OUTSIDER', NO_SEAT])('%s manages the list or nothing, but cannot read the task: it is not there', async (who) => {
        expect(await remove(who, T.TASK, L.THERE)).toEqual(TASK_NOT_FOUND);
        expect(listsOf(T.TASK)).toEqual([L.THERE, L.OPEN]);
    });

    test('a list the task is not in answers the same whether or not it exists', async () => {
        const answer = { code: 404, body: { status: false, statusText: 'The task is not in that list.', code: 'NOT_IN_LIST' } };

        expect(await remove('ON_BOTH', T.TASK, L.HOME_SECOND)).toEqual(answer);
        expect(await remove('ON_BOTH', T.TASK, L.THERE_PRIVATE)).toEqual(answer);
        expect(await remove('ON_BOTH', T.TASK, L.MISSING)).toEqual(answer);
    });

    test('an entry whose list is gone can still be taken out', async () => {
        mockWorld.db().store[SCHEMA_TYPE.SPRINTS] = rows(SCHEMA_TYPE.SPRINTS).filter((row) => row._id !== L.THERE);

        expect((await remove('ON_BOTH', T.TASK, L.THERE)).code).toBe(200);
        expect(history()[0].Message).toContain('from a list in another project.');
    });

    test('a field the action does not take is refused', async () => {
        expect(await remove('OWNER', T.TASK, L.THERE, { projectId: P.ELSEWHERE })).toEqual(ruled('UNKNOWN_FIELD'));
    });
});

describe('adding several tasks to a list', () => {
    test('each task is judged alone, and one that cannot be added is reported', async () => {
        place(T.SECOND, [[P.ELSEWHERE, L.THERE]]);

        const res = await bulkAdd('ON_BOTH', [T.TASK, T.SECOND, T.SUBTASK, T.IN_PRIVATE_SPRINT, T.MISSING, T.TASK], L.THERE);

        expect(res.code).toBe(200);
        expect(res.body).toEqual({
            status: true,
            statusText: 'Bulk operation completed',
            data: {
                projectId: P.ELSEWHERE,
                sprintId: L.THERE,
                added: [T.TASK],
                skipped: [
                    { taskId: T.SECOND, code: 'ALREADY_IN_LIST', reason: expect.any(String) },
                    { taskId: T.SUBTASK, code: 'SUBTASK', reason: expect.any(String) },
                    { taskId: T.IN_PRIVATE_SPRINT, code: 'TASK_NOT_FOUND', reason: 'Task not found' },
                    { taskId: T.MISSING, code: 'TASK_NOT_FOUND', reason: 'Task not found' },
                ],
            },
        });
        expect(listsOf(T.TASK)).toEqual([L.THERE]);
        expect(stored(T.IN_PRIVATE_SPRINT).extraLists).toBeUndefined();
        expect(history()).toHaveLength(1);
        expect(taskEvents()).toHaveLength(1);
    });

    test('a task the person may not move is reported, and the others are added', async () => {
        mockWorld.task(T.SECOND.replace(/..$/, 'f2'), P.OWN_RULES, L.OWN_RULES);

        const res = await bulkAdd('ON_BOTH', [T.SECOND.replace(/..$/, 'f2'), T.TASK], L.OPEN);

        expect(res.body.data).toMatchObject({ added: [T.TASK], skipped: [{ taskId: T.SECOND.replace(/..$/, 'f2'), code: 'NOT_PERMITTED' }] });
    });

    test.each([
        ['a list the person cannot open', 'HOME_ONLY', L.THERE, LIST_NOT_FOUND],
        ['a Scrum sprint', 'OWNER', L.SCRUM, ruled('SCRUM_LIST')],
    ])('%s refuses the whole request', async (_, who, sprintId, answer) => {
        expect(await bulkAdd(who, [T.TASK, T.SECOND], sprintId)).toEqual(answer);
        expect(stored(T.TASK).extraLists).toBeUndefined();
        expect(stored(T.SECOND).extraLists).toBeUndefined();
    });

    test.each([
        ['no tasks', []],
        ['tasks that are not ids', ['one']],
        ['more tasks than one request takes', Array.from({ length: 501 }, (_, at) => T.TASK.replace(/....$/, (0x1000 + at).toString(16)))],
    ])('%s is refused', async (_, taskIds) => {
        expect((await bulkAdd('OWNER', taskIds, L.THERE)).code).toBe(400);
    });

    test('a field the action does not take is refused', async () => {
        expect(await bulkAdd('OWNER', [T.TASK], L.THERE, { projectData: { id: P.ELSEWHERE } })).toEqual(ruled('UNKNOWN_FIELD'));
    });
});

describe('a token limited to some projects', () => {
    const as = (who, projectIds, action) => runNarrowed({ userId: uidOf[who], projectIds }, () => taskMongo[action.name]({ companyId: COMPANY, userData: { id: uidOf[who], Employee_Name: 'Token' }, ...action.payload }).then((data) => ({ data }), (error) => ({ statusCode: error.statusCode, code: error.code, message: error.message })));
    const adding = { name: 'addToList', payload: { taskId: T.TASK, sprintId: L.THERE } };
    const removing = { name: 'removeFromList', payload: { taskId: T.TASK, sprintId: L.THERE } };

    test('cannot reach the task write routes at all', async () => {
        const res = { statusCode: 200 };
        res.status = (code) => { res.statusCode = code; return res; };
        res.json = (body) => { res.body = body; return res; };
        const next = jest.fn();

        await holdNarrowedToken({ method: 'PATCH', originalUrl: '/api/v2/tasks', headers: { companyid: COMPANY }, uid: uidOf.OWNER, apiToken: { userId: uidOf.OWNER, projectIds: [P.HOME, P.ELSEWHERE] }, body: { action: 'addToList' } }, res, next);

        expect(next).not.toHaveBeenCalled();
        expect(res).toMatchObject({ statusCode: 403, body: { status: false, code: 'token_limited_to_projects' } });
    });

    test('needs both the home project and the project of the list', async () => {
        expect(await as('OWNER', [P.HOME], adding)).toMatchObject({ statusCode: 404, code: 'LIST_NOT_FOUND' });
        expect(await as('OWNER', [P.ELSEWHERE], adding)).toMatchObject({ statusCode: 404, message: 'Task not found' });
        expect(stored(T.TASK).extraLists).toBeUndefined();

        expect((await as('OWNER', [P.HOME, P.ELSEWHERE], adding)).data.extraLists).toHaveLength(1);
    });

    test('cannot remove a task whose home is outside it, and names no list outside it', async () => {
        place(T.TASK, [[P.ELSEWHERE, L.THERE], [P.HOME, L.HOME_SECOND]]);

        expect(await as('OWNER', [P.ELSEWHERE], removing)).toMatchObject({ statusCode: 404, message: 'Task not found' });
        const kept = await as('OWNER', [P.HOME], { name: 'removeFromList', payload: { taskId: T.TASK, sprintId: L.HOME_SECOND } });
        expect(kept.data.extraLists).toEqual([{ projectId: P.ELSEWHERE, sprintId: L.THERE, addedBy: uidOf.OWNER, addedAt: expect.any(Date) }]);
    });
});

describe('the permission guard in front of the routes', () => {
    beforeEach(() => { process.env.PERMISSION_ENFORCEMENT_MODE = 'enforce'; });

    test('judges the three actions by the key that moves a task, in the task\'s home project', () => {
        const judged = (action) => [requirementsOf(TASK_ACTIONS[action], {}).map((need) => `${need.key}:${need.write ? 'write' : 'read'}`), TASK_ACTIONS[action].tasks];

        expect(judged('addToList')).toEqual([['task.task_move:write'], [['taskId']]]);
        expect(judged('bulkAddToList')).toEqual([['task.task_move:write'], [['taskIds', '*']]]);
        expect(judged('removeFromList')).toEqual([['task.task_list:read'], [['taskId']]]);
    });

    test('refuses a person whose role may not move tasks at the home, before the handler', async () => {
        setRule('task_move', 3, false);

        expect(await add('ON_BOTH', T.TASK, L.THERE)).toMatchObject({ code: 403, body: { status: false, error: 'Forbidden', permission: 'task.task_move' } });
        expect(await bulkAdd('ON_BOTH', [T.TASK], L.THERE)).toMatchObject({ code: 403, body: { permission: 'task.task_move' } });
        expect(mockWorld.rows('permission_decisions').length).toBeGreaterThan(0);
    });

    test('lets the people through whom the rules allow, and they are still judged at the list', async () => {
        expect((await add('ON_BOTH', T.TASK, L.THERE)).code).toBe(200);
        expect(await add('HOME_ONLY', T.TASK, L.THERE_PRIVATE)).toEqual(LIST_NOT_FOUND);
        expect((await remove('ON_BOTH', T.TASK, L.THERE)).code).toBe(200);
    });

    test('an API token naming another company is refused', async () => {
        const res = await call(PATCH, uidOf.OWNER, { apiToken: { _id: 't' }, body: { action: 'addToList', taskId: T.TASK, sprintId: L.THERE, companyId: OTHER_COMPANY } });

        expect(res.code).toBe(403);
        expect(stored(T.TASK).extraLists).toBeUndefined();
    });
});

test('the global database holds no task, list or project row', () => {
    expect(Object.keys(mockWorld.dbFor(GLOBAL).store).sort()).toEqual(['companies', SCHEMA_TYPE.USERS].sort());
});
