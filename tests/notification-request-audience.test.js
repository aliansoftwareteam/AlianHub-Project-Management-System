process.env.STORAGE_TYPE = process.env.STORAGE_TYPE || 'server';

const verified = require('./fixtures/verifiedRequest');
const fakeMongo = require('./fixtures/fakeMongo');

let mockDb;
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...args) => mockDb.crud(...args) }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../event/socketEventEmitter.js', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../Modules/notification-count/controller', () => ({ updateUnReadCommentsCountFun: jest.fn(async () => ({})) }));
jest.mock('../Modules/storage/wasabi/controller.js', () => ({ getUserProfilePresignedUrlCallBackFunction: jest.fn() }));
jest.mock('../Modules/Inbox/helpers/inboxState', () => ({ wakeOnActivity: jest.fn() }));

const mongoose = require('mongoose');
const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const ctrl = require('../Modules/notification/prepare-notification-data/controllerV2');

const C = 'c00000000000000000000001';
const OWNER = 'a00000000000000000000001';
const MEMBER = 'a00000000000000000000003';
const INSIDER = 'a00000000000000000000004';
const oid = () => new mongoose.Types.ObjectId().toString();

const notify = async (uid, body) => {
    const res = { statusCode: 200, body: undefined };
    res.status = jest.fn((code) => { res.statusCode = code; return res; });
    res.json = jest.fn((payload) => { res.body = payload; return res; });
    res.send = res.json;
    await ctrl.handleNotification(verified({ uid, params: {}, body, query: {}, headers: { companyid: C } }), res);
    return res;
};

let open;
let hidden;
let built;

beforeEach(() => {
    myCache.flushAll();
    mockDb = fakeMongo.create();
    [[OWNER, 1], [MEMBER, 3], [INSIDER, 3]].forEach(([userId, roleType]) => mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId, roleType, status: 2, isDelete: false }));
    open = String(mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: oid(), ProjectName: 'Launch', isPrivateSpace: false, AssigneeUserId: [] })._id);
    hidden = String(mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: oid(), ProjectName: 'Board', isPrivateSpace: true, AssigneeUserId: [INSIDER] })._id);
    built = jest.spyOn(ctrl, 'handleNotificationtFun').mockResolvedValue({ status: true, message: 'create notification data' });
});
afterEach(() => jest.restoreAllMocks());

const about = (projectId, extra = {}) => ({ key: 'project', type: 'project', projectId, message: 'Have a look', assigneeUsers: [OWNER, MEMBER, INSIDER], ...extra });

describe('a notification is asked for by someone who can open its project, for people who can', () => {
    it('goes to the members named when the project is open to the workspace', async () => {
        const res = await notify(MEMBER, about(open));
        expect(res.body).toMatchObject({ status: true });
        expect(built.mock.calls[0][0].body).toMatchObject({ userId: MEMBER, companyId: C, assigneeUsers: [OWNER, MEMBER, INSIDER] });
    });

    it('goes only to the people who can open a private project', async () => {
        const res = await notify(INSIDER, about(hidden, { task_leader_ID: MEMBER }));
        expect(res.body).toMatchObject({ status: true });
        expect(built.mock.calls[0][0].body).toMatchObject({ assigneeUsers: [OWNER, INSIDER], task_leader_ID: '' });
    });

    it.each([
        ['a project the caller cannot open', () => hidden],
        ['a project that does not exist', () => oid()],
        ['something that is not an id', () => ({ $ne: '' })],
        ['no project', () => undefined],
    ])('answers 404 for %s and notifies nobody', async (_label, idOf) => {
        const res = await notify(MEMBER, about(idOf()));
        expect(res.statusCode).toBe(404);
        expect(built).not.toHaveBeenCalled();
    });

    it('keeps the fields the server writes out of the request', async () => {
        await notify(MEMBER, about(open, { userId: OWNER, receiverID: OWNER, notificationType: 'email', Employee_Email: 'x@example.test', isSeen: true }));
        const sent = built.mock.calls[0][0].body;
        expect(sent.userId).toBe(MEMBER);
        expect(sent).not.toHaveProperty('receiverID');
        expect(sent).not.toHaveProperty('notificationType');
        expect(sent).not.toHaveProperty('Employee_Email');
        expect(sent).not.toHaveProperty('isSeen');
    });
});
