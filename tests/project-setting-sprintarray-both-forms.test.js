/* Task 040 phase 1: tasks.sprintArray is an untyped object, so Mongoose converts neither
   sprintArray.id nor sprintArray.folderId, and moving a sprint writes folderId as an ObjectId
   (Sprints/controller.js). Relinking a project's tasks to its sprints and folders must match the
   ids in either form, as well as the legacy key. */
const mongoose = require('mongoose');
const sift = require('sift');

const mockCrud = jest.fn();
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockCrud(...a) }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Modules/Comments/controller', () => ({ updateCommentSprint: jest.fn(async () => true) }));

const { updateTaksSprints, updateTaksFolders } = require('../Modules/projectSetting/controller');

const oid = (id) => new mongoose.Types.ObjectId(id);
const C = '6f0000000000000000000c01';
const PROJECT = '6f0000000000000000000b01';
const LEGACY_SPRINT = '6f0000000000000000000e01';
const SPRINT = '6f0000000000000000000e02';
const FOLDER = '6f0000000000000000000f01';

const SPRINTS = [
    { _id: oid(LEGACY_SPRINT), legacyId: 'firebase-sprint', projectId: oid(PROJECT) },
    { _id: oid(SPRINT), projectId: oid(PROJECT) },
];
const FOLDERS = [{ _id: oid(FOLDER), legacyId: 'firebase-folder', projectId: oid(PROJECT) }];

const task = (_id, sprintArray) => ({ _id, ProjectID: oid(PROJECT), sprintArray });
const TASKS = [
    task('legacy-sprint-by-key', { id: 'firebase-sprint' }),
    task('legacy-sprint-as-text', { id: LEGACY_SPRINT }),
    task('legacy-sprint-as-id', { id: oid(LEGACY_SPRINT) }),
    task('sprint-as-text', { id: SPRINT }),
    task('sprint-as-id', { id: oid(SPRINT) }),
    task('folder-by-key', { id: SPRINT, folderId: 'firebase-folder' }),
    task('folder-as-text', { id: SPRINT, folderId: FOLDER }),
    task('folder-as-id', { id: SPRINT, folderId: oid(FOLDER) }),
];

/* An ObjectId equals only an ObjectId, as on the server; tagging keeps sift from reading it as its hex text. */
const bson = (value) => {
    if (value instanceof mongoose.Types.ObjectId) return { objectId: value.toHexString() };
    if (Array.isArray(value)) return value.map(bson);
    if (value && typeof value === 'object' && !(value instanceof Date) && !(value instanceof RegExp)) {
        return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, bson(v)]));
    }
    return value;
};
const found = (filter) => TASKS.filter((row) => sift(bson(filter))(bson(row))).map((row) => row._id).sort();

const settle = async () => { for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve)); };

const relinked = async (relink) => {
    mockCrud.mockImplementation(async (companyId, { type }, method) => {
        if (method === 'find' && type === 'sprints') return SPRINTS;
        if (method === 'find' && type === 'folders') return FOLDERS;
        return { modifiedCount: 0 };
    });
    await relink(PROJECT, C);
    await settle();
    const writes = mockCrud.mock.calls.filter(([, { type }, method]) => type === 'tasks' && method === 'updateMany');
    writes.forEach(([companyId]) => expect(companyId).toBe(C));
    return writes.map(([, { data: [filter, update] }]) => ({ found: found(filter), update }));
};

beforeEach(() => mockCrud.mockReset());

describe('relinking tasks to their sprints', () => {
    test('a sprint with a legacy key matches it and both forms of its id', async () => {
        const [legacy] = await relinked(updateTaksSprints);
        expect(legacy.found).toEqual(['legacy-sprint-as-id', 'legacy-sprint-as-text', 'legacy-sprint-by-key']);
        expect(legacy.update.sprintId).toEqual(oid(LEGACY_SPRINT));
    });

    test('a sprint without a legacy key matches both forms of its id', async () => {
        const [, current] = await relinked(updateTaksSprints);
        expect(current.found).toEqual(['folder-as-id', 'folder-as-text', 'folder-by-key', 'sprint-as-id', 'sprint-as-text']);
        expect(current.update.sprintId).toEqual(oid(SPRINT));
    });
});

describe('relinking tasks to their folders', () => {
    test('a folder with a legacy key matches it and both forms of its id', async () => {
        const [folder] = await relinked(updateTaksFolders);
        expect(folder.found).toEqual(['folder-as-id', 'folder-as-text', 'folder-by-key']);
        expect(folder.update.folderObjId).toEqual(oid(FOLDER));
    });
});
