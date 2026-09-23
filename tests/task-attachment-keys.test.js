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

const logger = require('../Config/loggerConfig');
const mongoHelper = require('../Modules/Tasks/helpers/mongo_helper');
const { handleTaskAttachmentsDuplicateFunctionality: copyStoredFile } = require('../common-storage/common-server.js');
const { SCHEMA_TYPE } = require('../Config/schemaType');

mongoHelper.getTotalSprintCount = async () => true;

const CID = '6f00000000000000000000c1';
const OWNER = '6f0000000000000000000001';
const COLLEAGUE = '6f0000000000000000000004';
const PROJECT = '6f0000000000000000000a01';
const SPRINT = '6f0000000000000000000e01';
const OTHER_SPRINT = '6f0000000000000000000e02';
const TASK = '6f0000000000000000000b01';
const OTHER_TASK = '6f0000000000000000000b02';
const FORM = '6f0000000000000000000f01';
const OTHER_FORM = '6f0000000000000000000f02';

const own = `Project/${PROJECT}/Sprint/${TASK}/Attachment/spec.pdf`;
const foreign = `Project/${PROJECT}/Sprint/${OTHER_TASK}/Attachment/secret.pdf`;
const formUpload = (form = FORM) => `formAttachment/${form}/abcdef0123456789abcdef01.pdf`;

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

const taskDoc = (_id, extra = {}) => ({
    _id, TaskName: `Task ${_id.slice(-2)}`, TaskKey: 'PAR-1', ProjectID: PROJECT, CompanyId: CID, sprintId: SPRINT,
    sprintArray: { id: SPRINT, name: 'Sprint 1', folderName: '' }, status: { key: 1, text: 'To Do', type: 'default_active' },
    statusKey: 1, statusType: 'default_active', TaskType: 'task', TaskTypeKey: 1, Task_Priority: 'MEDIUM', Task_Leader: OWNER,
    isParentTask: true, ParentTaskId: '', subTasks: 0, deletedStatusKey: 0, AssigneeUserId: [], watchers: [], tagsArray: [],
    attachments: [], checklistArray: [], createdBy: OWNER, createdAt: '2026-01-01T00:00:00.000Z', ...extra,
});

let submission;

beforeEach(() => {
    process.env.STORAGE_DOWNLOAD_SCOPE = 'enforce';
    logger.warn.mockClear();
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    copyStoredFile.mockClear();
    mockDb.seed('projects', { _id: PROJECT, ProjectName: 'Parity', ProjectCode: 'PAR', CompanyId: CID, lastTaskId: 4, taskStatusData: STATUS_LIST, taskTypeCounts: TYPE_LIST });
    mockDb.seed(SCHEMA_TYPE.USERS, { _id: OWNER, Employee_Name: 'Olivia Owner' });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: OWNER, roleType: 1, status: 2, isDelete: false });
    submission = mockDb.seed(SCHEMA_TYPE.FORM_SUBMISSIONS, { formId: FORM, taskId: TASK });
    mockDb.seed('tasks', taskDoc(TASK));
    mockDb.seed('tasks', taskDoc(OTHER_TASK));
});

const storedTask = (id) => JSON.parse(JSON.stringify(mockDb.store.tasks.find((task) => String(task._id) === id)));
const fileTask = (origin) => { mockDb.store.tasks.find((task) => String(task._id) === TASK).origin = origin; };

const attach = (url) => call('PATCH /api/v2/tasks', {
    action: 'updateAttachments', companyId: CID, sprintId: SPRINT, taskId: TASK, taskData: { _id: TASK, ProjectID: PROJECT, attachments: [] },
    id: '', operation: 'add', data: { id: 'a1', filename: 'f.pdf', url }, projectData: { id: PROJECT, ProjectName: 'Parity' },
});

const create = (attachments) => {
    const data = taskDoc('6f0000000000000000000b09', { attachments, TaskKey: '-' });
    ['_id', 'createdBy', 'createdAt'].forEach((field) => { delete data[field]; });
    return call('POST /api/v2/tasks', { action: 'create', data, user: { id: OWNER }, projectData: { _id: PROJECT, id: PROJECT, CompanyId: CID, ProjectCode: 'PAR', taskTypeCounts: TYPE_LIST }, indexObj: {} });
};

const REFUSAL = { code: 400, body: { status: false, code: 'ATTACHMENT_KEY_NOT_OWN' } };
const urls = (id) => storedTask(id).attachments.map((item) => item.url);

describe('adding an attachment to a task', () => {
    it.each([
        ['a file in the task\'s own folder', own],
        ['a cloud link', 'https://drive.example.com/file/d/abc'],
        ['the writer\'s own clip', `Clips/${CID}/${OWNER}/clip-1.webm`],
    ])('accepts %s', async (_label, url) => {
        expect((await attach(url)).code).toBe(200);
        expect(urls(TASK)).toEqual([url]);
    });

    it('accepts an upload of the form that filed the task', async () => {
        fileTask({ kind: 'form', ref: String(submission._id) });
        expect((await attach(formUpload())).code).toBe(200);
    });

    it.each([
        ['a file in another task\'s folder', foreign],
        ['a key outside every layout', 'backups/company.zip'],
        ['a colleague\'s clip', `Clips/${CID}/${COLLEAGUE}/clip-2.webm`],
        ['a clip filed under another company', `Clips/6f00000000000000000000c2/${OWNER}/clip-1.webm`],
        ['a form upload on a task no form filed', formUpload()],
    ])('refuses %s and writes nothing', async (_label, url) => {
        expect(await attach(url)).toMatchObject(REFUSAL);
        expect(urls(TASK)).toEqual([]);
    });

    it('refuses an upload of another form', async () => {
        fileTask({ kind: 'form', ref: String(submission._id) });
        expect(await attach(formUpload(OTHER_FORM))).toMatchObject(REFUSAL);
    });

    it('refuses a form upload when the task only claims the submission of another task', async () => {
        mockDb.store.form_submissions[0].taskId = OTHER_TASK;
        fileTask({ kind: 'form', ref: String(submission._id) });
        expect(await attach(formUpload())).toMatchObject(REFUSAL);
    });

    it.each([
        ['an operator', { $ne: null }],
        ['a list naming the task\'s own file', [own]],
    ])('refuses a url that is %s', async (_label, url) => {
        expect(await attach(url)).toMatchObject({ code: 400 });
        expect(urls(TASK)).toEqual([]);
    });
});

describe('creating a task with attachments', () => {
    it('accepts a voice note filed in the new task\'s sprint folder', async () => {
        const result = await create([{ id: 'v1', url: `Project/${PROJECT}/Sprint/${SPRINT}/Attachment/voice-note.webm` }]);
        expect(result.code).toBe(200);
    });

    it.each([
        ['a file in an existing task\'s folder', foreign],
        ['a note filed in another sprint\'s folder', `Project/${PROJECT}/Sprint/${OTHER_SPRINT}/Attachment/voice-note.webm`],
        ['a form upload, whatever origin the body claims', formUpload()],
    ])('refuses %s', async (_label, url) => {
        const before = mockDb.store.tasks.length;
        expect(await create([{ id: 'v1', url }])).toMatchObject(REFUSAL);
        expect(mockDb.store.tasks.length).toBe(before);
    });
});

const IMPORTED = 'Imported with attachments';
const importTasks = (attachments) => call('PATCH /api/v1/importTasks', {
    action: 'createMultipleTasks',
    tasks: [{ _id: 'row-1', TaskName: IMPORTED, status: 'To Do', ParentTaskId: '', ...(attachments ? { attachments } : {}) }],
    userData: { id: OWNER },
    projectData: { _id: PROJECT, CompanyId: CID, ProjectCode: 'PAR', ProjectName: 'Parity', taskTypeCounts: TYPE_LIST },
    indexObj: {},
    statusArray: [{ name: 'To Do', key: 1, type: 'default_active' }],
    sprint: { id: SPRINT, name: 'Sprint 1' },
    eventId: 'ev_import',
});
const importedUrls = () => {
    const imported = mockDb.store.tasks.find((task) => task.TaskName === IMPORTED);
    return imported ? (imported.attachments || []).map((item) => item.url) : null;
};

describe('importing tasks with attachments', () => {
    it('imports tasks that carry no attachments', async () => {
        expect((await importTasks()).code).toBe(200);
        expect(importedUrls()).toEqual([]);
    });

    it.each([
        ['a file filed in the destination sprint\'s folder', `Project/${PROJECT}/Sprint/${SPRINT}/Attachment/voice-note.webm`],
        ['a cloud link', 'https://drive.example.com/file/d/abc'],
        ['the importer\'s own clip', `Clips/${CID}/${OWNER}/clip-1.webm`],
    ])('accepts %s', async (_label, url) => {
        expect((await importTasks([{ id: 'i1', url }])).code).toBe(200);
        expect(importedUrls()).toEqual([url]);
    });

    it.each([
        ['a file in an existing task\'s folder', foreign],
        ['a key outside every layout', 'backups/company.zip'],
    ])('in enforce mode refuses %s and imports nothing', async (_label, url) => {
        expect(await importTasks([{ id: 'i1', url }])).toMatchObject(REFUSAL);
        expect(importedUrls()).toBeNull();
    });

    it.each([
        ['a file in an existing task\'s folder', foreign, 'other_task'],
        ['a key outside every layout', 'backups/company.zip', 'unknown'],
    ])('in report mode imports %s and counts one warning', async (_label, url, reason) => {
        process.env.STORAGE_DOWNLOAD_SCOPE = 'report';
        expect((await importTasks([{ id: 'i1', url }])).code).toBe(200);
        expect(importedUrls()).toEqual([url]);
        const lines = logger.warn.mock.calls.map(([line]) => line).filter((line) => line.startsWith('attachment write would be refused'));
        expect(lines).toHaveLength(1);
        expect(lines[0]).toMatch(new RegExp(`reason: ${reason}\\b`));
    });
});

describe('duplicating a task', () => {
    const duplicate = () => call('PATCH /api/v2/tasks', {
        action: 'duplicateTask', companyId: CID, projectData: { id: PROJECT, ProjectCode: 'PAR', ProjectName: 'Parity' },
        sprintObj: { id: SPRINT, name: 'Sprint 1' }, selectedTaskId: TASK,
        oldProject: { id: PROJECT, taskTypeCounts: TYPE_LIST, taskStatusData: STATUS_LIST, ProjectName: 'Parity' },
        isSubTask: false, duplicateData: ['Attachments'], assignee: [], watcher: [], taskName: 'Copy', oldSprintObj: { id: SPRINT },
    });

    it('copies the task\'s own files and leaves any other key uncopied', async () => {
        mockDb.store.tasks.find((task) => String(task._id) === TASK).attachments = [{ id: 'a1', url: own }, { id: 'a2', url: foreign }];
        expect((await duplicate()).code).toBe(200);
        const copied = copyStoredFile.mock.calls.map(([, from]) => from);
        expect(copied).toEqual([own]);
        const copy = mockDb.store.tasks.find((task) => ![TASK, OTHER_TASK].includes(String(task._id)));
        expect(copy.attachments.map((item) => item.url)).toEqual([expect.stringMatching(new RegExp(`^Project/${PROJECT}/Sprint/${String(copy._id)}/Attachment/spec\\.pdf$`)), foreign]);
    });
});

describe('the write check follows STORAGE_DOWNLOAD_SCOPE', () => {
    const refusalWarnings = () => logger.warn.mock.calls.map(([line]) => line).filter((line) => line.startsWith('attachment write would be refused'));

    it.each([['report', 'report'], ['unset', undefined]])('in %s mode writes a foreign key and counts one warning without the key', async (_label, value) => {
        if (value === undefined) delete process.env.STORAGE_DOWNLOAD_SCOPE;
        else process.env.STORAGE_DOWNLOAD_SCOPE = value;
        expect((await attach(foreign)).code).toBe(200);
        expect(urls(TASK)).toEqual([foreign]);
        const lines = refusalWarnings();
        expect(lines).toHaveLength(1);
        expect(lines[0]).toMatch(/reason: other_task\b.*reported so far for this reason: \d+/);
        expect(lines[0]).not.toContain(OTHER_TASK);
        expect(lines[0]).not.toContain('secret');
    });

    it('in enforce mode refuses a foreign key and logs no warning', async () => {
        expect(await attach(foreign)).toMatchObject(REFUSAL);
        expect(refusalWarnings()).toEqual([]);
    });

    it.each(['report', 'enforce'])('in %s mode refuses a url that is not text', async (value) => {
        process.env.STORAGE_DOWNLOAD_SCOPE = value;
        expect(await attach([own])).toMatchObject(REFUSAL);
        expect(urls(TASK)).toEqual([]);
    });
});
