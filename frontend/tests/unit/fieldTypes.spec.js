/* Task 046 slice A1.1 — people, url, rating and progress custom fields, everywhere a field appears. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { config, flushPromises, mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { createStore } from 'vuex';
import { ref } from 'vue';
import en from '@/locales/en';

const { apiRequest, USERS } = vi.hoisted(() => ({
    apiRequest: vi.fn(),
    USERS: {
        'a1a1a1a1a1a1a1a1a1a1a1a1': { Employee_Name: 'Olivia Owner', Employee_profileImageURL: '' },
        'b2b2b2b2b2b2b2b2b2b2b2b2': { Employee_Name: 'Max Member', Employee_profileImageURL: '' },
        'c3c3c3c3c3c3c3c3c3c3c3c3': { Employee_Name: 'Zed Outsider', Employee_profileImageURL: '' }
    }
}));
vi.mock('@/services', () => ({ apiRequest }));
vi.mock('@/store/index', () => ({ default: { commit: () => {}, dispatch: () => Promise.resolve(), getters: {}, state: {} } }));
vi.mock('@/composable', () => ({
    useCustomComposable: () => ({ checkPermission: () => true, checkApps: () => true, makeUniqueId: () => 'uid' }),
    useGetterFunctions: () => ({ getUser: (id) => ({ id, _id: id, Employee_Name: 'Ghost User', ...(USERS[id] || {}) }), getTeam: () => ({}) })
}));

import {
    FIELD_TYPES, customFieldPayload, customFieldText, emptyFieldDetail, projectFieldDefs, shownFieldValues
} from '@/views/Projects/composables/projectCustomFields';
import {
    comparisonsFor, customFieldGroups, customFilterCondition, customFilterOptions, customGroupMatches, customGroupOptions, customGroupUpdate,
    customSortValue, tableSortStages, valuePath
} from '@/views/Projects/composables/customFieldQuery';
import { sortTasks } from '@/views/Projects/composables/viewSort';
import { aiDraftFrom, aiFieldPayload, aiOutputOf, aiRatingMaxOf, isAiField, newAiDraft } from '@/views/Projects/composables/aiFields';
import { cleanViewSettings } from '@viewSettings';
import { fieldTypeUi, peopleOptions } from '@/plugins/customFieldView/fieldTypes';
import PeopleFieldValue from '@/plugins/customFieldView/fieldTypes/PeopleFieldValue.vue';
import UrlFieldValue from '@/plugins/customFieldView/fieldTypes/UrlFieldValue.vue';
import RatingFieldValue from '@/plugins/customFieldView/fieldTypes/RatingFieldValue.vue';
import ProgressFieldValue from '@/plugins/customFieldView/fieldTypes/ProgressFieldValue.vue';
import CustomFieldCell from '@/views/Projects/components/columns/CustomFieldCell.vue';
import CustomFieldRender from '@/plugins/customFieldView/component/molecules/customFieldTaskView/customFieldRender.vue';
import CustomFieldFilterValue from '@/components/molecules/TaskFilter/CustomFieldFilterValue.vue';
import FieldBuilder from '@/plugins/customFieldView/component/organisms/FieldBuilder/FieldBuilder.vue';

const i18n = createI18n({ legacy: false, locale: 'en', messages: { en }, missingWarn: false, fallbackWarn: false });
config.global.plugins = [i18n];
config.global.mocks = {};

const [OLIVIA, MAX, ZED] = Object.keys(USERS);
const userName = (id) => USERS[id]?.Employee_Name;
const PEOPLE = 'd1'.repeat(12);
const LINK = 'd2'.repeat(12);
const SCORE = 'd3'.repeat(12);
const DONE = 'd4'.repeat(12);
const base = { isDelete: true, type: 'task', global: true };
const people = { ...base, _id: PEOPLE, fieldType: 'people', fieldTitle: 'Reviewers', fieldMultiple: true };
const link = { ...base, _id: LINK, fieldType: 'url', fieldTitle: 'Spec' };
const score = { ...base, _id: SCORE, fieldType: 'rating', fieldTitle: 'Score', fieldRatingMax: 5 };
const done = { ...base, _id: DONE, fieldType: 'progress', fieldTitle: 'Done' };
const DEFS = [people, link, score, done];
const values = (over = {}) => ({ [PEOPLE]: [MAX, OLIVIA], [LINK]: 'https://www.example.com/specs/7?x=1', [SCORE]: 3, [DONE]: 40, ...over });
const task = (over = {}, extra = {}) => ({
    _id: 't1', ProjectID: 'p1', TaskTypeKey: 1,
    customField: Object.fromEntries(Object.entries(values(over)).map(([id, fieldValue]) => [id, { _id: id, fieldValue }])),
    ...extra
});

const getters = {
    'settings/companyUsers': () => [
        { userId: OLIVIA, status: 2, isDelete: false }, { userId: MAX, status: 2, isDelete: false }, { userId: ZED, status: 3, isDelete: false }
    ],
    'settings/teams': () => [],
    'settings/finalCustomFields': () => DEFS,
    'settings/customFields': () => [],
    'settings/selectedCompany': () => ({ planFeature: { customFields: true } }),
    'settings/AllTaskType': () => ({ settings: [] }),
    'settings/taskType': () => [],
    'projectData/tasks': () => ({}),
    'projectData/alltasks': () => [],
    'users/users': () => Object.entries(USERS).map(([_id, user]) => ({ _id, ...user }))
};
const mutations = { 'settings/mutateFinalCustomFields': () => {} };
const store = createStore({ getters, mutations });

const Assignee = {
    name: 'Assignee',
    props: ['users', 'options', 'multiSelect'],
    emits: ['selected', 'removed'],
    template: '<div data-picker><slot name="trigger" :open="() => {}" /></div>'
};
const global = { plugins: [store], provide: { $dateFormat: ref('DD/MM/YYYY'), selectedProject: ref({ _id: 'p1' }), $clientWidth: ref(1280) }, stubs: { Assignee, AiFieldMark: true } };

beforeEach(() => apiRequest.mockReset());

describe('the four types are field types', () => {
    it('lists them, and a project shows fields of those types', () => {
        expect(FIELD_TYPES).toEqual(expect.arrayContaining(['people', 'url', 'rating', 'progress']));
        expect(projectFieldDefs(DEFS, 'p1').map((def) => def.fieldType)).toEqual(['people', 'url', 'rating', 'progress']);
        DEFS.forEach((def) => expect(fieldTypeUi(def.fieldType)).toMatchObject({ icon: expect.any(String), value: expect.anything() }));
        expect(fieldTypeUi('text')).toBeNull();
    });

    it('turns what a person entered into the value the server stores, or refuses it', () => {
        expect(customFieldPayload(people, [OLIVIA, MAX])).toEqual({ fieldValue: [OLIVIA, MAX], _id: PEOPLE });
        expect(customFieldPayload(people, 'olivia')).toEqual({ invalid: true });
        expect(customFieldPayload({ ...people, fieldMultiple: false }, [OLIVIA, MAX])).toEqual({ invalid: true });
        expect(customFieldPayload(link, 'example.com/spec')).toEqual({ fieldValue: 'https://example.com/spec', _id: LINK });
        expect(customFieldPayload(link, 'http://example.com')).toEqual({ fieldValue: 'http://example.com/', _id: LINK });
        expect(customFieldPayload(link, 'javascript:alert(1)')).toEqual({ invalid: true });
        expect(customFieldPayload(link, 'ftp://example.com')).toEqual({ invalid: true });
        expect(customFieldPayload(score, 4)).toEqual({ fieldValue: 4, _id: SCORE });
        expect(customFieldPayload(score, 6)).toEqual({ invalid: true });
        expect(customFieldPayload(score, '')).toEqual({ fieldValue: '', _id: SCORE });
        expect(customFieldPayload(done, '55')).toEqual({ fieldValue: 55, _id: DONE });
        expect(customFieldPayload(done, 0)).toEqual({ fieldValue: 0, _id: DONE });
        expect(customFieldPayload(done, '101')).toEqual({ invalid: true });
        expect(emptyFieldDetail(people)).toEqual({ fieldValue: [], _id: PEOPLE });
        expect(emptyFieldDetail(score)).toEqual({ fieldValue: '', _id: SCORE });
    });

    it('reads each value as one line of text', () => {
        expect(customFieldText(people, task(), { userName })).toBe('Max Member, Olivia Owner');
        expect(customFieldText(link, task())).toBe('https://www.example.com/specs/7?x=1');
        expect(customFieldText(link, task({ [LINK]: 'javascript:alert(1)' }))).toBe('');
        expect(customFieldText(score, task())).toBe('3/5');
        expect(customFieldText(done, task())).toBe('40%');
        expect(customFieldText(done, task({ [DONE]: 0 }))).toBe('0%');
        expect(customFieldText(done, task({ [DONE]: '' }))).toBe('');
    });
});

describe('a url value', () => {
    const shown = (value, props = {}) => mount(UrlFieldValue, { props: { def: link, value, label: 'Spec', ...props }, global });

    it('is a link that opens in a new tab without handing over the opener, shortened to its host in a cell', () => {
        const anchor = shown('https://www.example.com/specs/7?x=1', { compact: true }).get('a');
        expect(anchor.attributes('href')).toBe('https://www.example.com/specs/7?x=1');
        expect(anchor.attributes('target')).toBe('_blank');
        expect(anchor.attributes('rel')).toBe('noopener noreferrer');
        expect(anchor.text()).toBe('www.example.com');
        expect(shown('https://www.example.com/specs/7?x=1').get('a').text()).toBe('https://www.example.com/specs/7?x=1');
    });

    it.each([['javascript:alert(1)'], ['data:text/html,<b>x</b>'], [' java\nscript:alert(1)'], ['vbscript:x']])('never makes %j an href', (value) => {
        const wrapper = shown(value, { compact: true });
        expect(wrapper.find('a').exists()).toBe(false);
        expect(wrapper.html()).not.toContain('href');
    });

    it('edits in place: Enter saves what was typed, Esc drops it', async () => {
        const wrapper = shown('https://example.com/', { editable: true, compact: true });
        await wrapper.get('[data-url-edit]').trigger('click');
        await wrapper.get('input').setValue('example.com/new');
        await wrapper.get('input').trigger('keydown', { key: 'Enter' });
        expect(wrapper.emitted('change')).toEqual([['example.com/new']]);

        await wrapper.get('[data-url-edit]').trigger('click');
        await wrapper.get('input').setValue('other.test');
        await wrapper.get('input').trigger('keydown', { key: 'Escape' });
        expect(wrapper.emitted('change')).toHaveLength(1);
        expect(wrapper.find('input').exists()).toBe(false);
    });

    it('offers no editor without the right', () => {
        expect(shown('https://example.com/').find('[data-url-edit]').exists()).toBe(false);
    });
});

describe('a rating value', () => {
    const shown = (value, props = {}) => mount(RatingFieldValue, { props: { def: score, value, label: 'Score', ...props }, global });

    it('shows filled stars drawn in the page, not an image', () => {
        const wrapper = shown(3);
        expect(wrapper.get('[role="img"]').attributes('aria-label')).toBe('Score: 3 of 5');
        expect(wrapper.findAll('.ftr__star')).toHaveLength(5);
        expect(wrapper.findAll('.ftr__star.is-on')).toHaveLength(3);
        expect(wrapper.find('img').exists()).toBe(false);
    });

    it('uses the field\'s own maximum, and never shows more than it', () => {
        expect(shown(8, { def: { ...score, fieldRatingMax: 10 } }).findAll('.ftr__star.is-on')).toHaveLength(8);
        expect(shown(9).findAll('.ftr__star.is-on')).toHaveLength(5);
    });

    it('is set with a click, and cleared by clicking the value it has', async () => {
        const wrapper = shown(3, { editable: true });
        const stars = wrapper.findAll('[role="radio"]');
        expect(stars).toHaveLength(5);
        expect(stars[2].attributes('aria-checked')).toBe('true');
        await stars[4].trigger('click');
        await stars[2].trigger('click');
        expect(wrapper.emitted('change')).toEqual([[5], ['']]);
    });

    it('is set and cleared from the keyboard', async () => {
        const wrapper = shown(3, { editable: true });
        const group = wrapper.get('[role="radiogroup"]');
        await group.trigger('keydown', { key: 'ArrowRight' });
        await group.trigger('keydown', { key: 'ArrowLeft' });
        await group.trigger('keydown', { key: 'End' });
        await group.trigger('keydown', { key: 'Delete' });
        expect(wrapper.emitted('change')).toEqual([[4], [2], [5], ['']]);
        expect(wrapper.findAll('[role="radio"]').filter((star) => star.attributes('tabindex') === '0')).toHaveLength(1);
    });

    it('has a clear button in the task panel when it holds a value', async () => {
        const wrapper = shown(3, { editable: true });
        await wrapper.get('[data-rating-clear]').trigger('click');
        expect(wrapper.emitted('change')).toEqual([['']]);
        expect(shown('', { editable: true }).find('[data-rating-clear]').exists()).toBe(false);
    });
});

describe('a progress value', () => {
    const shown = (value, props = {}) => mount(ProgressFieldValue, { props: { def: done, value, label: 'Done', ...props }, global });

    it('shows a bar and the percentage', () => {
        const bar = shown(40).get('[role="progressbar"]');
        expect(bar.attributes('aria-valuenow')).toBe('40');
        expect(bar.attributes('aria-label')).toBe('Done');
        expect(bar.get('.ftp__fill').attributes('style')).toContain('width: 40%');
        expect(shown(40).text()).toBe('40%');
        expect(shown(250).get('.ftp__fill').attributes('style')).toContain('width: 100%');
        expect(shown('').find('[role="progressbar"]').exists()).toBe(false);
    });

    it('is set by dragging the bar', async () => {
        const wrapper = shown(40, { editable: true });
        const range = wrapper.get('input[type="range"]');
        expect(range.attributes()).toMatchObject({ min: '0', max: '100', step: '1' });
        await range.setValue(70);
        await range.trigger('change');
        expect(wrapper.emitted('change')).toEqual([[70]]);
    });

    it('is set by typing, saved on Enter', async () => {
        const wrapper = shown(40, { editable: true });
        const number = wrapper.get('[data-progress-number]');
        await number.setValue('55');
        await number.trigger('keydown', { key: 'Enter' });
        expect(wrapper.emitted('change')).toEqual([['55']]);
    });
});

describe('a people value', () => {
    const shown = (value, props = {}) => mount(PeopleFieldValue, { props: { def: people, value, label: 'Reviewers', ...props }, global });

    it('shows avatars with names', () => {
        const wrapper = shown([MAX, OLIVIA]);
        expect(wrapper.findAll('[data-person]').map((person) => person.text())).toEqual(['MMax Member', 'OOlivia Owner']);
        expect(wrapper.findAll('.ah-avatar')).toHaveLength(2);
    });

    it('keeps to the first person and a count in a cell, with every name for a screen reader', () => {
        const wrapper = shown([MAX, OLIVIA], { compact: true });
        expect(wrapper.findAll('[data-person]')).toHaveLength(1);
        expect(wrapper.text()).toContain('Max Member');
        expect(wrapper.text()).toContain('+1');
        expect(wrapper.get('[role="img"]').attributes('aria-label')).toBe('Reviewers: Max Member, Olivia Owner');
    });

    it('is edited with the assignee picker, adding and removing one person at a time', async () => {
        const wrapper = shown([MAX], { editable: true });
        const picker = wrapper.getComponent(Assignee);
        expect(picker.props('multiSelect')).toBe(true);
        expect(picker.props('users')).toEqual([MAX]);
        picker.vm.$emit('selected', { id: OLIVIA });
        picker.vm.$emit('removed', { id: MAX });
        expect(wrapper.emitted('change')).toEqual([[[MAX, OLIVIA]], [[]]]);
    });

    it('replaces the person when the field holds one', () => {
        const wrapper = shown([MAX], { editable: true, def: { ...people, fieldMultiple: false } });
        const picker = wrapper.getComponent(Assignee);
        expect(picker.props('multiSelect')).toBe(false);
        picker.vm.$emit('selected', { id: OLIVIA });
        expect(wrapper.emitted('change')).toEqual([[[OLIVIA]]]);
    });

    it('offers active members who can open the project, and whoever is already on the field', () => {
        const seats = store.getters['settings/companyUsers'];
        expect(peopleOptions({ project: { _id: 'p1' }, seats, teams: [], current: [] })).toEqual([OLIVIA, MAX]);
        expect(peopleOptions({ project: { _id: 'p1', isPrivateSpace: true, AssigneeUserId: [MAX] }, seats, teams: [], current: [] })).toEqual([MAX]);
        expect(peopleOptions({ project: { _id: 'p1', isPrivateSpace: true, AssigneeUserId: ['tId_team1'] }, seats, teams: [{ _id: 'team1', assigneeUsersArray: [OLIVIA] }], current: [ZED] })).toEqual([OLIVIA, ZED]);
        expect(shown([ZED], { editable: true }).getComponent(Assignee).props('options')).toEqual([OLIVIA, MAX, ZED]);
    });
});

describe('a List or Table cell', () => {
    const cell = (def, data = task(), editable = true) => mount(CustomFieldCell, { props: { def, task: data, editable }, global });

    it('shows each type with its own rendering', () => {
        expect(cell(people).findAll('[data-person]')).toHaveLength(1);
        expect(cell(link).get('a').text()).toBe('www.example.com');
        expect(cell(score).findAll('.ftr__star.is-on')).toHaveLength(3);
        expect(cell(done).get('input[type="range"]').element.value).toBe('40');
        expect(cell(done, task(), false).get('[role="progressbar"]').attributes('aria-valuenow')).toBe('40');
    });

    it('hands an inline edit to the row', async () => {
        const rating = cell(score);
        await rating.findAll('[role="radio"]')[3].trigger('click');
        expect(rating.emitted('change')).toEqual([[4]]);

        const reviewers = cell(people);
        reviewers.getComponent(Assignee).vm.$emit('removed', { id: MAX });
        expect(reviewers.emitted('change')).toEqual([[[OLIVIA]]]);
    });

    it('is read-only without the right', () => {
        expect(cell(score, task(), false).find('[role="radio"]').exists()).toBe(false);
        expect(cell(link, task(), false).find('[data-url-edit]').exists()).toBe(false);
        expect(cell(people, task(), false).findComponent(Assignee).exists()).toBe(false);
    });

    it('stays empty on a task of a type the field is not for', () => {
        const scoped = cell({ ...score, fieldTaskTypes: [2] });
        expect(scoped.find('.ftr__star').exists()).toBe(false);
        expect(scoped.get('.ah-sr-only').text()).toBe(en.ViewColumns.field_not_for_type.replace('{field}', 'Score'));
    });
});

describe('the task panel', () => {
    it('shows the four types with their editors, and sends a change as the value to store', async () => {
        const wrapper = mount(CustomFieldRender, { props: { task: task(), editPermission: true }, global });
        await vi.waitFor(() => expect(wrapper.findAll('[data-field-type]').map((row) => row.attributes('data-field-type'))).toEqual(['people', 'url', 'rating', 'progress']), { timeout: 4000 });
        expect(wrapper.findAll('[data-person]').map((person) => person.text())).toEqual(['MMax Member', 'OOlivia Owner']);
        expect(wrapper.get('a').attributes('href')).toBe('https://www.example.com/specs/7?x=1');

        await wrapper.findAll('[role="radio"]')[4].trigger('click');
        expect(wrapper.emitted('fieldValue')).toEqual([[expect.objectContaining({ _id: SCORE }), 5]]);
        wrapper.unmount();
    });

    it('is read-only without the right, and hides a field the task\'s type does not use', async () => {
        const scoped = createStore({ getters: { ...getters, 'settings/finalCustomFields': () => [{ ...score, fieldTaskTypes: [2] }, done] } });
        const wrapper = mount(CustomFieldRender, { props: { task: task(), editPermission: false }, global: { ...global, plugins: [scoped] } });
        await vi.waitFor(() => expect(wrapper.findAll('[data-field-type]').map((row) => row.attributes('data-field-type'))).toEqual(['progress']), { timeout: 4000 });
        expect(wrapper.find('input').exists()).toBe(false);
        wrapper.unmount();
    });
});

describe('a Board card', () => {
    const columns = DEFS.map((def) => ({ id: `cf:${def._id}`, label: def.fieldTitle, field: def }));

    it('shows the four types read-only, and leaves out the ones with no value', () => {
        const entries = shownFieldValues(columns, task(), { userName });
        expect(entries.map((entry) => [entry.label, entry.text])).toEqual([['Reviewers', 'Max Member, Olivia Owner'], ['Spec', 'https://www.example.com/specs/7?x=1'], ['Score', '3/5'], ['Done', '40%']]);
        entries.forEach((entry) => expect(entry).toMatchObject({ field: expect.objectContaining({ _id: expect.any(String) }) }));
        expect(entries[2].value).toBe(3);

        const blank = shownFieldValues(columns, task({ [PEOPLE]: [], [LINK]: '', [SCORE]: '', [DONE]: 0 }), { userName });
        expect(blank.map((entry) => entry.label)).toEqual(['Done']);
        expect(shownFieldValues(columns.map((column) => ({ ...column, field: { ...column.field, fieldTaskTypes: [2] } })), task(), { userName })).toEqual([]);
    });
});

describe('filter, group and sort', () => {
    const EMPTY = [null, '', []];
    const row = (def, comparison, rowValues = []) => ({
        name: { value: `customField.${def._id}`, type: 'custom', fieldType: def.fieldType, filterOn: valuePath(def._id) },
        comparison: { value: comparison }, values: rowValues
    });
    const names = (def) => comparisonsFor(def.fieldType).map((item) => item.value);

    it('offers every type as a filter, with the operators that suit it', () => {
        expect(customFilterOptions(DEFS).map((option) => option.fieldType)).toEqual(['people', 'url', 'rating', 'progress']);
        expect(names(people)).toEqual([':', ':!=', ':set', ':empty']);
        expect(names(link)).toEqual([':~', ':=', ':set', ':empty']);
        expect(names(score)).toEqual([':=', ':!=', ':>', ':<', ':set', ':empty']);
        expect(names(done)).toEqual(names(score));
    });

    it('filters people by "is", "is not", "is set" and "is empty"', () => {
        expect(customFilterCondition(row(people, ':', [MAX]))).toEqual({ [valuePath(PEOPLE)]: { $in: [MAX] } });
        expect(customFilterCondition(row(people, ':!=', [MAX, OLIVIA]))).toEqual({ [valuePath(PEOPLE)]: { $nin: [MAX, OLIVIA] } });
        expect(customFilterCondition(row(people, ':set'))).toEqual({ [valuePath(PEOPLE)]: { $nin: EMPTY } });
        expect(customFilterCondition(row(people, ':empty'))).toEqual({ [valuePath(PEOPLE)]: { $in: EMPTY } });
        expect(customFilterCondition(row(people, ':!=', [MAX]), [{ ...people, fieldTaskTypes: [2] }]))
            .toEqual({ $or: [{ [valuePath(PEOPLE)]: { $nin: [MAX] } }, { TaskTypeKey: { $nin: [2] } }] });
    });

    it('filters a url as text, and a rating or progress as a number', () => {
        expect(customFilterCondition(row(link, ':~', ['example.com']))).toEqual({ [valuePath(LINK)]: { $regex: 'example\\.com', $options: 'i' } });
        const asNumber = { $convert: { input: `$${valuePath(SCORE)}`, to: 'double', onError: null, onNull: null } };
        expect(customFilterCondition(row(score, ':=', [4]))).toEqual({ $expr: { $eq: [asNumber, 4] } });
        expect(customFilterCondition(row(done, ':>', [50])).$expr.$and[1]).toEqual({ $gt: [{ $convert: { input: `$${valuePath(DONE)}`, to: 'double', onError: null, onNull: null } }, 50] });
    });

    it('lets the server keep a saved view that filters on the new types', () => {
        const filters = DEFS.map((def) => ({ ...row(def, ':set', [true]), condition: '&&' }));
        expect(cleanViewSettings({ filters }).filters.map((filter) => filter.name.fieldType)).toEqual(['people', 'url', 'rating', 'progress']);
    });

    it('picks people for a people filter and a number for a rating', async () => {
        const pick = mount(CustomFieldFilterValue, { props: { field: people, comparison: ':', modelValue: [], people: [{ value: OLIVIA, name: 'Olivia Owner' }, { value: MAX, name: 'Max Member' }, { value: '$meMode', name: 'Me' }] }, global });
        expect(pick.findAll('input[type="checkbox"]')).toHaveLength(2);
        await pick.findAll('input[type="checkbox"]')[1].setValue(true);
        expect(pick.emitted('update:modelValue')[0]).toEqual([[MAX]]);
        expect(mount(CustomFieldFilterValue, { props: { field: score, comparison: ':>', modelValue: [] }, global }).find('input[type="number"]').exists()).toBe(true);
    });

    it('groups by person, with a group for no one', () => {
        expect(customGroupOptions(DEFS).map((option) => option.fieldType)).toEqual(['people', 'rating']);
        const groups = customFieldGroups(people, { people: [{ id: OLIVIA, name: 'Olivia Owner' }, { id: MAX, name: 'Max Member' }] });
        expect(groups.map((group) => [group.name, group.searchValue])).toEqual([['Olivia Owner', OLIVIA], ['Max Member', MAX], ['ViewGroups.no_value', '']]);
        expect(groups[1].conditions).toEqual([{ [valuePath(PEOPLE)]: MAX }]);
        expect(groups.map((group) => customGroupMatches(task({ [PEOPLE]: [MAX] }), group))).toEqual([false, true, false]);
        expect(groups.map((group) => customGroupMatches(task({ [PEOPLE]: [] }), group))).toEqual([false, false, true]);
        expect(customGroupUpdate(groups[0])).toEqual({ fieldValue: [OLIVIA], _id: PEOPLE });
        expect(customGroupUpdate(groups[2])).toEqual({ fieldValue: [], _id: PEOPLE });
    });

    it('groups a rating by its value, highest first', () => {
        const groups = customFieldGroups(score);
        expect(groups.map((group) => group.searchValue)).toEqual([5, 4, 3, 2, 1, '']);
        expect(groups[2].conditions).toEqual([{ [valuePath(SCORE)]: { $in: [3, '3'] } }]);
        expect(groups.map((group) => customGroupMatches(task(), group))).toEqual([false, false, true, false, false, false]);
        expect(customGroupMatches(task({ [SCORE]: '' }), groups[5])).toBe(true);
        expect(customGroupUpdate(groups[0])).toEqual({ fieldValue: 5, _id: SCORE });
        expect(customGroupUpdate(groups[5])).toEqual({ fieldValue: '', _id: SCORE });
        expect(customFieldGroups(done)).toEqual([]);
    });

    it('sorts people by the first person\'s name, and ratings and progress as numbers', () => {
        expect(customSortValue(people, task(), { userName })).toBe('max member');
        expect(customSortValue(people, task({ [PEOPLE]: [] }), { userName })).toBeNull();
        expect(customSortValue(score, task())).toBe(3);
        expect(customSortValue(done, task({ [DONE]: 0 }))).toBe(0);
        expect(customSortValue(link, task())).toBe('www.example.com/specs/7?x=1');

        const rows = [task({ [PEOPLE]: [OLIVIA], [DONE]: 80 }, { _id: 'a' }), task({ [PEOPLE]: [] }, { _id: 'b' }), task({ [PEOPLE]: [MAX], [DONE]: 9 }, { _id: 'c' })];
        const context = { fields: DEFS, userName };
        expect(sortTasks(rows, { key: `cf:${PEOPLE}`, dir: 'asc' }, context).map((entry) => entry._id)).toEqual(['c', 'a', 'b']);
        expect(sortTasks(rows, { key: `cf:${DONE}`, dir: 'asc' }, context).map((entry) => entry._id)).toEqual(['c', 'b', 'a']);
    });

    it('sorts a Table by a people column on the server, by the order of the names', () => {
        const [addFields, sort] = tableSortStages(`${valuePath(PEOPLE)}:1`, DEFS, { users: store.getters['users/users'] });
        expect(JSON.stringify(addFields.$addFields.cfSortValue)).toContain(JSON.stringify({ $indexOfArray: [[MAX, OLIVIA, ZED], { $arrayElemAt: [{ $cond: [{ $isArray: `$${valuePath(PEOPLE)}` }, `$${valuePath(PEOPLE)}`, []] }, 0] }] }));
        expect(sort).toEqual({ $sort: { cfSortValue: 1, _id: 1 } });
        expect(tableSortStages(`${valuePath(SCORE)}:-1`, DEFS)[0].$addFields.cfSortValue.$convert.to).toBe('double');
    });
});

describe('an AI rating', () => {
    const aiScore = { ...score, fieldRatingMax: 10, fieldAi: { enabled: true, template: 'custom', output: 'rating', prompt: 'How sure are we?', reads: ['title'] } };

    it('set on a rating field stays a rating field with its own maximum', () => {
        expect(isAiField(aiScore)).toBe(true);
        expect(aiOutputOf(aiScore)).toBe('rating');
        expect(aiRatingMaxOf(aiScore)).toBe(10);
        const payload = aiFieldPayload(aiDraftFrom(aiScore));
        expect(payload).toMatchObject({ fieldType: 'rating', fieldAi: { output: 'rating' } });
        expect(payload).not.toHaveProperty('fieldMaximum');
    });

    it('made in the builder is a rating field with its maximum', () => {
        const payload = aiFieldPayload({ ...newAiDraft(), fieldTitle: 'Risk', output: 'rating', template: 'custom', prompt: 'How risky?', fieldRatingMax: '10' });
        expect(payload).toMatchObject({ fieldType: 'rating', fieldRatingMax: 10 });
        expect(aiRatingMaxOf({ fieldType: 'number' })).toBe(5);
    });
});

describe('the field builder', () => {
    const builder = () => mount(FieldBuilder, {
        global: { ...global, provide: { ...global.provide, $userId: ref(OLIVIA) }, stubs: { ...global.stubs, UpgradePlan: true, CustomFieldsSidebarComponent: true, AiFieldPanel: true, TaskTypeIcon: true } }
    });
    const saved = () => apiRequest.mock.calls.find(([method]) => method === 'post')?.[2]?.updateObject;

    beforeEach(() => apiRequest.mockImplementation((method) => Promise.resolve(method === 'get' ? { data: { data: { names: [] } } } : { status: 200, data: { _id: 'new' } })));

    it('offers the four types, each with an icon', () => {
        const wrapper = builder();
        ['people', 'url', 'rating', 'progress'].forEach((type) => expect(wrapper.find(`[data-field-type-option="${type}"] svg`).exists()).toBe(true));
    });

    it('saves a rating field with the maximum chosen for it', async () => {
        const wrapper = builder();
        await wrapper.get('[data-field-type-option="rating"]').trigger('click');
        await wrapper.get('#fb-title').setValue('Confidence');
        await wrapper.get('[data-rating-max]').setValue('10');
        await wrapper.get('.fb__save').trigger('click');
        await flushPromises();
        expect(saved()).toMatchObject({ fieldTitle: 'Confidence', fieldType: 'rating', fieldRatingMax: 10, type: 'task', global: true, fieldTaskTypes: [] });
    });

    it('refuses a maximum outside 3 to 10 before asking the server', async () => {
        const wrapper = builder();
        await wrapper.get('[data-field-type-option="rating"]').trigger('click');
        await wrapper.get('#fb-title').setValue('Confidence');
        await wrapper.get('[data-rating-max]').setValue('12');
        await wrapper.get('.fb__save').trigger('click');
        await flushPromises();
        expect(saved()).toBeUndefined();
        expect(wrapper.text()).toContain(en.FieldTypes.rating_max_error);
    });

    it('saves a people field for one person or several', async () => {
        const wrapper = builder();
        await wrapper.get('[data-field-type-option="people"]').trigger('click');
        await wrapper.get('#fb-title').setValue('Reviewer');
        await wrapper.get('[data-people-multiple]').setValue(false);
        await wrapper.get('.fb__save').trigger('click');
        await flushPromises();
        expect(saved()).toMatchObject({ fieldTitle: 'Reviewer', fieldType: 'people', fieldMultiple: false });
    });

    it('opens a stored field of one of the types in its own editor', async () => {
        const wrapper = builder();
        await wrapper.findAll('.fb__row').find((row) => row.text().includes('Score')).trigger('click');
        expect(wrapper.get('[data-rating-max]').element.value).toBe('5');
        expect(wrapper.get('#fb-title').element.value).toBe('Score');
    });
});
