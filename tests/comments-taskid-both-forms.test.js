/* Task 040 phase 1: comments.taskId is a Mixed path, so a task's comments are stored with the id
   as an ObjectId or as text, and Mongoose does not convert either side. A read must find both,
   and the literal 'default' still names the main chat thread. */
process.env.STORAGE_TYPE = 'server';
const mongoose = require('mongoose');
const sift = require('sift');

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../common-storage/common-server.js', () => ({ handleTaskAttachmentsDuplicateFunctionality: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Modules/Comments/helpers/threadAccess', () => ({
    commentThreadAccess: jest.fn(async () => ({ allowed: true, match: {} })),
    refuseThread: jest.fn(),
}));

const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const { getPaginatedMessages, searchMessageFromMainChat, updateCommentCollection } = require('../Modules/Comments/controller');

const oid = (id) => new mongoose.Types.ObjectId(id);
const COMPANY = '6a9954186dd786246031e47b';
const USER = '6a9954186dd786246031e47c';
const PROJECT = '6a9954186dd786246031e47d';
const SPRINT = '6a9954186dd786246031e47e';
const TASK = '6a9954186dd786246031e47f';
const NEW_SPRINT = '6a9954186dd786246031e480';
const NEW_PROJECT = '6a9954186dd786246031e481';
const NEW_TASK = '6a9954186dd786246031e482';

const comment = (id, taskId, extra = {}) => ({ _id: id, projectId: oid(PROJECT), sprintId: oid(SPRINT), taskId, message: `note ${id}`, ...extra });
const ROWS = [
    comment('as-object-id', oid(TASK)),
    comment('as-text', TASK),
    comment('main-chat', 'default'),
    comment('project-thread', undefined, { project: true, sprintId: undefined }),
];

/* The server compares BSON types strictly: an ObjectId equals only an ObjectId. Tagging ids as
   plain objects keeps sift from reading them as their hex text. */
const bson = (value) => {
    if (value instanceof mongoose.Types.ObjectId) return { objectId: value.toHexString() };
    if (Array.isArray(value)) return value.map(bson);
    if (value && typeof value === 'object' && !(value instanceof Date) && !(value instanceof RegExp)) {
        return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, bson(v)]));
    }
    return value;
};
const found = (filter) => ROWS.filter((row) => sift(bson(filter))(bson(row))).map((row) => row._id).sort();

const respond = () => {
    const res = {};
    res.status = jest.fn(() => res);
    res.json = jest.fn(() => res);
    return res;
};

const lastQuery = () => MongoDbCrudOpration.mock.calls[MongoDbCrudOpration.mock.calls.length - 1];

beforeEach(() => {
    MongoDbCrudOpration.mockReset();
    MongoDbCrudOpration.mockResolvedValue([]);
});

describe('a task thread finds comments whichever form stored the task id', () => {
    test('paginated messages', async () => {
        const res = respond();
        await getPaginatedMessages({ headers: { companyid: COMPANY }, uid: USER, query: { projectId: PROJECT, sprintId: SPRINT, taskId: TASK } }, res);
        expect(res.status).toHaveBeenCalledWith(200);
        const [companyId, { data: [pipeline] }, method] = lastQuery();
        expect([companyId, method]).toEqual([COMPANY, 'aggregate']);
        expect(found(pipeline[0].$match)).toEqual(['as-object-id', 'as-text']);
    });

    test('the main chat search box', async () => {
        const res = respond();
        await searchMessageFromMainChat({ headers: { companyid: COMPANY }, uid: USER, query: { projectId: PROJECT, sprintId: SPRINT, taskId: TASK } }, res);
        expect(res.status).toHaveBeenCalledWith(200);
        const [companyId, { data: [filter] }, method] = lastQuery();
        expect([companyId, method]).toEqual([COMPANY, 'find']);
        expect(found(filter)).toEqual(['as-object-id', 'as-text']);
    });

    test('moving a task carries both forms of its comments', async () => {
        await updateCommentCollection(COMPANY, { _id: oid(TASK), sprintId: SPRINT }, { id: NEW_SPRINT }, { id: NEW_PROJECT }, NEW_TASK);
        const [companyId, { data: [filter] }, method] = lastQuery();
        expect([companyId, method]).toEqual([COMPANY, 'updateMany']);
        expect(found(filter)).toEqual(['as-object-id', 'as-text']);
    });
});

describe("'default' still names the main chat thread", () => {
    test('paginated messages', async () => {
        await getPaginatedMessages({ headers: { companyid: COMPANY }, uid: USER, query: { projectId: PROJECT, sprintId: SPRINT, taskId: 'default' } }, respond());
        expect(found(lastQuery()[1].data[0][0].$match)).toEqual(['main-chat']);
    });

    test('the main chat search box', async () => {
        await searchMessageFromMainChat({ headers: { companyid: COMPANY }, uid: USER, query: { projectId: PROJECT, sprintId: SPRINT, taskId: 'default' } }, respond());
        expect(found(lastQuery()[1].data[0])).toEqual(['main-chat']);
    });
});
