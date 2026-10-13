/* Task 040 phase 2: until migration 045 has run everywhere a milestone's projectId is text in older
   rows and an ObjectId in new ones, so every reader of it matches both forms for one release.
   Filters are matched the way MongoDB does, where an ObjectId never equals its hex text. */
const mongoose = require('mongoose');
const sift = require('sift');
const verified = require('./fixtures/verifiedRequest');

const mockCrud = jest.fn();
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockCrud(...a) }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../Config/config', () => ({ myCache: { get: jest.fn(), set: jest.fn(), del: jest.fn(), getTtl: jest.fn() } }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Modules/Audit/recorder', () => ({ recordAuditFromReq: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({ getRoleType: jest.fn(async () => 2) }));
jest.mock('../Modules/Sprints/helpers/sprintVisibility', () => ({ hiddenSprintFilter: jest.fn(async () => ({})) }));
jest.mock('../Modules/AICore/llmProvider', () => ({ getProvider: jest.fn(), isAnyProviderConfigured: jest.fn(() => false) }));
jest.mock('../Config/projectAccess', () => ({
    ...jest.requireActual('../Config/projectAccess'),
    keepVisibleProjectIds: jest.fn(async (companyId, uid, ids) => ids.map(String)),
}));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const query = require('../Modules/Milestone/controller/query');
const billing = require('../Modules/Milestone/controller/billing');
const agile = require('../Modules/AgileReports/milestones');
const portfolio = require('../Modules/Portfolio/controller');
const { projectIdsFrom } = require('../Config/projectAccess');

const C = '6f0000000000000000000c01';
const ME = '6f0000000000000000000001';
const PROJECT = '6f0000000000000000000b01';
const OTHER_PROJECT = '6f0000000000000000000b02';
const MILESTONE_ID = '6f0000000000000000000e01';
const PORTFOLIO_ID = '6f0000000000000000000f01';
const oid = (id) => new mongoose.Types.ObjectId(id);

const ROWS = [
    { _id: oid('6f0000000000000000000e11'), milestoneName: 'text form', projectId: PROJECT },
    { _id: oid('6f0000000000000000000e12'), milestoneName: 'ObjectId form', projectId: oid(PROJECT) },
    { _id: oid('6f0000000000000000000e13'), milestoneName: 'other project', projectId: oid(OTHER_PROJECT) },
].map((row) => ({ amount: 10, statusDate: 50, statusId: 'OPEN', dueDate: 50, order: '1', ...row }));

/* An ObjectId equals only an ObjectId, as on the server; tagging keeps sift from reading it as its hex text. */
const bson = (value) => {
    if (value instanceof mongoose.Types.ObjectId) return { objectId: value.toHexString() };
    if (Array.isArray(value)) return value.map(bson);
    if (value && typeof value === 'object' && !(value instanceof Date) && !(value instanceof RegExp)) {
        return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, bson(v)]));
    }
    return value;
};
/* A milestone filter that also names the row's _id is checked on its project alone. */
const withoutId = ({ _id, ...rest }) => rest;
const matching = (filter) => ROWS.filter((row) => sift(bson(withoutId(filter)))(bson(row)));
const filterOf = (method, data) => (method === 'aggregate' ? { $and: data[0].filter((stage) => stage.$match).map((stage) => stage.$match) } : data[0]);

const milestoneReads = () => mockCrud.mock.calls
    .filter(([, { type }]) => type === SCHEMA_TYPE.MILESTONE)
    .map(([, { data }, method]) => ({ method, filter: filterOf(method, data) }));
const namesFound = () => milestoneReads().map(({ filter }) => matching(filter).map((row) => row.milestoneName).sort());

beforeEach(() => {
    mockCrud.mockReset();
    mockCrud.mockImplementation(async (companyId, { type, data }, method) => {
        if (type === SCHEMA_TYPE.MILESTONE) {
            if (method === 'find' && !Object.keys(data[0] || {}).length) return ROWS;
            const found = matching(filterOf(method, data));
            return ['findOne', 'findOneAndUpdate'].includes(method) ? found[0] || null : found;
        }
        if (type === SCHEMA_TYPE.PROJECTS) {
            const project = { _id: oid(PROJECT), ProjectName: 'Parity', status: 'open' };
            return method === 'findOne' ? project : [project];
        }
        if (type === SCHEMA_TYPE.PORTFOLIOS) return { _id: oid(PORTFOLIO_ID), name: 'P', projectIds: [PROJECT] };
        return method === 'findOne' ? null : [];
    });
});

const settle = async () => { for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve)); };
const call = async (handler, { params = {}, query: q = {}, body = {} } = {}) => {
    const r = { code: 200, body: null };
    r.status = (code) => { r.code = code; return r; };
    r.send = (answer) => { r.body = answer; return r; };
    r.json = r.send;
    r.set = () => r;
    await handler(verified({ headers: { companyid: C }, params, query: q, body, uid: ME }), r);
    await settle();
    return r;
};

const BOTH = ['ObjectId form', 'text form'];

describe('every reader of a milestone project id matches the text and the ObjectId form', () => {
    test.each([
        ['GET /api/v1/milestone/:id (Modules/Milestone/controller/query.js getMilestone)', () => call(query.getMilestone, { params: { id: PROJECT } })],
        ['getMilestoneByProject (query.js)', () => call(query.getMilestoneByProject, { params: { pid: PROJECT } })],
        ['the milestone report aggregate (query.js getMilestoneReport)', () => call(query.getMilestoneReport, { body: { element: [PROJECT], startDate: 1, endDate: 100, cancel: 'CANCELLED' } })],
        ['the billing context (billing.js loadMilestones)', () => billing.buildBillingContext(C, PROJECT)],
        ['PATCH /api/v2/billing/milestone/:id (billing.js updateBillingMilestone)', () => call(billing.updateBillingMilestone, { params: { id: MILESTONE_ID }, body: { projectId: PROJECT, milestoneName: 'Renamed' } })],
        ['GET /api/v1/agile/milestones (AgileReports/milestones.js)', () => call(agile.getMilestones)],
        ['GET /api/v1/portfolio/:id/rollup (Portfolio/controller.js buildRollup)', () => call(portfolio.getRollup, { params: { id: PORTFOLIO_ID } })],
    ])('%s', async (_, run) => {
        await run();
        expect(milestoneReads().length).toBeGreaterThan(0);
        namesFound().forEach((names) => expect(names).toEqual(BOTH));
    });

    test('the milestone list answers with both rows', async () => {
        const r = await call(query.getMilestoneByProject, { params: { pid: PROJECT } });
        expect(r.body.map((row) => row.milestoneName).sort()).toEqual(BOTH);
    });

    test('the agile report lists both under the project, by its id as text', async () => {
        const r = await call(agile.getMilestones);
        const rows = r.body.data.milestones.filter((m) => BOTH.includes(m.name));
        expect(rows.map((m) => m.projectId)).toEqual([PROJECT, PROJECT]);
    });

    test('the project access check reads the project of an ObjectId-stored milestone as its id text', async () => {
        mockCrud.mockImplementation(async () => [{ _id: oid(MILESTONE_ID), projectId: oid(PROJECT) }]);
        const ids = await projectIdsFrom({ records: [[SCHEMA_TYPE.MILESTONE, () => MILESTONE_ID]] })(verified({ headers: { companyid: C } }));
        expect(ids).toEqual([PROJECT]);
    });
});
