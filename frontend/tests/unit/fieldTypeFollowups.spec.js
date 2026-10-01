/* Task 046 slice A1.6 — the follow-ups to the people, url, rating and progress field types. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { config, mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { createStore } from 'vuex';
import { ref } from 'vue';
import en from '@/locales/en';

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));
vi.mock('@/services', () => ({ apiRequest }));
vi.mock('@/store/index', () => ({ default: { commit: () => {}, dispatch: () => Promise.resolve(), getters: {}, state: {} } }));
vi.mock('@/composable/aiAvailability', async () => {
    const { ref: vueRef } = await import('vue');
    return { aiUsable: vueRef(true), canUseAi: () => true };
});
vi.mock('@/composable', () => ({
    useCustomComposable: () => ({ checkPermission: () => true, checkApps: () => true, makeUniqueId: () => 'uid' }),
    useGetterFunctions: () => ({ getUser: (id) => ({ id, _id: id, Employee_Name: `User ${id}` }), getTeam: () => ({}) })
}));

import { fieldTypeCatalogue, peopleOptions } from '@/plugins/customFieldView/fieldTypes';
import ModuleFieldEditor from '@/plugins/customFieldView/fieldTypes/ModuleFieldEditor.vue';
import CustomFieldDrawer from '@/plugins/customFieldView/component/molecules/customFieldSidebar/customField.vue';
import CustomFieldRender from '@/plugins/customFieldView/component/molecules/customFieldTaskView/customFieldRender.vue';
import AiFieldColumnHead from '@/views/Projects/components/columns/AiFieldColumnHead.vue';
import {
    customFieldGroups, customGroupMatches, customGroupOptions, customGroupUpdate, needsProjectRange, numberRangeStages, rangeFromRows, valuePath
} from '@/views/Projects/composables/customFieldQuery';

const i18n = createI18n({ legacy: false, locale: 'en', messages: { en }, missingWarn: false, fallbackWarn: false });
config.global.plugins = [i18n];
config.global.mocks = {};

const OWNER = 'a1'.repeat(12);
const ADMIN = 'a2'.repeat(12);
const MEMBER = 'a3'.repeat(12);
const SEES_ALL = 'a4'.repeat(12);
const ASSIGNED = 'a5'.repeat(12);
const IN_TEAM = 'a6'.repeat(12);
const LEFT = 'a7'.repeat(12);
const SEATS = [
    { userId: OWNER, roleType: 1, status: 2 }, { userId: ADMIN, roleType: 2, status: 2 }, { userId: MEMBER, roleType: 3, status: 2 },
    { userId: SEES_ALL, roleType: 5, status: 2 }, { userId: ASSIGNED, roleType: 3, status: 2 }, { userId: IN_TEAM, roleType: 3, status: 2 },
    { userId: LEFT, roleType: 3, status: 3 }
];
const RULES = { project: { private_projects: { roles: [{ key: 3, permission: 1 }, { key: 5, permission: 2 }] } } };
const TEAMS = [{ _id: 'team1', assigneeUsersArray: [IN_TEAM] }];

describe('who a people field offers', () => {
    const offered = (project, current = []) => peopleOptions({ project, seats: SEATS, teams: TEAMS, rules: RULES, current });

    it('is every active member on a public project', () => {
        expect(offered({ _id: 'p1' })).toEqual([OWNER, ADMIN, MEMBER, SEES_ALL, ASSIGNED, IN_TEAM]);
    });

    it('is everyone who can open a private project: its people, owners and admins, and roles that see every private project', () => {
        const project = { _id: 'p1', isPrivateSpace: true, AssigneeUserId: [ASSIGNED, 'tId_team1'] };
        expect(offered(project)).toEqual([OWNER, ADMIN, SEES_ALL, ASSIGNED, IN_TEAM]);
    });

    it('is the owner alone on a personal project', () => {
        expect(offered({ _id: 'p1', isPersonal: true, personalOwner: MEMBER })).toEqual([MEMBER]);
    });

    it('still lists whoever is already on the field, so they can be taken off', () => {
        expect(offered({ _id: 'p1', isPrivateSpace: true, AssigneeUserId: [] }, [LEFT])).toEqual([OWNER, ADMIN, SEES_ALL, LEFT]);
    });
});

const getters = {
    'settings/customFields': () => [{ cfType: 'text', cfTitle: 'Text', cfDescrption: 'One line', cfIcon: 'CustomFieldText', cfPrimaryColor: '#111' }],
    'settings/selectedCompany': () => ({ planFeature: { customFields: true } }),
    'settings/finalCustomFields': () => [],
    'settings/AllTaskType': () => ({ settings: [] }),
    'settings/taskType': () => [],
    'settings/companyUsers': () => SEATS,
    'settings/teams': () => TEAMS,
    'settings/rules': () => RULES,
    'projectData/tasks': () => ({}),
    'projectData/alltasks': () => []
};
const store = createStore({ getters });
const global = {
    plugins: [store],
    provide: { $clientWidth: ref(1280), selectedProject: ref({ _id: 'p1' }) },
    stubs: { AiFieldMark: true, TaskTypeIcon: true, UpgradePlan: true, Assignee: true }
};

describe('the types the "create custom field" drawer offers', () => {
    it('adds the four new types to the catalogue, once', () => {
        const t = (key) => key;
        const types = fieldTypeCatalogue(getters['settings/customFields'](), t);
        expect(types.map((type) => type.cfType)).toEqual(['text', 'people', 'url', 'rating', 'progress']);
        expect(types.find((type) => type.cfType === 'rating')).toMatchObject({ cfTitle: 'Fields.type_rating', cfDescrption: 'Fields.hint_rating', icon: 'star' });
        const already = fieldTypeCatalogue([{ cfType: 'rating', cfTitle: 'Stars' }], t);
        expect(already.filter((type) => type.cfType === 'rating')).toEqual([{ cfType: 'rating', cfTitle: 'Stars' }]);
    });

    it('lists them, opens the type\'s own editor and saves the field', async () => {
        const drawer = mount(CustomFieldDrawer, { props: { componentDetails: {}, pageInd: 0, customFieldObject: {} }, global });
        expect(drawer.findAll('[data-field-type]').map((row) => row.attributes('data-field-type'))).toEqual(['text', 'people', 'url', 'rating', 'progress']);

        await drawer.get('[data-field-type="rating"]').trigger('click');
        const editor = drawer.getComponent(ModuleFieldEditor);
        await editor.get('[data-field-title]').setValue('Confidence');
        await editor.get('[data-rating-max]').setValue('7');
        await editor.get('[data-field-save]').trigger('click');
        expect(drawer.emitted('customFieldStore')).toEqual([[expect.objectContaining({ fieldTitle: 'Confidence', fieldType: 'rating', fieldRatingMax: 7, isDelete: true }), false]]);
    });
});

describe('the editor for a field of one of the types', () => {
    const editor = (props) => mount(ModuleFieldEditor, { props, global });

    it('needs a title, and a maximum that fits', async () => {
        const wrapper = editor({ fieldType: 'rating', field: {} });
        await wrapper.get('[data-field-save]').trigger('click');
        expect(wrapper.emitted('save')).toBeUndefined();
        expect(wrapper.text()).toContain(en.Fields.error_title_required);

        await wrapper.get('[data-field-title]').setValue('Score');
        await wrapper.get('[data-rating-max]').setValue('40');
        await wrapper.get('[data-field-save]').trigger('click');
        expect(wrapper.emitted('save')).toBeUndefined();
        expect(wrapper.text()).toContain(en.FieldTypes.rating_max_error);
    });

    it('opens a stored field and saves it as an edit', async () => {
        const stored = { _id: 'f1', fieldTitle: 'Reviewers', fieldType: 'people', fieldMultiple: true, fieldTaskTypes: [], fieldValue: ['x'] };
        const wrapper = editor({ fieldType: 'people', field: stored });
        expect(wrapper.get('[data-field-title]').element.value).toBe('Reviewers');
        await wrapper.get('[data-people-multiple]').setValue(false);
        await wrapper.get('[data-field-save]').trigger('click');
        const [value, isEdit] = wrapper.emitted('save')[0];
        expect(isEdit).toBe(true);
        expect(value).toMatchObject({ fieldTitle: 'Reviewers', fieldType: 'people', fieldMultiple: false });
        expect(value).not.toHaveProperty('fieldValue');
    });

    it('can be left without saving', async () => {
        const wrapper = editor({ fieldType: 'url', field: {} });
        await wrapper.get('[data-field-cancel]').trigger('click');
        expect(wrapper.emitted('cancel')).toHaveLength(1);
    });
});

describe('a task-panel row of one of the types', () => {
    const score = { _id: 'd3'.repeat(12), fieldType: 'rating', fieldTitle: 'Score', fieldRatingMax: 5, isDelete: true, type: 'task', global: true };
    const panel = (editPermission) => mount(CustomFieldRender, {
        props: { task: { _id: 't1', ProjectID: 'p1', TaskTypeKey: 1, customField: {} }, editPermission },
        global: { ...global, plugins: [createStore({ getters: { ...getters, 'settings/finalCustomFields': () => [score] } })] }
    });

    it('has the edit-definition control the other rows have', async () => {
        const wrapper = panel(true);
        await vi.waitFor(() => expect(wrapper.find('[data-field-edit]').exists()).toBe(true), { timeout: 4000 });
        expect(wrapper.get('[data-field-edit]').attributes('aria-label')).toBe(en.FieldTypes.edit_field.replace('{field}', 'Score'));
        await wrapper.get('[data-field-edit]').trigger('click');
        expect(wrapper.emitted('editCustomField')).toEqual([[expect.objectContaining({ _id: score._id, fieldType: 'rating' })]]);
        wrapper.unmount();
    });

    it('does not offer it without the right to edit', async () => {
        const wrapper = panel(false);
        await vi.waitFor(() => expect(wrapper.find('[data-field-type="rating"]').exists()).toBe(true), { timeout: 4000 });
        expect(wrapper.find('[data-field-edit]').exists()).toBe(false);
        wrapper.unmount();
    });
});

describe('an AI field column in the Table header', () => {
    const field = { _id: 'f1', fieldTitle: 'Summary', fieldType: 'textarea', fieldAi: { enabled: true, template: 'summary' } };
    const head = (props = {}) => mount(AiFieldColumnHead, { props: { field, tasks: [], editable: true, ...props }, global: { ...global, stubs: { ShellIcon: true } } });

    it('sorts from its header, like the other custom field columns', async () => {
        const wrapper = head({ sortable: true, sortDir: -1 });
        const button = wrapper.get('[data-ai-column-sort]');
        expect(button.attributes('title')).toBe(en.List.sort_by.replace('{column}', 'Summary'));
        expect(button.text()).toContain('Summary');
        expect(wrapper.get('.tv2__sort-caret').text()).toBe('▼');
        expect(wrapper.get('.tv2__sort-caret').classes()).toContain('is-on');
        await button.trigger('click');
        expect(wrapper.emitted('sort')).toHaveLength(1);
        expect(wrapper.find('[data-ai-column-menu]').exists()).toBe(true);
    });

    it('shows an unsorted column with a resting caret', () => {
        const caret = head({ sortable: true, sortDir: 0 }).get('.tv2__sort-caret');
        expect(caret.text()).toBe('▲');
        expect(caret.classes()).not.toContain('is-on');
    });

    it('stays a plain label where the view has no header sort', () => {
        expect(head().find('[data-ai-column-sort]').exists()).toBe(false);
    });
});

describe('grouping by a number field', () => {
    const SIZE = 'e1'.repeat(12);
    const size = { _id: SIZE, fieldType: 'number', fieldTitle: 'Size' };
    const path = valuePath(SIZE);
    const asNumber = { $convert: { input: `$${path}`, to: 'double', onError: null, onNull: null } };
    const task = (fieldValue, extra = {}) => ({ _id: `t${fieldValue}`, TaskTypeKey: 1, customField: { [SIZE]: { _id: SIZE, fieldValue } }, ...extra });
    const loaded = [task('0'), task('12'), task('37.5'), task('100'), task(''), task('n/a')];
    const names = (groups) => groups.map((group) => group.name);
    const t = (key, params) => (params ? `${key}:${Object.values(params).join(',')}` : key);

    it('offers number, money and progress fields beside the other groupable types', () => {
        const defs = [size, { _id: 'e2'.repeat(12), fieldType: 'money' }, { _id: 'e3'.repeat(12), fieldType: 'progress' }, { _id: 'e4'.repeat(12), fieldType: 'text' }];
        expect(customGroupOptions(defs).map((option) => option.fieldType)).toEqual(['number', 'money', 'progress']);
    });

    it('makes up to five even bands between the lowest and highest loaded value, then "No value"', () => {
        const groups = customFieldGroups(size, { t, tasks: loaded });
        expect(names(groups)).toEqual([
            'ViewGroups.number_below:20', 'ViewGroups.number_between:20,40', 'ViewGroups.number_between:40,60', 'ViewGroups.number_between:60,80',
            'ViewGroups.number_from:80', 'ViewGroups.no_value'
        ]);
        expect(groups[1].conditions).toEqual([{ $expr: { $and: [{ $ne: [asNumber, null] }, { $gte: [asNumber, 20] }, { $lt: [asNumber, 40] }] } }]);
        expect(groups[0].conditions).toEqual([{ $expr: { $and: [{ $ne: [asNumber, null] }, { $lt: [asNumber, 20] }] } }]);
        expect(groups[4].conditions).toEqual([{ $expr: { $and: [{ $ne: [asNumber, null] }, { $gte: [asNumber, 80] }] } }]);
        expect(groups[5].conditions).toEqual([{ $expr: { $eq: [asNumber, null] } }]);
    });

    it('puts every task in exactly one group, a value outside the bands included', () => {
        const groups = customFieldGroups(size, { t, tasks: loaded });
        const placed = (row) => groups.map((group) => customGroupMatches(row, group));
        expect(placed(task('12'))).toEqual([true, false, false, false, false, false]);
        expect(placed(task('20'))).toEqual([false, true, false, false, false, false]);
        expect(placed(task('1200'))).toEqual([false, false, false, false, true, false]);
        expect(placed(task('1,200'))).toEqual([false, false, false, false, false, true]);
        expect(placed(task('-5'))).toEqual([true, false, false, false, false, false]);
        expect(placed(task(''))).toEqual([false, false, false, false, false, true]);
        expect(placed(task('n/a'))).toEqual([false, false, false, false, false, true]);
    });

    it('uses the field\'s own minimum and maximum when it has both', () => {
        const groups = customFieldGroups({ ...size, fieldMinimum: '0', fieldMaximum: '10' }, { t, tasks: loaded });
        expect(names(groups)).toEqual([
            'ViewGroups.number_below:2', 'ViewGroups.number_between:2,4', 'ViewGroups.number_between:4,6', 'ViewGroups.number_between:6,8',
            'ViewGroups.number_from:8', 'ViewGroups.no_value'
        ]);
    });

    it('makes fewer bands for a short whole-number range, and one group when there is nothing to split', () => {
        expect(names(customFieldGroups(size, { t, tasks: [task('1'), task('3')] }))).toEqual(['ViewGroups.number_below:2', 'ViewGroups.number_from:2', 'ViewGroups.no_value']);
        expect(names(customFieldGroups(size, { t, tasks: [task('7'), task('7')] }))).toEqual(['ViewGroups.number_any', 'ViewGroups.no_value']);
        expect(names(customFieldGroups(size, { t, tasks: [] }))).toEqual(['ViewGroups.number_any', 'ViewGroups.no_value']);
    });

    it('asks the project for its lowest and highest value, unless the field fixes its own ends', () => {
        expect(needsProjectRange(size)).toBe(true);
        expect(needsProjectRange({ ...size, fieldMinimum: '0', fieldMaximum: '10' })).toBe(false);
        expect(needsProjectRange({ _id: SIZE, fieldType: 'progress' })).toBe(false);
        expect(numberRangeStages(size, 'p1')).toEqual([
            { $match: { $and: [{ ProjectID: { objId: { $in: ['p1'] } } }, { deletedStatusKey: { $in: [0] } }] } },
            { $group: { _id: null, min: { $min: asNumber }, max: { $max: asNumber } } }
        ]);
        expect(rangeFromRows([{ _id: null, min: 0, max: 50 }])).toEqual([0, 50]);
        expect(rangeFromRows([{ _id: null, min: null, max: null }])).toBeNull();
        expect(rangeFromRows([])).toBeNull();
    });

    it('cuts the bands from the range of the project when it has one, before the loaded tasks', () => {
        const groups = customFieldGroups(size, { t, range: [0, 50], tasks: loaded });
        expect(names(groups).slice(0, 2)).toEqual(['ViewGroups.number_below:10', 'ViewGroups.number_between:10,20']);
    });

    it('bands a progress field from 0 to 100 without looking at the tasks', () => {
        const groups = customFieldGroups({ _id: SIZE, fieldType: 'progress' }, { t, tasks: [] });
        expect(names(groups).slice(0, 2)).toEqual(['ViewGroups.number_below:20', 'ViewGroups.number_between:20,40']);
    });

    it('does not write a value when a task is dropped onto a band', () => {
        const groups = customFieldGroups(size, { t, tasks: loaded });
        groups.forEach((group) => {
            expect(group.dropDisabled).toBe(true);
            expect(customGroupUpdate(group)).toBeNull();
        });
    });

    it('keeps a task of a type the field is not for under "No value"', () => {
        const scoped = customFieldGroups({ ...size, fieldTaskTypes: [2] }, { t, tasks: loaded });
        expect(scoped[1].conditions[0]).toMatchObject({ TaskTypeKey: { $in: [2] } });
        expect(scoped.map((group) => customGroupMatches(task('30'), group))).toEqual([false, false, false, false, false, true]);
    });

    it('has English text for the new labels', () => {
        ['number_below', 'number_between', 'number_from', 'number_any'].forEach((key) => expect(typeof en.ViewGroups[key]).toBe('string'));
    });
});

beforeEach(() => apiRequest.mockReset());
