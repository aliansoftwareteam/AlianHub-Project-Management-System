/* Task 046 M3, slice L3: the writers that move or convert a task keep its extra lists right. The
   handlers are the real ones over the fake database of the extra-list tests; the stored form of
   the two updates is read from what Mongoose hands the driver under the real task schema. */
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

const { COMPANY, uidOf, P, L, T, settle, routeCaller, routesOf } = require('./fixtures/extraListsWorld');
const { driverWrites, isObjectId } = require('./fixtures/realTaskStore');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const socketEmitter = require('../event/socketEventEmitter');
const mongoHelper = require('../Modules/Tasks/helpers/mongo_helper');
const { taskMongo } = require('../Modules/Tasks/helpers/task_class_Mongo');
const { afterHomeMove, pullOfLists } = require('../Modules/Tasks/helpers/taskExtraLists');

const call = routeCaller(routesOf(path.join(__dirname, '../Modules/Tasks/routes')));
const { stored, listsOf, place, rows } = mockWorld;

const USER = { id: uidOf.OWNER, Employee_Name: 'Olive Owner', companyOwnerId: uidOf.OWNER };
const STATUS_LIST = [{ key: 1, name: 'To Do', type: 'default_active', convertStatus: { key: 1, name: 'To Do', type: 'default_active' } }];
const TYPE_LIST = [{ key: 1, value: 'task', name: 'Task', convertType: { key: 1, value: 'task', name: 'Task' } }];
const projectOf = (id) => ({ id, _id: id, ProjectName: `Project ${id.slice(-2)}`, ProjectCode: 'PRJ', taskStatusData: STATUS_LIST, taskTypeCounts: TYPE_LIST });
const listOf = (id) => ({ id, name: `List ${id.slice(-2)}` });

const move = async (taskId, projectId, sprintId) => {
    const task = stored(taskId);
    const res = await taskMongo.moveTask({
        companyId: COMPANY, projectData: projectOf(projectId), sprintObj: listOf(sprintId), moveTaskId: taskId, oldSprintObj: listOf(String(task.sprintId)),
        oldProject: projectOf(String(task.ProjectID)), isSubTask: false, assignee: [], watcher: [], userData: USER,
    });
    await settle();
    return res;
};
const toSubTask = async (taskId, parentId) => {
    const res = await taskMongo.convertToSubTask({
        companyId: COMPANY, projectData: projectOf(P.HOME), sprintId: L.HOME, selectedTaskId: taskId, taskId: parentId, oldProject: projectOf(P.HOME), isSubTask: false, userData: USER,
    });
    await settle();
    return res;
};
const setState = async (taskId, deletedStatusKey) => {
    await taskMongo.updateArchiveDelete({ companyId: COMPANY, projectData: projectOf(P.HOME), task: { _id: taskId }, userData: USER, deletedStatusKey });
    await settle();
};

const extraListLines = () => rows(SCHEMA_TYPE.HISTORY).filter((row) => row.Key === 'Task_Extra_List' || row.key === 'Task_Extra_List');
const lastUpdateOf = (taskId) => socketEmitter.emit.mock.calls
    .filter(([name, payload]) => name === 'update' && payload.module === 'task' && payload.data && String(payload.data._id) === taskId)
    .map(([, payload]) => payload).pop();

beforeEach(() => {
    mockWorld.reset();
    jest.clearAllMocks();
});

describe('moving a task\'s home', () => {
    test('into a list it is already in takes that list out of its extra lists and keeps the others', async () => {
        place(T.TASK, [[P.HOME, L.HOME_SECOND], [P.ELSEWHERE, L.THERE]]);

        const res = await move(T.TASK, P.HOME, L.HOME_SECOND);

        expect(res.status).toBe(true);
        expect(String(stored(T.TASK).sprintId)).toBe(L.HOME_SECOND);
        expect(listsOf(T.TASK)).toEqual([L.THERE]);
        expect(lastUpdateOf(T.TASK).updatedFields.extraLists.map((entry) => String(entry.sprintId))).toEqual([L.THERE]);
        expect(extraListLines()).toEqual([]);
    });

    test('in bulk does the same', async () => {
        place(T.TASK, [[P.HOME, L.HOME_SECOND], [P.ELSEWHERE, L.THERE]]);
        place(T.SECOND, [[P.ELSEWHERE, L.THERE]]);

        await taskMongo.bulkMove({ companyId: COMPANY, userData: USER, taskIds: [T.TASK, T.SECOND], sprintObj: listOf(L.HOME_SECOND), projectData: projectOf(P.HOME) });
        await settle();

        expect([T.TASK, T.SECOND].map((id) => String(stored(id).sprintId))).toEqual([L.HOME_SECOND, L.HOME_SECOND]);
        expect([listsOf(T.TASK), listsOf(T.SECOND)]).toEqual([[L.THERE], [L.THERE]]);
    });

    test('names the new home in the same update even when the row read holds no entry, so one added meanwhile goes too', async () => {
        const left = await afterHomeMove(COMPANY, stored(T.TASK), { projectId: P.HOME, sprintId: L.HOME_SECOND });

        expect(left.dropped).toEqual([]);
        expect(left.pull.extraLists.sprintId.$in.map(String)).toEqual([L.HOME_SECOND]);
    });

    test('inside one project keeps every other entry without judging it again', async () => {
        place(T.TASK, [[P.ELSEWHERE, L.SCRUM], [P.CLOSED, L.CLOSED]]);

        await move(T.TASK, P.HOME, L.HOME_SECOND);

        expect(listsOf(T.TASK)).toEqual([L.SCRUM, L.CLOSED]);
    });

    test('to another project keeps an entry only where the rules still allow it', async () => {
        place(T.TASK, [
            [P.HOME, L.HOME_SECOND], [P.ELSEWHERE, L.THERE], [P.ELSEWHERE, L.THERE_PRIVATE], [P.ELSEWHERE, L.DELETED], [P.ELSEWHERE, L.ARCHIVED],
            [P.ELSEWHERE, L.SCRUM], [P.ELSEWHERE, L.BACKLOG], [P.CLOSED, L.CLOSED], [P.GONE, L.GONE], [P.PERSONAL_MINE, L.PERSONAL_MINE], [P.ELSEWHERE, L.MISSING],
        ]);

        await move(T.TASK, P.OPEN, L.OPEN);

        expect(String(stored(T.TASK).ProjectID)).toBe(P.OPEN);
        expect(listsOf(T.TASK)).toEqual([L.HOME_SECOND, L.THERE, L.THERE_PRIVATE, L.DELETED, L.ARCHIVED]);
    });

    test('to another project drops the entry of the list it lands in without a line of its own', async () => {
        place(T.TASK, [[P.ELSEWHERE, L.THERE], [P.HOME, L.HOME_SECOND]]);

        await move(T.TASK, P.ELSEWHERE, L.THERE);

        expect(listsOf(T.TASK)).toEqual([L.HOME_SECOND]);
        expect(extraListLines()).toEqual([]);
    });

    test('to a personal project leaves the task in no extra list', async () => {
        place(T.TASK, [[P.HOME, L.HOME_SECOND], [P.ELSEWHERE, L.THERE]]);

        await move(T.TASK, P.PERSONAL_MINE, L.PERSONAL_MINE);

        expect(listsOf(T.TASK)).toEqual([]);
    });

    test('records the dropped lists, naming one only when it is in the new home project and not private', async () => {
        stored(T.TASK).TaskName = 'Write <the> brief';
        rows(SCHEMA_TYPE.SPRINTS).find((row) => row._id === L.BACKLOG).private = true;
        rows(SCHEMA_TYPE.SPRINTS).find((row) => row._id === L.SCRUM).name = 'Sprint <7>';
        place(T.TASK, [[P.ELSEWHERE, L.SCRUM], [P.ELSEWHERE, L.BACKLOG], [P.CLOSED, L.CLOSED], [P.HOME, L.HOME_SECOND]]);

        await move(T.TASK, P.ELSEWHERE, L.THERE);

        const lines = extraListLines();
        expect(lines).toHaveLength(1);
        const message = lines[0].Message || lines[0].message;
        expect(message).toBe('<b>Write &lt;the&gt; brief</b> moved to another project and is no longer in the list <b>Sprint &lt;7&gt;</b>, a private list, a list in another project.');
        expect(String(lines[0].ProjectId || lines[0].projectId)).toBe(P.ELSEWHERE);
    });
});

describe('converting', () => {
    test('a task to a subtask clears its extra lists', async () => {
        place(T.SECOND, [[P.HOME, L.HOME_SECOND], [P.ELSEWHERE, L.THERE]]);

        const res = await toSubTask(T.SECOND, T.TASK);

        expect(res.status).toBe(true);
        expect(stored(T.SECOND)).toMatchObject({ ParentTaskId: T.TASK, isParentTask: false });
        expect(stored(T.SECOND)).not.toHaveProperty('extraLists');
        expect(lastUpdateOf(T.SECOND).updatedFields.extraLists).toEqual([]);
    });

    test('several tasks to subtasks clears them on each', async () => {
        place(T.SECOND, [[P.ELSEWHERE, L.THERE]]);

        await taskMongo.bulkConvertToSubTask({ companyId: COMPANY, userData: USER, taskIds: [T.SECOND], parentTaskId: T.TASK });
        await settle();

        expect(stored(T.SECOND).ParentTaskId).toBe(T.TASK);
        expect(stored(T.SECOND)).not.toHaveProperty('extraLists');
    });

    test('a subtask to a task starts with none, whatever the stored row held', async () => {
        place(T.SUBTASK, [[P.ELSEWHERE, L.THERE]]);

        await taskMongo.convertToTask({
            companyId: COMPANY, projectData: projectOf(P.HOME), taskId: T.SUBTASK, sprintObj: listOf(L.HOME_SECOND), parentTaskId: T.TASK,
            oldSprintObj: listOf(L.HOME), oldProject: projectOf(P.HOME),
        });
        await settle();

        expect(stored(T.SUBTASK)).toMatchObject({ ParentTaskId: '', isParentTask: true });
        expect(stored(T.SUBTASK)).not.toHaveProperty('extraLists');
    });

    test('a task to a list: its subtasks become tasks of the new list with none', async () => {
        place(T.SUBTASK, [[P.ELSEWHERE, L.THERE]]);

        await mongoHelper.convertToListSubTask(COMPANY, projectOf(P.HOME), stored(T.SUBTASK), { _id: L.HOME_SECOND, name: 'Design queue' }, listOf(L.HOME));
        await settle();

        expect(String(stored(T.SUBTASK).sprintId)).toBe(L.HOME_SECOND);
        expect(stored(T.SUBTASK)).not.toHaveProperty('extraLists');
    });
});

describe('what leaves the entries alone', () => {
    test.each([['the trash', 1], ['the archive', 2]])('a task sent to %s and restored keeps its extra lists', async (_, deletedStatusKey) => {
        place(T.TASK, [[P.HOME, L.HOME_SECOND], [P.ELSEWHERE, L.THERE]]);

        await setState(T.TASK, deletedStatusKey);
        expect(stored(T.TASK).deletedStatusKey).toBe(deletedStatusKey);
        expect(listsOf(T.TASK)).toEqual([L.HOME_SECOND, L.THERE]);

        await setState(T.TASK, 0);
        expect(stored(T.TASK).deletedStatusKey).toBe(0);
        expect(listsOf(T.TASK)).toEqual([L.HOME_SECOND, L.THERE]);
    });

    test('a merge: the kept task keeps its own, and the merged task keeps its own in the trash', async () => {
        place(T.TASK, [[P.HOME, L.HOME_SECOND]]);
        place(T.SECOND, [[P.ELSEWHERE, L.THERE]]);

        await taskMongo.mergeTask({ companyId: COMPANY, projectData: projectOf(P.HOME), taskId: T.TASK, mergeTaskId: T.SECOND, oldProject: projectOf(P.HOME), isSubTask: false, userData: USER });
        await settle();

        expect([stored(T.TASK).deletedStatusKey, stored(T.SECOND).deletedStatusKey].sort()).toEqual([0, 1]);
        expect([listsOf(T.TASK), listsOf(T.SECOND)]).toEqual([[L.HOME_SECOND], [L.THERE]]);
    });

    test('a list sent to the trash keeps its entry, shown without a name until the list is restored', async () => {
        place(T.TASK, [[P.ELSEWHERE, L.THERE]]);
        const list = rows(SCHEMA_TYPE.SPRINTS).find((row) => row._id === L.THERE);
        const read = () => call('GET /api/v2/tasks/:id/lists', uidOf.OWNER, { params: { id: T.TASK } });

        list.deletedStatusKey = 1;
        const trashed = await read();
        expect(listsOf(T.TASK)).toEqual([L.THERE]);
        expect(trashed.body.data.extraLists).toEqual([expect.objectContaining({ sprintId: L.THERE })]);
        expect(trashed.body.data.extraLists[0]).not.toHaveProperty('name');

        list.deletedStatusKey = 0;
        expect((await read()).body.data.extraLists).toEqual([expect.objectContaining({ sprintId: L.THERE, name: 'Launch plan' })]);
    });
});

describe('the stored form of the two updates', () => {
    test('the pull of a move reaches the driver with list ids as ObjectIds', async () => {
        const { writes, error } = await driverWrites('findOneAndUpdate', [{ _id: T.TASK }, { $set: { sprintId: L.HOME_SECOND }, $pull: pullOfLists([L.HOME_SECOND, L.THERE]) }, { returnDocument: 'after' }]);

        expect(error).toBeNull();
        const ids = writes[0].args[1].$pull.extraLists.sprintId.$in;
        expect(ids.map(String)).toEqual([L.HOME_SECOND, L.THERE]);
        ids.forEach((id) => expect(isObjectId(id)).toBe(true));
    });

    test('the unset of a convert reaches the driver', async () => {
        const { writes, error } = await driverWrites('findOneAndUpdate', [{ _id: T.TASK }, { $set: { isParentTask: false }, $unset: { cascadedBy: '', extraLists: '' } }, { returnDocument: 'after' }]);

        expect(error).toBeNull();
        expect(writes[0].args[1].$unset).toHaveProperty('extraLists');
    });
});
