const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (companyId, q, method) => mockDb.crud(companyId, q, method),
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
jest.mock('../utils/planHelper', () => mockStub());
jest.mock('../utils/commonFunctions.js', () => mockStub());
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../common-storage/common-server.js', () => mockStub());
process.env.STORAGE_TYPE = 'server';

const mongoHelper = require('../Modules/Tasks/helpers/mongo_helper');
const { SCHEMA_TYPE } = require('../Config/schemaType');

mongoHelper.getTotalSprintCount = async () => true;

const CID = '6f00000000000000000000c1';
const OWNER = '6f0000000000000000000001';
const ADMIN = '6f0000000000000000000002';
const ON_PROJECT = '6f0000000000000000000003';
const ALSO_ON_PROJECT = '6f0000000000000000000004';
const THROUGH_TEAM = '6f0000000000000000000005';
const NOT_ON_PROJECT = '6f0000000000000000000006';
const SEAT_ENDED = '6f0000000000000000000007';
const TEAM = '6f0000000000000000000d01';
const OPEN_PROJECT = '6f0000000000000000000a01';
const PRIVATE_PROJECT = '6f0000000000000000000a02';
const PERSONAL_PROJECT = '6f0000000000000000000a03';
const SPRINT = '6f0000000000000000000e01';
const PRIVATE_SPRINT = '6f0000000000000000000e02';
const PERSONAL_SPRINT = '6f0000000000000000000e03';
const TASK = '6f0000000000000000000b01';

const CANNOT_OPEN = 'Only people who can open the project a copy lands in can be copied to it.';
const EVERYTHING = ['Copy Assignees', 'Copy Watchers'];

const settle = async () => { for (let i = 0; i < 30; i += 1) await new Promise((resolve) => setImmediate(resolve)); };

const routesOf = (modulePath) => {
    const table = {};
    const register = (method) => (routePath, ...handlers) => { table[`${method} ${routePath}`] = handlers[handlers.length - 1]; };
    const app = { get: register('GET'), post: register('POST'), put: register('PUT'), patch: register('PATCH'), delete: register('DELETE'), use: register('USE') };
    require(modulePath).init(app);
    return table;
};
const ROUTES = routesOf('../Modules/Tasks/routes');

const call = (route, body) => new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ code: 'no answer' }), 1000);
    const res = { statusCode: 200 };
    res.status = (code) => { res.statusCode = code; return res; };
    res.send = (answer) => { clearTimeout(timer); resolve({ code: res.statusCode, body: answer }); return res; };
    res.json = res.send;
    const [method, path] = route.split(' ');
    ROUTES[route]({ method, path, originalUrl: path, headers: { companyid: CID }, aud: CID, uid: OWNER, body }, res, () => resolve({ code: 'next' }));
}).then(async (result) => { await settle(); return result; });

const STATUS_LIST = [{ key: 1, name: 'To Do', type: 'default_active', convertStatus: { key: 1, name: 'To Do', type: 'default_active' } }];
const TYPE_LIST = [{ key: 1, value: 'task', name: 'Task', taskCount: 0, convertType: { key: 1, value: 'task', name: 'Task' } }];

const DESTINATIONS = {
    [OPEN_PROJECT]: { code: 'OPN', name: 'Open', sprint: SPRINT },
    [PRIVATE_PROJECT]: { code: 'PRV', name: 'Private', sprint: PRIVATE_SPRINT },
    [PERSONAL_PROJECT]: { code: 'MINE', name: 'Mine', sprint: PERSONAL_SPRINT },
};

const seat = (userId, roleType, extra = {}) => mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId, roleType, status: 2, isDelete: false, ...extra });
const project = (_id, extra = {}) => mockDb.seed('projects', {
    _id, ProjectName: DESTINATIONS[_id].name, ProjectCode: DESTINATIONS[_id].code, CompanyId: CID, lastTaskId: 4, taskStatusData: STATUS_LIST, taskTypeCounts: TYPE_LIST, ...extra,
});

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    project(OPEN_PROJECT);
    project(PRIVATE_PROJECT, { isPrivateSpace: true, AssigneeUserId: [ON_PROJECT, ALSO_ON_PROJECT, `tId_${TEAM}`] });
    project(PERSONAL_PROJECT, { isPersonal: true, personalOwner: OWNER });
    mockDb.seed(SCHEMA_TYPE.TEAMS_MANAGEMENT, { _id: TEAM, name: 'Design', assigneeUsersArray: [THROUGH_TEAM] });
    mockDb.seed(SCHEMA_TYPE.USERS, { _id: OWNER, Employee_Name: 'Olivia Owner' });
    seat(OWNER, 1);
    seat(ADMIN, 2);
    [ON_PROJECT, ALSO_ON_PROJECT, THROUGH_TEAM, NOT_ON_PROJECT].forEach((id) => seat(id, 3));
    seat(SEAT_ENDED, 3, { status: 3 });
    Object.entries(DESTINATIONS).forEach(([projectId, { sprint }]) => mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: sprint, name: 'Sprint 1', projectId }));
    mockDb.seed('tasks', {
        _id: TASK, TaskName: 'Write the brief', TaskKey: 'OPN-1', ProjectID: OPEN_PROJECT, CompanyId: CID, sprintId: SPRINT,
        sprintArray: { id: SPRINT, name: 'Sprint 1' }, status: { key: 1, text: 'To Do', type: 'default_active' }, statusKey: 1, statusType: 'default_active',
        TaskType: 'task', TaskTypeKey: 1, Task_Priority: 'MEDIUM', Task_Leader: OWNER, isParentTask: true, ParentTaskId: '', subTasks: 0, deletedStatusKey: 0,
        AssigneeUserId: [ON_PROJECT, ALSO_ON_PROJECT, NOT_ON_PROJECT, SEAT_ENDED], watchers: [ON_PROJECT, NOT_ON_PROJECT], tagsArray: [], attachments: [],
        checklistArray: [], createdBy: OWNER, createdAt: '2026-01-01T00:00:00.000Z',
    });
});

const placement = (projectId) => ({
    companyId: CID,
    projectData: { id: projectId, ProjectCode: DESTINATIONS[projectId].code, ProjectName: DESTINATIONS[projectId].name },
    sprintObj: { id: DESTINATIONS[projectId].sprint, name: 'Sprint 1' },
    oldProject: { id: OPEN_PROJECT, taskTypeCounts: TYPE_LIST, taskStatusData: STATUS_LIST, ProjectName: 'Open' },
    isSubTask: false, taskName: 'Copy', oldSprintObj: { name: 'Sprint 1', folderName: '' },
});

const duplicate = (projectId, people, duplicateData = EVERYTHING) => call('PATCH /api/v2/tasks', {
    action: 'duplicateTask', ...placement(projectId), selectedTaskId: TASK, duplicateData, ...people,
});
const duplicateInBulk = (projectId, people, duplicateData = EVERYTHING) => call('POST /api/v2/tasks/bulk', {
    action: 'bulkDuplicate', ...placement(projectId), taskIds: [TASK], duplicateData, ...people,
});

const copies = () => mockDb.store.tasks.filter((task) => String(task._id) !== TASK);
const peopleOn = (task) => ({ assignee: [...(task.AssigneeUserId || [])].map(String), watcher: [...(task.watchers || [])].map(String) });

describe('the people on a duplicated task', () => {
    it('are the assignees and watchers the request names, not everyone on the original', async () => {
        const chosen = { assignee: [ON_PROJECT, ALSO_ON_PROJECT], watcher: [ON_PROJECT] };

        expect((await duplicate(PRIVATE_PROJECT, chosen)).code).toBe(200);

        expect(copies()).toHaveLength(1);
        expect(peopleOn(copies()[0])).toEqual(chosen);
        expect(String(copies()[0].ProjectID)).toBe(PRIVATE_PROJECT);
    });

    it('include an admin and a team member of a private project', async () => {
        const chosen = { assignee: [ADMIN, THROUGH_TEAM], watcher: [OWNER] };

        expect((await duplicate(PRIVATE_PROJECT, chosen)).code).toBe(200);

        expect(peopleOn(copies()[0])).toEqual(chosen);
    });

    it('are any active members in a public project', async () => {
        const chosen = { assignee: [NOT_ON_PROJECT, ON_PROJECT], watcher: [THROUGH_TEAM] };

        expect((await duplicate(OPEN_PROJECT, chosen)).code).toBe(200);

        expect(peopleOn(copies()[0])).toEqual(chosen);
    });

    it('are nobody when the copy options leave them out', async () => {
        expect((await duplicate(PRIVATE_PROJECT, { assignee: [ON_PROJECT], watcher: [ON_PROJECT] }, [])).code).toBe(200);

        expect(peopleOn(copies()[0])).toEqual({ assignee: [], watcher: [] });
    });

    it.each([
        ['an assignee outside a private project', PRIVATE_PROJECT, { assignee: [ON_PROJECT, NOT_ON_PROJECT], watcher: [] }],
        ['a watcher outside a private project', PRIVATE_PROJECT, { assignee: [ON_PROJECT], watcher: [NOT_ON_PROJECT] }],
        ['an assignee whose seat ended', OPEN_PROJECT, { assignee: [SEAT_ENDED], watcher: [] }],
        ['anyone but the owner of a personal project', PERSONAL_PROJECT, { assignee: [ADMIN], watcher: [] }],
    ])('refuses %s and copies nothing', async (_label, projectId, people) => {
        const answer = await duplicate(projectId, people);

        expect(answer).toMatchObject({ code: 400, body: { status: false, statusText: CANNOT_OPEN } });
        expect(copies()).toEqual([]);
    });

    it('accepts the owner on their personal project', async () => {
        expect((await duplicate(PERSONAL_PROJECT, { assignee: [OWNER], watcher: [OWNER] })).code).toBe(200);

        expect(peopleOn(copies()[0])).toEqual({ assignee: [OWNER], watcher: [OWNER] });
    });
});

describe('the people on a task duplicated from a list row', () => {
    it('are the ones the request names', async () => {
        const chosen = { assignee: [ON_PROJECT, ALSO_ON_PROJECT], watcher: [ON_PROJECT] };

        expect((await duplicateInBulk(PRIVATE_PROJECT, chosen)).body.status).toBe(true);

        expect(peopleOn(copies()[0])).toEqual(chosen);
    });

    it('cannot include someone outside the project', async () => {
        const answer = await duplicateInBulk(PRIVATE_PROJECT, { assignee: [NOT_ON_PROJECT], watcher: [] });

        expect(answer).toMatchObject({ code: 400, body: { status: false, statusText: CANNOT_OPEN } });
        expect(copies()).toEqual([]);
    });
});

describe('the linked tasks and the votes of a duplicated task', () => {
    const CLIENT = '6f0000000000000000000f01';
    const VOTES = '6f0000000000000000000f02';
    const SUBTASK = '6f0000000000000000000b02';
    const OUTSIDE = '6f0000000000000000000b03';
    const UNSEEN = '6f0000000000000000000b04';
    const links = () => mockDb.store[SCHEMA_TYPE.CUSTOM_FIELD_LINKS] || [];
    const linksOf = (taskId) => links().filter((row) => row.taskId === String(taskId));

    beforeEach(() => {
        const field = (_id, fieldType) => mockDb.seed(SCHEMA_TYPE.CUSTOM_FIELDS, { _id, fieldTitle: fieldType, fieldType, type: 'task', global: true, isDelete: true });
        field(CLIENT, 'relationship');
        field(VOTES, 'voting');
        const original = mockDb.store.tasks.find((task) => task._id === TASK);
        Object.assign(mockDb.store.projects.find((row) => row._id === OPEN_PROJECT), { isPrivateSpace: false });
        Object.assign(original, { subTasks: 1, customField: { [CLIENT]: { _id: CLIENT, fieldValue: '', revision: 3 }, [VOTES]: { _id: VOTES, fieldValue: 2, revision: 3 } } });
        const row = (_id, TaskName, extra = {}) => mockDb.seed('tasks', { ...original, _id, TaskName, TaskKey: `OPN-${_id.slice(-1)}`, subTasks: 0, customField: {}, AssigneeUserId: [], watchers: [], ...extra });
        row(SUBTASK, 'Check the brief', { isParentTask: false, ParentTaskId: TASK, ancestors: [TASK] });
        row(OUTSIDE, 'Outside');
        row(UNSEEN, 'Unseen', { ProjectID: PERSONAL_PROJECT, sprintId: PERSONAL_SPRINT });
        mockDb.store.projects.find((row) => row._id === PERSONAL_PROJECT).personalOwner = ADMIN;
        mockDb.seed(SCHEMA_TYPE.CUSTOM_FIELD_LINKS, { taskId: TASK, fieldId: CLIENT, kind: 'relationship', ids: [SUBTASK, OUTSIDE, UNSEEN] });
        mockDb.seed(SCHEMA_TYPE.CUSTOM_FIELD_LINKS, { taskId: SUBTASK, fieldId: CLIENT, kind: 'relationship', ids: [TASK] });
        mockDb.seed(SCHEMA_TYPE.CUSTOM_FIELD_LINKS, { taskId: TASK, fieldId: VOTES, kind: 'voting', ids: [OWNER, ADMIN] });
    });

    it('follow the copy: a link to a copied subtask points at its copy, a link outside is kept when the person copying can open it', async () => {
        const result = await call('PATCH /api/v2/tasks', { action: 'duplicateTask', ...placement(OPEN_PROJECT), isSubTask: true, selectedTaskId: TASK, duplicateData: [] });
        expect(result.code).toBe(200);

        const copied = mockDb.store.tasks.filter((task) => ![TASK, SUBTASK, OUTSIDE, UNSEEN].includes(String(task._id)));
        const top = copied.find((task) => task.isParentTask === true);
        const under = copied.find((task) => String(task.ParentTaskId) === String(top._id));
        expect(linksOf(top._id)).toEqual([expect.objectContaining({ fieldId: CLIENT, kind: 'relationship', ids: [String(under._id), OUTSIDE] })]);
        expect(linksOf(under._id)).toEqual([expect.objectContaining({ fieldId: CLIENT, ids: [String(top._id)] })]);
        expect(top.customField).toEqual({ [CLIENT]: { _id: CLIENT, fieldValue: '', revision: expect.any(Number) } });
        expect(linksOf(TASK).map((row) => row.ids)).toEqual([[SUBTASK, OUTSIDE, UNSEEN], [OWNER, ADMIN]]);
    });

    it('are carried without the subtasks too, and the votes never are', async () => {
        const result = await duplicate(OPEN_PROJECT, {}, []);
        expect(result.code).toBe(200);

        const [copy] = mockDb.store.tasks.filter((task) => ![TASK, SUBTASK, OUTSIDE, UNSEEN].includes(String(task._id)));
        expect(linksOf(copy._id)).toEqual([expect.objectContaining({ fieldId: CLIENT, ids: [SUBTASK, OUTSIDE] })]);
        expect(copy.customField[VOTES]).toBeUndefined();
    });
});
