/* A description as each task and project write stores it, through the real handlers on the in-memory database. */
const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (companyId, q, method) => mockDb.crud(companyId, q, method),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0 } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../Config/tenant', () => ({ pinSessionTenant: (req) => req.headers.companyid }));
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
jest.mock('../Modules/LogTime/controllerV2/helpers', () => mockStub());
jest.mock('../utils/planHelper', () => mockStub());
jest.mock('../utils/commonFunctions.js', () => mockStub());
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../common-storage/common-server.js', () => mockStub());
jest.mock('../Modules/settings/ProjectSkills/helper', () => ({ resolveProjectSkills: jest.fn(async (companyId, skills) => skills || []), skillNamesOf: jest.fn(async () => []) }));
jest.mock('../Modules/Project/helpers/projectQuota', () => ({ TRASHED: 1, quotaStatus: () => null, syncProjectQuota: jest.fn(async () => false), privacyChange: () => null, syncProjectType: jest.fn() }));
jest.mock('../Modules/Knowledge/ingest/events', () => ({ guideTouched: () => false, publishGuideSaved: jest.fn(), publishProjectTrashed: jest.fn(), publishProjectRestored: jest.fn() }));
jest.mock('../Modules/TaskTemplates/access', () => ({
    OBJECT_ID: /^[a-f0-9]{24}$/i,
    CREATE_TASKS: 'task.task_create',
    companyOf: (req) => req.headers.companyid,
    canReadProject: async () => ({ allowed: true }),
    canSaveIn: async () => ({ allowed: true }),
    canEditProject: async () => ({ allowed: true }),
    usableIn: () => true,
    keyChecker: () => async () => true,
}));
process.env.STORAGE_TYPE = 'server';

const mongoHelper = require('../Modules/Tasks/helpers/mongo_helper');
const { taskMongo } = require('../Modules/Tasks/helpers/task_class_Mongo');
const { sendFailure } = require('../Modules/Tasks/helpers/taskWriteFields');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { updateProject } = require('../Modules/Project/controller/updateProject');
const recurring = require('../Modules/RecurringTasks/controller');
const templates = require('../Modules/TaskTemplates/controller');
const { LIMITS } = require('../Modules/Tasks/helpers/cleanRichText');
const guardFixture = require('./fixtures/taskWriteGuard');

mongoHelper.getTotalSprintCount = async () => true;

const { CID, OWNER, OPEN_PROJECT: PROJECT, OPEN_TASK: TASK } = guardFixture;
const SPRINT = '6f0000000000000000000e01';
const guard = guardFixture.create(mockDb);
const settle = async () => { for (let i = 0; i < 40; i += 1) await new Promise((resolve) => setImmediate(resolve)); };

const LINK = 'target="_blank" rel="noopener noreferrer"';
const sent = () => ({ time: 5, version: '2.30.7', blocks: [
    { id: 'a', type: 'paragraph', data: { text: 'Agree <b onclick="window.__ran = 1">the date</b><script>window.__ran = 1</script>', html: '<img src=x onerror="window.__ran = 1">' } },
    { id: 'b', type: 'list', data: { style: 'unordered', items: [{ content: 'Book <a href="javascript:window.__ran = 1">the room</a>', items: [] }, { content: 'Read <a href="https://example.test/spec">the spec</a>', items: [] }] } },
    { id: 'c', type: 'embed', data: { service: 'youtube', embed: 'https://remote.example.test/frame', source: 'https://remote.example.test/page', caption: '' } },
] });
const STORED = { time: 5, version: '2.30.7', blocks: [
    { id: 'a', type: 'paragraph', data: { text: 'Agree <b>the date</b>' } },
    { id: 'b', type: 'list', data: { style: 'unordered', items: [{ content: 'Book <a>the room</a>', items: [] }, { content: `Read <a href="https://example.test/spec" ${LINK}>the spec</a>`, items: [] }] } },
    { id: 'c', type: 'paragraph', data: { text: `<a href="https://remote.example.test/page" ${LINK}>https://remote.example.test/page</a>` } },
] };
const SENT_TEXT = 'Agree the date window.__ran = 1, Book the room, Read the spec';
const MIRROR = 'Agree the date\n- Book the room\n- Read the spec\nhttps://remote.example.test/page';
const editorMade = () => ({ time: 9, version: '2.30.7', blocks: [
    { id: 'a', type: 'paragraph', data: { text: 'Agree <b>the date</b> &amp; the room' } },
    { id: 'b', type: 'checklist', data: { items: [{ text: 'Book it', checked: false }] } },
] });

const tasks = () => mockDb.store[SCHEMA_TYPE.TASKS];
const taskNamed = (name) => tasks().find((task) => task.TaskName === name);
const storedTask = (id = TASK) => tasks().find((task) => String(task._id) === id);
const storedProject = () => mockDb.store[SCHEMA_TYPE.PROJECTS].find((project) => project._id === PROJECT);

const reply = () => {
    const res = { code: 200 };
    res.status = (code) => { res.code = code; return res; };
    res.send = (payload) => { res.body = payload; return res; };
    res.json = res.send;
    return res;
};
const call = async (handler, { body = {}, params = {} } = {}) => {
    const res = reply();
    await handler({ uid: OWNER, headers: { companyid: CID }, body, params, query: {} }, res);
    await settle();
    return res;
};
const refusalOf = async (promise) => promise.then(() => null, (error) => error);

const create = (fields) => taskMongo.create({
    data: {
        TaskName: 'Made', TaskKey: '-', TaskType: 'task', TaskTypeKey: 1, ProjectID: PROJECT, CompanyId: CID, sprintId: SPRINT,
        sprintArray: { id: SPRINT, name: 'Sprint 1' }, status: { text: 'To Do', key: 1, type: 'default_active' }, statusKey: 1, statusType: 'default_active',
        AssigneeUserId: [], watchers: [], isParentTask: true, ParentTaskId: '', Task_Leader: OWNER, Task_Priority: 'MEDIUM', deletedStatusKey: 0, ...fields,
    },
    user: { id: OWNER, Employee_Name: 'Olivia Owner', companyOwnerId: OWNER },
    projectData: { _id: PROJECT, id: PROJECT, CompanyId: CID, ProjectCode: 'WEB', lastTaskId: 0 },
    indexObj: { indexName: 'groupByStatusIndex', searchKey: 'statusKey', searchValue: '1' },
});

beforeEach(() => {
    guard.reset();
    jest.clearAllMocks();
    Object.assign(storedProject(), { ProjectName: 'Web', ProjectCode: 'WEB', CompanyId: CID, taskStatusData: [{ name: 'To Do', key: 1, type: 'default_active' }] });
    mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: SPRINT, name: 'Sprint 1', projectId: PROJECT });
    mockDb.seed(SCHEMA_TYPE.USERS, { _id: OWNER, Employee_Name: 'Olivia Owner', Employee_Email: 'owner@company.test' });
});

describe('a new task', () => {
    it('stores its description as the editor would draw it, with the plain text beside it', async () => {
        const result = await create({ descriptionBlock: sent(), rawDescription: SENT_TEXT, description: 'Older <b onclick="window.__ran = 1">text</b><iframe src="https://remote.example.test"></iframe>' });
        await settle();
        expect(result).toMatchObject({ status: true });
        expect(taskNamed('Made')).toMatchObject({ descriptionBlock: STORED, rawDescription: MIRROR, description: 'Older <b>text</b>' });
    });

    it('stores a description the editor made as it was sent', async () => {
        await create({ descriptionBlock: editorMade(), rawDescription: 'Agree the date & the room, Book it' });
        await settle();
        expect(JSON.stringify(taskNamed('Made').descriptionBlock)).toBe(JSON.stringify(editorMade()));
        expect(taskNamed('Made').rawDescription).toBe('Agree the date & the room, Book it');
    });

    it('is refused when its description is beyond a size limit', async () => {
        const blocks = Array.from({ length: LIMITS.blocks + 1 }, () => ({ type: 'paragraph', data: { text: 'x' } }));
        const error = await refusalOf(create({ descriptionBlock: { blocks } }));
        expect(error).toMatchObject({ statusCode: 400, limit: 'blocks' });
        expect(taskNamed('Made')).toBeUndefined();
        const res = reply();
        sendFailure(res, error);
        expect(res).toMatchObject({ code: 400, body: { status: false, statusText: expect.stringMatching(/5000 blocks/) } });
    });
});

describe('a task\'s description', () => {
    // The handler sends the fields bare, which the driver writes as a $set and the in-memory database does not apply.
    const written = () => mockDb.calls.filter((made) => made.type === SCHEMA_TYPE.TASKS && made.method === 'findOneAndUpdate').at(-1).data[1];

    it('is stored as the editor would draw it when it is edited', async () => {
        await taskMongo.updateDescription({ companyId: CID, task: { _id: TASK }, text: { blocks: sent(), text: SENT_TEXT } });
        expect(written()).toEqual({ descriptionBlock: STORED, rawDescription: MIRROR });
        const socketEmitter = require('../event/socketEventEmitter');
        expect(socketEmitter.emit.mock.calls.at(-1)[1].updatedFields).toEqual({ descriptionBlock: STORED, rawDescription: MIRROR });
    });

    it('is stored as it was sent when the editor made it', async () => {
        await taskMongo.updateDescription({ companyId: CID, task: { _id: TASK }, text: { blocks: editorMade(), text: 'Agree the date & the room, Book it' } });
        expect(JSON.stringify(written())).toBe(JSON.stringify({ descriptionBlock: editorMade(), rawDescription: 'Agree the date & the room, Book it' }));
    });

    it('is refused beyond a size limit, and the task keeps what it had', async () => {
        const before = mockDb.calls.length;
        const error = await refusalOf(taskMongo.updateDescription({ companyId: CID, task: { _id: TASK }, text: { blocks: { blocks: [{ type: 'paragraph', data: { text: `${'<b>'.repeat(LIMITS.tagDepth + 1)}x` } }] }, text: 'x' } }));
        expect(error).toMatchObject({ statusCode: 400, limit: 'tagDepth' });
        expect(mockDb.calls.slice(before).filter((made) => made.method !== 'findOne' && made.method !== 'find')).toEqual([]);
    });
});

describe('a project\'s description', () => {
    const update = (updateObject, key) => call(updateProject, { params: { id: PROJECT }, body: { updateObject, ...(key ? { key } : {}) } });

    it('is stored as the editor would draw it', async () => {
        const res = await update({ descriptionBlock: sent(), description: 'Older <b onclick="window.__ran = 1">text</b>' });
        expect(res.code).toBe(200);
        expect(storedProject()).toMatchObject({ descriptionBlock: STORED, description: 'Older <b>text</b>' });
    });

    it('is stored as it was sent when the editor made it', async () => {
        await update({ descriptionBlock: editorMade() });
        expect(JSON.stringify(storedProject().descriptionBlock)).toBe(JSON.stringify(editorMade()));
    });

    it.each([
        ['a part of it', { 'descriptionBlock.blocks.0.data.text': '<b>x</b>' }, undefined],
        ['an addition to it', { 'descriptionBlock.blocks': { type: 'paragraph', data: { text: 'x' } } }, '$push'],
        ['another field moved onto it', { ProjectName: 'description' }, '$rename'],
    ])('is replaced whole: %s is refused', async (_name, updateObject, key) => {
        Object.assign(storedProject(), { description: 'Before' });
        const res = await update(updateObject, key);
        expect(res).toMatchObject({ code: 400, body: { status: false, statusText: 'A description is saved whole.' } });
        expect(storedProject()).toMatchObject({ description: 'Before', ProjectName: 'Web' });
        expect(storedProject().descriptionBlock).toBeUndefined();
    });

    it('can be removed, and other fields are written as before', async () => {
        Object.assign(storedProject(), { description: 'Before' });
        expect((await update({ description: '' }, '$unset')).code).toBe(200);
        expect((await update({ ProjectName: 'Web 2' })).code).toBe(200);
        expect(storedProject().ProjectName).toBe('Web 2');
    });

    it('is refused beyond a size limit', async () => {
        const res = await update({ description: 'x'.repeat(LIMITS.textLength + 1) });
        expect(res).toMatchObject({ code: 400, body: { status: false, statusText: expect.stringMatching(/characters long/) } });
        expect(storedProject().description).toBeUndefined();
    });
});

describe('a recurring task', () => {
    const body = (fields = {}) => ({
        name: 'Weekly review', taskName: 'Review', freq: 'weekly', byweekday: [1], sprintId: SPRINT,
        projectData: { _id: PROJECT, CompanyId: CID, ProjectCode: 'WEB', ProjectName: 'Web' },
        userData: { id: OWNER, Employee_Name: 'Olivia Owner', companyOwnerId: OWNER },
        ...fields,
    });
    const definitions = () => mockDb.store[SCHEMA_TYPE.RECURRING_TASKS] || [];

    it('keeps the description it repeats as the editor would draw it', async () => {
        const res = await call(recurring.createDefinition, { body: body({ descriptionBlock: sent(), rawDescription: SENT_TEXT }) });
        expect(res.body).toMatchObject({ status: true });
        expect(definitions()[0].templateSnapshot).toMatchObject({ descriptionBlock: STORED, rawDescription: MIRROR, TaskName: 'Review' });
    });

    it('is refused when that description is beyond a size limit', async () => {
        const res = await call(recurring.createDefinition, { body: body({ rawDescription: 'x'.repeat(LIMITS.textLength + 1) }) });
        expect(res).toMatchObject({ code: 400, body: { status: false, statusText: expect.stringMatching(/characters long/) } });
        expect(definitions()).toHaveLength(0);
    });
});

describe('a task template', () => {
    const saved = () => (mockDb.store[SCHEMA_TYPE.TASK_TEMPLATES] || [])[0];

    it('keeps the description of the task it was saved from as the editor would draw it', async () => {
        Object.assign(storedTask(), { TaskName: 'Launch', descriptionBlock: sent(), rawDescription: SENT_TEXT, deletedStatusKey: 0 });
        const res = await call(templates.saveTemplate, { body: { name: 'Launch plan', taskId: TASK } });
        expect(res.body).toMatchObject({ status: true });
        expect(saved()).toMatchObject({ descriptionBlock: STORED, rawDescription: MIRROR });
    });

    it('gives a task a cleaned description even from a template kept before this', async () => {
        Object.assign(storedTask(), { TaskName: 'Launch', deletedStatusKey: 0, sprintId: SPRINT });
        const template = mockDb.seed(SCHEMA_TYPE.TASK_TEMPLATES, { _id: '6f0000000000000000000f01', name: 'Older', scope: 'project', ProjectID: PROJECT, deletedStatusKey: 0, descriptionBlock: sent(), rawDescription: SENT_TEXT });
        const res = await call(templates.applyTemplate, { body: { taskId: TASK }, params: { id: template._id } });
        expect(res.body).toMatchObject({ status: true });
        expect(storedTask()).toMatchObject({ descriptionBlock: STORED, rawDescription: MIRROR });
    });
});
