const fakeMongo = require('./fixtures/fakeMongo');

let mockDb;
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...args) => mockDb.crud(...args) }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../Modules/Pages/helpers/pageAi', () => ({ composePage: jest.fn(), isAiConfigured: jest.fn(() => false) }));
jest.mock('../Config/contentAccess', () => ({
    projectAccess: jest.fn(async () => ({ visible: true, canEdit: true })),
    isCompanyMember: jest.fn(async () => true),
    isCompanyAdmin: jest.fn(async () => false),
    visibleProjectIds: jest.fn(async () => []),
}));
jest.mock('../Modules/notification/prepare-notification-data/controllerV2', () => ({
    handleSingleNotification: jest.fn(async () => []),
    handleNotificationtFun: jest.fn(async () => ({ status: true })),
}));

const mongoose = require('mongoose');
const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { NOT_A_MEMBER } = require('../Config/companyMembers');
const { CANNOT_OPEN_PROJECT } = require('../Config/projectPeople');
const ctrl = require('../Modules/Pages/controller');

const C = '6f00000000000000000000c1';
const AUTHOR = '6f0000000000000000000001';
const ON_PROJECT = '6f0000000000000000000002';
const NOT_ON_PROJECT = '6f0000000000000000000003';
const LEFT = '6f0000000000000000000004';
const oid = () => new mongoose.Types.ObjectId().toString();

const call = async (handler, { params = {}, body = {} } = {}) => {
    const res = { statusCode: 200, body: undefined };
    res.status = jest.fn((code) => { res.statusCode = code; return res; });
    res.send = jest.fn((payload) => { res.body = payload; return res; });
    res.json = res.send;
    await handler({ uid: AUTHOR, aud: C, headers: { companyid: C }, params, query: {}, body }, res);
    return res;
};
const pages = () => mockDb.store[SCHEMA_TYPE.PAGES] || [];

const OUTSIDERS = [
    ['someone who left the workspace', LEFT, NOT_A_MEMBER],
    ['a member who cannot open the project', NOT_ON_PROJECT, CANNOT_OPEN_PROJECT],
];

let project;

beforeEach(() => {
    myCache.flushAll();
    mockDb = fakeMongo.create();
    [[AUTHOR, false], [ON_PROJECT, false], [NOT_ON_PROJECT, false], [LEFT, true]].forEach(([userId, isDelete]) => mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId, roleType: 3, status: 2, isDelete }));
    project = String(mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: oid(), ProjectName: 'Board', isPrivateSpace: true, AssigneeUserId: [AUTHOR, ON_PROJECT, LEFT] })._id);
});

describe('the owner of a doc', () => {
    const seeded = (ownerId) => String(mockDb.seed(SCHEMA_TYPE.PAGES, {
        _id: oid(), title: 'Launch plan', ProjectID: project, visibility: 'project', createdBy: AUTHOR, ownerId, deletedStatusKey: 0,
        content: { html: '', blocks: { time: 1, blocks: [], version: '2.30.7' } },
    })._id);

    it('is a member who can open the doc\'s project', async () => {
        const res = await call(ctrl.createPage, { body: { title: 'Launch plan', projectId: project, ownerId: ON_PROJECT } });
        expect(res.body).toMatchObject({ status: true });
        expect(pages()[0].ownerId).toBe(ON_PROJECT);
    });

    it.each(OUTSIDERS)('answers 400 when %s is named on a new doc', async (_label, ownerId, reason) => {
        const res = await call(ctrl.createPage, { body: { title: 'Launch plan', projectId: project, ownerId } });
        expect(res.body).toMatchObject({ status: false, statusCode: 400, statusText: reason });
        expect(pages()).toHaveLength(0);
    });

    it.each(OUTSIDERS)('answers 400 when %s is named on a saved doc', async (_label, ownerId, reason) => {
        const id = seeded(ON_PROJECT);
        const res = await call(ctrl.updatePage, { params: { id }, body: { ownerId, isWiki: true } });
        expect(res.body).toMatchObject({ status: false, statusCode: 400, statusText: reason });
        expect(pages()[0]).toMatchObject({ ownerId: ON_PROJECT });
        expect(pages()[0].isWiki).not.toBe(true);
    });

    it('stays when a doc whose owner has left is saved with the same owner', async () => {
        const id = seeded(LEFT);
        const res = await call(ctrl.updatePage, { params: { id }, body: { ownerId: LEFT, isWiki: true } });
        expect(res.body).toMatchObject({ status: true });
        expect(pages()[0]).toMatchObject({ ownerId: LEFT, isWiki: true });
    });

    it('is a member of the workspace on a doc that belongs to no project', async () => {
        expect((await call(ctrl.createPage, { body: { title: 'Handbook', ownerId: LEFT } })).body).toMatchObject({ status: false, statusCode: 400 });
        expect((await call(ctrl.createPage, { body: { title: 'Handbook', ownerId: NOT_ON_PROJECT } })).body).toMatchObject({ status: true });
    });
});
