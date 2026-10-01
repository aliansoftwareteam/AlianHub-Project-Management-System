jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn(), validateObjectId: () => true }));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0 } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));

const { fieldInsertFrom, fieldUpdateFrom, FieldWriteError } = require('../Modules/CustomField/helpers/fieldWrite');

const FIELD = '6f0000000000000000000d01';
const option = (label) => ({ id: label.toLowerCase(), label, value: label.toLowerCase(), color: '#34495E', selected: false });
const update = (updateObject) => fieldUpdateFrom({ key: '$set', id: FIELD, updateObject });

describe('creating a field', () => {
    it.each([['text'], ['textarea'], ['number'], ['money'], ['date'], ['checkbox'], ['email'], ['phone'], ['people'], ['url'], ['rating'], ['progress'], ['rollup']])(
        'takes a %s field that has a name and nothing else',
        (fieldType) => {
            expect(fieldInsertFrom({ fieldTitle: 'Cost', fieldType, type: 'task' }).fieldTitle).toBe('Cost');
        }
    );

    it('stores the name without the spaces around it', () => {
        expect(fieldInsertFrom({ fieldTitle: '  Cost  ', fieldType: 'number' }).fieldTitle).toBe('Cost');
    });

    it.each([[undefined], [''], ['   '], [null], [12], [['Cost']]])('refuses the name %j', (fieldTitle) => {
        expect(() => fieldInsertFrom({ fieldTitle, fieldType: 'text' })).toThrow(FieldWriteError);
    });

    it('takes an empty placeholder and description, and keeps the ones that are sent', () => {
        expect(() => fieldInsertFrom({ fieldTitle: 'Note', fieldType: 'text', fieldPlaceholder: '', fieldDescription: '' })).not.toThrow();
        const kept = fieldInsertFrom({ fieldTitle: 'Note', fieldType: 'text', fieldPlaceholder: 'Type here', fieldDescription: 'Short' });
        expect(kept).toMatchObject({ fieldPlaceholder: 'Type here', fieldDescription: 'Short' });
    });

    it.each([['fieldPlaceholder'], ['fieldDescription']])('refuses a %s that is not text', (name) => {
        expect(() => fieldInsertFrom({ fieldTitle: 'Note', fieldType: 'text', [name]: { $gt: '' } })).toThrow(FieldWriteError);
    });
});

describe('creating a dropdown', () => {
    it('takes a name and one option', () => {
        expect(() => fieldInsertFrom({ fieldTitle: 'Stage', fieldType: 'dropdown', fieldOptions: [option('Alpha')] })).not.toThrow();
    });

    it.each([
        ['no options at all', undefined],
        ['an empty list', []],
        ['options with no label', [{ id: 'a', label: '  ', value: '' }]],
        ['something that is not a list', 'Alpha'],
    ])('refuses %s', (label, fieldOptions) => {
        expect(() => fieldInsertFrom({ fieldTitle: 'Stage', fieldType: 'dropdown', fieldOptions })).toThrow('A dropdown field needs at least one option.');
    });
});

describe('changing a field', () => {
    it('leaves the name, placeholder and description alone when they are not sent', () => {
        expect(update({ isDelete: false })).toEqual({ isDelete: false });
    });

    it('refuses to empty the name', () => {
        expect(() => update({ fieldTitle: ' ' })).toThrow(FieldWriteError);
    });

    it('takes a description that was emptied', () => {
        expect(update({ fieldTitle: 'Note', fieldDescription: '' })).toMatchObject({ fieldTitle: 'Note', fieldDescription: '' });
    });

    it('refuses to take the last option off a dropdown', () => {
        expect(() => update({ fieldType: 'dropdown', fieldOptions: [] })).toThrow('A dropdown field needs at least one option.');
        expect(() => update({ fieldType: 'dropdown', fieldOptions: [option('Beta')] })).not.toThrow();
        expect(() => update({ fieldType: 'dropdown', fieldTitle: 'Stage' })).not.toThrow();
    });
});
