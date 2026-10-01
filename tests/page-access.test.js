const verified = require('./fixtures/verifiedRequest');
const fakeMongo = require('./fixtures/fakeMongo');

let mockDb;
jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (...args) => mockDb.crud(...args),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Modules/Pages/helpers/pageAi', () => ({ composePage: jest.fn(), isAiConfigured: () => false }));

const mongoose = require('mongoose');
const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const socketEmitter = require('../event/socketEventEmitter');
const pages = require('../Modules/Pages/controller');

const C = 'c00000000000000000000001';
const OWNER = 'a00000000000000000000001';
const ADMIN = 'a00000000000000000000002';
const AUTHOR = 'a00000000000000000000003';
const EDITOR = 'a00000000000000000000004';
const MEMBER_ROLE = 3;
const OTHER_ROLE = 7;

const oid = () => new mongoose.Types.ObjectId().toString();

const response = () => {
    const res = { statusCode: 200, body: undefined };
    res.status = jest.fn((code) => { res.statusCode = code; return res; });
    res.send = jest.fn((body) => { res.body = body; return res; });
    res.json = res.send;
    return res;
};

const call = async (handler, { uid, params = {}, body = {}, query = {} }) => {
    const res = response();
    await handler(verified({ uid, params, body, query, headers: { companyid: C } }), res);
    return res.body;
};

const seedRuleWithoutMemberRow = () => {
    const parent = mockDb.seed(SCHEMA_TYPE.RULES, { _id: oid(), key: 'project', isParent: true, roles: [{ key: MEMBER_ROLE, permission: true }] });
    mockDb.seed(SCHEMA_TYPE.RULES, { _id: oid(), key: 'private_projects', isParent: false, parentId: String(parent._id), roles: [{ key: OTHER_ROLE, permission: 2 }] });
};

const seedProject = (doc = {}) => String(mockDb.seed(SCHEMA_TYPE.PROJECTS, {
    _id: oid(), ProjectName: 'Launch', isPrivateSpace: true, AssigneeUserId: [OWNER], deletedStatusKey: 0, ...doc,
})._id);

const seedPage = (doc = {}) => String(mockDb.seed(SCHEMA_TYPE.PAGES, {
    _id: oid(), title: 'Launch plan', visibility: 'project', createdBy: AUTHOR, updatedBy: AUTHOR, deletedStatusKey: 0, order: 1, ...doc,
})._id);

const stored = (id) => mockDb.store[SCHEMA_TYPE.PAGES].find((p) => String(p._id) === id);

beforeEach(() => {
    myCache.flushAll();
    jest.clearAllMocks();
    mockDb = fakeMongo.create();
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: OWNER, roleType: 1, status: 2, isDelete: false });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: ADMIN, roleType: 2, status: 2, isDelete: false });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: AUTHOR, roleType: MEMBER_ROLE, status: 2, isDelete: false });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: EDITOR, roleType: MEMBER_ROLE, status: 2, isDelete: false });
    seedRuleWithoutMemberRow();
});

describe('a doc in a private project, for a member whose role has no row in the private project rule', () => {
    it('answers not found to a member who is not assigned to the project', async () => {
        const projectId = seedProject();
        const pageId = seedPage({ ProjectID: projectId, createdBy: OWNER });

        expect(await call(pages.getPage, { uid: EDITOR, params: { id: pageId } })).toEqual({ status: false, statusText: 'Page not found.' });
        for (const query of [{ projectId }, { scope: 'all' }]) {
            const list = await call(pages.listPages, { uid: EDITOR, query });
            expect(list).toMatchObject({ status: true, data: [] });
        }
    });

    it('serves it to a member who is assigned to the project', async () => {
        const projectId = seedProject({ AssigneeUserId: [EDITOR] });
        const pageId = seedPage({ ProjectID: projectId, createdBy: OWNER });

        expect(await call(pages.getPage, { uid: EDITOR, params: { id: pageId } })).toMatchObject({ status: true, data: { title: 'Launch plan' } });
        const list = await call(pages.listPages, { uid: EDITOR, query: { projectId } });
        expect(list.data.map((p) => String(p._id))).toEqual([pageId]);
    });

    it('serves it to a member assigned through a team', async () => {
        const team = mockDb.seed(SCHEMA_TYPE.TEAMS_MANAGEMENT, { _id: oid(), name: 'Core', assigneeUsersArray: [EDITOR] });
        const projectId = seedProject({ AssigneeUserId: [`tId_${team._id}`] });
        const pageId = seedPage({ ProjectID: projectId, createdBy: OWNER });

        expect(await call(pages.getPage, { uid: EDITOR, params: { id: pageId } })).toMatchObject({ status: true });
    });
});

describe('switching a doc to private', () => {
    let pageId;
    beforeEach(() => {
        pageId = seedPage({ ProjectID: seedProject({ isPrivateSpace: false, AssigneeUserId: [] }) });
    });

    it.each([
        ['another member who can edit the doc', EDITOR],
        ['an admin', ADMIN],
        ['the workspace owner', OWNER],
    ])('refuses %s and changes nothing', async (_label, uid) => {
        const before = { ...stored(pageId) };
        const res = await call(pages.updatePage, { uid, params: { id: pageId }, body: { visibility: 'private', title: 'Renamed' } });

        expect(res).toMatchObject({ status: false });
        expect(res.data).toBeUndefined();
        expect(stored(pageId)).toEqual(before);
        expect(socketEmitter.emit).not.toHaveBeenCalled();
        expect(await call(pages.getPage, { uid: AUTHOR, params: { id: pageId } })).toMatchObject({ status: true, data: { visibility: 'project', title: 'Launch plan' } });
    });

    it('lets the author make it private, and back', async () => {
        const made = await call(pages.updatePage, { uid: AUTHOR, params: { id: pageId }, body: { visibility: 'private' } });
        expect(made).toMatchObject({ status: true });
        expect(stored(pageId).visibility).toBe('private');
        expect(await call(pages.getPage, { uid: EDITOR, params: { id: pageId } })).toEqual({ status: false, statusText: 'Page not found.' });

        const shared = await call(pages.updatePage, { uid: AUTHOR, params: { id: pageId }, body: { visibility: 'project' } });
        expect(shared).toMatchObject({ status: true });
        expect(stored(pageId).visibility).toBe('project');
    });

    it('still lets another member edit a shared doc, and send the visibility it already has', async () => {
        const res = await call(pages.updatePage, { uid: EDITOR, params: { id: pageId }, body: { visibility: 'project', title: 'Renamed' } });
        expect(res).toMatchObject({ status: true });
        expect(stored(pageId)).toMatchObject({ title: 'Renamed', visibility: 'project', updatedBy: EDITOR });
    });

    it('lets the author keep editing a doc that is already private', async () => {
        const mine = seedPage({ visibility: 'private' });
        const res = await call(pages.updatePage, { uid: AUTHOR, params: { id: mine }, body: { visibility: 'private', title: 'Renamed' } });
        expect(res).toMatchObject({ status: true });
        expect(stored(mine)).toMatchObject({ title: 'Renamed', visibility: 'private' });
    });
});
