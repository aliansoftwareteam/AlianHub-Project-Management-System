/* Task 040 phase 2: a milestone's projectId is stored as an ObjectId, whichever form the writer
   passed. Every stored form here is read from what Mongoose hands the driver under the real
   milestone schema; the handlers' own database calls are only recorded. */
const mongoose = require('mongoose');
const verified = require('./fixtures/verifiedRequest');

const mockCrud = jest.fn();
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockCrud(...a) }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../Config/config', () => ({ myCache: { get: jest.fn(), set: jest.fn(), del: jest.fn(), getTtl: jest.fn() } }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Modules/Audit/recorder', () => ({ recordAuditFromReq: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({ getRoleType: jest.fn(async () => 2) }));
jest.mock('../Modules/Tasks/helpers/helper', () => ({ HandleHistory: jest.fn(async () => true) }));
jest.mock('../Modules/Tasks/helpers/handleNotification', () => ({ HandleBothNotification: jest.fn(async () => true) }));
jest.mock('../Modules/Project/controller/updateProject.js', () => ({ updateProjectInternal: jest.fn(async () => true) }));

const { milestone: milestoneSchema } = require('../utils/mongo-handler/createSchema');
const { realModelStore, isObjectId } = require('./fixtures/realModelStore');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const crud = require('../Modules/Milestone/controller/crud');
const billing = require('../Modules/Milestone/controller/billing');

const C = '6f0000000000000000000c01';
const ME = '6f0000000000000000000001';
const PROJECT = '6f0000000000000000000b01';
const MILESTONE_ID = '6f0000000000000000000e01';
const oid = (id) => new mongoose.Types.ObjectId(id);

const { driverWrites } = realModelStore('milestone', milestoneSchema);

const milestoneDoc = (extra = {}) => ({ milestoneName: 'Kickoff', amount: 10, projectId: PROJECT, order: '1', ...extra });

/* The written parts of a driver call only: a filter is sent as written and is checked on its own. */
const writtenParts = ({ op, args }) => {
    if (op === 'insertOne') return [args[0]];
    if (op === 'insertMany') return args[0];
    if (op === 'bulkWrite') return args[0].map((item) => (item.insertOne ? item.insertOne.document : (item.updateOne || item.updateMany).update));
    return [args[1]];
};
const storedProjectIds = async (method, data) => {
    const { writes, error } = await driverWrites(method, data);
    expect(error).toBeNull();
    return writes.flatMap(writtenParts).map((part) => (part.$set ? part.$set.projectId : part.projectId)).filter((value) => value !== undefined);
};

describe('the milestone schema stores the project id as an ObjectId', () => {
    test.each([
        ['save', 'save', () => milestoneDoc()],
        ['insertMany', 'insertMany', () => [[milestoneDoc()]]],
        ['updateOne with $set', 'updateOne', () => [{ _id: MILESTONE_ID }, { $set: { projectId: PROJECT } }]],
        ['updateOne with a bare update', 'updateOne', () => [{ _id: MILESTONE_ID }, { projectId: PROJECT }]],
        ['updateMany', 'updateMany', () => [{ projectId: PROJECT }, { $set: { projectId: PROJECT } }]],
        ['findOneAndUpdate with an upsert', 'findOneAndUpdate', () => [{ _id: MILESTONE_ID }, { $set: { projectId: PROJECT } }, { new: true, upsert: true }]],
        ['bulkWrite', 'bulkWrite', () => [[{ insertOne: { document: milestoneDoc() } }, { updateOne: { filter: { _id: MILESTONE_ID }, update: { $set: { projectId: PROJECT } } } }]]],
    ])('%s converts a text id', async (_, method, data) => {
        const stored = await storedProjectIds(method, data());
        expect(stored.length).toBeGreaterThan(0);
        stored.forEach((value) => {
            expect(isObjectId(value)).toBe(true);
            expect(String(value)).toBe(PROJECT);
        });
    });

    test('an id that is already an ObjectId is stored as it is', async () => {
        const [value] = await storedProjectIds('save', milestoneDoc({ projectId: oid(PROJECT) }));
        expect(isObjectId(value) && String(value) === PROJECT).toBe(true);
    });

    test('a value that is not an id is stored as sent', async () => {
        expect(await storedProjectIds('save', milestoneDoc({ projectId: 'firebase-project' }))).toEqual(['firebase-project']);
    });

    test('a filter is sent as written, so a read still matches either form', async () => {
        const { writes, error } = await driverWrites('find', [{ projectId: { $in: [PROJECT, oid(PROJECT)] } }]);
        expect(error).toBeNull();
        const [text, id] = writes[0].args[0].projectId.$in;
        expect(text).toBe(PROJECT);
        expect(isObjectId(id)).toBe(true);
    });
});

const settle = async () => { for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve)); };

const call = async (handler, body) => {
    const r = { code: 200, body: null };
    r.status = (code) => { r.code = code; return r; };
    r.send = (answer) => { r.body = answer; return r; };
    r.json = r.send;
    await handler(verified({ headers: { companyid: C }, body, query: {}, params: {}, uid: ME }), r);
    await settle();
    return r;
};

describe('every handler that creates a milestone', () => {
    beforeEach(() => {
        mockCrud.mockReset();
        mockCrud.mockImplementation(async (companyId, { type }, method) => {
            if (type === SCHEMA_TYPE.USERS && method === 'findOne') return { _id: ME, Employee_Name: 'Session Person' };
            if (type === SCHEMA_TYPE.COMPANY_USERS && method === 'findOne') return { userId: ME };
            if (method === 'find') return [];
            if (method === 'save') return { _id: MILESTONE_ID };
            return { acknowledged: true };
        });
    });

    const addBody = (fixOrHourlyMilCheck) => ({
        projectId: PROJECT,
        ProjectName: 'Project',
        cuurencyValue: '$',
        fixOrHourlyMilCheck,
        milestoneObject: { milestoneName: 'M1', amount: 10, startDate: '2026-01-01', endDate: '2026-02-01', statusArray: [], order: 1 },
    });

    test.each([
        ['POST /api/v1/addmilestone, fixed price', crud.addMilestone, () => addBody(false)],
        ['POST /api/v1/addmilestone, hourly', crud.addMilestone, () => addBody(true)],
        ['POST /api/v2/billing/milestone', billing.createBillingMilestone, () => ({ projectId: PROJECT, milestoneName: 'M2', amount: 5 })],
    ])('%s stores the project id as an ObjectId', async (_, handler, body) => {
        const r = await call(handler, body());
        expect(r.body).toMatchObject({ status: true });
        const saves = mockCrud.mock.calls.filter(([, { type }, method]) => type === SCHEMA_TYPE.MILESTONE && method === 'save');
        expect(saves).toHaveLength(1);
        const [value] = await storedProjectIds('save', saves[0][1].data);
        expect(isObjectId(value)).toBe(true);
        expect(String(value)).toBe(PROJECT);
    });
});
