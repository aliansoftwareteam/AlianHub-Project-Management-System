import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';
import { createStore } from 'vuex';

const composable = vi.hoisted(() => {
    let next = 0;
    return {
        useCustomComposable: () => ({ makeUniqueId: () => `u${++next}`, debounce: (fn) => fn, checkPermission: () => true }),
    };
});
vi.mock('@/composable', () => composable);
vi.mock('@/composable/index', () => composable);
vi.mock('@/plugins/customFieldView/component/atom/customFieldSidebar/customFieldSidebarComponent/customFieldInputComponent/customFieldInputComponent.vue', () => ({
    default: { name: 'CustomFieldInputComponent', render: () => null },
}));
vi.mock('@formkit/vue', () => ({
    FormKit: defineComponent({
        name: 'FormKit',
        setup: (_, { slots }) => () => h('div', { class: 'formkit-stub' }, slots.prefix ? slots.prefix() : []),
    }),
}));

import MoneyComponent from '@/plugins/customFieldView/component/atom/customFieldSidebar/customFieldSidebarComponent/moneyComponent.vue';
import RollupComponent from '@/plugins/customFieldView/component/atom/customFieldSidebar/customFieldSidebarComponent/rollupComponent.vue';
import TextComponents from '@/plugins/customFieldView/component/atom/customFieldSidebar/customFieldSidebarComponent/textComponents.vue';
import PhoneViewColumn from '@/plugins/customFieldView/component/atom/customFieldViewColumn/phoneComponentViewColumn.vue';

const store = createStore({
    getters: {
        'settings/allCurrencyArray': () => [
            { name: 'Indian Rupee', code: 'INR', isDelete: true },
            { name: 'US Dollar', code: 'USD', isDelete: true },
        ],
        'settings/finalCustomFields': () => [
            { _id: 'f1', type: 'task', fieldType: 'number', fieldTitle: 'Hours' },
            { _id: 'f2', type: 'task', fieldType: 'money', fieldTitle: 'Cost' },
        ],
    },
});

let wrapper;
const mountSite = async (component, props) => {
    wrapper = mount(component, { props, global: { plugins: [store] }, attachTo: '#app' });
    await flushPromises();
};

const triggers = () => [...document.querySelectorAll('#app [aria-haspopup]')];
const triggerWith = (text) => triggers().find((el) => el.textContent.includes(text));
const openList = async (trigger) => {
    trigger.click();
    await flushPromises();
    return document.getElementById(trigger.getAttribute('aria-controls'));
};
const selectedText = (list) => [...list.querySelectorAll('[role="option"][aria-selected="true"]')].map((el) => el.textContent.trim());

beforeEach(() => {
    document.body.innerHTML = '<div id="my-dropdown"></div><div id="app"></div>';
});

afterEach(() => {
    wrapper?.unmount();
});

describe('custom field sidebar type picker', () => {
    it('is a named listbox button that marks the current type', async () => {
        await mountSite(TextComponents, { isType: true, customFieldObject: { type: 'task' } });
        const trigger = triggerWith('Billing.type');
        expect(trigger.tagName).toBe('BUTTON');
        expect(trigger.getAttribute('aria-haspopup')).toBe('listbox');
        expect(trigger.getAttribute('aria-expanded')).toBe('false');
        expect(trigger.querySelector('label, button')).toBeNull();
        const list = await openList(trigger);
        expect(trigger.getAttribute('aria-expanded')).toBe('true');
        expect(list.getAttribute('role')).toBe('listbox');
        expect(selectedText(list)).toEqual(['subProjectRulesNames.Task']);
    });
});

describe('custom field money currency picker', () => {
    it('names the trigger and marks the current currency', async () => {
        await mountSite(MoneyComponent, { tabIndex: 2, customFieldObject: { fieldMoneyName: 'US Dollar' } });
        const trigger = triggerWith('US Dollar');
        expect(trigger.getAttribute('aria-haspopup')).toBe('listbox');
        expect(trigger.textContent).toContain('ProjectDetails.currency');
        const list = await openList(trigger);
        expect(list.getAttribute('role')).toBe('listbox');
        expect(selectedText(list)).toEqual(['US Dollar']);
    });
});

describe('custom field rollup pickers', () => {
    it('mark the current function and source field', async () => {
        await mountSite(RollupComponent, { customFieldObject: { rollupFunction: 'avg', rollupSourceFieldId: 'f2' } });
        const fnTrigger = triggerWith('CustomField.rollup_function');
        expect(fnTrigger.getAttribute('aria-haspopup')).toBe('listbox');
        expect(selectedText(await openList(fnTrigger))).toEqual(['avg']);
        fnTrigger.click();
        await flushPromises();

        const sourceTrigger = triggerWith('CustomField.rollup_source_field');
        expect(sourceTrigger.textContent).toContain('Cost');
        expect(selectedText(await openList(sourceTrigger))).toEqual(['Cost']);
    });
});

describe('custom field phone column country picker', () => {
    it('gives the flag-only trigger a name and marks the current country', async () => {
        await mountSite(PhoneViewColumn, {
            customFieldId: 'c1',
            detail: {
                _id: 'c1',
                fieldPattern: '+1 ###',
                fieldCountryCode: '+1',
                fieldCountrySelect: ['yes'],
                fieldCountryObject: { code: 'US', dialCode: '+1', maskWithDialCode: '+1 ###' },
            },
        });
        await new Promise((resolve) => setTimeout(resolve));
        await flushPromises();
        const [trigger] = triggers();
        expect(trigger.tagName).toBe('BUTTON');
        expect(trigger.getAttribute('aria-haspopup')).toBe('listbox');
        expect(trigger.textContent.trim()).toBe('CustomField.country_code');
        const list = await openList(trigger);
        expect(list.getAttribute('role')).toBe('listbox');
        expect(selectedText(list)).toEqual(['United States']);
    });
});
