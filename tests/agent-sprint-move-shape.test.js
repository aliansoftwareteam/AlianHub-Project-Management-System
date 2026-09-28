const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../Modules/Audit/recorder', () => ({ recordAudit: jest.fn() }));

const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { executors } = require('../Modules/Agents/actions');
const { inverses } = require('../Modules/Agents/undo');

const C = '6f0000000000000000000c01';
const PROJECT = '6f0000000000000000000a01';
const TASK = '6f0000000000000000000701';
const OLD_SPRINT = '6f0000000000000000000501';
const OLD_FOLDER = '6f0000000000000000000401';
const FOLDER_SPRINT = '6f0000000000000000000502';
const FOLDER = '6f0000000000000000000402';
const ROOT_SPRINT = '6f0000000000000000000503';
const oid = (id) => new mongoose.Types.ObjectId(id);
const actor = { kind: 'agent', agentId: '6f0000000000000000000b01', userId: '6f0000000000000000000d01', agentName: 'Planner' };

const oldElement = { id: OLD_SPRINT, name: 'Backlog', folderId: OLD_FOLDER, folderName: 'Q3' };
const storedTask = () => mockDb.store[SCHEMA_TYPE.TASKS].find((t) => String(t._id) === TASK);
const move = (sprintId) => executors['task.sprint.move']({ companyId: C, actor, params: { taskId: TASK, sprintId }, depth: 0 });
const COMMENT = '6f0000000000000000000601';
const sprintCounts = () => Object.fromEntries(mockDb.store[SCHEMA_TYPE.SPRINTS].map((s) => [String(s._id), s.tasks]));
const commentSprint = () => String(mockDb.store[SCHEMA_TYPE.COMMENTS][0].sprintId);
const COUNTS = { [OLD_SPRINT]: 5, [FOLDER_SPRINT]: 2, [ROOT_SPRINT]: 0 };

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    jest.clearAllMocks();
    mockDb.seed(SCHEMA_TYPE.TASKS, {
        _id: oid(TASK), CompanyId: C, ProjectID: oid(PROJECT), TaskName: 'Ship it', deletedStatusKey: 0,
        sprintId: oid(OLD_SPRINT), sprintArray: { ...oldElement }, folderObjId: oid(OLD_FOLDER),
    });
    mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: oid(OLD_SPRINT), projectId: oid(PROJECT), name: 'Backlog', folderId: oid(OLD_FOLDER), tasks: COUNTS[OLD_SPRINT] });
    mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: oid(FOLDER_SPRINT), projectId: oid(PROJECT), name: 'Sprint 7', folderId: oid(FOLDER), tasks: COUNTS[FOLDER_SPRINT] });
    mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: oid(ROOT_SPRINT), projectId: oid(PROJECT), name: 'Inbox', tasks: COUNTS[ROOT_SPRINT] });
    mockDb.seed(SCHEMA_TYPE.COMMENTS, { _id: oid(COMMENT), projectId: oid(PROJECT), sprintId: oid(OLD_SPRINT), taskId: TASK, message: 'on it' });
    mockDb.seed(SCHEMA_TYPE.FOLDERS, { _id: oid(FOLDER), name: 'Q4' });
    mockDb.seed(SCHEMA_TYPE.FOLDERS, { _id: oid(OLD_FOLDER), name: 'Q3' });
});

describe('task.sprint.move writes the sprint element the app reads', () => {
    it('stores the target sprint as sprintArray.id and its folder as sprintArray.folderId, both ObjectIds', async () => {
        await move(FOLDER_SPRINT);
        const t = storedTask();
        expect(t.sprintArray.id).toBeInstanceOf(mongoose.Types.ObjectId);
        expect(String(t.sprintArray.id)).toBe(FOLDER_SPRINT);
        expect(t.sprintArray.folderId).toBeInstanceOf(mongoose.Types.ObjectId);
        expect(String(t.sprintArray.folderId)).toBe(FOLDER);
        expect(t.sprintArray).toMatchObject({ name: 'Sprint 7', folderName: 'Q4' });
        expect(t.sprintArray).not.toHaveProperty('_id');
        expect(String(t.sprintId)).toBe(FOLDER_SPRINT);
        expect(String(t.folderObjId)).toBe(FOLDER);
    });

    it('is found by a reader that filters on sprintArray.id or sprintArray.folderId', async () => {
        await move(FOLDER_SPRINT);
        const bySprint = await mockDb.crud(C, { type: SCHEMA_TYPE.TASKS, data: [{ 'sprintArray.id': oid(FOLDER_SPRINT), ProjectID: oid(PROJECT) }] }, 'find');
        const byFolder = await mockDb.crud(C, { type: SCHEMA_TYPE.TASKS, data: [{ 'sprintArray.folderId': oid(FOLDER) }] }, 'find');
        expect(bySprint.map((t) => String(t._id))).toEqual([TASK]);
        expect(byFolder.map((t) => String(t._id))).toEqual([TASK]);
    });

    it('drops the folder when the target sprint sits at the project root', async () => {
        await move(ROOT_SPRINT);
        const t = storedTask();
        expect(String(t.sprintArray.id)).toBe(ROOT_SPRINT);
        expect(t.sprintArray).toEqual({ id: expect.anything(), name: 'Inbox' });
        expect(t).not.toHaveProperty('folderObjId');
    });

    it('moves the sprint task counts and the comment thread with the task, as the app move does', async () => {
        await move(FOLDER_SPRINT);
        expect(sprintCounts()).toEqual({ ...COUNTS, [OLD_SPRINT]: 4, [FOLDER_SPRINT]: 3 });
        expect(commentSprint()).toBe(FOLDER_SPRINT);
    });

    it('rewrites the element but leaves counts and comments alone when the task is already in the sprint', async () => {
        mockDb.store[SCHEMA_TYPE.TASKS][0].sprintArray = { _id: oid(OLD_SPRINT), name: 'Backlog' };
        await move(OLD_SPRINT);
        expect(String(storedTask().sprintArray.id)).toBe(OLD_SPRINT);
        expect(String(storedTask().sprintArray.folderId)).toBe(OLD_FOLDER);
        expect(sprintCounts()).toEqual(COUNTS);
        expect(commentSprint()).toBe(OLD_SPRINT);
    });

    it('undo puts back the previous element, folder, counts and comment thread', async () => {
        const out = await move(ROOT_SPRINT);
        await inverses[out.undo.kind](C, out.undo);
        const t = storedTask();
        expect(t.sprintArray).toEqual(oldElement);
        expect(String(t.sprintId)).toBe(OLD_SPRINT);
        expect(String(t.folderObjId)).toBe(OLD_FOLDER);
        expect(sprintCounts()).toEqual(COUNTS);
        expect(commentSprint()).toBe(OLD_SPRINT);
    });
});
