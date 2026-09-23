const mockCrud = jest.fn();
const mockHistory = jest.fn(async () => true);
const mockNotify = jest.fn(async () => true);
const mockProjectInc = jest.fn(async () => true);

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockCrud(...a) }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../Config/config', () => ({ myCache: { get: jest.fn(), set: jest.fn(), del: jest.fn() } }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Modules/Tasks/helpers/helper', () => ({ HandleHistory: (...a) => mockHistory(...a) }));
jest.mock('../Modules/Tasks/helpers/handleNotification', () => ({ HandleBothNotification: (...a) => mockNotify(...a) }));
jest.mock('../Modules/Project/controller/updateProject.js', () => ({ updateProjectInternal: (...a) => mockProjectInc(...a) }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const crud = require('../Modules/Milestone/controller/crud');
const status = require('../Modules/Milestone/controller/status');

const C = '6f0000000000000000000c01';
const OTHER_COMPANY = '6f0000000000000000000c02';
const ME = '6f0000000000000000000001';
const OTHER = '6f0000000000000000000002';
const OWNER = '6f0000000000000000000009';
const PROJECT = '6f0000000000000000000b01';
const MILESTONE = '6f0000000000000000000e01';
const SESSION_NAME = 'Session Person';
const BODY_NAME = 'Body Name';

const forgedUser = () => ({ id: OTHER, Employee_Name: BODY_NAME, companyOwnerId: OTHER });

const common = (overrides) => ({
    companyId: C,
    projectId: PROJECT,
    ProjectName: 'Project',
    userDetail: forgedUser(),
    cuurencyValue: '$',
    ...overrides,
});

const BODIES = {
    addMilestone: () => common({
        fixOrHourlyMilCheck: false,
        milestoneObject: { milestoneName: 'M1', amount: 10, startDate: '2026-01-01', endDate: '2026-02-01', statusArray: [], order: 1 },
    }),
    updateMilestone: () => common({
        fixOrHourlyMilCheck: false,
        onlyNumber: 0,
        milestoneStatusObj: '',
        statusObj: {},
        prevMilestoneName: { milestoneName: 'M1', startDate: '2026-01-01', endDate: '2026-02-01', amount: 10 },
        milestoneObject: { id: MILESTONE, milestoneName: 'M2', amount: 10, startDate: '2026-01-02', endDate: '2026-02-01', statusArray: [], order: 1 },
    }),
    deleteMilestone: () => common({
        onlyNumber: 10,
        milestoneObjForDelete: { _id: MILESTONE, milestoneName: 'M1' },
    }),
    clearMilestoneStatus: () => common({
        milestoneObject: { _id: MILESTONE, milestoneName: 'M1', amount: 10, statusArray: [], refundedAmount: [] },
    }),
    cancelMilestoneStatus: () => common({
        onlyNumber: 10,
        statusObj: { name: 'Cancelled', backgroundColor: '#000' },
        milestoneObject: { _id: MILESTONE, milestoneName: 'M1', statusArray: [{ milestoneStatusColor: 'CANCELLED', statusDateValue: '2026-01-05' }] },
    }),
    refundAmount: () => common({
        onlyNumber: 5,
        milestoneObject: { _id: MILESTONE, milestoneName: 'M1', refundedAmount: [{ amount: 5, date: '2026-01-05' }] },
    }),
};

const HANDLERS = {
    addMilestone: crud.addMilestone,
    updateMilestone: crud.updateMilestone,
    deleteMilestone: crud.deleteMilestone,
    clearMilestoneStatus: status.clearMilestoneStatus,
    cancelMilestoneStatus: status.cancelMilestoneStatus,
    refundAmount: status.refundAmount,
};

const settle = () => new Promise((resolve) => setImmediate(resolve));

const call = async (handler, body, uid = ME) => {
    const r = { code: 200, body: null };
    r.status = (c) => { r.code = c; return r; };
    r.send = (b) => { r.body = b; return r; };
    r.json = r.send;
    await handler({ headers: { companyid: C }, body, query: {}, params: {}, uid }, r);
    await settle();
    return r;
};

const writes = () => mockCrud.mock.calls.filter(([, , method]) => ['save', 'updateOne', 'deleteOne'].includes(method));
const tenantCompanies = () => [...new Set(mockCrud.mock.calls.filter(([, { type }]) => type !== SCHEMA_TYPE.USERS).map(([companyId]) => String(companyId)))];
const historyUsers = () => mockHistory.mock.calls.map((c) => c[5]);
const historyMessages = () => mockHistory.mock.calls.map((c) => c[4].message).filter(Boolean);
const notifiedUsers = () => mockNotify.mock.calls.map((c) => c[0].userData);

beforeEach(() => {
    jest.clearAllMocks();
    mockCrud.mockImplementation(async (companyId, { type }, method) => {
        if (type === SCHEMA_TYPE.USERS && method === 'findOne') return { _id: ME, Employee_Name: SESSION_NAME };
        if (type === SCHEMA_TYPE.COMPANY_USERS && method === 'findOne') return { userId: OWNER };
        if (method === 'save') return { _id: MILESTONE };
        return { acknowledged: true };
    });
});

describe.each(Object.keys(HANDLERS))('%s takes the company and user from the verified request', (name) => {
    const handler = HANDLERS[name];

    it('attributes history and notifications to the signed-in user, not the body userDetail', async () => {
        const r = await call(handler, BODIES[name]());

        expect(r.body.status).toBe(true);
        expect(historyUsers().length).toBeGreaterThan(0);
        historyUsers().forEach((user) => expect(user.id).toBe(ME));
        historyMessages().forEach((message) => expect(message).not.toContain(BODY_NAME));
        expect(historyMessages().some((message) => message.includes(SESSION_NAME))).toBe(true);
        notifiedUsers().forEach((user) => expect(user).toMatchObject({ id: ME, companyOwnerId: OWNER }));
        expect(tenantCompanies()).toEqual([C]);
    });

    it('still works when the body leaves userDetail out', async () => {
        const body = BODIES[name]();
        delete body.userDetail;
        const r = await call(handler, body);

        expect(r.body.status).toBe(true);
        historyUsers().forEach((user) => expect(user.id).toBe(ME));
        expect(historyUsers().length).toBeGreaterThan(0);
    });

    it('still works when the body leaves the company out', async () => {
        const body = BODIES[name]();
        delete body.companyId;
        const r = await call(handler, body);

        expect(r.body.status).toBe(true);
        expect(tenantCompanies()).toEqual([C]);
    });

    it('refuses a body that names another company and writes nothing', async () => {
        const r = await call(handler, { ...BODIES[name](), companyId: OTHER_COMPANY });

        expect(r.code).toBe(403);
        expect(mockCrud).not.toHaveBeenCalled();
        expect(mockProjectInc).not.toHaveBeenCalled();
    });

    it('refuses a request without a signed-in user and writes nothing', async () => {
        const r = await call(handler, BODIES[name](), null);

        expect(r.code).toBe(401);
        expect(writes()).toHaveLength(0);
        expect(mockProjectInc).not.toHaveBeenCalled();
        expect(mockHistory).not.toHaveBeenCalled();
    });
});

describe('draggableMilestone takes the company from the verified request', () => {
    const body = () => ({ companyId: C, projectId: PROJECT, milestoneObject: { _id: MILESTONE, order: 2 } });

    it('reorders within the header company', async () => {
        const r = await call(status.draggableMilestone, body());

        expect(r.body.status).toBe(true);
        expect(tenantCompanies()).toEqual([C]);
    });

    it('refuses a body that names another company', async () => {
        const r = await call(status.draggableMilestone, { ...body(), companyId: OTHER_COMPANY });

        expect(r.code).toBe(403);
        expect(mockCrud).not.toHaveBeenCalled();
    });
});
