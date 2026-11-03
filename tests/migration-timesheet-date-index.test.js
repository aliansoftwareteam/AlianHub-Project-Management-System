/* Migration 079 builds the { LogStartTime } timesheets index in every workspace, so a Time report over a date range
   for an owner or admin no longer scans every time log (task 086). */
const mockBuilt = [];

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: async (companyId, query, method) => {
        if (method !== 'createIndexes') throw new Error(`unexpected ${method} on ${query.type}`);
        mockBuilt.push({ companyId: String(companyId), type: query.type, data: query.data });
        return undefined;
    },
}));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

const { buildContext, listMigrations } = require('../migrations');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const { timeSheetSchema } = require('../utils/mongo-handler/createSchema');
const migration = require('../migrations/079-timesheet-date-index');

const ID = '079-timesheet-date-index';
const C1 = '6f00000000000000000000c1';
const C2 = '6f00000000000000000000c2';
const quiet = { info: jest.fn(), error: jest.fn() };
const contextFor = (companies) => buildContext({ MongoDbCrudOpration, SCHEMA_TYPE, logger: quiet, listCompanies: async () => companies.map((_id) => ({ _id })) });

beforeEach(() => { mockBuilt.length = 0; });

describe(ID, () => {
    test('is a company migration, the only one of its number, listed after the ones before it', () => {
        const ids = listMigrations().map((m) => m.id);
        expect(ids.filter((id) => id.startsWith('079-'))).toEqual([ID]);
        expect(ids.indexOf(ID)).toBeGreaterThan(ids.indexOf('078-ai-access-rules'));
        expect(migration).toMatchObject({ id: ID, scope: 'company', INDEX: 'LogStartTime_1' });
    });

    test('the schema declares the index it builds', () => {
        expect(timeSheetSchema.indexes().some(([fields]) => JSON.stringify(fields) === JSON.stringify({ LogStartTime: 1 }))).toBe(true);
    });

    test('builds the timesheets indexes in every workspace, and never drops one', async () => {
        const ctx = contextFor([C1, C2]);
        await migration.up(ctx);
        expect(mockBuilt).toEqual([
            { companyId: C1, type: SCHEMA_TYPE.TIMESHEET, data: [] },
            { companyId: C2, type: SCHEMA_TYPE.TIMESHEET, data: [] },
        ]);
        expect(ctx.companies).toEqual({ [C1]: { ok: true, index: migration.INDEX }, [C2]: { ok: true, index: migration.INDEX } });
    });
});
