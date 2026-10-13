jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn(), validateObjectId: () => true }));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0 } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));

const { PAST, FUTURE, pastFutureOf, cleanPastFuture } = require('../Modules/CustomField/helpers/datePastFuture');
const { fieldInsertFrom, fieldUpdateFrom, FieldWriteError } = require('../Modules/CustomField/helpers/fieldWrite');

const FIELD = '6f0000000000000000000d01';

describe('the past/future words of a date field', () => {
    it('are stored as Past and Future', () => {
        expect([PAST, FUTURE]).toEqual(['Past', 'Future']);
        expect(cleanPastFuture(['Future', 'Past', 'Past'])).toEqual(['Past', 'Future']);
        expect(cleanPastFuture([])).toEqual([]);
    });

    it('reads the words the form used to store in the person\'s language', () => {
        expect(cleanPastFuture(['ભૂતકાળ', 'ભાવિ'])).toEqual(['Past', 'Future']);
        expect(cleanPastFuture(['Futur'])).toEqual(['Future']);
        expect(cleanPastFuture(['Passé'])).toEqual(['Past']);
        expect(pastFutureOf(' past ')).toBe('Past');
    });

    it.each([['Past'], [null], [['Sometime']], [[1]], [[['Past']]]])('refuses %j', (value) => {
        expect(cleanPastFuture(value)).toBeNull();
    });
});

describe('saving a date field', () => {
    it('stores the canonical words whatever language the client sent', () => {
        expect(fieldInsertFrom({ fieldTitle: 'Due', fieldType: 'date', fieldPastFuture: ['Passé', 'Futur'] }).fieldPastFuture).toEqual(['Past', 'Future']);
        expect(fieldUpdateFrom({ key: '$set', id: FIELD, updateObject: { fieldPastFuture: ['ભાવિ'] } }).fieldPastFuture).toEqual(['Future']);
        expect(fieldUpdateFrom({ key: '$set', id: FIELD, updateObject: { fieldPastFuture: [] } }).fieldPastFuture).toEqual([]);
    });

    it('refuses anything else', () => {
        expect(() => fieldInsertFrom({ fieldTitle: 'Due', fieldType: 'date', fieldPastFuture: ['Sometime'] })).toThrow(FieldWriteError);
        expect(() => fieldUpdateFrom({ key: '$set', id: FIELD, updateObject: { fieldPastFuture: 'Past' } })).toThrow(FieldWriteError);
    });

    it('leaves a field that sends no limits alone', () => {
        expect(fieldUpdateFrom({ key: '$set', id: FIELD, updateObject: { fieldTitle: 'Due' } })).not.toHaveProperty('fieldPastFuture');
    });
});
