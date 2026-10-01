const fakeMongo = require('./fixtures/fakeMongo');

let mockDb;
jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (...args) => mockDb.crud(...args),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));

const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const socketEmitter = require('../event/socketEventEmitter');
const companyCtrl = require('../Modules/Company/controller/updateCompany');
const ptoCtrl = require('../Modules/Pto/controller');
const capacityCtrl = require('../Modules/CapacityPlanning/controller');

const C = 'c00000000000000000000001';
const OWNER = 'a00000000000000000000001';
const ADMIN = 'a00000000000000000000002';
const MEMBER = 'a00000000000000000000003';
const MON_TO_SAT = [1, 2, 3, 4, 5, 6];

const response = () => {
    const res = { statusCode: 200, body: undefined };
    res.status = jest.fn((code) => { res.statusCode = code; return res; });
    res.json = jest.fn((body) => { res.body = body; return res; });
    res.send = res.json;
    res.set = jest.fn(() => res);
    return res;
};

const request = (uid, extra = {}) => ({ uid, aud: C, headers: { companyid: C }, params: {}, query: {}, body: {}, ...extra });

const saveWeek = async (uid, workingDays) => {
    const res = response();
    await companyCtrl.updateCompany(request(uid, { body: { updateObject: { workingDays } } }), res);
    return res;
};

const storedCompany = () => mockDb.calls.filter((call) => call.type === SCHEMA_TYPE.COMPANIES && call.method === 'findOneAndUpdate');

let emitted;
const onCompanyUpdate = (payload) => emitted.push(payload);

beforeAll(() => socketEmitter.on('companies:update', onCompanyUpdate));
afterAll(() => socketEmitter.off('companies:update', onCompanyUpdate));

beforeEach(() => {
    myCache.flushAll();
    emitted = [];
    mockDb = fakeMongo.create();
    mockDb.seed(SCHEMA_TYPE.COMPANIES, { _id: C, Cst_CompanyName: 'Acme' });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: OWNER, roleType: 1, status: 2, isDelete: false });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: ADMIN, roleType: 2, status: 2, isDelete: false });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: MEMBER, roleType: 3, status: 2, isDelete: false });
});

describe('PUT /api/v1/company saves the working days', () => {
    it.each([['the owner', OWNER], ['an admin', ADMIN]])('lets %s choose the week', async (label, uid) => {
        const res = await saveWeek(uid, [0, 1, 2, 3, 4]);
        expect(res.statusCode).toBe(200);
        expect(res.body.workingDays).toEqual([0, 1, 2, 3, 4]);
        expect(storedCompany()[0].data[1]).toEqual({ $set: { workingDays: [0, 1, 2, 3, 4] } });
    });

    it('stores the week sorted and without repeats', async () => {
        const res = await saveWeek(OWNER, [5, 1, 1, 3]);
        expect(res.statusCode).toBe(200);
        expect(storedCompany()[0].data[1].$set.workingDays).toEqual([1, 3, 5]);
    });

    it('saves it beside the rest of the company details form', async () => {
        const res = response();
        await companyCtrl.updateCompany(request(OWNER, { body: { updateObject: { Cst_CompanyName: 'Acme Ltd', workingDays: MON_TO_SAT } } }), res);
        expect(res.statusCode).toBe(200);
        expect(storedCompany()[0].data[1].$set).toEqual({ Cst_CompanyName: 'Acme Ltd', workingDays: MON_TO_SAT });
    });

    it.each([
        ['no days', []],
        ['a day past Saturday', [1, 7]],
        ['a negative day', [-1]],
        ['a fraction', [1.5]],
        ['a day sent as text', ['1']],
        ['a name', 'weekdays'],
        ['null', null],
    ])('refuses %s and writes nothing', async (label, workingDays) => {
        const res = await saveWeek(OWNER, workingDays);
        expect(res.statusCode).toBe(400);
        expect(res.body).toEqual({ status: false, message: expect.any(String) });
        expect(storedCompany()).toHaveLength(0);
        expect(emitted).toHaveLength(0);
    });

    it('refuses a member', async () => {
        const res = await saveWeek(MEMBER, MON_TO_SAT);
        expect(res.statusCode).toBe(403);
        expect(res.body).toEqual({ status: false, message: expect.any(String) });
        expect(storedCompany()).toHaveLength(0);
        expect(emitted).toHaveLength(0);
    });

    it('tells open clients and drops the cached company', async () => {
        myCache.set(`companyData_${C}`, { _id: C, Cst_CompanyName: 'Acme' });
        await saveWeek(OWNER, MON_TO_SAT);
        expect(myCache.get(`companyData_${C}`)).toBeUndefined();
        expect(emitted).toHaveLength(1);
        expect(emitted[0]).toMatchObject({ type: 'update', module: 'companies', updatedFields: { workingDays: MON_TO_SAT } });
        expect(emitted[0].data.data).toMatchObject({ _id: C, workingDays: MON_TO_SAT });
    });
});

describe('time off and capacity count the company\'s working days', () => {
    /* 2026-07-03 is a Friday: the leave covers Friday, Saturday, Sunday and Monday. */
    const seedLeave = () => mockDb.seed(SCHEMA_TYPE.PTO_ENTRIES, {
        userId: OWNER, status: 'approved', type: 'casual', hoursPerDay: 9,
        startDate: new Date('2026-07-03T00:00:00Z'), endDate: new Date('2026-07-06T00:00:00Z'),
    });
    const JULY = { from: '2026-07-01', to: '2026-07-31' };

    const capacityOf = async () => {
        const res = response();
        await ptoCtrl.getCapacity(request(OWNER, { query: JULY }), res);
        return res.body.data;
    };

    it('a company that never chose keeps the Monday-to-Friday count', async () => {
        seedLeave();
        expect(await capacityOf()).toMatchObject({ workingDays: 23, totalCapacityHours: 207, ptoHours: 18, availableHours: 189 });
    });

    it('a Monday-to-Saturday company gains the Saturdays in capacity and in leave', async () => {
        seedLeave();
        await saveWeek(OWNER, MON_TO_SAT);
        expect(await capacityOf()).toMatchObject({ workingDays: 27, totalCapacityHours: 243, ptoHours: 27, availableHours: 216 });
    });

    it('the time off list counts leave days in the company\'s week', async () => {
        seedLeave();
        const list = async () => {
            const res = response();
            await ptoCtrl.listPto(request(OWNER), res);
            return res.body.data.map((row) => row.totalDays);
        };
        expect(await list()).toEqual([2]);
        await saveWeek(OWNER, MON_TO_SAT);
        expect(await list()).toEqual([3]);
    });

    it('the capacity report counts the company\'s week', async () => {
        seedLeave();
        mockDb.seed(SCHEMA_TYPE.USERS, { _id: OWNER, Employee_Name: 'Olive Owner' });
        const report = async () => {
            const res = response();
            await capacityCtrl.getCapacityPlan(request(OWNER, { query: JULY }), res);
            return res.body.data.users.find((row) => row.userId === OWNER);
        };
        expect(await report()).toMatchObject({ workCapacityHours: 184, ptoHours: 18 });
        await saveWeek(OWNER, MON_TO_SAT);
        expect(await report()).toMatchObject({ workCapacityHours: 216, ptoHours: 27 });
    });

    it('the months-ahead report counts the company\'s week', async () => {
        seedLeave();
        const july = async () => {
            const res = response();
            await capacityCtrl.getMonthlyCapacity(request(OWNER, { query: { from: '2026-07', to: '2026-07' } }), res);
            return res.body.data;
        };
        const before = JSON.stringify(await july());
        await saveWeek(OWNER, MON_TO_SAT);
        expect(JSON.stringify(await july())).not.toBe(before);
    });
});
