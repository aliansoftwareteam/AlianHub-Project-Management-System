/* Task 045 slice 9 — a custom field can be limited to task types. */
import { describe, expect, it } from 'vitest';
import { config, mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { createStore } from 'vuex';
import { ref } from 'vue';
import en from '@/locales/en';

import { fieldAppliesToTask } from '@/views/Projects/composables/projectCustomFields';
import { taskTypeOptions } from '@/plugins/customFieldView/taskTypeOptions';
import CustomFieldCell from '@/views/Projects/components/columns/CustomFieldCell.vue';
import FieldTaskTypesPicker from '@/plugins/customFieldView/component/atom/FieldTaskTypesPicker/FieldTaskTypesPicker.vue';

const i18n = createI18n({ legacy: false, locale: 'en', messages: { en }, missingWarn: false, fallbackWarn: false });
config.global.plugins = [i18n];

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
