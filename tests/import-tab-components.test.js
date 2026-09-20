const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), log: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { importProjectTabComponents } = require('../utils/data');

const C = '6f00000000000000000000c1';
const T = SCHEMA_TYPE.PROJECT_TAB_COMPONENTS;
const rows = () => mockDb.store[T] || [];

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.calls.length = 0;
});

describe('importProjectTabComponents', () => {
    it('seeds the whole catalogue into an empty company', async () => {
        await importProjectTabComponents(C);
        expect(rows()).toHaveLength(20);
        expect(new Set(rows().map((row) => row.keyName)).size).toBe(20);
    });

    it('fills the gaps of a partial catalogue without touching stored rows', async () => {
        mockDb.seed(T, { name: 'List', sortIndex: 1, keyName: 'ProjectListView', value: 'list', setAsDefault: false, viewStatus: true });
        mockDb.seed(T, { name: 'Board', sortIndex: 2, keyName: 'ProjectKanban', value: 'ProjectKanban', setAsDefault: false, viewStatus: false });
        mockDb.seed(T, { name: 'Calendar', sortIndex: 5, keyName: 'Calendar', value: 'calendar', setAsDefault: false, viewStatus: false });

        await importProjectTabComponents(C);

        expect(rows()).toHaveLength(20);
        expect(rows().find((row) => row.keyName === 'ProjectListView').viewStatus).toBe(true);
    });

    it('fails loudly instead of leaving a partial catalogue', async () => {
        const real = mockDb.crud.getMockImplementation();
        mockDb.crud.mockImplementation(async (companyId, query, method) => {
            if (query.data && query.data[0] && query.data[0].keyName === 'ProjectKanban') throw new Error('disk full');
            return real(companyId, query, method);
        });
        try {
            await expect(importProjectTabComponents(C)).rejects.toThrow('1 of 20 project tab components were not stored');
        } finally {
            mockDb.crud.mockImplementation(real);
        }
    });
});
