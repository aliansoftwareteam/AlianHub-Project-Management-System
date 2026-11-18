const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (...args) => mockDb.crud(...args),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0 } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { withFieldDefaults } = require('../Modules/CustomField/helpers/fieldDefaults');
const { insertCustomFieldPromise } = require('../Modules/CustomField/controller');

const CID = '6f00000000000000000000c1';
const stored = () => mockDb.store[SCHEMA_TYPE.CUSTOM_FIELDS] || [];

beforeEach(() => {
    Object.keys(mockDb.store).forEach((type) => { mockDb.store[type].length = 0; });
});

describe('withFieldDefaults', () => {
    it('lets a date field with no limits take any date on any weekday', () => {
        expect(withFieldDefaults({ fieldTitle: 'Due', fieldType: 'date' })).toEqual({
            fieldTitle: 'Due', fieldType: 'date', fieldPastFuture: ['Past', 'Future'], fieldDaysDisable: [],
        });
        expect(withFieldDefaults({ fieldType: 'date', fieldPastFuture: null }).fieldPastFuture).toEqual(['Past', 'Future']);
    });

    it('keeps the settings a field was sent with', () => {
        const sent = { fieldType: 'date', fieldPastFuture: ['Future'], fieldDaysDisable: [0, 6] };
        expect(withFieldDefaults(sent)).toEqual(sent);
        expect(withFieldDefaults({ fieldType: 'date', fieldPastFuture: [] }).fieldPastFuture).toEqual([]);
    });

    it('gives a dropdown an empty option list', () => {
        expect(withFieldDefaults({ fieldType: 'dropdown' }).fieldOptions).toEqual([]);
        const options = [{ id: 'o1', label: 'Gold' }];
        expect(withFieldDefaults({ fieldType: 'dropdown', fieldOptions: options }).fieldOptions).toBe(options);
    });

    it('does not share one list between two fields', () => {
        expect(withFieldDefaults({ fieldType: 'date' }).fieldDaysDisable).not.toBe(withFieldDefaults({ fieldType: 'date' }).fieldDaysDisable);
    });

    it.each([['text'], ['number'], ['toString'], [undefined]])('adds nothing to a field of type %s', (fieldType) => {
        const sent = { fieldTitle: 'Plain', fieldType };
        expect(withFieldDefaults(sent)).toEqual(sent);
    });
});

describe('saving a new field', () => {
    it('stores a date field with its optional settings, whoever the caller is', async () => {
        await insertCustomFieldPromise({ fieldTitle: 'Due', fieldType: 'date', type: 'task', global: true }, 'save', CID);
        expect(stored()).toHaveLength(1);
        expect(stored()[0]).toMatchObject({ fieldTitle: 'Due', fieldPastFuture: ['Past', 'Future'], fieldDaysDisable: [] });
    });

    it('stores a text field as it was sent', async () => {
        await insertCustomFieldPromise({ fieldTitle: 'Customer', fieldType: 'text', type: 'task', global: true }, 'save', CID);
        expect(stored()[0]).not.toHaveProperty('fieldPastFuture');
        expect(stored()[0]).not.toHaveProperty('fieldOptions');
    });
});
