/* Task 040 phase 1b: comments.taskId is a Mixed path, so a task's comments are stored with the id
   as an ObjectId or as text and neither Mongoose nor an aggregate converts either side. Every read
   of a task's comments must find both forms; the literal 'default' still names the main chat. */
process.env.STORAGE_TYPE = 'server';
const mongoose = require('mongoose');
const sift = require('sift');

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../common-storage/common-server.js', () => ({ handleTaskAttachmentsDuplicateFunctionality: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Config/config', () => ({ myCache: { get: jest.fn(), set: jest.fn(), del: jest.fn() } }));
jest.mock('../Modules/AI/taskAccess', () => ({ visibleTask: jest.fn(async () => ({ _id: 'task', TaskName: 'Task' })), TASK_NOT_FOUND: 'task not found' }));
jest.mock('../Modules/AICore/llmProvider', () => ({ isAnyProviderConfigured: () => true, getProvider: jest.fn() }));
/* Who reads a thread is asked in tests/media-files-access.test.js; here every thread is open, so the filters are what is read. */
jest.mock('../Modules/Comments/helpers/threadAccess', () => ({ commentThreadAccess: jest.fn(async () => ({ allowed: true, match: {} })), refuseThread: jest.fn() }));

const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const { addCommentCollection } = require('../Modules/Comments/controller');
const { summarizeTask } = require('../Modules/AI/taskSummary');
const { TOOLS } = require('../Modules/Mcp/dataTools');
const { getPaginateMediaFiles, getMediaFileUsers } = require('../Modules/MediaFiles/controller');

const oid = (id) => new mongoose.Types.ObjectId(id);
const COMPANY = '6a9954186dd786246031e47b';
const PROJECT = '6a9954186dd786246031e47d';
const SPRINT = '6a9954186dd786246031e47e';
const TASK = '6a9954186dd786246031e47f';

const comment = (id, taskId, extra = {}) => ({
    _id: id, projectId: oid(PROJECT), sprintId: oid(SPRINT), project: false, isDeleted: false, taskId, message: `note ${id}`, ...extra,
});
const rowsOfType = (type) => [
    comment('as-object-id', oid(TASK), { type }),
    comment('as-text', TASK, { type }),
    comment('main-chat', 'default', { type }),
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
const found = (filter, rows) => rows.filter((row) => sift(bson(filter))(bson(row))).map((row) => row._id).sort();

const respond = () => {
    const res = {};
    res.status = jest.fn(() => res);
    res.json = jest.fn(() => res);
    return res;
};
const commentCalls = (method) => MongoDbCrudOpration.mock.calls.filter(([, { type }, m]) => type === 'comments' && m === method);
const onlyCall = (method) => {
    const calls = commentCalls(method);
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe(COMPANY);
    return calls[0][1].data;
};
const mediaRequest = (handleType, selected, extra = {}) => ({
    headers: { companyid: COMPANY },
    query: { handleType, fromWhich: handleType, selectedData: JSON.stringify(selected), mediaTypes: '["audio"]', skip: '0', batchSize: '20', ...extra },
});
const TASK_SELECTED = { _id: TASK, ProjectID: PROJECT, sprintId: SPRINT };

beforeEach(() => {
    MongoDbCrudOpration.mockReset();
    MongoDbCrudOpration.mockImplementation(async (companyId, { type }, method) => {
        if (type === 'tasks' && method === 'findOne') return { _id: oid(TASK), ProjectID: oid(PROJECT), sprintId: oid(SPRINT) };
        return [];
    });
});

describe('a task\'s comments are found whichever form stored the task id', () => {
    test('copying a task copies both forms of its comments', async () => {
        await addCommentCollection(COMPANY, { id: PROJECT }, { _id: oid(TASK) }, { id: TASK }, { id: SPRINT });
        const [filter] = onlyCall('find');
        expect(found(filter, rowsOfType('text'))).toEqual(['as-object-id', 'as-text']);
    });

    test('the AI summary reads both forms of the thread', async () => {
        await summarizeTask({ companyId: COMPANY, uid: 'user', taskId: TASK });
        const [[{ $match }]] = onlyCall('aggregate');
        expect(found($match, rowsOfType('text'))).toEqual(['as-object-id', 'as-text']);
    });

    test('the MCP comments.list tool lists both forms', async () => {
        const tool = TOOLS.find((t) => t.name === 'comments.list');
        await tool.run({ companyId: COMPANY, userId: 'user' }, { taskId: TASK }, { allowsTask: () => true });
        const [filter] = onlyCall('find');
        expect(found(filter, rowsOfType('text'))).toEqual(['as-object-id', 'as-text']);
    });

    test.each(['task', 'chat'])('the %s media gallery lists both forms', async (handleType) => {
        const res = respond();
        await getPaginateMediaFiles(mediaRequest(handleType, TASK_SELECTED), res);
        expect(res.status).toHaveBeenCalledWith(200);
        const [[pipeline]] = onlyCall('aggregate');
        expect(found(pipeline[0].$match, rowsOfType('audio'))).toEqual(['as-object-id', 'as-text']);
    });

    test.each(['task', 'chat'])('the %s audio senders list counts both forms', async (fromWhich) => {
        const res = respond();
        await getMediaFileUsers(mediaRequest(fromWhich, TASK_SELECTED), res);
        expect(res.status).toHaveBeenCalledWith(200);
        const [pipeline] = onlyCall('aggregate');
        expect(found(pipeline[0].$match, rowsOfType('audio'))).toEqual(['as-object-id', 'as-text']);
    });
});

describe("'default' still names the main chat in the media views", () => {
    const MAIN_CHAT = { _id: 'default', ProjectID: PROJECT, sprintId: SPRINT };

    test('media gallery', async () => {
        await getPaginateMediaFiles(mediaRequest('chat', MAIN_CHAT), respond());
        const [[pipeline]] = onlyCall('aggregate');
        expect(found(pipeline[0].$match, rowsOfType('audio'))).toEqual(['main-chat']);
    });

    test('audio senders list', async () => {
        await getMediaFileUsers(mediaRequest('chat', MAIN_CHAT), respond());
        const [pipeline] = onlyCall('aggregate');
        expect(found(pipeline[0].$match, rowsOfType('audio'))).toEqual(['main-chat']);
    });
});
