import { afterEach, describe, expect, it, vi } from 'vitest';
import { config, flushPromises, mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { createStore } from 'vuex';
import { ref } from 'vue';
import en from '@/locales/en';

vi.mock('@/services', () => ({ apiRequest: vi.fn(() => Promise.resolve({ status: 200, data: {} })) }));
vi.mock('@/store/index', () => ({ default: { commit: () => {}, dispatch: () => Promise.resolve(), getters: {}, state: {} } }));
const composable = vi.hoisted(() => ({
    useCustomComposable: () => ({ checkPermission: () => true, makeUniqueId: () => 'uid', debounce: (fn) => fn }),
    useConvertDate: () => ({ convertDateFormat: (value) => String(value || '') }),
    useGetterFunctions: () => ({ getUser: (id) => ({ id }) })
}));
vi.mock('@/composable', () => composable);
vi.mock('@/composable/index', () => composable);
vi.mock('@/composable/index.js', () => composable);
vi.mock('@vuepic/vue-datepicker/dist/main.css', () => ({}));
vi.mock('@vuepic/vue-datepicker', async () => {
    const vue = await import('vue');
    return {
        default: vue.defineComponent({
            name: 'VueDatePicker',
            props: ['minDate', 'maxDate', 'modelValue', 'disabledWeekDays'],
            emits: ['update:modelValue'],
            setup(_, { slots, expose }) {
                expose({ openMenu: () => {}, closeMenu: () => {} });
                return () => vue.h('div', { class: 'date-picker' }, slots.trigger ? slots.trigger() : []);
            }
        })
    };
});
vi.mock('@formkit/vue', async () => {
    const vue = await import('vue');
    return { FormKit: vue.defineComponent({ name: 'FormKit', props: ['mask'], setup: (_, { slots }) => () => vue.h('div', { class: 'formkit-stub' }, slots.prefix ? slots.prefix() : []) }) };
});

import { dateFieldLimits } from '@/plugins/customFieldView/dateFieldLimits';
import CustomFieldRender from '@/plugins/customFieldView/component/molecules/customFieldTaskView/customFieldRender.vue';
import DateComponentListing from '@/plugins/customFieldView/component/atom/customFieldTaskView/dateComponentListing.vue';
import DateComponentViewColumn from '@/plugins/customFieldView/component/atom/customFieldViewColumn/dateComponentViewColumn.vue';
import DropdownComponentListing from '@/plugins/customFieldView/component/atom/customFieldTaskView/dropdownComponentListing.vue';
import NumberComponentListing from '@/plugins/customFieldView/component/atom/customFieldTaskView/numberComponentListing.vue';
import MoneyComponentListing from '@/plugins/customFieldView/component/atom/customFieldTaskView/moneyComponentListing.vue';
import PhoneComponentListing from '@/plugins/customFieldView/component/atom/customFieldTaskView/phoneComponentListing.vue';

const i18n = createI18n({ legacy: false, locale: 'en', messages: { en }, missingWarn: false, fallbackWarn: false });
config.global.plugins = [i18n];
config.global.mocks = {};

/* A field saved through the API or an import carries only what its writer sent, so none of the form's settings. */
const bare = (fieldType, more = {}) => ({ _id: `f-${fieldType}`, fieldType, fieldTitle: `A ${fieldType}`, type: 'task', global: true, isDelete: true, ...more });
const DUE = bare('date', { _id: 'f-due', fieldTitle: 'Due' });

const store = (fields = [], company = {}) => createStore({
    getters: {
        'settings/selectedCompany': () => company,
        'settings/companyDateFormat': () => ({ dateFormat: 'DD/MM/YYYY' }),
        'settings/finalCustomFields': () => fields,
        'projectData/tasks': () => ({}),
        'projectData/alltasks': () => []
    }
});

const mounted = [];
afterEach(() => { while (mounted.length) mounted.pop().unmount(); });

const show = (component, detail, more = {}, company = {}) => {
    const failed = vi.fn();
    const wrapper = mount(component, {
        props: { detail },
        global: { plugins: [store([], company)], provide: { $clientWidth: ref(1280), $defaultUserAvatar: '' }, config: { errorHandler: failed }, stubs: { ToolTip: true, Sidebar: true, ...more } }
    });
    mounted.push(wrapper);
    return { wrapper, failed };
};
const picker = (wrapper) => wrapper.findComponent({ name: 'VueDatePicker' });
const isToday = (date) => new Date(date).toDateString() === new Date().toDateString();

describe('the allowed dates of a date field', () => {
    it('are unlimited when the field says nothing about past and future', () => {
        expect(dateFieldLimits(DUE)).toEqual({ minDate: '', maxDate: '' });
        expect(dateFieldLimits({ ...DUE, fieldPastFuture: null })).toEqual({ minDate: '', maxDate: '' });
        expect(dateFieldLimits(undefined)).toEqual({ minDate: '', maxDate: '' });
    });

    it('follow the stored choice as before', () => {
        expect(dateFieldLimits({ fieldPastFuture: ['Past', 'Future'] })).toEqual({ minDate: '', maxDate: '' });

        const pastOnly = dateFieldLimits({ fieldPastFuture: ['Past'] });
        expect(pastOnly.minDate).toBe('');
        expect(isToday(pastOnly.maxDate)).toBe(true);

        const futureOnly = dateFieldLimits({ fieldPastFuture: ['Future'] });
        expect(isToday(futureOnly.minDate)).toBe(true);
        expect(futureOnly.minDate.getHours()).toBe(0);
        expect(futureOnly.maxDate).toBe('');

        const todayOnly = dateFieldLimits({ fieldPastFuture: [] });
        expect([isToday(todayOnly.minDate), isToday(todayOnly.maxDate)]).toEqual([true, true]);
    });
});

describe('a date field with no past/future setting', () => {
    it('renders in the task panel and takes a picked date', async () => {
        const { wrapper, failed } = show(DateComponentListing, DUE);
        expect(failed).not.toHaveBeenCalled();
        expect(picker(wrapper).props()).toMatchObject({ minDate: '', maxDate: '' });

        const picked = new Date(2026, 9, 15);
        picker(wrapper).vm.$emit('update:modelValue', picked);
        await flushPromises();
        expect(wrapper.emitted('blurUpdate')).toEqual([[picked, DUE]]);
        expect(failed).not.toHaveBeenCalled();
    });

    it('still limits a field that allows only the future', () => {
        const { wrapper } = show(DateComponentListing, { ...DUE, fieldPastFuture: ['Future'] });
        expect(isToday(picker(wrapper).props('minDate'))).toBe(true);
        expect(picker(wrapper).props('maxDate')).toBe('');
    });

    it('renders as a List column', () => {
        const { wrapper, failed } = show(DateComponentViewColumn, DUE);
        expect(failed).not.toHaveBeenCalled();
        expect(picker(wrapper).props()).toMatchObject({ minDate: '', maxDate: '' });
    });

    it('shows among the task\'s custom fields, where its value can be set', async () => {
        const failed = vi.fn();
        const wrapper = mount(CustomFieldRender, {
            props: { task: { _id: 't1', ProjectID: 'p1', TaskTypeKey: 1, customField: {} }, editPermission: true },
            global: { plugins: [store([DUE])], provide: { $clientWidth: ref(1280), $defaultUserAvatar: '' }, config: { errorHandler: failed }, stubs: { ToolTip: true, AiFieldMark: true, Skelaton: true } }
        });
        mounted.push(wrapper);
        await vi.waitFor(() => expect(picker(wrapper).exists()).toBe(true), { timeout: 4000 });

        const picked = new Date(2026, 9, 15);
        picker(wrapper).vm.$emit('update:modelValue', picked);
        await flushPromises();
        expect(wrapper.emitted('blurUpdate').at(-1).slice(0, 2)).toEqual([picked, expect.objectContaining({ _id: 'f-due' })]);
        expect(failed).not.toHaveBeenCalled();
    });
});

describe('the other field types without their optional settings', () => {
    it('a dropdown with no options renders, and survives its value changing', async () => {
        const { wrapper, failed } = show(DropdownComponentListing, bare('dropdown'));
        await flushPromises();
        await wrapper.setProps({ detail: bare('dropdown', { fieldValue: ['o1'] }) });
        await flushPromises();
        expect(failed).not.toHaveBeenCalled();
        expect(wrapper.find('.formkit-label').exists()).toBe(true);
    });

    it.each([['number', NumberComponentListing], ['money', MoneyComponentListing]])('an empty %s field takes a key press that types nothing', async (fieldType, component) => {
        const { wrapper, failed } = show(component, bare(fieldType));
        await wrapper.get('input').trigger('keyup', { key: 'Tab' });
        expect(failed).not.toHaveBeenCalled();
    });

    const DropDown = { template: '<div><slot name="button" /><slot name="options" /></div>' };
    const phone = async (detail, company) => {
        const shown = show(PhoneComponentListing, detail, { DropDown, DropDownOption: true }, company);
        await new Promise((resolve) => setTimeout(resolve));
        await flushPromises();
        return shown;
    };

    it('a phone field with no country renders its code', async () => {
        const { wrapper, failed } = await phone(bare('phone', { fieldPattern: '###', fieldCode: '+91', fieldCountryCode: '+1' }));
        expect(failed).not.toHaveBeenCalled();
        expect(wrapper.text()).toContain('+91');
    });

    it.each([[{ Cst_countryCode: 'IN' }], [{ Cst_Country: 'India' }]])('a phone field with no country takes the company\'s, %j', async (company) => {
        const { wrapper, failed } = await phone(bare('phone'), company);
        expect(failed).not.toHaveBeenCalled();
        expect(wrapper.findComponent({ name: 'FormKit' }).props('mask')).toBe('##### #####');
        expect(wrapper.text()).toContain('+91');
        expect(wrapper.find('.vti__flag.in').exists()).toBe(true);
    });

    it('a phone field keeps its own country over the company\'s', async () => {
        const france = { code: 'FR', dialCode: '+33', maskWithDialCode: '# ## ## ## ##' };
        const { wrapper } = await phone(bare('phone', { fieldCountryObject: france, fieldCountryCode: '+33' }), { Cst_countryCode: 'IN' });
        expect(wrapper.findComponent({ name: 'FormKit' }).props('mask')).toBe('# ## ## ## ##');
        expect(wrapper.text()).toContain('+33');
    });

    it('a phone field with no country anywhere is a plain digits input whose value can be saved', async () => {
        const detail = bare('phone');
        const { wrapper, failed } = await phone(detail);
        expect(wrapper.findComponent({ name: 'FormKit' }).exists()).toBe(false);

        const input = wrapper.get('input[type="tel"]');
        input.element.value = '98-76 5a';
        await input.trigger('input');
        expect(input.element.value).toBe('98765');
        expect(wrapper.emitted('inputUpdate').at(-1)).toEqual(['98765']);

        await input.trigger('blur');
        const [value, saved, id] = wrapper.emitted('blurUpdate').at(-1);
        expect(value).toBe('98765');
        expect(saved).toMatchObject({ _id: 'f-phone', fieldCountryObject: {} });
        expect(input.attributes('id')).toBe(id);
        expect(failed).not.toHaveBeenCalled();
    });
});
