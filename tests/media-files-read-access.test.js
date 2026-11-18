const verified = require('./fixtures/verifiedRequest');
const fakeMongo = require('./fixtures/fakeMongo');

let mockDb;

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...args) => mockDb.crud(...args) }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../Modules/PersonalList/ownership', () => ({ othersPersonalListIds: jest.fn(async () => []) }));

const mongoose = require('mongoose');
const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const media = require('../Modules/MediaFiles/controller');

const C = 'c00000000000000000000001';
const OWNER = 'a00000000000000000000001';
const ON_PROJECT = 'a00000000000000000000002';
const ON_LIST = 'a00000000000000000000003';
const ELSEWHERE = 'a00000000000000000000004';
const GUEST = 'a00000000000000000000005';
const oid = () => new mongoose.Types.ObjectId();

let project;
let openList;
let privateList;
let openTask;
let privateTask;
let space;
let direct;

const fileOf = (extra) => mockDb.seed(SCHEMA_TYPE.COMMENTS, { _id: oid(), type: 'audio', isDeleted: false, userId: ON_LIST, mediaName: 'memo.webm', mediaOriginalName: 'memo.webm', ...extra });

const call = async (handler, uid, query) => {
    const res = { statusCode: 200, body: undefined };
    res.status = jest.fn((code) => { res.statusCode = code; return res; });
    res.json = jest.fn((payload) => { res.body = payload; return res; });
    res.send = res.json;
    await handler(verified({ uid, params: {}, body: {}, query, headers: { companyid: C } }), res);
    return res;
};

const files = (uid, handleType, selected, extra = {}) => call(media.getPaginateMediaFiles, uid, {
    handleType, selectedData: JSON.stringify(selected), mediaTypes: JSON.stringify(['audio']), selectedOrder: '0', skip: '0', batchSize: '50', ...extra,
});
const senders = (uid, fromWhich, selected) => call(media.getMediaFileUsers, uid, { fromWhich, selectedData: JSON.stringify(selected) });
const commentReads = () => mockDb.calls.filter((entry) => entry.type === SCHEMA_TYPE.COMMENTS);
const namesIn = (res) => (res.body || []).map((row) => row.mediaName).sort();

const ofProject = () => ({ _id: String(project) });
const ofTask = (task, list) => ({ ProjectID: String(project), sprintId: String(list), _id: String(task) });
const ofDirect = () => ({ ProjectID: String(space), sprintId: String(openList), _id: String(direct) });

beforeEach(() => {
    myCache.flushAll();
    mockDb = fakeMongo.create();
    [[OWNER, 1], [ON_PROJECT, 3], [ON_LIST, 3], [ELSEWHERE, 3], [GUEST, 0]].forEach(([userId, roleType]) => mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId, roleType, status: 2, isDelete: false }));
    const taskRules = mockDb.seed(SCHEMA_TYPE.RULES, { key: 'task', name: 'task', isParent: true, roles: [] });
    mockDb.seed(SCHEMA_TYPE.RULES, { key: 'task_list', name: 'task_list', isParent: false, parentId: String(taskRules._id), roles: [{ key: 3, permission: true }] });
    project = mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: oid(), ProjectName: 'Board', isPrivateSpace: true, AssigneeUserId: [ON_PROJECT, ON_LIST] })._id;
    openList = mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: oid(), projectId: project, name: 'Open', private: false, deletedStatusKey: 0 })._id;
    privateList = mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: oid(), projectId: project, name: 'Closed', private: true, AssigneeUserId: [ON_LIST], deletedStatusKey: 0 })._id;
    openTask = mockDb.seed(SCHEMA_TYPE.TASKS, { _id: oid(), ProjectID: project, sprintId: openList, TaskName: 'Open task' })._id;
    privateTask = mockDb.seed(SCHEMA_TYPE.TASKS, { _id: oid(), ProjectID: project, sprintId: privateList, TaskName: 'Closed task' })._id;
    space = mockDb.seed(SCHEMA_TYPE.MAIN_CHATS, { _id: oid(), default: true })._id;
    direct = mockDb.seed(SCHEMA_TYPE.TASKS, { _id: oid(), ProjectID: space, sprintId: openList, mainChat: true, AssigneeUserId: [ON_PROJECT, ON_LIST] })._id;

    fileOf({ projectId: project, project: true, mediaName: 'project.webm' });
    fileOf({ projectId: project, project: false, sprintId: openList, taskId: openTask, mediaName: 'open-task.webm' });
    fileOf({ projectId: project, project: false, sprintId: privateList, taskId: privateTask, mediaName: 'closed-task.webm' });
    fileOf({ projectId: space, project: false, sprintId: openList, taskId: direct, mediaName: 'direct.webm' });
    mockDb.calls.length = 0;
});

describe('the files of a project, a task or a conversation are read by who can open it', () => {
    it('lists a project\'s files to someone on the project', async () => {
        const res = await files(ON_PROJECT, 'project', ofProject());
        expect(res.statusCode).toBe(200);
        expect(namesIn(res)).toEqual(['project.webm']);
        expect((await senders(ON_PROJECT, 'project', ofProject())).body).toEqual([expect.objectContaining({ _id: ON_LIST, count: 1 })]);
    });

    it('lists a task\'s files to someone who can open the task', async () => {
        expect(namesIn(await files(ON_PROJECT, 'task', ofTask(openTask, openList)))).toEqual(['open-task.webm']);
        expect(namesIn(await files(ON_LIST, 'task', ofTask(privateTask, privateList)))).toEqual(['closed-task.webm']);
        expect(namesIn(await files(OWNER, 'task', ofTask(privateTask, privateList)))).toEqual(['closed-task.webm']);
    });

    it('lists a direct conversation\'s files to the people in it', async () => {
        expect(namesIn(await files(ON_PROJECT, 'chat', ofDirect()))).toEqual(['direct.webm']);
    });

    it.each([
        ['a member who is not on the project', ELSEWHERE, 'project', ofProject],
        ['a guest who is not on the project', GUEST, 'project', ofProject],
        ['a member who is not on the project, for a task of it', ELSEWHERE, 'task', () => ofTask(openTask, openList)],
        ['a member who is not on the private list', ON_PROJECT, 'task', () => ofTask(privateTask, privateList)],
        ['a member who is not in the direct conversation', ELSEWHERE, 'chat', ofDirect],
        ['an owner who is not in the direct conversation', OWNER, 'chat', ofDirect],
    ])('answers 404 to %s, and reads no comment', async (_label, uid, kind, selected) => {
        for (const res of [await files(uid, kind, selected()), await senders(uid, kind, selected())]) {
            expect(res.statusCode).toBe(404);
            expect(JSON.stringify(res.body)).not.toMatch(/webm/);
        }
        expect(commentReads()).toHaveLength(0);
    });

    it.each([
        ['a kind of place it does not know', 'everything', () => ({})],
        ['a task id that is not an id', 'task', () => ({ ProjectID: String(project), sprintId: String(openList), _id: { $ne: null } })],
        ['a list id that is not an id', 'task', () => ({ ProjectID: String(project), sprintId: { $ne: null }, _id: String(openTask) })],
        ['a project id that is not an id', 'project', () => ({ _id: { $ne: null } })],
    ])('answers 400 to %s, and reads no comment', async (_label, kind, selected) => {
        for (const res of [await files(OWNER, kind, selected()), await senders(OWNER, kind, selected())]) {
            expect(res.statusCode).toBe(400);
        }
        expect(commentReads()).toHaveLength(0);
    });

    it('answers 400 to people to search by that are not ids', async () => {
        const res = await files(ON_PROJECT, 'project', ofProject(), { searchByUserId: JSON.stringify([{ $ne: null }]) });
        expect(res.statusCode).toBe(400);
        expect(commentReads()).toHaveLength(0);
    });
});
