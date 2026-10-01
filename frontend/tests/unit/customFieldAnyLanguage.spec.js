import { afterEach, describe, expect, it, vi } from 'vitest';
import { config, flushPromises, mount, shallowMount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { createStore } from 'vuex';
import { FormKit, plugin as formKit, defaultConfig } from '@formkit/vue';
import en from '@/locales/en';
import fr from '@/locales/fr';

vi.mock('@/services', () => ({ apiRequest: vi.fn(() => Promise.resolve({ status: 200, data: {} })) }));
vi.mock('@/store/index', () => ({ default: { commit: () => {}, dispatch: () => Promise.resolve(), getters: {}, state: {} } }));
const composable = vi.hoisted(() => {
    let next = 0;
    return { useCustomComposable: () => ({ checkPermission: () => true, makeUniqueId: () => `uid${++next}`, debounce: (fn) => fn }) };
});
vi.mock('@/composable', () => composable);
vi.mock('@/composable/index', () => composable);

import { dateFieldLimits } from '@/plugins/customFieldView/dateFieldLimits';
import CustomFieldsComponent from '@/plugins/customFieldView/component/molecules/customFieldSidebar/customFieldsComponent/customFieldsComponent.vue';
import CustomFieldListing from '@/plugins/customFieldView/component/atom/customFieldTaskView/customFieldListing/customFieldListing.vue';
import EmailComponentListing from '@/plugins/customFieldView/component/atom/customFieldTaskView/emailComponentListing.vue';
import DropdownComponentListing from '@/plugins/customFieldView/component/atom/customFieldTaskView/dropdownComponentListing.vue';
import NumberComponentListing from '@/plugins/customFieldView/component/atom/customFieldTaskView/numberComponentListing.vue';
import MoneyComponentListing from '@/plugins/customFieldView/component/atom/customFieldTaskView/moneyComponentListing.vue';

const localeFiles = import.meta.glob(['../../src/locales/*.js', '!../../src/locales/main.js'], { eager: true, import: 'default' });

config.global.plugins = [];
config.global.mocks = {};
config.global.provide = { ...config.global.provide, $defaultUserAvatar: '' };

const store = () => createStore({
    getters: { 'settings/AllTaskType': () => [], 'settings/taskType': () => [], 'settings/selectedCompany': () => ({}) }
});

const mounted = [];
const keep = (wrapper) => { mounted.push(wrapper); return wrapper; };
afterEach(() => { while (mounted.length) mounted.pop().unmount(); });

const isToday = (date) => new Date(date).toDateString() === new Date().toDateString();
const limitsOf = (fieldPastFuture) => {
    const { minDate, maxDate } = dateFieldLimits({ fieldType: 'date', fieldPastFuture });
    return { past: minDate === '', future: maxDate === '', today: [minDate, maxDate].filter(Boolean).every(isToday) };
};

describe('a date field saved with the words of another language', () => {
    it('reads Gujarati and French words as the limits they mean', () => {
        expect(limitsOf(['ભૂતકાળ'])).toEqual({ past: true, future: false, today: true });
        expect(limitsOf(['ભાવિ'])).toEqual({ past: false, future: true, today: true });
        expect(limitsOf(['Passé', 'Futur'])).toEqual({ past: true, future: true, today: true });
        expect(limitsOf(['Futur'])).toEqual({ past: false, future: true, today: true });
    });

    it('reads the word of every locale file', () => {
        const words = Object.entries(localeFiles).map(([file, messages]) => [file, messages.CustomField?.past, messages.CustomField?.future]);
        expect(words.filter(([, past]) => past).length).toBeGreaterThan(8);
        words.filter(([, past, future]) => past && future).forEach(([file, past, future]) => {
            expect([file, limitsOf([past])]).toEqual([file, { past: true, future: false, today: true }]);
            expect([file, limitsOf([future])]).toEqual([file, { past: false, future: true, today: true }]);
        });
    });

    it('does not limit a field whose words it cannot read', () => {
        expect(limitsOf(['Once upon a time'])).toEqual({ past: true, future: true, today: true });
    });
});

describe('the date settings form in French', () => {
    const french = createI18n({ legacy: false, locale: 'fr', fallbackLocale: 'en', messages: { en, fr }, missingWarn: false, fallbackWarn: false });
    const DATE_TYPE = { cfType: 'date', cfTitle: 'Date', cfIcon: 'CustomFieldDate', cfIconGrey: 'CustomFieldDateGrey' };

    const form = async (customFieldObject = {}) => {
        const wrapper = keep(mount(CustomFieldsComponent, {
            props: { componentDetail: DATE_TYPE, customFieldObject, tabIndex: 4 },
            attachTo: document.body,
            global: { plugins: [french, store(), [formKit, defaultConfig()]], stubs: { DropDown: true, TaskTypeIcon: true, ToolTip: true } }
        }));
        await flushPromises();
        return wrapper;
    };
    const limitBoxes = (wrapper) => wrapper.findAll('input[type="checkbox"][name="fieldPastFuture"]');
    const save = async (wrapper) => {
        const node = wrapper.findComponent(FormKit).vm.node;
        node.at('fieldTitle').input('Échéance', false);
        node.at('fieldDescription').input('Date de livraison prévue', false);
        await node.settled;
        node.submit();
        await vi.waitFor(() => expect(wrapper.emitted('handleFunction')).toBeTruthy(), { timeout: 3000 });
        return wrapper.emitted('handleFunction')[0][0];
    };

    it('shows the limits in French and saves them as Past and Future', async () => {
        const wrapper = await form();
        expect(limitBoxes(wrapper).map((box) => [box.element.value, box.element.checked])).toEqual([['Past', true], ['Future', true]]);
        expect(wrapper.text()).toContain('Passé');
        expect(wrapper.text()).toContain('Futur');
        expect((await save(wrapper)).fieldPastFuture).toEqual(['Past', 'Future']);
    });

    it('opens a field stored with French words with the right boxes ticked, and saves it clean', async () => {
        const wrapper = await form({ _id: 'f-due', fieldTitle: 'Échéance', fieldDescription: 'Date de livraison prévue', fieldType: 'date', type: 'task', fieldPastFuture: ['Futur'] });
        expect(limitBoxes(wrapper).map((box) => [box.element.value, box.element.checked])).toEqual([['Past', false], ['Future', true]]);
        expect((await save(wrapper)).fieldPastFuture).toEqual(['Future']);
    });
});

describe('the messages of a field in the task panel', () => {
    const zz = {
        CustomField: {
            min_value: 'zz {field} >= {min}', max_value: 'zz {field} <= {max}', must_be_valid_email: 'zz {field} mail', select_field: 'zz pick {field}'
        }
    };
    const other = createI18n({ legacy: false, locale: 'zz', fallbackLocale: 'en', messages: { en, zz }, missingWarn: false, fallbackWarn: false });
    const global = { plugins: [other, store()], stubs: { ToolTip: true, Sidebar: true } };
    const field = (fieldType, more = {}) => ({ _id: `f-${fieldType}`, fieldType, fieldTitle: 'Points', type: 'task', ...more });

    it.each([['number', NumberComponentListing], ['money', MoneyComponentListing]])('a %s field says it is under or over its limit in the person\'s language', async (fieldType, component) => {
        const wrapper = keep(mount(component, { props: { detail: field(fieldType, { fieldMinimum: '5', fieldMaximum: '7' }) }, global }));
        const input = wrapper.get('input');
        await input.setValue('3');
        await input.trigger('keyup');
        expect(wrapper.get('.formkit-message').text()).toBe('zz Points >= 5');
        await input.setValue('9');
        await input.trigger('keyup');
        expect(wrapper.get('.formkit-message').text()).toBe('zz Points <= 7');
    });

    it('an email field says its value is not an email', async () => {
        const wrapper = keep(shallowMount(EmailComponentListing, { props: { detail: field('email') }, global }));
        wrapper.findComponent(CustomFieldListing).vm.$emit('inputUpdate', 'not an email');
        await flushPromises();
        expect(wrapper.findComponent(CustomFieldListing).props('customValidationMessage')).toEqual({ is: 'zz Points mail' });
    });

    it('a dropdown field names its option list', async () => {
        const wrapper = keep(mount(DropdownComponentListing, { props: { detail: field('dropdown', { fieldOptions: [] }) }, global }));
        await flushPromises();
        expect(wrapper.findComponent({ name: 'Sidebar' }).props('title')).toBe('zz pick Points');
    });

    it('has the English text for each message', () => {
        expect(en.CustomField).toMatchObject({
            min_value: '{field} must be at least {min}.',
            max_value: '{field} must be less than or equal to {max}.',
            must_be_valid_email: '{field} must be a valid email',
            select_field: 'Select {field}'
        });
    });
});
