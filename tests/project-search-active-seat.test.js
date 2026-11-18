const verified = require('./fixtures/verifiedRequest');
const fakeMongo = require('./fixtures/fakeMongo');

let mockDb;
jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (...args) => mockDb.crud(...args),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));

const mongoose = require('mongoose');
const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { projectFilter } = require('../Modules/Project/controller/getProjectFilterData');
const { getSprintFolder } = require('../Modules/Project/controller/getSprintFolder');

const C = 'c00000000000000000000001';
const OWNER = 'a00000000000000000000001';
const ADMIN = 'a00000000000000000000002';
const MEMBER = 'a00000000000000000000003';
const CALLER = 'a00000000000000000000009';

const oid = () => new mongoose.Types.ObjectId().toString();

const seedSeat = (userId, roleType, seat = {}) => mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId, roleType, status: 2, isDelete: false, ...seat });

const seedProject = (doc = {}) => String(mockDb.seed(SCHEMA_TYPE.PROJECTS, {
    _id: oid(), ProjectName: 'Launch', isPrivateSpace: true, AssigneeUserId: [OWNER], deletedStatusKey: 0, statusType: 'active', ...doc,
})._id);

const call = async (handler, { uid, body = {}, query = {}, params = {} }) => {
    const res = { statusCode: 200, body: undefined };
    res.status = jest.fn((code) => { res.statusCode = code; return res; });
    res.json = jest.fn((payload) => { res.body = payload; return res; });
    jest.spyOn(console, 'error').mockImplementation(() => {});
    await handler(verified({ uid, query, params, body, headers: { companyid: C } }), res);
    return res;
};

const SEARCHES = {
    'by project name': { type: 'projectName', search: 'Launch', fields: 'ProjectName' },
    'by saved filter': { type: 'projectFilter', query: { $and: [] }, sortByField: {}, fields: 'ProjectName' },
    'by saved filter and project name': { type: 'projectFilter_projectName', search: 'Launch', query: { $and: [] }, sortByField: {}, fields: 'ProjectName' },
    'for archived sprints and folders': { type: 'showArchiveOnly' },
};

const NOT_ACTIVE = [
    ['a removed admin', 2, { isDelete: true }],
    ['a removed owner', 1, { isDelete: true }],
    ['a removed member', 3, { isDelete: true }],
    ['an invitation not yet accepted', 2, { status: 1 }],
    ['a cancelled invitation', 2, { status: 3 }],
];

const foundIds = async (uid, body) => {
    const res = await call(projectFilter, { uid, body });
    expect(res.statusCode).toBe(200);
    return res.body.map((project) => String(project._id)).sort();
};

let unassignedPrivate;
let assignedPrivate;
let assignedPublic;

beforeEach(() => {
    myCache.flushAll();
    mockDb = fakeMongo.create();
    seedSeat(OWNER, 1);
    seedSeat(ADMIN, 2);
    seedSeat(MEMBER, 3);
    unassignedPrivate = seedProject();
    assignedPrivate = seedProject({ AssigneeUserId: [MEMBER, CALLER] });
    assignedPublic = seedProject({ isPrivateSpace: false, AssigneeUserId: [MEMBER, CALLER] });
});

afterEach(() => jest.restoreAllMocks());

describe('POST /api/v1/project/search answers a seat that is not active with nothing', () => {
    const cases = NOT_ACTIVE.flatMap(([who, roleType, seat]) => Object.entries(SEARCHES).map(([how, body]) => [who, how, roleType, seat, body]));

    it.each(cases)('%s searching %s finds nothing', async (_who, _how, roleType, seat, body) => {
        seedSeat(CALLER, roleType, seat);
        const res = await call(projectFilter, { uid: CALLER, body });
        expect(res.statusCode).toBe(200);
        expect(res.body).toEqual([]);
    });

    it.each(Object.entries(SEARCHES))('someone with no seat at all searching %s finds nothing', async (_how, body) => {
        const res = await call(projectFilter, { uid: CALLER, body });
        expect(res.statusCode).toBe(200);
        expect(res.body).toEqual([]);
    });
});

describe('POST /api/v1/project/search is unchanged for an active seat', () => {
    const everything = () => [unassignedPrivate, assignedPrivate, assignedPublic].sort();
    const assigned = () => [assignedPrivate, assignedPublic].sort();
    const searches = Object.entries(SEARCHES).filter(([, body]) => body.type !== 'showArchiveOnly');

    it.each(searches)('an owner and an admin searching %s find every project', async (_how, body) => {
        expect(await foundIds(OWNER, body)).toEqual(everything());
        expect(await foundIds(ADMIN, body)).toEqual(everything());
    });

    it.each(searches)('a member searching %s finds the projects they are assigned to', async (_how, body) => {
        expect(await foundIds(MEMBER, body)).toEqual(assigned());
    });

    it('still asks for a search type', async () => {
        const res = await call(projectFilter, { uid: MEMBER, body: {} });
        expect(res.statusCode).toBe(404);
    });
});

describe('GET /api/v1/project/sprintFolder/:id reads the role of an active seat', () => {
    const sprintsOf = async (uid, projectId) => {
        const res = await call(getSprintFolder, { uid, params: { id: projectId }, query: { collection: 'sprints' } });
        await new Promise((resolve) => setImmediate(resolve));
        expect(res.statusCode).toBe(200);
        return res.body.map((sprint) => sprint.name).sort();
    };

    const seedSprints = (projectId) => {
        const sprint = { projectId: new mongoose.Types.ObjectId(projectId), deletedStatusKey: 0 };
        mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: oid(), name: 'Open', ...sprint });
        mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: oid(), name: 'Shared with the owner', private: true, AssigneeUserId: [OWNER], ...sprint });
    };

    it('an admin sees every sprint of the project', async () => {
        seedSprints(assignedPublic);
        expect(await sprintsOf(ADMIN, assignedPublic)).toEqual(['Open', 'Shared with the owner']);
    });

    it.each([
        ['a removed admin', { isDelete: true }],
        ['an admin invitation not yet accepted', { status: 1 }],
    ])('%s does not read past sprint privacy', async (_who, seat) => {
        seedSeat(CALLER, 2, seat);
        seedSprints(assignedPublic);
        expect(await sprintsOf(CALLER, assignedPublic)).toEqual(['Open']);
    });
});
