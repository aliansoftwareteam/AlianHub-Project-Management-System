const verified = require('./fixtures/verifiedRequest');
const fakeMongo = require('./fixtures/fakeMongo');

let mockDb;
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...args) => mockDb.crud(...args) }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));

const mongoose = require('mongoose');
const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const ctrl = require('../Modules/UserDashboard/controller');

const C = 'c00000000000000000000001';
const OWNER = 'a00000000000000000000001';
const MEMBER = 'a00000000000000000000003';
const OTHER = 'a00000000000000000000004';
const oid = () => new mongoose.Types.ObjectId().toString();

const call = async (handler, { uid = MEMBER, params = {}, body = {} } = {}) => {
    const res = { statusCode: 200, body: undefined };
    res.status = jest.fn((code) => { res.statusCode = code; return res; });
    res.json = jest.fn((payload) => { res.body = payload; return res; });
    res.send = res.json;
    res.set = jest.fn(() => res);
    await handler(verified({ uid, params, body, query: {}, headers: { companyid: C } }), res);
    return res;
};

const dashboards = () => mockDb.store[SCHEMA_TYPE.USERDASHBOARD] || [];

let open;
let hidden;

beforeEach(() => {
    myCache.flushAll();
    mockDb = fakeMongo.create();
    [[OWNER, 1], [MEMBER, 3], [OTHER, 3]].forEach(([userId, roleType]) => mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId, roleType, status: 2, isDelete: false }));
    open = String(mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: oid(), ProjectName: 'Launch', isPrivateSpace: false, AssigneeUserId: [] })._id);
    hidden = String(mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: oid(), ProjectName: 'Board', isPrivateSpace: true, AssigneeUserId: [OTHER] })._id);
});

describe('a dashboard is shared with a project its owner can open', () => {
    it('is made for a project the caller can open', async () => {
        const res = await call(ctrl.createSharedDashboard, { body: { title: 'Launch numbers', visibility: 'project', projectId: open } });
        expect(res.body).toMatchObject({ status: true });
        expect(dashboards()[0]).toMatchObject({ visibility: 'project', projectId: open, ownerId: MEMBER });
    });

    it.each([
        ['a project the caller cannot open', () => hidden],
        ['a project that does not exist', () => oid()],
        ['something that is not an id', () => ({ $ne: '' })],
    ])('answers 404 when it is made for %s', async (_label, idOf) => {
        const res = await call(ctrl.createSharedDashboard, { body: { title: 'For them', visibility: 'project', projectId: idOf() } });
        expect(res.statusCode).toBe(404);
        expect(dashboards()).toHaveLength(0);
    });

    it('answers 404 when its owner moves it to a project they cannot open, and leaves it where it was', async () => {
        const mine = mockDb.seed(SCHEMA_TYPE.USERDASHBOARD, { _id: oid(), ownerId: MEMBER, userId: MEMBER, visibility: 'private', projectId: '', title: 'Mine', cards: [], isDeleted: false });
        const res = await call(ctrl.updateSharedDashboard, { params: { id: String(mine._id) }, body: { visibility: 'project', projectId: hidden } });
        expect(res.statusCode).toBe(404);
        expect(dashboards()[0]).toMatchObject({ visibility: 'private', projectId: '' });

        const moved = await call(ctrl.updateSharedDashboard, { params: { id: String(mine._id) }, body: { visibility: 'project', projectId: open } });
        expect(moved.body).toMatchObject({ status: true });
        expect(dashboards()[0]).toMatchObject({ visibility: 'project', projectId: open });
    });

    it('lets the owner of a private project share a dashboard with it', async () => {
        const res = await call(ctrl.createSharedDashboard, { uid: OTHER, body: { title: 'Board numbers', visibility: 'project', projectId: hidden } });
        expect(res.body).toMatchObject({ status: true });
    });
});
