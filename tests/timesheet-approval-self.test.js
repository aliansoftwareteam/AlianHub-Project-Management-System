/* An owner or admin may approve their own week. The approval says that they did, and so does the week's history. */
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
const approval = require('../Modules/TimesheetApproval/controller');

const C = '6f0000000000000000000c01';
const OWNER = '6f0000000000000000000a01';
const ADMIN = '6f0000000000000000000a02';
const MEMBER = '6f0000000000000000000a03';

const call = async (handler, uid, { body = {}, params = {} } = {}) => {
    const res = { statusCode: 200, body: undefined };
    res.status = (code) => { res.statusCode = code; return res; };
    res.send = (sent) => { res.body = sent; return res; };
    res.json = res.send;
    await handler(verified({ headers: { companyid: C }, uid, query: {}, body, params }), res);
    return res;
};

let week = 0;
const sheet = (userId, over = {}) => {
    week += 1;
    return mockDb.seed(SCHEMA_TYPE.TIMESHEET_APPROVAL, {
        userId, periodType: 'week', periodStart: new Date(2026, 0, week * 7), periodEnd: new Date(2026, 0, week * 7 + 6),
        status: 'submitted', totalMinutes: 60, reviewedAt: null, reviewedBy: '', reviewerName: '', rejectionReason: '', deletedStatusKey: 0,
        ...over,
    });
};
const stored = (id) => mockDb.store[SCHEMA_TYPE.TIMESHEET_APPROVAL].find((d) => String(d._id) === String(id));
const writes = () => mockDb.calls.filter((c) => c.method === 'findOneAndUpdate');
const review = (uid, id, body) => call(approval.reviewTimesheet, uid, { body, params: { id } });
const approve = (uid, id) => review(uid, id, { action: 'approve' });
const bulk = (uid, body) => call(approval.reviewTimesheetsBulk, uid, { body });
const flags = (id) => stored(id).history.map((entry) => [entry.action, entry.by, entry.selfApproved]);

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.calls.length = 0;
    jest.clearAllMocks();
    Object.assign(mockRoles, { [OWNER]: 1, [ADMIN]: 2, [MEMBER]: 3 });
    mockDb.seed(SCHEMA_TYPE.USERS, { _id: OWNER, Employee_Name: 'Olive Owner' });
    mockDb.seed(SCHEMA_TYPE.USERS, { _id: ADMIN, Employee_Name: 'Asha Admin' });
});

describe('approving your own week', () => {
    it.each([['an owner', OWNER, 'Olive Owner'], ['an admin', ADMIN, 'Asha Admin']])('%s still may, and the approval and its history say it was their own', async (_label, uid, name) => {
        const own = sheet(uid);
        const before = Date.now();
        const res = await approve(uid, own._id);

        expect(res.body).toMatchObject({ status: true, data: { status: 'approved', selfApproved: true } });
        expect(stored(own._id)).toMatchObject({ status: 'approved', reviewedBy: uid, reviewerName: name, selfApproved: true });
        expect(stored(own._id).history).toHaveLength(1);
        expect(stored(own._id).history[0]).toMatchObject({ action: 'approve', from: 'submitted', to: 'approved', by: uid, byName: name, selfApproved: true });
        expect(stored(own._id).history[0].at.getTime()).toBeGreaterThanOrEqual(before);
        expect(stored(own._id).history[0].at).toEqual(stored(own._id).reviewedAt);
    });

    it('a member still may not approve theirs', async () => {
        const own = sheet(MEMBER);
        const res = await approve(MEMBER, own._id);

        expect(res.body).toEqual({ status: false, statusText: 'Only an owner or admin can review timesheets.' });
        expect(stored(own._id).status).toBe('submitted');
        expect(stored(own._id).selfApproved).toBeUndefined();
    });
});

describe('approving someone else\'s week', () => {
    it('is recorded in the history as not their own', async () => {
        const theirs = sheet(MEMBER);
        await approve(OWNER, theirs._id);

        expect(stored(theirs._id)).toMatchObject({ status: 'approved', reviewedBy: OWNER, selfApproved: false });
        expect(flags(theirs._id)).toEqual([['approve', OWNER, false]]);
    });

    it('sending a week back marks nothing', async () => {
        const own = sheet(OWNER);
        await review(OWNER, own._id, { action: 'reject', reason: 'Friday is missing' });

        expect(stored(own._id)).toMatchObject({ status: 'rejected', selfApproved: false });
        expect(stored(own._id).history).toBeUndefined();
    });
});

describe('a bulk review', () => {
    it('marks only the reviewer\'s own week among the ones it approves, in one write a week', async () => {
        const own = sheet(OWNER);
        const members = sheet(MEMBER);
        const admins = sheet(ADMIN);
        const res = await bulk(OWNER, { ids: [own._id, members._id, admins._id], action: 'approve' });

        expect(res.body.data.counts).toEqual({ approved: 3, sent_back: 0, skipped: 0 });
        expect([own, members, admins].map((w) => stored(w._id).selfApproved)).toEqual([true, false, false]);
        expect([own, members, admins].map((w) => flags(w._id))).toEqual([
            [['approve', OWNER, true]],
            [['approve', OWNER, false]],
            [['approve', OWNER, false]],
        ]);
        expect(writes()).toHaveLength(3);
    });
});

describe('the mark reflects the latest approval', () => {
    it('is cleared by a reopening and stays clear when someone else approves the week again', async () => {
        const own = sheet(OWNER);
        await approve(OWNER, own._id);
        await review(ADMIN, own._id, { action: 'reopen' });
        expect(stored(own._id)).toMatchObject({ status: 'submitted', selfApproved: false });

        await approve(ADMIN, own._id);
        expect(stored(own._id)).toMatchObject({ status: 'approved', reviewedBy: ADMIN, reviewerName: 'Asha Admin', selfApproved: false });
        expect(flags(own._id)).toEqual([['approve', OWNER, true], ['reopen', ADMIN, undefined], ['approve', ADMIN, false]]);
        expect(stored(own._id).history[1]).toMatchObject({ reviewedBy: OWNER, reviewerName: 'Olive Owner' });
    });

    it('is set when the person approves their own week again after someone else had', async () => {
        const own = sheet(OWNER);
        await approve(ADMIN, own._id);
        await review(ADMIN, own._id, { action: 'reopen' });
        await approve(OWNER, own._id);

        expect(stored(own._id)).toMatchObject({ status: 'approved', reviewedBy: OWNER, selfApproved: true });
        expect(flags(own._id)).toEqual([['approve', ADMIN, false], ['reopen', ADMIN, undefined], ['approve', OWNER, true]]);
    });

    it('is cleared when the week is submitted again', async () => {
        const own = sheet(OWNER, { status: 'rejected', selfApproved: true });
        await call(approval.submitTimesheet, OWNER, { body: { periodStart: own.periodStart, periodEnd: own.periodEnd } });
        expect(stored(own._id)).toMatchObject({ status: 'submitted', selfApproved: false });
    });
});

describe('the mark survives the strict approval schema', () => {
    const Approvals = mongoose.models.SelfApproval || mongoose.model('SelfApproval', new mongoose.Schema(schema.timesheetApproval, { strict: true, timestamps: true }));

    it('on the approval and on its history entry', () => {
        const entry = { action: 'approve', from: 'submitted', to: 'approved', by: OWNER, byName: 'Olive Owner', at: new Date(2026, 0, 13), selfApproved: true };
        const doc = new Approvals({ userId: OWNER, periodStart: new Date(2026, 0, 5), periodEnd: new Date(2026, 0, 11), selfApproved: true, history: [entry] }).toObject();
        expect(doc.selfApproved).toBe(true);
        expect(doc.history).toEqual([entry]);
    });
});
