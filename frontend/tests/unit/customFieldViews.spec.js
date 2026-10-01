/* 045 slice 1: custom fields group, filter and sort the List, Board and Table, and a view keeps them. */
import { describe, expect, test } from 'vitest';
import { mount } from '@vue/test-utils';
import ListSortControl from '@/views/Projects/ListView/ListSortControl.vue';
import CustomFieldFilterValue from '@/components/molecules/TaskFilter/CustomFieldFilterValue.vue';
import en from '@/locales/en';
import {
    comparisonsFor,
    customFieldGroups,
    customFieldIdOf,
    customFilterCondition,
    customFilterOptions,
    customGroupMatches,
    customGroupOptions,
    customGroupUpdate,
    customSortValue,
    customGroupId,
    tableSortStages,
    valuePath
} from '@/views/Projects/composables/customFieldQuery';
import { cleanSort, settingsFromSort, sortChoices, sortFromSettings, sortTasks } from '@/views/Projects/composables/viewSort';
import { buildFilterQuery } from '@/composable/commonFunction';
import { cleanViewSettings } from '@viewSettings';

const t = (key) => key;
const STAGE = 'a1a1a1a1a1a1a1a1a1a1a1a1';
const DONE = 'b2b2b2b2b2b2b2b2b2b2b2b2';
const DUE = 'c3c3c3c3c3c3c3c3c3c3c3c3';
const SIZE = 'd4d4d4d4d4d4d4d4d4d4d4d4';
const NOTE = 'e5e5e5e5e5e5e5e5e5e5e5e5';

const stage = { _id: STAGE, fieldTitle: 'Stage', fieldType: 'dropdown', fieldOptions: [{ id: 'o1', label: 'Idea', color: '#111' }, { id: 'o2', label: 'Build', color: '#222' }] };
const done = { _id: DONE, fieldTitle: 'Signed off', fieldType: 'checkbox' };
const due = { _id: DUE, fieldTitle: 'Launch', fieldType: 'date' };
const size = { _id: SIZE, fieldTitle: 'Size', fieldType: 'number' };
const note = { _id: NOTE, fieldTitle: 'Note', fieldType: 'text' };
const defs = [stage, done, due, size, note];

const withField = (id, fieldValue, extra = {}) => ({ customField: { [id]: { fieldValue, _id: id } }, ...extra });
const ids = (rows) => rows.map((row) => row._id);

describe('group by custom field', () => {
    test('offers dropdown, checkbox, date and number fields, never free text', () => {
        expect(customGroupOptions(defs).map((option) => option.id)).toEqual([`cf:${STAGE}`, `cf:${DONE}`, `cf:${DUE}`, `cf:${SIZE}`]);
        expect(customGroupOptions(defs)[0]).toMatchObject({ title: 'Stage', fieldType: 'dropdown' });
    });

    test('reads a group id back to its field id and nothing else', () => {
        expect(customFieldIdOf(customGroupId(STAGE))).toBe(STAGE);
        expect(customFieldIdOf(2)).toBeNull();
        expect(customFieldIdOf('cf:$where')).toBeNull();
        expect(customFieldIdOf('cf:abc')).toBeNull();
    });

    test('a dropdown field gives one group per option and one for no value, each with its server condition', () => {
        const groups = customFieldGroups(stage, { t });
        expect(groups.map((group) => group.name)).toEqual(['Idea', 'Build', 'ViewGroups.no_value']);
        expect(groups[0]).toMatchObject({
            customFieldId: STAGE,
            searchKey: valuePath(STAGE),
            searchValue: 'o1',
            textColor: '#111',
            conditions: [{ [`customField.${STAGE}.fieldValue`]: 'o1' }]
        });
        expect(groups[2].conditions).toEqual([{ [`customField.${STAGE}.fieldValue`]: { $in: [null, '', []] } }]);
        expect(groups.every((group) => group.indexName === 'groupByStatusIndex' && group.isExpanded)).toBe(true);
    });

    test('a checkbox field groups checked and unchecked', () => {
        const [on, off] = customFieldGroups(done, { t });
        expect([on.name, off.name]).toEqual(['ViewGroups.checked', 'ViewGroups.unchecked']);
        expect(on.conditions).toEqual([{ [valuePath(DONE)]: { $in: [true, 'true'] } }]);
        expect(off.conditions).toEqual([{ [valuePath(DONE)]: { $nin: [true, 'true'] } }]);
    });

    test('a date field buckets like due date, and its groups are not drop targets', () => {
        const groups = customFieldGroups(due, { t, now: new Date('2026-09-16T09:30:00') });
        expect(groups[0].name).toBe('ViewGroups.date_past');
        expect(groups[groups.length - 1].name).toBe('ViewGroups.no_value');
        expect(groups.every((group) => group.dropDisabled)).toBe(true);
        const today = groups.find((group) => group.searchValue === 'TODAY');
        const expr = today.conditions[0].$expr;
        expect(expr.$and).toHaveLength(3);
        expect(JSON.stringify(expr)).toContain(`$customField.${DUE}.fieldValue`);
    });

    test('rows land in the same group on the client as on the server', () => {
        const [idea, build, none] = customFieldGroups(stage, { t });
        expect(customGroupMatches(withField(STAGE, ['o1']), idea)).toBe(true);
        expect(customGroupMatches(withField(STAGE, ['o1']), build)).toBe(false);
        expect(customGroupMatches(withField(STAGE, []), none)).toBe(true);
        expect(customGroupMatches({}, none)).toBe(true);

        const [on, off] = customFieldGroups(done, { t });
        expect(customGroupMatches(withField(DONE, true), on)).toBe(true);
        expect(customGroupMatches(withField(DONE, 'true'), on)).toBe(true);
        expect(customGroupMatches({}, off)).toBe(true);

        const dated = customFieldGroups(due, { t, now: new Date('2026-09-16T09:30:00') });
        const today = dated.find((group) => group.searchValue === 'TODAY');
        const past = dated[0];
        const noDate = dated[dated.length - 1];
        expect(customGroupMatches(withField(DUE, new Date('2026-09-16T15:00:00').toISOString()), today)).toBe(true);
        expect(customGroupMatches(withField(DUE, '2026-09-01T10:00:00.000Z'), past)).toBe(true);
        expect(customGroupMatches(withField(DUE, ''), noDate)).toBe(true);
    });

    test('an AI field stores the same shapes: several labels sit in each of their groups', () => {
        const [idea, build, none] = customFieldGroups(stage, { t });
        const labelled = withField(STAGE, ['o1', 'o2']);
        expect([idea, build, none].map((group) => customGroupMatches(labelled, group))).toEqual([true, true, false]);
        expect(customSortValue(stage, labelled)).toBe(0);
        expect(customSortValue(size, withField(SIZE, '4'))).toBe(4);
    });

    test('dropping a row on a group writes that group value to the field', () => {
        const [idea, , none] = customFieldGroups(stage, { t });
        expect(customGroupUpdate(idea)).toEqual({ fieldValue: ['o1'], _id: STAGE });
        expect(customGroupUpdate(none)).toEqual({ fieldValue: [], _id: STAGE });
        expect(customGroupUpdate(customFieldGroups(done, { t })[1])).toEqual({ fieldValue: false, _id: DONE });
        expect(customGroupUpdate(customFieldGroups(due, { t })[0])).toBeNull();
    });
});

describe('filter by custom field', () => {
    test('every typed field is a filter field; operators follow its type', () => {
        const options = customFilterOptions([...defs, { _id: 'f6f6f6f6f6f6f6f6f6f6f6f6', fieldTitle: 'Calc', fieldType: 'formula' }]);
        expect(options.map((option) => option.name)).toEqual(['Stage', 'Signed off', 'Launch', 'Size', 'Note']);
        expect(options[0]).toEqual({ value: `customField.${STAGE}`, name: 'Stage', type: 'custom', fieldType: 'dropdown', filterOn: valuePath(STAGE) });

        const ops = (type) => comparisonsFor(type).map((op) => op.value);
        expect(ops('dropdown')).toEqual([':', ':!=', ':set', ':empty']);
        expect(ops('checkbox')).toEqual([':=']);
        expect(ops('number')).toEqual([':=', ':!=', ':>', ':<', ':set', ':empty']);
        expect(ops('date')).toEqual([':=', ':>', ':<', ':set', ':empty']);
        expect(ops('text')).toEqual([':~', ':=', ':set', ':empty']);
    });

    const row = (def, comparison, values) => ({ name: customFilterOptions([def])[0], comparison: { value: comparison }, values, condition: '&&', comparisonsData: [{ value: comparison }] });

    test('dropdown, checkbox and text rows become plain field conditions', () => {
        expect(customFilterCondition(row(stage, ':', ['o1', 'o2']))).toEqual({ [valuePath(STAGE)]: { $in: ['o1', 'o2'] } });
        expect(customFilterCondition(row(stage, ':!=', ['o1']))).toEqual({ [valuePath(STAGE)]: { $nin: ['o1'] } });
        expect(customFilterCondition(row(done, ':=', [false]))).toEqual({ [valuePath(DONE)]: { $nin: [true, 'true'] } });
        expect(customFilterCondition(row(note, ':~', ['a.b']))).toEqual({ [valuePath(NOTE)]: { $regex: 'a\\.b', $options: 'i' } });
        expect(customFilterCondition(row(note, ':empty', [true]))).toEqual({ [valuePath(NOTE)]: { $in: [null, '', []] } });
        expect(customFilterCondition(row(note, ':set', [true]))).toEqual({ [valuePath(NOTE)]: { $nin: [null, '', []] } });
    });

    test('numbers compare as numbers although the panel stores them as text', () => {
        const condition = customFilterCondition(row(size, ':>', ['5']));
        const converted = { $convert: { input: `$${valuePath(SIZE)}`, to: 'double', onError: null, onNull: null } };
        expect(condition).toEqual({ $expr: { $and: [{ $ne: [converted, null] }, { $gt: [converted, 5] }] } });
        expect(customFilterCondition(row(size, ':>', ['x']))).toBeNull();
    });

    test('a date row covers the whole day', () => {
        const condition = customFilterCondition(row(due, ':=', ['2026-09-16']));
        const text = JSON.stringify(condition);
        expect(text).toContain(String(new Date('2026-09-16T00:00:00').getTime()));
        expect(text).toContain(String(new Date('2026-09-16T23:59:59.999').getTime()));
    });

    test('a row naming anything but a custom field value is ignored', () => {
        const bad = { ...row(note, ':=', ['x']), name: { ...customFilterOptions([note])[0], filterOn: '$where' } };
        expect(customFilterCondition(bad)).toBeNull();
    });

    test('the task filter builds the custom rows into its query', () => {
        const query = buildFilterQuery([row(stage, ':', ['o1']), { ...row(done, ':=', [true]), condition: '&&' }]);
        expect(query).toEqual({ $and: [{ [valuePath(STAGE)]: { $in: ['o1'] } }, { [valuePath(DONE)]: { $in: [true, 'true'] } }] });
    });
});

describe('sort by custom field, points, estimate and assignee', () => {
    const rows = [
        { _id: 'a', points: 3, totalEstimatedTime: 120, AssigneeUserId: ['u2'], ...withField(SIZE, '10') },
        { _id: 'b', points: null, totalEstimatedTime: 0, AssigneeUserId: [], ...withField(SIZE, '9') },
        { _id: 'c', points: 8, totalEstimatedTime: 30, AssigneeUserId: ['u1'], ...withField(SIZE, '') }
    ];
    const names = { u1: 'Ann', u2: 'Zed' };
    const context = { fields: defs, userName: (id) => names[id] };
    const sorted = (key, dir) => ids(sortTasks(rows, { key, dir }, context));

    test('points, estimate and assignee sort with the empty rows last', () => {
        expect(sorted('points', 'desc')).toEqual(['c', 'a', 'b']);
        expect(sorted('estimate', 'asc')).toEqual(['c', 'a', 'b']);
        expect(sorted('assignee', 'asc')).toEqual(['c', 'a', 'b']);
    });

    test('a number field sorts numerically', () => {
        expect(sorted(`cf:${SIZE}`, 'asc')).toEqual(['b', 'a', 'c']);
        expect(sorted(`cf:${SIZE}`, 'desc')).toEqual(['a', 'b', 'c']);
    });

    test('a dropdown sorts by option order and a date by time', () => {
        expect(customSortValue(stage, withField(STAGE, ['o2']))).toBe(1);
        expect(customSortValue(due, withField(DUE, '2026-09-16T00:00:00.000Z'))).toBe(Date.parse('2026-09-16T00:00:00.000Z'));
        expect(customSortValue(note, withField(NOTE, ''))).toBeNull();
    });

    test('the view keeps the sort as a field path and reads it back', () => {
        expect(settingsFromSort({ key: `cf:${SIZE}`, dir: 'desc' })).toEqual({ field: valuePath(SIZE), dir: -1 });
        expect(sortFromSettings({ field: valuePath(SIZE), dir: -1 })).toEqual({ key: `cf:${SIZE}`, dir: 'desc' });
        expect(settingsFromSort({ key: 'points', dir: 'asc' })).toEqual({ field: 'points', dir: 1 });
        expect(sortFromSettings({ field: 'totalEstimatedTime', dir: 1 })).toEqual({ key: 'estimate', dir: 'asc' });
        expect(sortFromSettings({ field: 'AssigneeUserId', dir: 1 })).toEqual({ key: 'assignee', dir: 'asc' });
        expect(cleanSort({ key: 'cf:nope', dir: 'asc' })).toEqual({ key: 'manual', dir: 'asc' });
    });

    test('the sort menu lists the built-in keys, then the fields', () => {
        const choices = sortChoices([stage, size]);
        expect(choices.slice(-2)).toEqual([{ key: `cf:${STAGE}`, label: 'Stage' }, { key: `cf:${SIZE}`, label: 'Size' }]);
        expect(choices.map((choice) => choice.key)).toEqual(expect.arrayContaining(['points', 'estimate', 'assignee']));
    });

    test('the Table sorts a field on the server by its number when it is one', () => {
        expect(tableSortStages(`${valuePath(SIZE)}: -1`)).toEqual([
            { $addFields: { cfSortValue: { $convert: { input: `$${valuePath(SIZE)}`, to: 'double', onError: `$${valuePath(SIZE)}`, onNull: null } } } },
            { $sort: { cfSortValue: -1, _id: 1 } }
        ]);
        expect(tableSortStages('points: 1')).toEqual([{ $sort: { points: 1, _id: 1 } }]);
    });
});

describe('a saved view keeps the custom field choices', () => {
    test('group by a custom field survives the settings cleaner; a bad id does not', () => {
        expect(cleanViewSettings({ groupBy: `cf:${STAGE}` }).groupBy).toBe(`cf:${STAGE}`);
        expect(cleanViewSettings({ groupBy: 'cf:$where' }).groupBy).toBe(0);
        expect(cleanViewSettings({ groupBy: 9 }).groupBy).toBe(0);
    });

    test('custom filter rows keep their field type and operator', () => {
        const filters = [
            { name: customFilterOptions([size])[0], comparison: { value: ':>', name: 'Greater_Than' }, values: [5], condition: '&&', date: '' },
            { name: customFilterOptions([note])[0], comparison: { value: ':~', name: 'cf_contains' }, values: ['x'], condition: '&&', date: '' },
            { name: customFilterOptions([note])[0], comparison: { value: ':empty', name: 'cf_is_empty' }, values: [true], condition: '&&', date: '' }
        ];
        const clean = cleanViewSettings({ filters }).filters;
        expect(clean).toHaveLength(3);
        expect(clean[0].name).toEqual({ value: `customField.${SIZE}`, name: 'Size', type: 'custom', fieldType: 'number', filterOn: valuePath(SIZE) });
        expect(clean.map((row) => row.comparison.value)).toEqual([':>', ':~', ':empty']);
    });

    test('a custom row with an unknown field type is dropped', () => {
        const bad = { name: { ...customFilterOptions([note])[0], fieldType: 'script' }, comparison: { value: ':=' }, values: ['x'] };
        expect(cleanViewSettings({ filters: [bad] }).filters).toEqual([]);
    });

    test('a sort on a custom field value survives', () => {
        expect(cleanViewSettings({ sort: { field: valuePath(SIZE), dir: -1 } }).sort).toEqual({ field: valuePath(SIZE), dir: -1 });
    });
});

describe('the controls', () => {
    test('the sort menu shows a field by its title and emits its key', async () => {
        const options = sortChoices([size]);
        const wrapper = mount(ListSortControl, { props: { sort: { key: `cf:${SIZE}`, dir: 'asc' }, options }, attachTo: document.body });
        expect(wrapper.find('.lvs__trigger').text()).toContain('Size');
        await wrapper.find('.lvs__trigger').trigger('click');
        const inputs = wrapper.findAll('input[name="lvs-key"]');
        expect(inputs.map((input) => input.element.value)).toEqual(options.map((option) => option.key));
        await inputs[1].setValue(true);
        expect(wrapper.emitted('key')[0]).toEqual([options[1].key]);
        wrapper.unmount();
    });

    test('a dropdown filter row picks options; a number row takes a number', async () => {
        const dropdown = mount(CustomFieldFilterValue, { props: { field: stage, comparison: ':', modelValue: [] } });
        await dropdown.findAll('input[type="checkbox"]')[1].setValue(true);
        expect(dropdown.emitted('update:modelValue')[0]).toEqual([['o2']]);

        const number = mount(CustomFieldFilterValue, { props: { field: size, comparison: ':>', modelValue: [] } });
        await number.find('input[type="number"]').setValue('7');
        expect(number.emitted('update:modelValue').pop()).toEqual([[7]]);

        const empty = mount(CustomFieldFilterValue, { props: { field: size, comparison: ':empty', modelValue: [true] } });
        expect(empty.find('input').exists()).toBe(false);
    });

    test('every new label has English text', () => {
        ['no_value', 'checked', 'unchecked', 'date_past'].forEach((key) => expect(typeof en.ViewGroups[key]).toBe('string'));
        ['cf_contains', 'cf_on', 'cf_before', 'cf_after', 'cf_is_set', 'cf_is_empty', 'cf_value', 'cf_choose'].forEach((key) => expect(typeof en.Filters[key]).toBe('string'));
        ['sort_assignee', 'sort_points', 'sort_estimate'].forEach((key) => expect(typeof en.List[key]).toBe('string'));
    });
});
