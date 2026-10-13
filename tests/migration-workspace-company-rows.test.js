const mockDbs = {};
const mockDbFor = (db) => { mockDbs[db] = mockDbs[db] || require('./fixtures/fakeMongo').create(); return mockDbs[db]; };
/* The fake stores anything; the real company schema refuses a row with a required field empty. */
const mockValidateCompanyRow = (row) => {
    const mongoose = require('mongoose');
    const { schema } = require('../utils/mongo-handler/schema');
    const Company = mongoose.models.RepairedCompany || mongoose.model('RepairedCompany', new mongoose.Schema(schema.companies, { strict: true }));
    const company = new Company(row);
    const refused = company.validateSync();
    if (refused) throw refused;
    return company.toObject({ flattenMaps: true });
};
const mockCrud = async (db, query, method) => {
    const { SCHEMA_TYPE: types } = require('../Config/schemaType');
    const stored = method === 'save' && query.type === types.COMPANIES ? { ...query, data: mockValidateCompanyRow(query.data) } : query;
    return mockDbFor(String(db)).crud(db, stored, method);
};

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...args) => mockCrud(...args) }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

const { buildContext, validateMigration, listMigrations } = require('../migrations');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { settingsCollectionDocs } = require('../Config/collections');
const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const { planObj } = require('../Modules/Company/defaultSubscriptionData');
const migration = require('../migrations/071-workspace-company-rows');

const ID = '071-workspace-company-rows';
const GLOBAL = SCHEMA_TYPE.GOLBAL;
const OWNER = '6f0000000000000000000001';
const OTHER_OWNER = '6f0000000000000000000002';
const WITHOUT_ROW = '6f0000000000000000000c01';
const WITH_ROW = '6f0000000000000000000c02';
const WAITING = '6f0000000000000000000c03';
const NO_OWNER = '6f0000000000000000000c04';
const NOT_ON_ACCOUNT = '6f0000000000000000000c05';
const SECOND_WITHOUT_ROW = '6f0000000000000000000c06';

const logger = { info: jest.fn(), error: jest.fn() };
const context = () => buildContext({ MongoDbCrudOpration, SCHEMA_TYPE, settingsCollectionDocs, logger, listCompanies: async () => [] });
const companyRows = () => mockDbFor(GLOBAL).store[SCHEMA_TYPE.COMPANIES] || [];
const rowOf = (companyId) => companyRows().find((row) => String(row._id) === companyId);

const taken = (companyId) => mockDbFor(GLOBAL).seed(SCHEMA_TYPE.PRECOMPANIES, { _id: companyId, isAvailable: false, pickupCount: 1 });
const ownerSeat = (companyId, userId, extra = {}) => mockDbFor(companyId).seed(SCHEMA_TYPE.COMPANY_USERS, {
    companyId, userId, roleType: 1, status: 2, isDelete: false, userEmail: 'owner@own.test', designation: 0, ...extra,
});
const account = (userId, firstName, companies) => mockDbFor(GLOBAL).seed(SCHEMA_TYPE.USERS, {
    _id: userId, Employee_FName: firstName, Employee_Name: `${firstName} Owner`, Employee_Email: `${firstName.toLowerCase()}@own.test`, AssignCompany: companies,
});
const existingRow = { _id: WITH_ROW, userId: OWNER, Cst_CompanyName: 'Kept as it was', Cst_Country: 'IN', totalProjects: '4' };

beforeEach(() => {
    Object.keys(mockDbs).forEach((db) => { delete mockDbs[db]; });
    jest.clearAllMocks();
    mockDbFor(GLOBAL).unique(SCHEMA_TYPE.COMPANIES, ['_id']);
    account(OWNER, 'Olivia', [WITH_ROW, WITHOUT_ROW]);
    taken(WITHOUT_ROW);
    ownerSeat(WITHOUT_ROW, OWNER);
    taken(WITH_ROW);
    ownerSeat(WITH_ROW, OWNER);
    mockDbFor(GLOBAL).seed(SCHEMA_TYPE.COMPANIES, { ...existingRow });
    mockDbFor(GLOBAL).seed(SCHEMA_TYPE.PRECOMPANIES, { _id: WAITING, isAvailable: true, pickupCount: 0 });
});

describe(ID, () => {
    test('is a valid global migration listed after 070', () => {
        expect(() => validateMigration(migration, ID)).not.toThrow();
        expect(migration.scope).toBe('global');
        const ids = listMigrations().map((m) => m.id);
        expect(ids.indexOf(ID)).toBeGreaterThan(ids.indexOf('070-goal-source-indexes'));
    });

    test('a workspace made on the sign-up page gets the row sign-up writes now', async () => {
        await migration.up(context());

        expect(rowOf(WITHOUT_ROW)).toMatchObject({
            Cst_CompanyName: "Olivia's workspace",
            Cst_Country: 'N/A',
            Cst_Phone: '',
            Cst_LogTimeDays: '8',
            totalProjects: '0',
            isInactive: false,
            totalData: { storage: 0, trackers: 0, users: 1 },
            companyData: [{ users: 1 }],
            planFeature: expect.objectContaining({ planName: planObj.planName }),
            rowRepairedBy: ID,
        });
        expect(String(rowOf(WITHOUT_ROW).userId)).toBe(OWNER);
    });

    test('the row counts the people the workspace holds, waiting invitations included', async () => {
        mockDbFor(WITHOUT_ROW).seed(SCHEMA_TYPE.COMPANY_USERS, { userId: OTHER_OWNER, roleType: 3, status: 2, isDelete: false });
        mockDbFor(WITHOUT_ROW).seed(SCHEMA_TYPE.COMPANY_USERS, { userId: '', roleType: 3, status: 1, isDelete: false });
        mockDbFor(WITHOUT_ROW).seed(SCHEMA_TYPE.COMPANY_USERS, { userId: '6f0000000000000000000009', roleType: 3, status: 2, isDelete: true });
        mockDbFor(WITHOUT_ROW).seed(SCHEMA_TYPE.COMPANY_USERS, { userId: '', roleType: 3, status: 3, isDelete: false });

        await migration.up(context());

        expect(rowOf(WITHOUT_ROW).companyData).toEqual([{ users: 3 }]);
    });

    test('a row that exists is left exactly as it was', async () => {
        await migration.up(context());

        expect(rowOf(WITH_ROW)).toEqual(expect.objectContaining(existingRow));
        expect(rowOf(WITH_ROW).rowRepairedBy).toBeUndefined();
        expect(companyRows()).toHaveLength(2);
    });

    test('a prepared company nobody took, one with no owner, and one the owner\'s account does not name get no row', async () => {
        taken(NO_OWNER);
        taken(NOT_ON_ACCOUNT);
        ownerSeat(NOT_ON_ACCOUNT, OTHER_OWNER);
        account(OTHER_OWNER, 'Ned', []);

        const outcome = await migration.up(context());

        expect([WAITING, NO_OWNER, NOT_ON_ACCOUNT].map(rowOf)).toEqual([undefined, undefined, undefined]);
        expect(outcome).toEqual({ written: 1, withoutOwner: 2 });
    });

    test('an owner who is no longer active in the workspace is not made its owner again', async () => {
        taken(SECOND_WITHOUT_ROW);
        ownerSeat(SECOND_WITHOUT_ROW, OWNER, { isDelete: true });
        mockDbFor(GLOBAL).store[SCHEMA_TYPE.USERS][0].AssignCompany.push(SECOND_WITHOUT_ROW);

        await migration.up(context());

        expect(rowOf(SECOND_WITHOUT_ROW)).toBeUndefined();
    });

    test('two workspaces of one person get two names, and neither takes a name the person already has', async () => {
        taken(SECOND_WITHOUT_ROW);
        ownerSeat(SECOND_WITHOUT_ROW, OWNER);
        mockDbFor(GLOBAL).store[SCHEMA_TYPE.USERS][0].AssignCompany.push(SECOND_WITHOUT_ROW);
        mockDbFor(GLOBAL).store[SCHEMA_TYPE.COMPANIES][0].Cst_CompanyName = "olivia's Workspace";

        await migration.up(context());

        expect([rowOf(WITHOUT_ROW), rowOf(SECOND_WITHOUT_ROW)].map((row) => row.Cst_CompanyName).sort()).toEqual(["Olivia's workspace 2", "Olivia's workspace 3"]);
    });

    test('a person with no first name on the account gets a plain name', async () => {
        mockDbFor(GLOBAL).store[SCHEMA_TYPE.USERS][0].Employee_FName = '  ';

        await migration.up(context());

        expect(rowOf(WITHOUT_ROW).Cst_CompanyName).toBe('My workspace');
    });

    test('a second run writes nothing', async () => {
        await migration.up(context());
        const after = JSON.stringify(companyRows());

        const outcome = await migration.up(context());

        expect(outcome).toEqual({ written: 0, withoutOwner: 0 });
        expect(JSON.stringify(companyRows())).toBe(after);
    });

    test('every read happens before the first write, so a dry run can show the plan', async () => {
        taken(SECOND_WITHOUT_ROW);
        ownerSeat(SECOND_WITHOUT_ROW, OWNER);
        mockDbFor(GLOBAL).store[SCHEMA_TYPE.USERS][0].AssignCompany.push(SECOND_WITHOUT_ROW);

        await migration.up(context());

        const calls = Object.values(mockDbs).flatMap((db) => db.crud.mock.invocationCallOrder.map((order, index) => ({ order, method: db.crud.mock.calls[index][2] })));
        const firstWrite = Math.min(...calls.filter((call) => call.method === 'save').map((call) => call.order));
        expect(calls.filter((call) => call.method !== 'save' && call.order > firstWrite)).toEqual([]);
    });

    test('says how many rows it wrote', async () => {
        await migration.up(context());

        expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('wrote 1 company row'));
    });

    test('one workspace that cannot be written does not stop the next, and the run is reported as failed', async () => {
        taken(SECOND_WITHOUT_ROW);
        ownerSeat(SECOND_WITHOUT_ROW, OWNER);
        mockDbFor(GLOBAL).store[SCHEMA_TYPE.USERS][0].AssignCompany.push(SECOND_WITHOUT_ROW);
        const crud = mockDbFor(GLOBAL).crud.getMockImplementation();
        mockDbFor(GLOBAL).crud.mockImplementation(async (db, query, method) => {
            if (method === 'save' && String(query.data._id) === WITHOUT_ROW) throw new Error('the database refused the row');
            return crud(db, query, method);
        });
        const ctx = context();

        await expect(migration.up(ctx)).rejects.toThrow(/1 of 2/);

        expect(rowOf(SECOND_WITHOUT_ROW)).toBeDefined();
        expect(ctx.companies[WITHOUT_ROW]).toMatchObject({ ok: false });
        expect(ctx.companies[SECOND_WITHOUT_ROW]).toMatchObject({ ok: true });
    });

    test('a row that appeared after the plan was read is kept, and is no failure', async () => {
        const crud = mockDbFor(GLOBAL).crud.getMockImplementation();
        mockDbFor(GLOBAL).crud.mockImplementation(async (db, query, method) => {
            if (method === 'save') mockDbFor(GLOBAL).seed(SCHEMA_TYPE.COMPANIES, { _id: WITHOUT_ROW, Cst_CompanyName: 'Written meanwhile' });
            return crud(db, query, method);
        });

        const outcome = await migration.up(context());

        expect(outcome).toEqual({ written: 0, withoutOwner: 0 });
        expect(rowOf(WITHOUT_ROW)).toMatchObject({ Cst_CompanyName: 'Written meanwhile' });
        expect(companyRows()).toHaveLength(2);
    });

    describe('verify', () => {
        test('names a workspace that still has no row, and nothing once it has one', async () => {
            expect(await migration.verify(context())).toEqual([expect.stringContaining(WITHOUT_ROW)]);

            await migration.up(context());

            expect(await migration.verify(context())).toEqual([]);
        });
    });

    describe('down', () => {
        test('refuses without the confirmation, and removes nothing', async () => {
            await migration.up(context());

            await expect(migration.down(context())).rejects.toThrow(/--confirm/);

            expect(companyRows()).toHaveLength(2);
        });

        test('removes the rows this migration wrote and no other', async () => {
            await migration.up(context());

            await migration.down(context(), { confirmed: true });

            expect(rowOf(WITHOUT_ROW)).toBeUndefined();
            expect(rowOf(WITH_ROW)).toEqual(expect.objectContaining(existingRow));
        });
    });
});
