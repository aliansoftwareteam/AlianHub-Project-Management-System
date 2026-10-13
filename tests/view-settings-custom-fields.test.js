const { cleanViewSettings, cleanFilterRow } = require('../Modules/Project/helpers/viewSettings');

const FIELD = 'a1a1a1a1a1a1a1a1a1a1a1a1';
const customRow = (overrides = {}) => ({
    name: { value: `customField.${FIELD}`, name: 'Size', type: 'custom', fieldType: 'number', filterOn: `customField.${FIELD}.fieldValue` },
    comparison: { value: ':>', name: 'Greater_Than' },
    values: [5],
    condition: '&&',
    date: '',
    ...overrides,
});

describe('045.1 view settings keep custom field grouping, filters and sort', () => {
    test('groupBy accepts a custom field id and nothing shaped like a path', () => {
        expect(cleanViewSettings({ groupBy: `cf:${FIELD}` }).groupBy).toBe(`cf:${FIELD}`);
        expect(cleanViewSettings({ groupBy: `cf:${FIELD}.x` }).groupBy).toBe(0);
        expect(cleanViewSettings({ groupBy: 'cf:$where' }).groupBy).toBe(0);
        expect(cleanViewSettings({ groupBy: 3 }).groupBy).toBe(3);
    });

    test('a custom filter row keeps its field type and the new operators', () => {
        expect(cleanFilterRow(customRow()).name.fieldType).toBe('number');
        [':~', ':set', ':empty'].forEach((op) => {
            expect(cleanFilterRow(customRow({ comparison: { value: op, name: 'x' } })).comparison.value).toBe(op);
        });
    });

    test('a custom row must point at a custom field value of a known type', () => {
        expect(cleanFilterRow(customRow({ name: { ...customRow().name, fieldType: 'script' } }))).toBeNull();
        expect(cleanFilterRow(customRow({ name: { ...customRow().name, filterOn: 'statusKey' } }))).toBeNull();
    });

    test('a built-in row does not grow a field type', () => {
        const row = { name: { value: 'statusKey', name: 'status', type: 'array', filterOn: 'statusKey', fieldType: 'number' }, comparison: { value: ':', name: 'Is' }, values: [1] };
        expect(cleanFilterRow(row).name).toEqual({ value: 'statusKey', name: 'status', type: 'array', filterOn: 'statusKey' });
    });
});
