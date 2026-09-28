/* Relinking a migrated project's tasks and comments to its sprints and folders runs one updateMany
   per sprint or folder. migrateProject waits on these functions, so each must settle only after
   every one of its updates has run, not as soon as the sprints or folders are read. */
process.env.STORAGE_TYPE = 'server';
const mongoose = require('mongoose');

const mockCrud = jest.fn();
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockCrud(...a) }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../common-storage/common-server.js', () => ({ handleTaskAttachmentsDuplicateFunctionality: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));

const { updateTaksSprints, updateTaksFolders } = require('../Modules/projectSetting/controller');
const { updateCommentSprint } = require('../Modules/Comments/controller');

const oid = (id) => new mongoose.Types.ObjectId(id);
const C = '6f0000000000000000000c01';
const PROJECT = '6f0000000000000000000b01';
const SPRINT_A = '6f0000000000000000000e01';
const SPRINT_B = '6f0000000000000000000e02';
const FOLDER = '6f0000000000000000000f01';

const SPRINTS = [
    { _id: oid(SPRINT_A), legacyId: 'firebase-sprint', projectId: oid(PROJECT) },
    { _id: oid(SPRINT_B), projectId: oid(PROJECT) },
];
const FOLDERS = [{ _id: oid(FOLDER), legacyId: 'firebase-folder', projectId: oid(PROJECT) }];

const later = (ms, value) => new Promise((resolve) => setTimeout(() => resolve(value), ms));

let applied;
beforeEach(() => {
    applied = [];
    mockCrud.mockReset();
    mockCrud.mockImplementation((companyId, { type, data }, method) => {
        expect(companyId).toBe(C);
        if (method === 'find' && type === 'sprints') return later(5, SPRINTS);
        if (method === 'find' && type === 'folders') return later(5, FOLDERS);
        if (method === 'updateMany') {
            return later(10).then(() => {
                applied.push({ type, set: String(Object.values(data[1])[0]) });
                return { modifiedCount: 1 };
            });
        }
        return later(0, []);
    });
});

test('tasks are relinked to every sprint before updateTaksSprints settles', async () => {
    await updateTaksSprints(PROJECT, C);
    expect(applied).toEqual([{ type: 'tasks', set: SPRINT_A }, { type: 'tasks', set: SPRINT_B }]);
});

test('tasks are relinked to every folder before updateTaksFolders settles', async () => {
    await updateTaksFolders(PROJECT, C);
    expect(applied).toEqual([{ type: 'tasks', set: FOLDER }]);
});

test('comments are relinked to every legacy sprint before updateCommentSprint settles', async () => {
    await updateCommentSprint(PROJECT, C);
    expect(applied).toEqual([{ type: 'comments', set: SPRINT_A }]);
});
