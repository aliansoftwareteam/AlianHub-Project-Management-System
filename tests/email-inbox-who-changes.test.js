const verified = require('./fixtures/verifiedRequest');
const fakeMongo = require('./fixtures/fakeMongo');

let mockDb;
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...args) => mockDb.crud(...args) }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../Modules/Tasks/helpers/task_class_Mongo', () => ({ taskMongo: { create: jest.fn() } }));

const mongoose = require('mongoose');
const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const ctrl = require('../Modules/EmailIn/controller');

const C = 'c00000000000000000000001';
const OWNER = 'a00000000000000000000001';
const ADMIN = 'a00000000000000000000002';
const MAKER = 'a00000000000000000000003';
const OTHER = 'a00000000000000000000004';
const oid = () => new mongoose.Types.ObjectId().toString();

const listFor = async (uid) => {
    const res = { statusCode: 200, body: undefined };
    res.status = (code) => { res.statusCode = code; return res; };
    res.send = (payload) => { res.body = payload; return res; };
    res.json = res.send;
    await ctrl.listInboxes(verified({ uid, params: {}, body: {}, query: {}, headers: { companyid: C } }), res);
    return res.body.data;
};

beforeEach(() => {
    myCache.flushAll();
    mockDb = fakeMongo.create();
    [[OWNER, 1], [ADMIN, 2], [MAKER, 3], [OTHER, 3]].forEach(([userId, roleType]) => mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId, roleType, status: 2, isDelete: false }));
    const project = mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: oid(), ProjectName: 'Launch', isPrivateSpace: false, AssigneeUserId: [] });
    mockDb.seed(SCHEMA_TYPE.EMAIL_INBOXES, { _id: oid(), token: 'a'.repeat(32), companyId: C, name: 'Inbox', ProjectID: project._id, createdBy: MAKER, enabled: true, deletedStatusKey: 0 });
});

describe('the inbox list says who may change each inbox', () => {
    it.each([['its maker', MAKER], ['the owner', OWNER], ['an admin', ADMIN]])('marks it as theirs to change for %s', async (_label, uid) => {
        expect(await listFor(uid)).toEqual([expect.objectContaining({ name: 'Inbox', canManage: true })]);
    });

    it('shows it to another member of the project as one they cannot change', async () => {
        expect(await listFor(OTHER)).toEqual([expect.objectContaining({ name: 'Inbox', canManage: false })]);
    });
});
