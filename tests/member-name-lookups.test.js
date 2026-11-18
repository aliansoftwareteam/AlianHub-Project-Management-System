jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn(async () => null) }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../Modules/Audit/recorder', () => ({ recordAuditFromReq: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({
    ...jest.requireActual('../Config/permissionGuard'),
    getRoleType: jest.fn(async () => 1),
}));

const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { setMiddlewareWithCV2 } = require('../Config/setMiddleware');
const { signSession, startApp } = require('./fixtures/sessionApp');
const workloadGrid = require('../Modules/TimeSheet/controller/workloadGrid');
const billing = require('../Modules/Milestone/controller/billing');

const COMPANY = '6f0000000000000000000c01';
const PROJECT = '6f0000000000000000000a01';
const OWNER = '6f0000000000000000000001';
const MEMBER = '6f0000000000000000000002';
const FORMER = '6f0000000000000000000003';
const OUTSIDER = '6f0000000000000000000009';
const UNKNOWN = '6f00000000000000000000ff';

const PEOPLE = {
    [OWNER]: { Employee_Name: 'Olive Owner' },
    [MEMBER]: { Employee_Name: 'Mia Member', Employee_profileImageURL: 'mia.png' },
    [FORMER]: { Employee_Name: 'Fred Former' },
    [OUTSIDER]: { Employee_Name: 'Otto Outsider', Employee_profileImageURL: 'otto.png' },
};

// The outsider is registered elsewhere and was only invited here, so the row carries their id.
const SEATS = [
    { userId: OWNER, status: 2, isDelete: false },
    { userId: MEMBER, status: 2, isDelete: false },
    { userId: FORMER, status: 2, isDelete: true },
    { userId: OUTSIDER, status: 1, isDelete: false, userEmail: 'otto@elsewhere.test' },
];

const matchesValue = (value, condition) => {
    if (condition && typeof condition === 'object' && !Array.isArray(condition)) {
        if ('$in' in condition) return condition.$in.map(String).includes(String(value));
        if ('$ne' in condition) return value !== condition.$ne;
    }
    return String(value) === String(condition);
};
const matches = (row, filter) => Object.entries(filter || {}).every(([key, condition]) => matchesValue(row[key], condition));

let milestones;

beforeEach(() => {
    myCache.flushAll();
    milestones = [];
    MongoDbCrudOpration.mockReset();
    MongoDbCrudOpration.mockImplementation(async (db, obj, method) => {
        const filter = Array.isArray(obj.data) ? obj.data[0] : obj.data;
        if (obj.type === SCHEMA_TYPE.COMPANY_USERS) {
            const rows = db === COMPANY ? SEATS.filter((row) => matches(row, filter)) : [];
            return method === 'findOne' ? rows[0] || null : rows;
        }
        if (obj.type === SCHEMA_TYPE.USERS && method === 'find') {
            return Object.entries(PEOPLE)
                .filter(([id]) => matchesValue(id, filter._id))
                .map(([id, person]) => ({ _id: id, ...person }));
        }
        if (obj.type === SCHEMA_TYPE.PROJECTS && method === 'findOne') return { _id: PROJECT, ProjectName: 'Billable' };
        if (obj.type === SCHEMA_TYPE.MILESTONE && method === 'find') return milestones;
        if (obj.type === SCHEMA_TYPE.MILESTONE && method === 'save') {
            milestones.push({ _id: `m${milestones.length}`, ...obj.data });
            return milestones.at(-1);
        }
        if (method === 'find' || method === 'aggregate') return [];
        return null;
    });
});

let app;
beforeAll(async () => {
    app = await startApp((server) => {
        setMiddlewareWithCV2(server);
        server.post('/api/v1/timesheet/workload-grid', workloadGrid.getWorkloadGrid);
        server.get('/api/v2/billing/contract', billing.getBillingContract);
        server.post('/api/v2/billing/milestone', billing.createBillingMilestone);
    });
});
afterAll(() => app.close());

const call = (method, path, body) => app.call(method, path, { token: signSession(OWNER, [COMPANY]), companyId: COMPANY, body });

describe('POST /api/v1/timesheet/workload-grid', () => {
    const grid = (userIds) => call('POST', '/api/v1/timesheet/workload-grid', { start: '2026-09-01', end: '2026-09-02', userIds });

    it('answers for a person outside the company exactly as for an unknown id', async () => {
        const outsider = await grid([OUTSIDER]);
        const unknown = await grid([UNKNOWN]);

        expect(outsider.status).toBe(200);
        expect(outsider.body).toEqual(unknown.body);
        expect(JSON.stringify(outsider.body)).not.toMatch(/Otto|otto\.png/);
    });

    it('still names a member of the company', async () => {
        const res = await grid([MEMBER]);

        expect(res.body.data.users).toEqual([expect.objectContaining({ userId: MEMBER, name: 'Mia Member', avatar: 'mia.png' })]);
    });
});

describe('billing sign-off', () => {
    const contract = () => call('GET', `/api/v2/billing/contract?projectId=${PROJECT}`);
    const signOffOf = (res, id) => res.body.data.milestones.find((m) => m.id === id);

    it('names only a sign-off person who holds or held a seat in the company', async () => {
        milestones = [
            { _id: 'm-outsider', milestoneName: 'A', amount: 1, signOffUserId: OUTSIDER },
            { _id: 'm-unknown', milestoneName: 'B', amount: 1, signOffUserId: UNKNOWN },
            { _id: 'm-member', milestoneName: 'C', amount: 1, signOffUserId: MEMBER },
            { _id: 'm-former', milestoneName: 'D', amount: 1, signOffUserId: FORMER },
        ];
        const res = await contract();

        expect(res.body.status).toBe(true);
        expect(signOffOf(res, 'm-outsider').signOffName).toBe(signOffOf(res, 'm-unknown').signOffName);
        expect(JSON.stringify(res.body)).not.toContain('Otto');
        expect(signOffOf(res, 'm-member').signOffName).toBe('Mia Member');
        expect(signOffOf(res, 'm-former').signOffName).toBe('Fred Former');
    });

    it('refuses a sign-off person outside the company exactly as an unknown id', async () => {
        const create = (signOffUserId) => call('POST', '/api/v2/billing/milestone', { projectId: PROJECT, milestoneName: 'M', amount: 10, signOffUserId });
        const outsider = await create(OUTSIDER);
        const unknown = await create(UNKNOWN);

        expect(outsider.body).toEqual(unknown.body);
        expect(outsider.body.status).toBe(false);
        expect(milestones).toEqual([]);

        const member = await create(MEMBER);
        expect(member.body.status).toBe(true);
        expect(milestones.map((m) => m.signOffUserId)).toEqual([MEMBER]);
    });
});
