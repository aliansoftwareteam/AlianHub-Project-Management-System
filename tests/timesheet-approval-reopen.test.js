const verified = require('./fixtures/verifiedRequest');
const mockDb = require('./fixtures/fakeMongo').create();
const mockRoles = {};

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({
    getRoleType: jest.fn(async (companyId, userId) => mockRoles[userId]),
    isPrivileged: (roleType) => roleType === 1 || roleType === 2,
}));

const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { schema } = require('../utils/mongo-handler/schema.js');
const socketEmitter = require('../event/socketEventEmitter');
const approval = require('../Modules/TimesheetApproval/controller');
const { isPeriodLocked } = require('../Modules/TimesheetApproval/helpers/lockGuard');

const C = '6f0000000000000000000c01';
const OWNER = '6f0000000000000000000a01';
const ADMIN = '6f0000000000000000000a02';
const MEMBER = '6f0000000000000000000a03';
const APPROVED_AT = new Date(2026, 0, 12, 9, 0);

const call = async (handler, uid, { body = {}, params = {} } = {}) => {
    const res = { statusCode: 200, body: undefined };
    res.status = (code) => { res.statusCode = code; return res; };
    res.send = (sent) => { res.body = sent; return res; };
    res.json = res.send;
    await handler(verified({ headers: { companyid: C }, uid, query: {}, body, params }), res);
    return res;
};

const sheet = (over = {}) => mockDb.seed(SCHEMA_TYPE.TIMESHEET_APPROVAL, {
    userId: MEMBER,
    periodType: 'week',
    periodStart: new Date(2026, 0, 5),
    periodEnd: new Date(2026, 0, 11),
    status: 'approved',
    totalMinutes: 2400,
    reviewedAt: APPROVED_AT,
    reviewedBy: ADMIN,
    reviewerName: 'Asha Admin',
    rejectionReason: '',
    deletedStatusKey: 0,
    ...over,
});
const stored = (id) => mockDb.store[SCHEMA_TYPE.TIMESHEET_APPROVAL].find((d) => String(d._id) === String(id));
const review = (uid, id, body) => call(approval.reviewTimesheet, uid, { body, params: { id } });
const reopen = (uid, id) => review(uid, id, { action: 'reopen' });

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.calls.length = 0;
    jest.clearAllMocks();
    Object.assign(mockRoles, { [OWNER]: 1, [ADMIN]: 2, [MEMBER]: 3 });
    mockDb.seed(SCHEMA_TYPE.USERS, { _id: OWNER, Employee_Name: 'Olive Owner' });
    mockDb.seed(SCHEMA_TYPE.USERS, { _id: ADMIN, Employee_Name: 'Asha Admin' });
});

describe('reopening an approved week', () => {
    it.each([['an owner', OWNER], ['an admin', ADMIN]])('%s, who may approve it, may reopen it', async (label, uid) => {
        const week = sheet();
        const res = await reopen(uid, week._id);

        expect(res.body.status).toBe(true);
        expect(res.body.data.status).toBe('submitted');
        expect(stored(week._id).status).toBe('submitted');
    });

    it('the person whose week it is may not, and nothing changes', async () => {
        const week = sheet();
        const res = await reopen(MEMBER, week._id);

        expect(res.body).toEqual({ status: false, statusText: 'Only an owner or admin can review timesheets.' });
        expect(stored(week._id)).toMatchObject({ status: 'approved', reviewedBy: ADMIN, reviewerName: 'Asha Admin', reviewedAt: APPROVED_AT });
        expect(stored(week._id).history).toBeUndefined();
        expect(socketEmitter.emit).not.toHaveBeenCalled();
    });

    it('puts the week back as it stood before the approval: submitted, with no review on it', async () => {
        const week = sheet({ submittedAt: new Date(2026, 0, 11, 18, 0), submittedBy: MEMBER, note: 'all in' });
        await reopen(OWNER, week._id);

        expect(stored(week._id)).toMatchObject({
            status: 'submitted', reviewedAt: null, reviewedBy: '', reviewerName: '', rejectionReason: '',
            submittedAt: new Date(2026, 0, 11, 18, 0), submittedBy: MEMBER, note: 'all in', totalMinutes: 2400,
        });
    });

    it('writes who reopened it and when, and whose approval that undid, in the week\'s history', async () => {
        const week = sheet();
        const before = Date.now();
        const res = await reopen(OWNER, week._id);

        const { history } = stored(week._id);
        expect(history).toHaveLength(1);
        expect(history[0]).toMatchObject({
            action: 'reopen', from: 'approved', to: 'submitted', by: OWNER, byName: 'Olive Owner',
            reviewedBy: ADMIN, reviewerName: 'Asha Admin', reviewedAt: APPROVED_AT,
        });
        expect(history[0].at).toBeInstanceOf(Date);
        expect(history[0].at.getTime()).toBeGreaterThanOrEqual(before);
        expect(res.body.data.history).toHaveLength(1);
    });

    it('keeps each reopening when a week is approved and reopened again', async () => {
        const week = sheet();
        await reopen(OWNER, week._id);
        await review(ADMIN, week._id, { action: 'approve' });
        await reopen(ADMIN, week._id);

        expect(stored(week._id).history.map((entry) => [entry.action, entry.by, entry.reviewedBy])).toEqual([
            ['reopen', OWNER, ADMIN],
            ['approve', ADMIN, undefined],
            ['reopen', ADMIN, ADMIN],
        ]);
        expect(stored(week._id).status).toBe('submitted');
    });

    it('emits the event an approval emits', async () => {
        const fresh = sheet({ status: 'submitted', reviewedAt: null, reviewedBy: '', reviewerName: '', periodStart: new Date(2026, 0, 12), periodEnd: new Date(2026, 0, 18) });
        await review(OWNER, fresh._id, { action: 'approve' });
        const [approveEvent, approvePayload] = socketEmitter.emit.mock.calls[0];
        socketEmitter.emit.mockClear();

        const week = sheet();
        await reopen(OWNER, week._id);

        expect(socketEmitter.emit).toHaveBeenCalledTimes(1);
        const [event, payload] = socketEmitter.emit.mock.calls[0];
        expect(event).toBe(approveEvent);
        expect({ type: payload.type, module: payload.module }).toEqual({ type: approvePayload.type, module: approvePayload.module });
        expect(payload.data).toMatchObject({ status: 'submitted' });
        expect(String(payload.data._id)).toBe(String(week._id));
    });

    it('lets time in the week be edited again', async () => {
        const week = sheet();
        const day = new Date(2026, 0, 7);
        expect(await isPeriodLocked({ companyId: C, userId: MEMBER, date: day })).toBe(true);
        await reopen(OWNER, week._id);
        expect(await isPeriodLocked({ companyId: C, userId: MEMBER, date: day })).toBe(false);
    });

    it('refuses a week that is only submitted, and writes no history', async () => {
        const week = sheet({ status: 'submitted', reviewedAt: null, reviewedBy: '', reviewerName: '' });
        const res = await reopen(OWNER, week._id);

        expect(res.body).toEqual({ status: false, statusText: 'Only an approved or rejected timesheet can be reopened.' });
        expect(stored(week._id).history).toBeUndefined();
        expect(socketEmitter.emit).not.toHaveBeenCalled();
    });

    it('adds no history to a rejection', async () => {
        const week = sheet({ status: 'submitted', reviewedAt: null, reviewedBy: '', reviewerName: '' });
        await review(OWNER, week._id, { action: 'reject', reason: 'Friday is missing' });
        expect(stored(week._id).history).toBeUndefined();
    });
});

describe('the history survives the strict approval schema', () => {
    const Approvals = mongoose.models.ReopenApproval || mongoose.model('ReopenApproval', new mongoose.Schema(schema.timesheetApproval, { strict: true, timestamps: true }));

    it('keeps every field of an entry', () => {
        const entry = { action: 'reopen', from: 'approved', to: 'submitted', by: OWNER, byName: 'Olive Owner', at: new Date(2026, 0, 13), reviewedBy: ADMIN, reviewerName: 'Asha Admin', reviewedAt: APPROVED_AT };
        const doc = new Approvals({ userId: MEMBER, periodStart: new Date(2026, 0, 5), periodEnd: new Date(2026, 0, 11), history: [entry] });
        expect(doc.toObject().history).toEqual([entry]);
    });
});
