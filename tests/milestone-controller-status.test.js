const verified = require('./fixtures/verifiedRequest');
const mockCrud = jest.fn();
const mockHistory = jest.fn(async () => true);
const mockNotify = jest.fn(async () => true);
const mockProjectInc = jest.fn();
const mockRemoveCache = jest.fn();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockCrud(...a) }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../Config/config', () => ({ myCache: { get: jest.fn(), set: jest.fn(), del: jest.fn() } }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: (...a) => mockRemoveCache(...a) }));
jest.mock('../Modules/Tasks/helpers/helper', () => ({ HandleHistory: (...a) => mockHistory(...a) }));
jest.mock('../Modules/Tasks/helpers/handleNotification', () => ({ HandleBothNotification: (...a) => mockNotify(...a) }));
jest.mock('../Modules/Project/controller/updateProject.js', () => ({ updateProjectInternal: (...a) => mockProjectInc(...a) }));

const logger = require('../Config/loggerConfig');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const status = require('../Modules/Milestone/controller/status');

const C = '6f0000000000000000000c01';
const OTHER_COMPANY = '6f0000000000000000000c02';
const ME = '6f0000000000000000000001';
const OWNER = '6f0000000000000000000009';
const PROJECT = '6f0000000000000000000b01';
const MILESTONE = '6f0000000000000000000e01';

const settle = () => new Promise((resolve) => setImmediate(resolve));

const call = async (handler, body, uid = ME, headers = { companyid: C }, aud = headers.companyid) => {
    const r = { code: 200, body: null };
    r.status = (c) => { r.code = c; return r; };
    r.send = (b) => { r.body = b; return r; };
    r.json = r.send;
    await handler(verified({ headers, body, query: {}, params: {}, uid, aud }), r);
    await settle();
    return r;
};

const milestoneWrites = () => mockCrud.mock.calls.filter(([, { type }]) => type === SCHEMA_TYPE.MILESTONE);

beforeEach(() => {
    jest.clearAllMocks();
    mockProjectInc.mockResolvedValue(true);
    mockCrud.mockImplementation(async (companyId, { type }, method) => {
        if (type === SCHEMA_TYPE.USERS && method === 'findOne') return { _id: ME, Employee_Name: 'Ana' };
        if (type === SCHEMA_TYPE.COMPANY_USERS && method === 'findOne') return { userId: OWNER };
        return { acknowledged: true };
    });
});

describe('clearMilestoneStatus', () => {
    const body = (over = {}) => ({
        projectId: PROJECT,
        ProjectName: 'Apollo',
        milestoneObject: { _id: MILESTONE, milestoneName: 'Beta', amount: 100, statusArray: [{ milestoneStatusColor: 'FUNDED' }], refundedAmount: [{ amount: 30 }, { amount: 20 }] },
        ...over,
    });

    it('resets every status field of the milestone in the caller company and answers success', async () => {
        const r = await call(status.clearMilestoneStatus, body());

        expect(r.body).toEqual({ status: true, statusText: 'Milestone Clear Status', data: '' });
        const writes = milestoneWrites();
        expect(writes).toHaveLength(1);
        const [companyId, obj, method] = writes[0];
        expect(companyId).toBe(C);
        expect(method).toBe('updateOne');
        expect(String(obj.data[0]._id)).toBe(MILESTONE);
        expect(obj.data[1]).toEqual({ statusArray: [], refundedAmount: [], minRefundDate: 0, maxRefundDate: 0, statusDate: 0, statusId: '' });
        expect(mockRemoveCache).toHaveBeenCalledWith(`milestone:${PROJECT}:${C}`);
    });

    it('takes the refunded total back off the project budget when the milestone was not cancelled', async () => {
        await call(status.clearMilestoneStatus, body());
        expect(mockProjectInc).toHaveBeenCalledWith(C, PROJECT, { milestoneAmount: 50 }, '$inc', []);
    });

    it('gives the milestone amount back to the project when the last status was CANCELLED', async () => {
        const milestoneObject = { _id: MILESTONE, milestoneName: 'Beta', amount: 100, statusArray: [{ milestoneStatusColor: 'FUNDED' }, { milestoneStatusColor: 'CANCELLED' }], refundedAmount: [{ amount: 30 }] };
        await call(status.clearMilestoneStatus, body({ milestoneObject }));
        expect(mockProjectInc).toHaveBeenCalledWith(C, PROJECT, { milestoneAmount: 100 }, '$inc', []);
    });

    it('records history and a notification that name the project and the milestone', async () => {
        await call(status.clearMilestoneStatus, body());
        const [, companyId, projectId, , historyObj, user] = mockHistory.mock.calls[0];
        expect([companyId, projectId]).toEqual([C, PROJECT]);
        expect(historyObj.key).toBe('Project_Milestone_status_clear');
        expect(historyObj.message).toContain('Beta');
        expect(user).toMatchObject({ id: ME, Employee_Name: 'Ana', companyOwnerId: OWNER });
        const note = mockNotify.mock.calls[0][0];
        expect(note.companyId).toBe(C);
        expect(note.object.message).toContain('Apollo');
        expect(note.object.message).toContain('Beta');
    });

    it('answers with the error and writes no milestone when the project update fails', async () => {
        mockProjectInc.mockRejectedValue('project gone');
        const r = await call(status.clearMilestoneStatus, body());
        expect(r.body).toEqual({ status: false, statusText: 'project gone' });
        expect(milestoneWrites()).toHaveLength(0);
        expect(mockHistory).not.toHaveBeenCalled();
    });

    it('answers with the error and sends no history when the milestone write fails', async () => {
        mockCrud.mockImplementation(async (companyId, { type }, method) => {
            if (type === SCHEMA_TYPE.MILESTONE) throw 'write failed';
            if (type === SCHEMA_TYPE.USERS) return { _id: ME, Employee_Name: 'Ana' };
            return { userId: OWNER };
        });
        const r = await call(status.clearMilestoneStatus, body());
        expect(r.body).toEqual({ status: false, statusText: 'write failed' });
        expect(mockHistory).not.toHaveBeenCalled();
        expect(mockRemoveCache).not.toHaveBeenCalled();
    });

    it.each([
        ['projectId', { projectId: '' }, 'project Id is required'],
        ['milestoneObject', { milestoneObject: undefined }, 'milestoneArray is required'],
        ['an empty milestoneObject', { milestoneObject: {} }, 'milestoneArray is required'],
        ['ProjectName', { ProjectName: '' }, 'ProjectName is required'],
    ])('refuses a body without %s and changes nothing', async (label, over, text) => {
        const r = await call(status.clearMilestoneStatus, body(over));
        expect(r.body).toEqual({ status: false, statusText: text });
        expect(mockProjectInc).not.toHaveBeenCalled();
        expect(milestoneWrites()).toHaveLength(0);
    });

    it('refuses a request with no body', async () => {
        const r = await call(status.clearMilestoneStatus, undefined);
        expect(r.body).toEqual({ status: false, statusText: 'Request body is required' });
        expect(mockCrud).not.toHaveBeenCalled();
    });
});

describe('cancelMilestoneStatus', () => {
    const body = (over = {}) => ({
        projectId: PROJECT,
        ProjectName: 'Apollo',
        onlyNumber: 40,
        statusObj: { name: 'Cancelled', backgroundColor: '#990000' },
        milestoneObject: {
            _id: MILESTONE,
            milestoneName: 'Beta',
            statusArray: [
                { milestoneStatusColor: 'FUNDED', statusDateValue: '2026-01-05T00:00:00Z' },
                { milestoneStatusColor: 'CANCELLED', statusDateValue: { seconds: 1780000000 } },
            ],
        },
        ...over,
    });

    it('stores the status trail with the last status as the current one, in the caller company', async () => {
        const r = await call(status.cancelMilestoneStatus, body());

        expect(r.body).toEqual({ status: true, statusText: 'Milestone Cancel Status', data: '' });
        const [companyId, obj, method] = milestoneWrites()[0];
        expect(companyId).toBe(C);
        expect(method).toBe('updateOne');
        expect(String(obj.data[0]._id)).toBe(MILESTONE);
        const set = obj.data[1];
        expect(set.statusId).toBe('CANCELLED');
        expect(set.statusDate).toBe(1780000000 * 1000);
        expect(set.statusArray).toHaveLength(2);
        expect(set.statusArray[0].statusDateValue).toEqual(new Date('2026-01-05T00:00:00Z'));
        expect(set.statusArray[1].statusDateValue).toEqual(new Date(1780000000 * 1000));
        expect(mockRemoveCache).toHaveBeenCalledWith(`milestone:${PROJECT}:${C}`);
    });

    it('takes the cancelled amount off the project budget', async () => {
        await call(status.cancelMilestoneStatus, body());
        expect(mockProjectInc).toHaveBeenCalledWith(C, PROJECT, { milestoneAmount: -40 }, '$inc', []);
    });

    it('notifies the project with the status name and colour, and logs history for the caller', async () => {
        await call(status.cancelMilestoneStatus, body());
        const note = mockNotify.mock.calls[0][0];
        expect(note).toMatchObject({ type: 'project', companyId: C, projectId: PROJECT });
        expect(note.object.key).toBe('project_milestone_status_change');
        expect(note.object.message).toContain('Cancelled');
        expect(note.object.message).toContain('#990000');
        expect(note.object.message).toContain('Beta');
        expect(note.object.message).toContain('Apollo');
        const [, companyId, projectId, , historyObj, user] = mockHistory.mock.calls[0];
        expect([companyId, projectId, user.id]).toEqual([C, PROJECT, ME]);
        expect(historyObj.message).toContain('changed <b>Beta</b> milestone status to <b>Cancelled</b>');
    });

    it('answers with the error and writes nothing when the project update fails', async () => {
        mockProjectInc.mockRejectedValue('nope');
        const r = await call(status.cancelMilestoneStatus, body());
        expect(r.body).toEqual({ status: false, statusText: 'nope' });
        expect(milestoneWrites()).toHaveLength(0);
        expect(mockNotify).not.toHaveBeenCalled();
    });

    it('answers with the error and notifies nobody when the milestone write fails', async () => {
        mockCrud.mockImplementation(async (companyId, { type }) => {
            if (type === SCHEMA_TYPE.MILESTONE) throw 'write failed';
            if (type === SCHEMA_TYPE.USERS) return { _id: ME, Employee_Name: 'Ana' };
            return { userId: OWNER };
        });
        const r = await call(status.cancelMilestoneStatus, body());
        expect(r.body).toEqual({ status: false, statusText: 'write failed' });
        expect(mockNotify).not.toHaveBeenCalled();
        expect(mockHistory).not.toHaveBeenCalled();
    });

    it.each([
        ['projectId', { projectId: undefined }, 'project Id is required'],
        ['milestoneObject', { milestoneObject: {} }, 'milestoneArray is required'],
        ['ProjectName', { ProjectName: undefined }, 'ProjectName is required'],
        ['statusObj', { statusObj: undefined }, 'statusObj is required'],
        ['an empty statusObj', { statusObj: {} }, 'statusObj is required'],
    ])('refuses a body without %s and changes nothing', async (label, over, text) => {
        const r = await call(status.cancelMilestoneStatus, body(over));
        expect(r.body).toEqual({ status: false, statusText: text });
        expect(mockProjectInc).not.toHaveBeenCalled();
        expect(milestoneWrites()).toHaveLength(0);
    });

    it('answers a failure, not a crash, when the milestone has no status array', async () => {
        const r = await call(status.cancelMilestoneStatus, body({ milestoneObject: { _id: MILESTONE, milestoneName: 'Beta' } }));
        expect(r.body.status).toBe(false);
        expect(logger.error).toHaveBeenCalled();
        expect(mockProjectInc).not.toHaveBeenCalled();
        expect(milestoneWrites()).toHaveLength(0);
    });

    it('refuses a request with no body', async () => {
        const r = await call(status.cancelMilestoneStatus, undefined);
        expect(r.body).toEqual({ status: false, statusText: 'Request body is required' });
        expect(mockCrud).not.toHaveBeenCalled();
    });
});

describe('refundAmount', () => {
    const day = (d) => new Date(2026, 0, d, 15, 30);
    const midnight = (d) => new Date(2026, 0, d, 0, 0, 0).getTime();
    const body = (over = {}) => ({
        projectId: PROJECT,
        onlyNumber: 25,
        cuurencyValue: 'EUR',
        milestoneObject: {
            _id: MILESTONE,
            milestoneName: 'Beta',
            refundedAmount: [
                { amount: 10, date: day(9).toISOString() },
                { amount: 15, date: { seconds: Math.floor(day(3).getTime() / 1000) } },
                { amount: 5, date: day(20).toISOString() },
            ],
        },
        ...over,
    });

    it('stores the refunds with the earliest and latest refund day, in the caller company', async () => {
        const r = await call(status.refundAmount, body());

        expect(r.body).toEqual({ status: true, statusText: 'Milestone Refund Amount', data: '' });
        const [companyId, obj, method] = milestoneWrites()[0];
        expect(companyId).toBe(C);
        expect(method).toBe('updateOne');
        expect(String(obj.data[0]._id)).toBe(MILESTONE);
        expect(obj.data[1].minRefundDate).toBe(midnight(3));
        expect(obj.data[1].maxRefundDate).toBe(midnight(20));
        expect(obj.data[1].refundedAmount).toHaveLength(3);
        obj.data[1].refundedAmount.forEach((refund) => expect(refund.date).toBeInstanceOf(Date));
        expect(mockRemoveCache).toHaveBeenCalledWith(`milestone:${PROJECT}:${C}`);
    });

    it('takes the refunded amount off the project budget', async () => {
        await call(status.refundAmount, body());
        expect(mockProjectInc).toHaveBeenCalledWith(C, PROJECT, { milestoneAmount: -25 }, '$inc', []);
    });

    it('uses the same day for the first and last refund when there is only one', async () => {
        const milestoneObject = { _id: MILESTONE, milestoneName: 'Beta', refundedAmount: [{ amount: 10, date: day(9).toISOString() }] };
        await call(status.refundAmount, body({ milestoneObject }));
        const set = milestoneWrites()[0][1].data[1];
        expect(set.minRefundDate).toBe(midnight(9));
        expect(set.maxRefundDate).toBe(midnight(9));
    });

    it('logs the latest refund with its currency and amount', async () => {
        await call(status.refundAmount, body());
        const [, companyId, projectId, , historyObj, user] = mockHistory.mock.calls[0];
        expect([companyId, projectId, user.id]).toEqual([C, PROJECT, ME]);
        expect(historyObj.key).toBe('Project_Milestone_Changed');
        expect(historyObj.message).toContain('refund of <b>EUR 5</b>');
        expect(historyObj.message).toContain('<b>Beta</b>');
        expect(historyObj.message).toContain(`DATE_${day(20).getTime()}`);
    });

    it('answers with the error and writes nothing when the project update fails', async () => {
        mockProjectInc.mockRejectedValue('nope');
        const r = await call(status.refundAmount, body());
        expect(r.body).toEqual({ status: false, statusText: 'nope' });
        expect(milestoneWrites()).toHaveLength(0);
        expect(mockHistory).not.toHaveBeenCalled();
    });

    it.each([
        ['projectId', { projectId: '' }, 'project Id is required'],
        ['onlyNumber', { onlyNumber: 0 }, 'onlyNumber is required'],
        ['milestoneObject', { milestoneObject: {} }, 'milestoneArray is required'],
    ])('refuses a body without %s and changes nothing', async (label, over, text) => {
        const r = await call(status.refundAmount, body(over));
        expect(r.body).toEqual({ status: false, statusText: text });
        expect(mockProjectInc).not.toHaveBeenCalled();
        expect(milestoneWrites()).toHaveLength(0);
    });

    it('answers a failure, not a crash, when there are no refunds to record', async () => {
        const r = await call(status.refundAmount, body({ milestoneObject: { _id: MILESTONE, milestoneName: 'Beta', refundedAmount: [] } }));
        expect(r.body.status).toBe(false);
        expect(logger.error).toHaveBeenCalled();
        expect(mockProjectInc).not.toHaveBeenCalled();
        expect(milestoneWrites()).toHaveLength(0);
    });

    it('refuses a request with no body', async () => {
        const r = await call(status.refundAmount, undefined);
        expect(r.body).toEqual({ status: false, statusText: 'Request body is required' });
        expect(mockCrud).not.toHaveBeenCalled();
    });
});

describe('draggableMilestone', () => {
    const body = (over = {}) => ({ projectId: PROJECT, milestoneObject: { _id: MILESTONE, order: 4 }, ...over });

    it('saves only the new order for that milestone, in the caller company', async () => {
        const r = await call(status.draggableMilestone, body());

        expect(r.body).toEqual({ status: true, statusText: 'Milestone Drag', data: '' });
        expect(mockCrud).toHaveBeenCalledTimes(1);
        const [companyId, obj, method] = mockCrud.mock.calls[0];
        expect(companyId).toBe(C);
        expect(method).toBe('updateOne');
        expect(obj.type).toBe(SCHEMA_TYPE.MILESTONE);
        expect(String(obj.data[0]._id)).toBe(MILESTONE);
        expect(obj.data[1]).toEqual({ order: 4 });
        expect(mockRemoveCache).toHaveBeenCalledWith(`milestone:${PROJECT}:${C}`);
    });

    it('writes no history, notification or project change', async () => {
        await call(status.draggableMilestone, body());
        expect(mockHistory).not.toHaveBeenCalled();
        expect(mockNotify).not.toHaveBeenCalled();
        expect(mockProjectInc).not.toHaveBeenCalled();
    });

    it('answers with the error and logs when the write fails', async () => {
        mockCrud.mockRejectedValue('write failed');
        const r = await call(status.draggableMilestone, body());
        expect(r.body).toEqual({ status: false, statusText: 'write failed' });
        expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('write failed'));
        expect(mockRemoveCache).not.toHaveBeenCalled();
    });

    it.each([
        ['projectId', { projectId: '' }, 'project Id is required'],
        ['milestoneObject', { milestoneObject: undefined }, 'milestoneObject is required'],
        ['an empty milestoneObject', { milestoneObject: {} }, 'milestoneObject is required'],
    ])('refuses a body without %s and writes nothing', async (label, over, text) => {
        const r = await call(status.draggableMilestone, body(over));
        expect(r.body).toEqual({ status: false, statusText: text });
        expect(mockCrud).not.toHaveBeenCalled();
    });

    it('refuses a request with no body', async () => {
        const r = await call(status.draggableMilestone, undefined);
        expect(r.body).toEqual({ status: false, statusText: 'Request body is required' });
        expect(mockCrud).not.toHaveBeenCalled();
    });

    it('refuses a missing company header and writes nothing', async () => {
        const r = await call(status.draggableMilestone, body(), ME, {});
        expect(r.code).toBe(403);
        expect(mockCrud).not.toHaveBeenCalled();
    });
});

describe.each([
    ['clearMilestoneStatus', status.clearMilestoneStatus],
    ['cancelMilestoneStatus', status.cancelMilestoneStatus],
    ['refundAmount', status.refundAmount],
])('%s refusals owned by the handler', (name, handler) => {
    const full = () => ({
        projectId: PROJECT,
        ProjectName: 'Apollo',
        onlyNumber: 5,
        statusObj: { name: 'X', backgroundColor: '#000' },
        milestoneObject: { _id: MILESTONE, milestoneName: 'Beta', statusArray: [{ milestoneStatusColor: 'CANCELLED', statusDateValue: '2026-01-01' }], refundedAmount: [{ amount: 5, date: '2026-01-01' }] },
    });

    it('answers 401 to a signed-out caller and changes nothing', async () => {
        const r = await call(handler, full(), null);
        expect(r.code).toBe(401);
        expect(mockProjectInc).not.toHaveBeenCalled();
        expect(milestoneWrites()).toHaveLength(0);
    });

    it('answers 403 to a body that names another company and touches no database', async () => {
        const r = await call(handler, { ...full(), companyId: OTHER_COMPANY });
        expect(r.code).toBe(403);
        expect(mockCrud).not.toHaveBeenCalled();
        expect(mockProjectInc).not.toHaveBeenCalled();
    });

    it('answers 403 to a header for a company the token does not hold', async () => {
        const r = await call(handler, full(), ME, { companyid: OTHER_COMPANY }, C);
        expect(r.code).toBe(403);
    });
});
