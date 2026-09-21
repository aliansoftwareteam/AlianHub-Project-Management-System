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
const { getRoleType } = require('../Config/permissionGuard');
const approval = require('../Modules/TimesheetApproval/controller');
const { parsePeriod } = require('../Modules/TimesheetApproval/helpers/approvalRules');

const C = '6f0000000000000000000c01';
const OWNER = '6f0000000000000000000a01';
const ADMIN = '6f0000000000000000000a02';
const MEMBER = '6f0000000000000000000a03';
const GUEST = '6f0000000000000000000a04';
const OTHER = '6f0000000000000000000a05';
const PERIOD = { periodStart: '2026-09-14', periodEnd: '2026-09-20' };

const call = async (handler, uid, query = {}) => {
    const res = { statusCode: 200, body: undefined };
    res.status = (code) => { res.statusCode = code; return res; };
    res.send = (body) => { res.body = body; return res; };
    res.json = res.send;
    await handler({ headers: { companyid: C }, uid, query, body: {}, params: {} }, res);
    return res;
};

const sheetFor = (userId, note) => {
    const { periodStart, periodEnd } = parsePeriod(PERIOD);
    return mockDb.seed(SCHEMA_TYPE.TIMESHEET_APPROVAL, { userId, periodType: 'week', periodStart, periodEnd, status: 'submitted', totalMinutes: 60, note, deletedStatusKey: 0 });
};

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    jest.clearAllMocks();
    Object.assign(mockRoles, { [OWNER]: 1, [ADMIN]: 2, [MEMBER]: 3, [GUEST]: 0, [OTHER]: 3 });
    sheetFor(OTHER, 'theirs');
    sheetFor(MEMBER, 'mine');
});

describe('whose timesheet approval a caller reads', () => {
    it.each([['an owner', OWNER], ['an admin', ADMIN]])('%s, a timesheet reviewer, reads another user\'s status and history', async (label, uid) => {
        const status = await call(approval.getStatus, uid, { userId: OTHER, ...PERIOD });
        expect(status.body.status).toBe(true);
        expect(status.body.data).toMatchObject({ userId: OTHER, note: 'theirs' });
        const mine = await call(approval.listMine, uid, { userId: OTHER });
        expect(mine.body.data.map((d) => d.userId)).toEqual([OTHER]);
    });

    it.each([['a member', MEMBER], ['a guest', GUEST]])('%s, not a reviewer, gets their own whatever user the query names', async (label, uid) => {
        const status = await call(approval.getStatus, uid, { userId: OTHER, ...PERIOD });
        expect(status.body.status).toBe(true);
        expect(status.body.data ? status.body.data.userId : uid).toBe(uid);
        expect(JSON.stringify(status.body)).not.toContain('theirs');
        const mine = await call(approval.listMine, uid, { userId: OTHER });
        expect(mine.body.data.every((d) => d.userId === uid)).toBe(true);
        expect(JSON.stringify(mine.body)).not.toContain('theirs');
    });

    it('someone with no seat in the company gets only their own, which is nothing', async () => {
        const stranger = '6f0000000000000000000a99';
        const mine = await call(approval.listMine, stranger, { userId: MEMBER });
        expect(mine.body.data).toEqual([]);
    });

    it('a member reads their own status and history, named or not, without a role lookup', async () => {
        for (const query of [{}, { userId: MEMBER }]) {
            const status = await call(approval.getStatus, MEMBER, { ...query, ...PERIOD });
            expect(status.body.data).toMatchObject({ userId: MEMBER, note: 'mine' });
            const mine = await call(approval.listMine, MEMBER, query);
            expect(mine.body.data.map((d) => d.note)).toEqual(['mine']);
        }
        expect(getRoleType).not.toHaveBeenCalled();
    });
});
