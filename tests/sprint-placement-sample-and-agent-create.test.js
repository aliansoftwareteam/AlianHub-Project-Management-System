/* Sample tasks stored the whole sprint document as sprintArray (an `_id`, no `id`), and an agent's
   task.create stored `{ id, name }` with the id as text and no folder. The app finds a task in its
   sprint by sprintArray.id and in its folder by sprintArray.folderId and folderObjId, so neither
   task showed up there. Both writers now store what the app's own create stores. */
const mongoose = require('mongoose');

const mockDb = require('./fixtures/fakeMongo').create();

const mockInserted = [];
jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: async (companyId, query, method) => {
        if (method === 'insertMany') { mockInserted.push({ type: query.type, data: query.data }); return query.data[0]; }
        return mockDb.crud(companyId, query, method);
    },
}));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../Modules/Audit/recorder', () => ({ recordAudit: jest.fn() }));
jest.mock('../Modules/Tasks/helpers/taskMongo/internals.js', () => ({ updateTaskKey: jest.fn(async () => undefined) }));
jest.mock('../Modules/Sprints/controller', () => ({ addSprintFun: jest.fn() }));
jest.mock('../Modules/createProject/sampleProject', () => ({ loadUserData: jest.fn(async () => ({})) }));
jest.mock('../Modules/AIProjectGenerator/orchestrator', () => ({}));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { addSprintFun } = require('../Modules/Sprints/controller');
const { seedSampleTasks, demoTasksForFocus, SAMPLE_TASKS } = require('../utils/sampleTasks');
const tools = require('../Modules/Automations/engine/tools');
const { driverWrites, sprintArraysIn, isObjectId } = require('./fixtures/realTaskStore');

const C = '6f0000000000000000000c01';
const PROJECT = '6f0000000000000000000a01';
const OWNER = '6f0000000000000000000d01';
const ROOT_SPRINT = '6f0000000000000000000501';
const FOLDER_SPRINT = '6f0000000000000000000502';
const FOLDER = '6f0000000000000000000401';
const oid = (id) => new mongoose.Types.ObjectId(id);

const project = {
    _id: oid(PROJECT),
    CompanyId: C,
    ProjectName: 'Launch',
    ProjectCode: 'LN',
    userId: OWNER,
    lastTaskId: 0,
    taskTypeCounts: [{ name: 'Task', key: 1, value: 'task' }],
    taskStatusData: [
        { name: 'To Do', key: 1, type: 'default_active' },
        { name: 'In Progress', key: 3, type: 'active' },
        { name: 'Complete', key: 2, type: 'close' },
    ],
};
const rootSprint = { _id: oid(ROOT_SPRINT), name: 'List', projectId: oid(PROJECT), tasks: 0, deletedStatusKey: 0, createdAt: new Date('2026-01-01') };
const folderSprint = { _id: oid(FOLDER_SPRINT), name: 'Sprint 7', projectId: oid(PROJECT), folderId: oid(FOLDER), tasks: 0, deletedStatusKey: 0, createdAt: new Date('2026-02-01') };

const insertedTasks = () => mockInserted.filter((c) => c.type === SCHEMA_TYPE.TASKS).flatMap((c) => c.data[0]);
const savedTask = () => mockDb.store[SCHEMA_TYPE.TASKS][0];
const templateRows = SAMPLE_TASKS['Backlogs and Sprints'];

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.calls.length = 0;
    mockInserted.length = 0;
    jest.clearAllMocks();
    mockDb.seed(SCHEMA_TYPE.PROJECTS, { ...project });
    mockDb.seed(SCHEMA_TYPE.SPRINTS, { ...rootSprint });
    mockDb.seed(SCHEMA_TYPE.SPRINTS, { ...folderSprint });
    mockDb.seed(SCHEMA_TYPE.FOLDERS, { _id: oid(FOLDER), name: 'Q4', projectId: oid(PROJECT) });
});

describe('sample tasks store the sprint element the app reads', () => {
    it('stores the sprint as sprintArray.id and name, not the sprint document', async () => {
        const count = await seedSampleTasks(project, rootSprint, templateRows, OWNER);

        expect(count).toBe(templateRows.length);
        insertedTasks().forEach((doc) => {
            expect(doc.sprintArray).toEqual({ id: expect.anything(), name: 'List' });
            expect(isObjectId(doc.sprintArray.id)).toBe(true);
            expect(String(doc.sprintArray.id)).toBe(ROOT_SPRINT);
            expect(String(doc.sprintId)).toBe(ROOT_SPRINT);
            expect(doc).not.toHaveProperty('folderObjId');
        });
    });

    it('carries the folder of a sprint that sits in one', async () => {
        await seedSampleTasks(project, folderSprint, templateRows, OWNER);

        insertedTasks().forEach((doc) => {
            expect(doc.sprintArray).toMatchObject({ name: 'Sprint 7', folderName: 'Q4' });
            expect(String(doc.sprintArray.folderId)).toBe(FOLDER);
            expect(String(doc.folderObjId)).toBe(FOLDER);
        });
    });

    it('keeps the ids as ObjectIds through the real task schema', async () => {
        await seedSampleTasks(project, folderSprint, templateRows, OWNER);

        const { writes, error } = await driverWrites('insertMany', [insertedTasks()]);
        expect(error).toBeNull();
        const stored = sprintArraysIn(writes.map((w) => w.args));
        expect(stored).toHaveLength(templateRows.length);
        stored.forEach((element) => {
            expect(element).not.toHaveProperty('_id');
            expect(isObjectId(element.id) && isObjectId(element.folderId)).toBe(true);
        });
    });

    it('places each demo task in its own sprint, subtasks with their parent', async () => {
        addSprintFun.mockImplementation(async ({ body }) => ({ status: true, data: { _id: new mongoose.Types.ObjectId(), name: body.sprintName, projectId: body.projectId } }));

        await seedSampleTasks(project, rootSprint, demoTasksForFocus(''), OWNER);

        const docs = insertedTasks();
        expect(new Set(docs.map((d) => String(d.sprintId))).size).toBeGreaterThan(1);
        docs.forEach((doc) => {
            expect(doc.sprintArray).not.toHaveProperty('_id');
            expect(String(doc.sprintArray.id)).toBe(String(doc.sprintId));
        });
        docs.filter((d) => d.ParentTaskId).forEach((kid) => {
            const parent = docs.find((d) => String(d._id) === kid.ParentTaskId);
            expect(String(kid.sprintArray.id)).toBe(String(parent.sprintArray.id));
        });
    });
});

describe('an agent-created task stores the sprint element the app reads', () => {
    it('stores a chosen sprint in a folder with its folder, as ObjectIds', async () => {
        await tools.createTask(C, PROJECT, { title: 'Found it', sprintId: FOLDER_SPRINT, leaderId: OWNER });

        const t = savedTask();
        expect(t.sprintArray).toMatchObject({ name: 'Sprint 7', folderName: 'Q4' });
        expect(isObjectId(t.sprintArray.id) && isObjectId(t.sprintArray.folderId)).toBe(true);
        expect([String(t.sprintArray.id), String(t.sprintArray.folderId)]).toEqual([FOLDER_SPRINT, FOLDER]);
        expect(String(t.sprintId)).toBe(FOLDER_SPRINT);
        expect(String(t.folderObjId)).toBe(FOLDER);
    });

    it('files into the oldest list at the project root without a folder', async () => {
        await tools.createTask(C, PROJECT, { title: 'Filed somewhere', leaderId: OWNER });

        const t = savedTask();
        expect(t.sprintArray).toEqual({ id: expect.anything(), name: 'List' });
        expect(isObjectId(t.sprintArray.id)).toBe(true);
        expect(String(t.sprintArray.id)).toBe(ROOT_SPRINT);
        expect(t).not.toHaveProperty('folderObjId');
    });

    it('keeps the ids as ObjectIds through the real task schema', async () => {
        await tools.createTask(C, PROJECT, { title: 'Found it', sprintId: FOLDER_SPRINT, leaderId: OWNER });

        const save = mockDb.calls.find((c) => c.type === SCHEMA_TYPE.TASKS && c.method === 'save');
        const { writes, error } = await driverWrites('save', save.data);
        expect(error).toBeNull();
        const [stored] = sprintArraysIn(writes.map((w) => w.args));
        expect(isObjectId(stored.id) && isObjectId(stored.folderId)).toBe(true);
        expect([String(stored.id), String(stored.folderId)]).toEqual([FOLDER_SPRINT, FOLDER]);
    });
});
