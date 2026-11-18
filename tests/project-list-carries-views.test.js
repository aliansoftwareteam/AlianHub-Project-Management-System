/* The sidebar's project list is read once when a hidden tab reconnects (frontend liveProjects.js), so it has to carry
   everything the single project read carries, a view added a moment ago among it, past the list's cache. */
const verified = require('./fixtures/verifiedRequest');
const fakeMongo = require('./fixtures/fakeMongo');

let mockDb;
jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (...args) => mockDb.crud(...args),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));

const mongoose = require('mongoose');
const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { getProjectList } = require('../Modules/Project/controller/getProjectList');
const { getProjectById } = require('../Modules/Project/controller/getProjectById');
const { createView } = require('../Modules/Project/controller/viewSettings');

const C = 'c00000000000000000000001';
const OWNER = 'a00000000000000000000001';
const oid = () => new mongoose.Types.ObjectId().toString();
const LIST_VIEW = { _id: '6f00000000000000000000a1', id: '6f00000000000000000000a1', keyName: 'ProjectListView', name: 'List', title: 'List', viewStatus: true };

const response = () => {
    const res = { statusCode: 200, body: undefined };
    res.status = jest.fn((code) => { res.statusCode = code; return res; });
    res.json = jest.fn((body) => { res.body = body; return res; });
    res.send = res.json;
    res.set = jest.fn(() => res);
    return res;
};
const call = async (handler, { params = {}, body = {} } = {}) => {
    const res = response();
    await handler(verified({ uid: OWNER, query: {}, params, body, headers: { companyid: C } }), res, () => {});
    return res;
};
const plain = (value) => JSON.parse(JSON.stringify(value));

let projectId;
beforeEach(() => {
    myCache.flushAll();
    mockDb = fakeMongo.create();
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { _id: oid(), userId: OWNER, roleType: 1, status: 2, isDelete: false, companyId: C, userEmail: 'owner@e2e.test' });
    projectId = String(mockDb.seed(SCHEMA_TYPE.PROJECTS, {
        _id: oid(), ProjectName: 'Launch', isPrivateSpace: false, AssigneeUserId: [OWNER], deletedStatusKey: 0, legacyId: 'old-1',
        ProjectRequiredComponent: [LIST_VIEW], taskStatusData: [{ key: 1, name: 'To do' }], agentLimits: { paused: false },
    })._id);
});

it('lists each project as the single read answers it, but for the legacy id no screen reads', async () => {
    const [listed] = (await call(getProjectList)).body;
    const { legacyId, ...single } = plain((await call(getProjectById, { params: { id: projectId } })).body);
    expect(legacyId).toBe('old-1');
    expect(plain(listed)).toEqual(single);
});

it('carries a view added after the list was cached, as the single read does', async () => {
    expect((await call(getProjectList)).body[0].ProjectRequiredComponent).toHaveLength(1);
    const added = await call(createView, { params: { id: projectId }, body: { sourceViewId: LIST_VIEW._id, title: 'By Stage' } });
    expect(added.body).toMatchObject({ status: true });
    const [listed] = (await call(getProjectList)).body;
    const single = (await call(getProjectById, { params: { id: projectId } })).body;
    expect(listed.ProjectRequiredComponent.map((view) => view.title)).toEqual(['List', 'By Stage']);
    expect(plain(listed.ProjectRequiredComponent)).toEqual(plain(single.ProjectRequiredComponent));
});
