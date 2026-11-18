jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
const mockDb = require('./fixtures/fakeMongo').create();
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...args) => mockDb.crud(...args) }));
const mockScope = jest.fn();
jest.mock('../Modules/TimeSheet/helpers/timeScope', () => ({
    ...jest.requireActual('../Modules/TimeSheet/helpers/timeScope'),
    resolveSheetScope: (...args) => mockScope(...args),
}));

const { dbCollections } = require('../Config/collections');
const { SHEET_PERMISSION } = require('../Modules/TimeSheet/helpers/timeScope');
const { mongoOperation } = require('../Modules/Auth/controller/mongoOperation');

const COMPANY = '6f0000000000000000000c01';
const ME = '6f0000000000000000000001';
const TEAMMATE = '6f0000000000000000000002';
const OPEN_PROJECT = '6f0000000000000000000b01';
const HIDDEN_PROJECT = '6f0000000000000000000b02';

const MEMBER = { uid: ME, roleType: 3, companyWide: false, everyone: false, visible: [OPEN_PROJECT] };
const MEMBER_SEEING_EVERYONE = { ...MEMBER, everyone: true };
const ADMIN = { uid: ME, roleType: 2, companyWide: true, everyone: true, visible: null };

const totalFor = (match) => ({
    dbName: COMPANY,
    collection: dbCollections.TIMESHEET,
    methodName: 'aggregate',
    dataObj: [[{ $match: match }, { $group: { _id: null, total: { $sum: '$LogTimeDuration' } } }]],
});

const call = async (body) => {
    const res = { statusCode: 200 };
    res.status = jest.fn((code) => { res.statusCode = code; return res; });
    res.json = jest.fn((payload) => { res.body = payload; return res; });
    await mongoOperation({ body, headers: { companyid: COMPANY }, uid: ME }, res);
    return res;
};

beforeEach(() => {
    mockScope.mockReset();
    Object.keys(mockDb.store).forEach((type) => { delete mockDb.store[type]; });
    mockDb.seed(dbCollections.TIMESHEET, { TicketID: 'task-1', Loggeduser: ME, ProjectId: OPEN_PROJECT, LogTimeDuration: 30 });
    mockDb.seed(dbCollections.TIMESHEET, { TicketID: 'task-1', Loggeduser: TEAMMATE, ProjectId: OPEN_PROJECT, LogTimeDuration: 15 });
    mockDb.seed(dbCollections.TIMESHEET, { TicketID: 'task-1', Loggeduser: TEAMMATE, ProjectId: HIDDEN_PROJECT, LogTimeDuration: 100 });
});

describe('the timesheet summary query through /api/v1/mongoOpration', () => {
    it('counts only the caller\'s own time for a member without a wider timesheet permission', async () => {
        mockScope.mockResolvedValue(MEMBER);
        const res = await call(totalFor({ TicketID: 'task-1' }));

        expect(res.statusCode).toBe(200);
        expect(res.body.data).toEqual([{ _id: null, total: 30 }]);
    });

    it('does not widen when the request names someone else', async () => {
        mockScope.mockResolvedValue(MEMBER);
        const res = await call(totalFor({ Loggeduser: TEAMMATE }));

        expect(res.body.data).toEqual([]);
    });

    it('counts everyone\'s time on the projects the caller can open when the permission covers everyone', async () => {
        mockScope.mockResolvedValue(MEMBER_SEEING_EVERYONE);
        const res = await call(totalFor({ TicketID: 'task-1' }));

        expect(res.body.data).toEqual([{ _id: null, total: 45 }]);
    });

    it('counts all time for an owner or admin', async () => {
        mockScope.mockResolvedValue(ADMIN);
        const res = await call(totalFor({ TicketID: 'task-1' }));

        expect(res.body.data).toEqual([{ _id: null, total: 145 }]);
    });

    it('resolves the scope for the signed-in caller from every timesheet permission', async () => {
        mockScope.mockResolvedValue(MEMBER);
        await call(totalFor({ TicketID: 'task-1' }));

        expect(mockScope).toHaveBeenCalledWith(COMPANY, ME, Object.values(SHEET_PERMISSION));
    });

    it('answers 500 and reads nothing when the scope cannot be resolved', async () => {
        mockScope.mockRejectedValue(new Error('down'));
        mockDb.crud.mockClear();
        const res = await call(totalFor({ TicketID: 'task-1' }));

        expect(res.statusCode).toBe(500);
        expect(mockDb.crud.mock.calls.filter(([, { type }]) => type === dbCollections.TIMESHEET)).toEqual([]);
    });
});
