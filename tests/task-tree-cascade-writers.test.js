/* Task 046 M2, slice N3a: the writers outside the task routes that archive or move a task (the
   agent sprint move and its undo, the nightly auto-archive, the sprint completion preview) reach
   every level of its subtasks through the same tree helpers. */
const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../Modules/Audit/recorder', () => ({ recordAudit: jest.fn() }));
jest.mock('../Modules/Tasks/helpers/mongo_helper', () => ({ HandleHistory: jest.fn(async () => ({})) }));
jest.mock('../Modules/Tasks/helpers/helper', () => ({ HandleHistory: jest.fn(async () => ({})) }));
jest.mock('../Modules/Sprints/controller', () => ({ addSprintFun: jest.fn() }));
jest.mock('../Modules/Sprints/helpers/actingUser', () => ({ actingUser: jest.fn(async () => ({ id: 'u1', Employee_Name: 'Max' })) }));

const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const socketEmitter = require('../event/socketEventEmitter');
const { executors } = require('../Modules/Agents/actions');
const { inverses } = require('../Modules/Agents/undo');
const autoArchive = require('../Modules/projectSetting/autoArchive');
const scrum = require('../Modules/Sprints/scrum');
const tree = require('../Modules/Tasks/helpers/taskTree');
const { taskSchema } = require('../utils/mongo-handler/createSchema');
const { TASK_ACTION_FIELDS, prepareTaskWrite } = require('../Modules/Tasks/helpers/taskWriteFields');

const C = '6f0000000000000000000c01';
const PROJECT = '6f0000000000000000000a01';
const SPRINT = '6f0000000000000000000501';
const FOLDER = '6f0000000000000000000401';
const TARGET_SPRINT = '6f0000000000000000000502';
const ROOT = '6f0000000000000000000701';
const CHILD = '6f0000000000000000000702';
const GRANDCHILD = '6f0000000000000000000703';
const DELETED_CHILD = '6f0000000000000000000704';
const FAMILY = [ROOT, CHILD, GRANDCHILD];
const oid = (id) => new mongoose.Types.ObjectId(id);
const actor = { kind: 'agent', agentId: '6f0000000000000000000b01', userId: '6f0000000000000000000d01', agentName: 'Planner' };
const LONG_AGO = new Date('2020-01-01T00:00:00.000Z');

const element = { id: oid(SPRINT), name: 'Sprint 1', folderId: oid(FOLDER), folderName: 'Q3' };
const taskRow = (_id, ancestors, extra = {}) => ({
    _id: oid(_id), CompanyId: C, ProjectID: oid(PROJECT), TaskName: `Task ${_id.slice(-2)}`, TaskKey: `P-${_id.slice(-2)}`, deletedStatusKey: 0,
    isParentTask: !ancestors.length, ParentTaskId: ancestors[ancestors.length - 1] || '', ancestors,
    sprintId: oid(SPRINT), sprintArray: { ...element }, folderObjId: oid(FOLDER), statusType: 'close', updatedAt: LONG_AGO, subTasks: 0, ...extra,
});

const stored = (id) => mockDb.store[SCHEMA_TYPE.TASKS].find((t) => String(t._id) === id);
const sprint = (id) => mockDb.store[SCHEMA_TYPE.SPRINTS].find((s) => String(s._id) === id);
const sprintsOf = (ids) => ids.map((id) => String(stored(id).sprintId));
const commentSprints = () => mockDb.store[SCHEMA_TYPE.COMMENTS].map((c) => String(c.sprintId));

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.calls.length = 0;
    jest.clearAllMocks();
    mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: oid(PROJECT), ProjectName: 'Launch', ProjectCode: 'P', deletedStatusKey: 0, autoArchive: { enabled: true, afterDays: 30 } });
    mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: oid(SPRINT), projectId: oid(PROJECT), name: 'Sprint 1', folderId: oid(FOLDER), tasks: 4, archiveTaskCount: 0, isScrum: true, state: 'active' });
    mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: oid(TARGET_SPRINT), projectId: oid(PROJECT), name: 'Inbox', tasks: 0, archiveTaskCount: 0 });
    mockDb.seed(SCHEMA_TYPE.FOLDERS, { _id: oid(FOLDER), name: 'Q3' });
    mockDb.seed(SCHEMA_TYPE.TASKS, taskRow(ROOT, [], { subTasks: 1 }));
    mockDb.seed(SCHEMA_TYPE.TASKS, taskRow(CHILD, [ROOT], { subTasks: 1, statusType: 'active' }));
    mockDb.seed(SCHEMA_TYPE.TASKS, taskRow(GRANDCHILD, [ROOT, CHILD], { statusType: 'active' }));
    mockDb.seed(SCHEMA_TYPE.TASKS, taskRow(DELETED_CHILD, [ROOT], { deletedStatusKey: 1 }));
    FAMILY.forEach((id) => mockDb.seed(SCHEMA_TYPE.COMMENTS, { projectId: oid(PROJECT), sprintId: oid(SPRINT), taskId: id, message: 'note' }));
});

describe('the agent sprint move', () => {
    const move = (taskId, sprintId) => executors['task.sprint.move']({ companyId: C, actor, params: { taskId, sprintId }, depth: 0 });

    test('takes every level of subtasks with the task: placement, counts and comment threads', async () => {
        await move(ROOT, TARGET_SPRINT);

        expect(sprintsOf(FAMILY)).toEqual([TARGET_SPRINT, TARGET_SPRINT, TARGET_SPRINT]);
        FAMILY.forEach((id) => {
            expect(stored(id).sprintArray).toEqual({ id: expect.anything(), name: 'Inbox' });
            expect(stored(id)).not.toHaveProperty('folderObjId');
        });
        expect([stored(CHILD).ancestors, stored(GRANDCHILD).ancestors]).toEqual([[ROOT], [ROOT, CHILD]]);
        expect(String(stored(DELETED_CHILD).sprintId)).toBe(SPRINT);
        expect([sprint(SPRINT).tasks, sprint(TARGET_SPRINT).tasks]).toEqual([1, 3]);
        expect(commentSprints()).toEqual([TARGET_SPRINT, TARGET_SPRINT, TARGET_SPRINT]);
        const announced = socketEmitter.emit.mock.calls.filter(([event]) => event === 'update').map(([, payload]) => String(payload.data._id));
        expect(announced).toEqual(expect.arrayContaining(FAMILY));
    });

    test('refuses a subtask on its own', async () => {
        const refused = await move(CHILD, TARGET_SPRINT).catch((error) => error);

        expect(refused.deterministic).toBe(true);
        expect(refused.message).toMatch(/moves with its parent/);
        expect(sprintsOf(FAMILY)).toEqual([SPRINT, SPRINT, SPRINT]);
        expect([sprint(SPRINT).tasks, sprint(TARGET_SPRINT).tasks]).toEqual([4, 0]);
    });

    test('undo brings the task and every level back', async () => {
        const out = await move(ROOT, TARGET_SPRINT);

        await inverses[out.undo.kind](C, out.undo);

        expect(sprintsOf(FAMILY)).toEqual([SPRINT, SPRINT, SPRINT]);
        FAMILY.forEach((id) => {
            expect(String(stored(id).sprintArray.id)).toBe(SPRINT);
            expect(String(stored(id).folderObjId)).toBe(FOLDER);
        });
        expect([sprint(SPRINT).tasks, sprint(TARGET_SPRINT).tasks]).toEqual([4, 0]);
        expect(commentSprints()).toEqual([SPRINT, SPRINT, SPRINT]);
    });
});

describe('the nightly auto-archive', () => {
    test('archives a finished task with every level of its subtasks and counts the rows it changed', async () => {
        const archived = await autoArchive.runAutoArchiveForCompany(C);

        expect(archived).toBe(1);
        expect(FAMILY.map((id) => stored(id).deletedStatusKey)).toEqual([2, 3, 3]);
        expect([stored(CHILD).cascadedBy, stored(GRANDCHILD).cascadedBy]).toEqual([ROOT, ROOT]);
        expect(stored(DELETED_CHILD)).toMatchObject({ deletedStatusKey: 1 });
        expect(stored(DELETED_CHILD)).not.toHaveProperty('cascadedBy');
        expect({ tasks: sprint(SPRINT).tasks, archiveTaskCount: sprint(SPRINT).archiveTaskCount }).toEqual({ tasks: 1, archiveTaskCount: 3 });
        const announced = socketEmitter.emit.mock.calls.filter(([event]) => event === 'update').map(([, payload]) => String(payload.data._id));
        expect(announced.sort()).toEqual([...FAMILY].sort());
    });
});

describe('the sprint completion preview', () => {
    test('lists the open subtasks at every level under a finished task', async () => {
        const res = { send: jest.fn() };

        await scrum.completePreview({ headers: { companyid: C }, query: { sprintId: SPRINT } }, res);

        const [{ status, data }] = res.send.mock.calls[0];
        expect(status).toBe(true);
        expect(data.strandedSubtasks.list.map((t) => t._id).sort()).toEqual([CHILD, GRANDCHILD]);
    });
});

describe('the cascade rules', () => {
    test('a sprint counts a row as live or archived, and a move between the two changes both', () => {
        expect(tree.sprintCountChange(0, 2)).toEqual({ tasks: -1, archiveTaskCount: 1 });
        expect(tree.sprintCountChange(2, 0)).toEqual({ tasks: 1, archiveTaskCount: -1 });
        expect(tree.sprintCountChange(0, 1)).toEqual({ tasks: -1 });
        expect(tree.sprintCountChange(1, 0)).toEqual({ tasks: 1 });
        expect(tree.sprintCountChange(2, 1)).toEqual({ archiveTaskCount: -1 });
        expect(tree.sprintCountChange(2, 2)).toEqual({});
        expect(tree.sprintCountChange(undefined, 2, 4)).toEqual({ tasks: -4, archiveTaskCount: 4 });
    });

    test('the stamp is a declared, server-owned field', () => {
        expect(taskSchema.path('cascadedBy')).toBeDefined();
        const req = { headers: { companyid: C }, aud: C, uid: actor.userId, body: { data: { TaskName: 'New', ProjectID: PROJECT, cascadedBy: ROOT }, user: {}, projectData: { _id: PROJECT }, indexObj: {} } };
        const { payload, dropped } = prepareTaskWrite(req, TASK_ACTION_FIELDS.create, 'create');
        expect(payload.data).not.toHaveProperty('cascadedBy');
        expect(dropped).toContain('data.cascadedBy');
    });
});
