const verified = require('./fixtures/verifiedRequest');
const fakeMongo = require('./fixtures/fakeMongo');

let mockDb;

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...args) => mockDb.crud(...args) }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../Modules/RecurringTasks/helper', () => ({ computeNextRun: jest.fn(() => new Date('2026-11-02T09:00:00Z')), announce: jest.fn(), updateDef: jest.fn(async () => ({})) }));

const mongoose = require('mongoose');
const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { NOT_A_MEMBER } = require('../Config/companyMembers');
const { CANNOT_OPEN_PROJECT } = require('../Config/projectPeople');
const recurring = require('../Modules/RecurringTasks/controller');
const epics = require('../Modules/Epics/controller');

const C = 'c00000000000000000000001';
const CALLER = 'a00000000000000000000001';
const ON_PROJECT = 'a00000000000000000000002';
const NOT_ON_PROJECT = 'a00000000000000000000003';
const LEFT = 'a00000000000000000000004';
const NOBODY = 'a00000000000000000000009';
const oid = () => new mongoose.Types.ObjectId().toString();

const OUTSIDERS = [
    ['someone who left the workspace', LEFT, NOT_A_MEMBER],
    ['someone of no workspace', NOBODY, NOT_A_MEMBER],
    ['a member who cannot open the project', NOT_ON_PROJECT, CANNOT_OPEN_PROJECT],
];

const call = async (handler, { params = {}, body = {} } = {}) => {
    const res = { statusCode: 200, body: undefined };
    res.status = jest.fn((code) => { res.statusCode = code; return res; });
    res.json = jest.fn((payload) => { res.body = payload; return res; });
    res.send = res.json;
    await handler(verified({ uid: CALLER, params, body, query: {}, headers: { companyid: C } }), res);
    return res;
};

let project;

beforeEach(() => {
    myCache.flushAll();
    jest.clearAllMocks();
    mockDb = fakeMongo.create();
    [[CALLER, 3, false], [ON_PROJECT, 3, false], [NOT_ON_PROJECT, 3, false], [LEFT, 3, true]].forEach(([userId, roleType, isDelete]) => {
        mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId, roleType, status: 2, isDelete });
        mockDb.seed(SCHEMA_TYPE.USERS, { _id: userId, Employee_Name: `Person ${userId.slice(-1)}` });
    });
    project = String(mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: oid(), ProjectName: 'Board', isPrivateSpace: true, AssigneeUserId: [CALLER, ON_PROJECT, LEFT] })._id);
});

describe('the people a repeating task is given to', () => {
    const repeat = (assignees) => call(recurring.createDefinition, {
        body: { name: 'Weekly report', taskName: 'Write the report', freq: 'weekly', projectData: { _id: project, CompanyId: C, ProjectName: 'Board' }, assignees },
    });
    const saved = () => mockDb.store[SCHEMA_TYPE.RECURRING_TASKS] || [];

    it('keeps members who can open its project', async () => {
        const res = await repeat([ON_PROJECT]);
        expect(res.body).toMatchObject({ status: true });
        expect(saved()[0].templateSnapshot.AssigneeUserId).toEqual([ON_PROJECT]);
    });

    it.each(OUTSIDERS)('answers 400 when %s is named, and saves nothing', async (_label, named, reason) => {
        const res = await repeat([ON_PROJECT, named]);
        expect(res.statusCode).toBe(400);
        expect(res.body).toMatchObject({ status: false, statusText: reason });
        expect(saved()).toHaveLength(0);
    });

    it('answers 400 to people that are not a list of ids', async () => {
        for (const assignees of [[{ $ne: '' }], 'everyone']) {
            // eslint-disable-next-line no-await-in-loop
            expect((await repeat(assignees)).statusCode).toBe(400);
        }
        expect(saved()).toHaveLength(0);
    });
});

describe('the owner of an epic', () => {
    const epicRows = () => mockDb.store[SCHEMA_TYPE.EPICS] || [];
    const make = (ownerUserId) => call(epics.createEpic, { body: { name: 'Checkout', projectId: project, ownerUserId } });
    const seeded = () => String(mockDb.seed(SCHEMA_TYPE.EPICS, { _id: oid(), name: 'Checkout', ProjectID: project, ownerUserId: ON_PROJECT, deletedStatusKey: 0 })._id);

    it('is a member who can open its project', async () => {
        const res = await make(ON_PROJECT);
        expect(res.body).toMatchObject({ status: true });
        expect(epicRows()[0].ownerUserId).toBe(ON_PROJECT);
    });

    it.each(OUTSIDERS)('answers 400 when %s is named on a new epic', async (_label, named, reason) => {
        const res = await make(named);
        expect(res.statusCode).toBe(400);
        expect(res.body).toMatchObject({ status: false, statusText: reason });
        expect(epicRows()).toHaveLength(0);
    });

    it.each(OUTSIDERS)('answers 400 when %s is named on an epic that exists', async (_label, named, reason) => {
        const id = seeded();
        const res = await call(epics.updateEpic, { params: { id }, body: { ownerUserId: named, name: 'Renamed' } });
        expect(res.statusCode).toBe(400);
        expect(res.body).toMatchObject({ status: false, statusText: reason });
        expect(epicRows()[0]).toMatchObject({ ownerUserId: ON_PROJECT, name: 'Checkout' });
    });

    it('can be changed to another member of the project, or taken off', async () => {
        const id = seeded();
        expect((await call(epics.updateEpic, { params: { id }, body: { ownerUserId: CALLER } })).body).toMatchObject({ status: true });
        expect(epicRows()[0].ownerUserId).toBe(CALLER);
        expect((await call(epics.updateEpic, { params: { id }, body: { ownerUserId: '' } })).body).toMatchObject({ status: true });
        expect(epicRows()[0].ownerUserId).toBe('');
    });

    it('stays as it is when the epic is changed without naming anyone', async () => {
        const id = String(mockDb.seed(SCHEMA_TYPE.EPICS, { _id: oid(), name: 'Old', ProjectID: project, ownerUserId: LEFT, deletedStatusKey: 0 })._id);
        expect((await call(epics.updateEpic, { params: { id }, body: { name: 'New' } })).body).toMatchObject({ status: true });
        expect(epicRows()[0]).toMatchObject({ name: 'New', ownerUserId: LEFT });
    });
});
