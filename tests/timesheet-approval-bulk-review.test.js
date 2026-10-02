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

const { SCHEMA_TYPE } = require('../Config/schemaType');
const socketEmitter = require('../event/socketEventEmitter');
const approval = require('../Modules/TimesheetApproval/controller');

const C = '6f0000000000000000000c01';
const OWNER = '6f0000000000000000000a01';
const ADMIN = '6f0000000000000000000a02';
const MEMBER = '6f0000000000000000000a03';
const UNKNOWN_ID = '6f0000000000000000000fff';

const call = async (handler, uid, { body = {}, params = {} } = {}) => {
    const res = { statusCode: 200, body: undefined };
    res.status = (code) => { res.statusCode = code; return res; };
    res.send = (sent) => { res.body = sent; return res; };
    res.json = res.send;
    await handler(verified({ headers: { companyid: C }, uid, query: {}, body, params }), res);
    return res;
};

let week = 0;
const sheet = (over = {}) => {
    week += 1;
    return mockDb.seed(SCHEMA_TYPE.TIMESHEET_APPROVAL, {
        userId: MEMBER,
        periodType: 'week',
        periodStart: new Date(2026, 0, week * 7),
        periodEnd: new Date(2026, 0, week * 7 + 6),
        status: 'submitted',
        totalMinutes: 60,
        reviewedAt: null,
        reviewedBy: '',
        reviewerName: '',
        rejectionReason: '',
        deletedStatusKey: 0,
        ...over,
    });
};
const stored = (id) => mockDb.store[SCHEMA_TYPE.TIMESHEET_APPROVAL].find((d) => String(d._id) === String(id));
const writes = () => mockDb.calls.filter((c) => c.method === 'findOneAndUpdate');
const bulk = (uid, body) => call(approval.reviewTimesheetsBulk, uid, { body });
const single = (uid, id, body) => call(approval.reviewTimesheet, uid, { body, params: { id } });
const withoutClock = ({ reviewedAt, ...rest }) => rest;

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.calls.length = 0;
    jest.clearAllMocks();
    Object.assign(mockRoles, { [OWNER]: 1, [ADMIN]: 2, [MEMBER]: 3 });
});

describe('POST /api/v2/timesheet-approval/bulk-review', () => {
    it.each([['an owner', OWNER], ['an admin', ADMIN]])('%s approves several submitted timesheets in one request', async (label, uid) => {
        const ids = [sheet(), sheet(), sheet()].map((d) => d._id);
        const res = await bulk(uid, { ids, action: 'approve' });

        expect(res.statusCode).toBe(200);
        expect(res.body.status).toBe(true);
        expect(res.body.data.results).toEqual(ids.map((id) => ({ id, outcome: 'approved' })));
        expect(res.body.data.counts).toEqual({ approved: 3, sent_back: 0, skipped: 0 });
        ids.forEach((id) => {
            expect(stored(id)).toMatchObject({ status: 'approved', reviewedBy: uid, rejectionReason: '' });
            expect(stored(id).reviewedAt).toBeInstanceOf(Date);
        });
    });

    it('sends several back with one note that applies to all of them', async () => {
        const ids = [sheet(), sheet()].map((d) => d._id);
        const res = await bulk(OWNER, { ids, action: 'reject', reason: '  Friday is missing  ' });

        expect(res.body.data.results).toEqual(ids.map((id) => ({ id, outcome: 'sent_back' })));
        expect(res.body.data.counts).toEqual({ approved: 0, sent_back: 2, skipped: 0 });
        ids.forEach((id) => expect(stored(id)).toMatchObject({ status: 'rejected', rejectionReason: 'Friday is missing', reviewedBy: OWNER }));
    });

    it('writes for each id exactly what a single review writes', async () => {
        const one = sheet();
        const many = sheet();
        await single(OWNER, one._id, { action: 'reject', reason: 'Split the client work' });
        await bulk(OWNER, { ids: [many._id], action: 'reject', reason: 'Split the client work' });

        const keep = ({ status, rejectionReason, reviewedBy, reviewerName }) => ({ status, rejectionReason, reviewedBy, reviewerName });
        expect(keep(stored(many._id))).toEqual(keep(stored(one._id)));
        const [singleWrite, bulkWrite] = writes();
        expect(withoutClock(bulkWrite.data[1].$set)).toEqual(withoutClock(singleWrite.data[1].$set));
    });

    it('emits the socket event a single review emits, once per reviewed timesheet', async () => {
        const one = sheet();
        await single(OWNER, one._id, { action: 'approve' });
        const [singleEvent, singlePayload] = socketEmitter.emit.mock.calls[0];
        socketEmitter.emit.mockClear();

        const ids = [sheet(), sheet({ status: 'approved' }), sheet()].map((d) => d._id);
        await bulk(OWNER, { ids, action: 'approve' });

        expect(socketEmitter.emit).toHaveBeenCalledTimes(2);
        socketEmitter.emit.mock.calls.forEach(([event, payload]) => {
            expect(event).toBe(singleEvent);
            expect({ type: payload.type, module: payload.module }).toEqual({ type: singlePayload.type, module: singlePayload.module });
            expect(payload.data.status).toBe('approved');
        });
        expect(socketEmitter.emit.mock.calls.map(([, payload]) => String(payload.data._id))).toEqual([ids[0], ids[2]]);
    });

    it('answers per id and reviews the rest when some cannot be reviewed', async () => {
        const fresh = sheet();
        const approved = sheet({ status: 'approved', reviewedBy: ADMIN });
        const rejected = sheet({ status: 'rejected', reviewedBy: ADMIN, rejectionReason: 'earlier' });
        const deleted = sheet({ deletedStatusKey: 1 });
        const res = await bulk(OWNER, { ids: [fresh._id, approved._id, rejected._id, UNKNOWN_ID, 'not-an-id', deleted._id], action: 'approve' });

        expect(res.statusCode).toBe(200);
        expect(res.body.status).toBe(true);
        expect(res.body.data.results).toEqual([
            { id: fresh._id, outcome: 'approved' },
            { id: approved._id, outcome: 'skipped', reason: 'already_reviewed' },
            { id: rejected._id, outcome: 'skipped', reason: 'already_reviewed' },
            { id: UNKNOWN_ID, outcome: 'skipped', reason: 'not_found' },
            { id: 'not-an-id', outcome: 'skipped', reason: 'not_found' },
            { id: deleted._id, outcome: 'skipped', reason: 'not_found' },
        ]);
        expect(res.body.data.counts).toEqual({ approved: 1, sent_back: 0, skipped: 5 });
        expect(stored(approved._id)).toMatchObject({ status: 'approved', reviewedBy: ADMIN });
        expect(stored(rejected._id)).toMatchObject({ status: 'rejected', rejectionReason: 'earlier' });
        expect(stored(deleted._id).status).toBe('submitted');
    });

    it('skips every id for someone who is not a reviewer, without saying which exist', async () => {
        const theirs = sheet({ userId: OWNER });
        const res = await bulk(MEMBER, { ids: [theirs._id, UNKNOWN_ID], action: 'approve' });

        expect(res.body.data.results).toEqual([
            { id: theirs._id, outcome: 'skipped', reason: 'not_allowed' },
            { id: UNKNOWN_ID, outcome: 'skipped', reason: 'not_allowed' },
        ]);
        expect(stored(theirs._id).status).toBe('submitted');
        expect(writes()).toHaveLength(0);
        expect(socketEmitter.emit).not.toHaveBeenCalled();
    });

    it('reviews an id once when the request repeats it', async () => {
        const one = sheet();
        const res = await bulk(OWNER, { ids: [one._id, one._id], action: 'approve' });
        expect(res.body.data.results).toEqual([{ id: one._id, outcome: 'approved' }]);
        expect(writes()).toHaveLength(1);
    });

    it('does not overwrite a review that lands between its read and its write', async () => {
        const one = sheet();
        const crud = mockDb.crud.getMockImplementation();
        mockDb.crud.mockImplementation(async (companyId, query, method) => {
            const found = await crud(companyId, query, method);
            if (method === 'findOne' && query.type === SCHEMA_TYPE.TIMESHEET_APPROVAL) {
                Object.assign(stored(one._id), { status: 'rejected', reviewedBy: ADMIN, rejectionReason: 'first' });
            }
            return found;
        });
        const res = await bulk(OWNER, { ids: [one._id], action: 'approve' }).finally(() => mockDb.crud.mockImplementation(crud));

        expect(res.body.data.results).toEqual([{ id: one._id, outcome: 'skipped', reason: 'already_reviewed' }]);
        expect(stored(one._id)).toMatchObject({ status: 'rejected', reviewedBy: ADMIN, rejectionReason: 'first' });
        expect(socketEmitter.emit).not.toHaveBeenCalled();
    });

    it('reads and writes only in the caller\'s company', async () => {
        await bulk(OWNER, { ids: [sheet()._id, sheet()._id], action: 'approve' });
        const approvalCalls = mockDb.calls.filter((c) => c.type === SCHEMA_TYPE.TIMESHEET_APPROVAL);
        expect(approvalCalls.length).toBeGreaterThan(0);
        approvalCalls.forEach((c) => expect(c.companyId).toBe(C));
    });

    it('takes 100 ids and refuses 101 before reviewing any', async () => {
        const real = sheet();
        const filler = (n) => Array.from({ length: n }, (_, i) => `7f${String(i).padStart(22, '0')}`);

        const atCap = await bulk(OWNER, { ids: [real._id, ...filler(99)], action: 'approve' });
        expect(atCap.body.status).toBe(true);
        expect(atCap.body.data.results).toHaveLength(100);
        expect(stored(real._id).status).toBe('approved');

        const second = sheet();
        const overCap = await bulk(OWNER, { ids: [second._id, ...filler(100)], action: 'approve' });
        expect(overCap.statusCode).toBe(400);
        expect(overCap.body.status).toBe(false);
        expect(stored(second._id).status).toBe('submitted');
    });

    it.each([
        ['no ids', { ids: undefined, action: 'approve' }],
        ['an empty list', { ids: [], action: 'approve' }],
        ['ids that are not a list', { ids: 'abc', action: 'approve' }],
        ['an action that is not approve or reject', { action: 'reopen' }],
        ['no action', {}],
        ['a send back without a note', { action: 'reject' }],
        ['a send back with a blank note', { action: 'reject', reason: '   ' }],
        ['a note longer than the single review allows', { action: 'reject', reason: 'x'.repeat(501) }],
    ])('refuses %s as a whole and reviews nothing', async (label, body) => {
        const one = sheet({ status: body.action === 'reopen' ? 'approved' : 'submitted' });
        const res = await bulk(OWNER, { ids: [one._id], ...body });
        expect(res.statusCode).toBe(400);
        expect(res.body.status).toBe(false);
        expect(writes()).toHaveLength(0);
        expect(socketEmitter.emit).not.toHaveBeenCalled();
    });
});

describe('POST /api/v2/timesheet-approval/:id/review keeps its answers', () => {
    it('approves a submitted timesheet', async () => {
        const one = sheet();
        const res = await single(OWNER, one._id, { action: 'approve' });
        expect(res.body).toMatchObject({ status: true, statusText: 'Timesheet approved.', data: { status: 'approved', reviewedBy: OWNER } });
    });

    it.each([
        ['a malformed id', () => 'nope', { action: 'approve' }, OWNER, 'A valid id is required.'],
        ['a caller who is not a reviewer', () => sheet()._id, { action: 'approve' }, MEMBER, 'Only an owner or admin can review timesheets.'],
        ['an unknown id', () => UNKNOWN_ID, { action: 'approve' }, OWNER, 'Timesheet submission not found.'],
        ['an already approved timesheet', () => sheet({ status: 'approved' })._id, { action: 'approve' }, OWNER, 'Only a submitted timesheet can be approved.'],
        ['a rejection without a reason', () => sheet()._id, { action: 'reject' }, OWNER, 'A rejection reason is required.'],
    ])('refuses %s with the same text as before', async (label, idOf, body, uid, statusText) => {
        const res = await single(uid, idOf(), body);
        expect(res.body).toEqual({ status: false, statusText });
        expect(writes()).toHaveLength(0);
    });

    it('reopens an approved timesheet and clears its review trail', async () => {
        const one = sheet({ status: 'approved', reviewedBy: ADMIN, reviewerName: 'Ada', reviewedAt: new Date() });
        const res = await single(OWNER, one._id, { action: 'reopen' });
        expect(res.body.status).toBe(true);
        expect(stored(one._id)).toMatchObject({ status: 'submitted', reviewedBy: '', reviewerName: '', reviewedAt: null });
    });
});
