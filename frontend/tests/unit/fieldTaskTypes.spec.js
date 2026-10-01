/* Task 045 slice 9 — a custom field can be limited to task types. */
import { describe, expect, it, vi } from 'vitest';
import { config, mount, shallowMount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { createStore } from 'vuex';
import { ref } from 'vue';
import en from '@/locales/en';

vi.mock('@/services', () => ({ apiRequest: vi.fn(() => Promise.resolve({ data: {} })) }));
vi.mock('@/store/index', () => ({ default: { commit: () => {}, dispatch: () => Promise.resolve(), getters: {}, state: {} } }));

import { fieldAppliesToTask, shownFieldValues } from '@/views/Projects/composables/projectCustomFields';
import {
    customFieldGroups, customFilterCondition, customFilterOptions, customGroupMatches, customSortValue, groupTakesTask, putFrom, tableSortStages, valuePath
} from '@/views/Projects/composables/customFieldQuery';
import { taskTypeOptions } from '@/plugins/customFieldView/taskTypeOptions';
import CustomFieldCell from '@/views/Projects/components/columns/CustomFieldCell.vue';
import CustomFieldRender from '@/plugins/customFieldView/component/molecules/customFieldTaskView/customFieldRender.vue';
import TextComponentListing from '@/plugins/customFieldView/component/atom/customFieldTaskView/textComponentListing.vue';
import FieldTaskTypesPicker from '@/plugins/customFieldView/component/atom/FieldTaskTypesPicker/FieldTaskTypesPicker.vue';

const i18n = createI18n({ legacy: false, locale: 'en', messages: { en }, missingWarn: false, fallbackWarn: false });
config.global.plugins = [i18n];
config.global.mocks = {};

const BUG = 2;
const SEVERITY = { _id: 'f-sev', fieldType: 'text', fieldTitle: 'Severity', isDelete: true, type: 'task', global: true, fieldTaskTypes: [BUG] };
const task = (TaskTypeKey) => ({ _id: 't1', ProjectID: 'p1', TaskTypeKey, customField: { 'f-sev': { _id: 'f-sev', fieldValue: 'High' } } });

const COMPANY_TYPES = {
    settings: [
        { key: 1, name: 'Task', value: 'task' },
        { key: BUG, name: 'Bug', value: 'bug' },
        { key: 7, name: 'Retired', value: 'retired', isDeleted: true }
    ]
};

describe('fieldAppliesToTask in the web app', () => {
    it('matches the server rule', () => {
        expect(fieldAppliesToTask(SEVERITY, task(BUG))).toBe(true);
        expect(fieldAppliesToTask(SEVERITY, task(1))).toBe(false);
        expect(fieldAppliesToTask({ ...SEVERITY, fieldTaskTypes: [] }, task(1))).toBe(true);
    });
});

describe('the task panel', () => {
    const CUSTOMER = { _id: 'f-cust', fieldType: 'text', fieldTitle: 'Customer', isDelete: true, type: 'task', global: true };
    const store = createStore({ getters: { 'settings/finalCustomFields': () => [SEVERITY, CUSTOMER], 'projectData/tasks': () => ({}), 'projectData/alltasks': () => [] } });
    const shown = (wrapper) => wrapper.findAllComponents(TextComponentListing).map((field) => field.props('detail'));

    it('hides a field the task\'s type does not use, and brings it back with its value when the type changes', async () => {
        const wrapper = shallowMount(CustomFieldRender, {
            props: { task: task(1), editPermission: true },
            global: { plugins: [i18n, store], provide: { $clientWidth: ref(1280) } }
        });
        await vi.waitFor(() => expect(shown(wrapper).map((detail) => detail.fieldTitle)).toEqual(['Customer']), { timeout: 4000 });

        await wrapper.setProps({ task: task(BUG) });
        await vi.waitFor(() => expect(shown(wrapper).map((detail) => [detail.fieldTitle, detail.fieldValue])).toEqual([['Severity', 'High'], ['Customer', undefined]]), { timeout: 4000 });
        wrapper.unmount();
    });
});

describe('a List or Table cell for a scoped field', () => {
    const cell = (data, editable = true) => mount(CustomFieldCell, {
        props: { def: SEVERITY, task: data, editable },
        global: { provide: { $dateFormat: ref('DD/MM/YYYY') }, stubs: { ShellIcon: true, AiFieldMark: true } }
    });

    it('shows the value and an editor on a task of the field\'s type', () => {
        const wrapper = cell(task(BUG));
        expect(wrapper.get('button').text()).toBe('High');
    });

    it('is empty and cannot be edited on a task of another type, though the value is stored', () => {
        const wrapper = cell(task(1));
        expect(wrapper.find('button').exists()).toBe(false);
        expect(wrapper.find('input').exists()).toBe(false);
        expect(wrapper.text()).not.toContain('High');
        expect(wrapper.get('.ah-sr-only').text()).toBe(en.ViewColumns.field_not_for_type.replace('{field}', 'Severity'));
    });
});

describe('a Board card', () => {
    const columns = [
        { id: 'points' },
        { id: 'cf:f-sev', label: 'Severity', field: SEVERITY },
        { id: 'cf:f-cust', label: 'Customer', field: { _id: 'f-cust', fieldType: 'text', fieldTitle: 'Customer' } }
    ];
    const card = (TaskTypeKey) => ({ ...task(TaskTypeKey), customField: { 'f-sev': { fieldValue: 'High' }, 'f-cust': { fieldValue: 'Acme' } } });

    it('shows a scoped field only on a card of one of its task types', () => {
        expect(shownFieldValues(columns, card(BUG)).map((entry) => [entry.label, entry.text])).toEqual([['Severity', 'High'], ['Customer', 'Acme']]);
        expect(shownFieldValues(columns, card(1)).map((entry) => [entry.label, entry.text])).toEqual([['Customer', 'Acme']]);
    });
});

describe('group, filter and sort by a scoped field', () => {
    const TIER = 'a1'.repeat(12);
    const SIGNED = 'b2'.repeat(12);
    const EMPTY = [null, '', []];
    const inType = { TaskTypeKey: { $in: [BUG] } };
    const otherType = { TaskTypeKey: { $nin: [BUG] } };
    const tier = { _id: TIER, fieldType: 'dropdown', fieldTitle: 'Tier', fieldTaskTypes: [BUG], fieldOptions: [{ id: 'o1', label: 'Gold' }] };
    const signed = { _id: SIGNED, fieldType: 'checkbox', fieldTitle: 'Signed', fieldTaskTypes: [BUG] };
    const valued = (TaskTypeKey) => ({ TaskTypeKey, customField: { [TIER]: { fieldValue: ['o1'] }, [SIGNED]: { fieldValue: true } } });
    const bug = valued(BUG);
    const retyped = valued(1);

    it('groups a task of another type under "No value", though its old value is still stored', () => {
        const [gold, none] = customFieldGroups(tier);
        expect(gold.conditions).toEqual([{ [valuePath(TIER)]: 'o1', ...inType }]);
        expect(none.conditions).toEqual([{ $nor: [{ [valuePath(TIER)]: { $nin: EMPTY }, ...inType }] }]);
        expect([gold, none].map((group) => customGroupMatches(bug, group))).toEqual([true, false]);
        expect([gold, none].map((group) => customGroupMatches(retyped, group))).toEqual([false, true]);

        const [checked, unchecked] = customFieldGroups(signed);
        expect(checked.conditions).toEqual([{ [valuePath(SIGNED)]: { $in: [true, 'true'] }, ...inType }]);
        expect(unchecked.conditions).toEqual([{ $nor: [{ [valuePath(SIGNED)]: { $in: [true, 'true'] }, ...inType }] }]);
        expect([checked, unchecked].map((group) => customGroupMatches(retyped, group))).toEqual([false, true]);
    });

    it('a value filter does not match a task of another type, while "is empty" and "is not" do', () => {
        const row = (comparison, values) => ({ name: customFilterOptions([tier])[0], comparison: { value: comparison }, values });
        const path = valuePath(TIER);
        expect(customFilterCondition(row(':', ['o1']), [tier])).toEqual({ [path]: { $in: ['o1'] }, ...inType });
        expect(customFilterCondition(row(':set', [true]), [tier])).toEqual({ [path]: { $nin: EMPTY }, ...inType });
        expect(customFilterCondition(row(':empty', [true]), [tier])).toEqual({ $or: [{ [path]: { $in: EMPTY } }, otherType] });
        expect(customFilterCondition(row(':!=', ['o1']), [tier])).toEqual({ $or: [{ [path]: { $nin: ['o1'] } }, otherType] });
    });

    it('a group takes a dropped task only when the field is used for its type', () => {
        const [gold] = customFieldGroups(tier);
        expect(groupTakesTask(gold, String(BUG))).toBe(true);
        expect(groupTakesTask(gold, '1')).toBe(false);
        expect(groupTakesTask(gold, undefined)).toBe(false);
        expect(groupTakesTask(customFieldGroups({ ...tier, fieldTaskTypes: [] })[0], '1')).toBe(true);
        expect(groupTakesTask({ searchKey: 'statusKey', searchValue: 1 }, undefined)).toBe(true);
    });

    it('an allowed List drop names its own drag group, because Sortable reads true as "from any list"', () => {
        const [gold] = customFieldGroups(tier);
        const row = (taskType) => ({ dataset: { taskType } });
        expect(putFrom('lv2-task', gold)(null, null, row(String(BUG)))).toEqual(['lv2-task']);
        expect(putFrom('lv2-task', gold)(null, null, row('1'))).toBe(false);
        expect(putFrom('lv2-task', { searchKey: 'statusKey' })(null, null, row('1'))).toEqual(['lv2-task']);
    });

    it('sorts a task of another type as having no value', () => {
        expect(customSortValue(tier, bug)).toBe(0);
        expect(customSortValue(tier, retyped)).toBeNull();
        const [stage] = tableSortStages(`${valuePath(TIER)}:1`, [tier]);
        expect(stage.$addFields.cfSortValue.$cond[0]).toEqual({ $in: ['$TaskTypeKey', [BUG]] });
        expect(stage.$addFields.cfSortValue.$cond[2]).toBeNull();
    });
});

describe('the "Show for task types" choice', () => {
    it('offers the company\'s live task types, and keeps a chosen type that has since gone', () => {
        const options = taskTypeOptions(COMPANY_TYPES, [], [9]);
        expect(options.map((option) => option.key)).toEqual([1, BUG, 9]);
        expect(options[2].missing).toBe(true);
    });

    it('falls back to the task type templates when the company list is not loaded', () => {
        const templates = [{ taskTypes: [{ key: 1, name: 'Task' }, { key: BUG, name: 'Bug' }] }, { taskTypes: [{ key: BUG, name: 'Bug' }] }];
        expect(taskTypeOptions({}, templates, []).map((option) => option.key)).toEqual([1, BUG]);
    });

    const picker = (modelValue) => mount(FieldTaskTypesPicker, {
        props: { modelValue },
        global: {
            plugins: [i18n, createStore({ getters: { 'settings/AllTaskType': () => COMPANY_TYPES, 'settings/taskType': () => [] } })],
            stubs: { TaskTypeIcon: true }
        }
    });

    it('ticks the chosen types and says that none ticked means every type', async () => {
        const wrapper = picker([BUG]);
        const boxes = wrapper.findAll('input[type="checkbox"]');
        expect(boxes.map((box) => box.element.checked)).toEqual([false, true]);
        expect(wrapper.text()).toContain(en.Fields.task_types_hint);

        await boxes[0].setValue(true);
        expect(wrapper.emitted('update:modelValue').at(-1)).toEqual([[BUG, 1]]);
        await boxes[1].setValue(false);
        expect(wrapper.emitted('update:modelValue').at(-1)).toEqual([[]]);
    });
});
