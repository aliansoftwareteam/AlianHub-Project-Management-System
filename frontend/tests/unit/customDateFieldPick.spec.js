import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { createStore } from 'vuex';
import VueDatePicker from '@vuepic/vue-datepicker';
import en from '@/locales/en';

const { composable } = vi.hoisted(() => ({
    composable: () => ({
        useCustomComposable: () => ({ checkPermission: () => true, checkApps: () => true, makeUniqueId: () => 'uid' }),
        useGetterFunctions: () => ({ getUser: (id) => ({ id, _id: id, Employee_Name: '' }), getTeam: () => ({}) }),
        useConvertDate: () => ({ convertDateFormat: (value) => (value ? String(value) : '') })
    })
}));
vi.mock('@/composable', composable);
vi.mock('@/composable/index', composable);
vi.mock('@/services', () => ({ apiRequest: vi.fn() }));
vi.mock('@/store/index', () => ({ default: { commit: () => {}, dispatch: () => Promise.resolve(), getters: {}, state: {} } }));
vi.mock('@/composable/customFieldIcon.js', () => ({ default: () => ({ getImageData: () => '' }) }));
vi.mock('vue-toast-notification', () => ({ useToast: () => ({ error: vi.fn(), success: vi.fn() }) }));

import DateComponentListing from '@/plugins/customFieldView/component/atom/customFieldTaskView/dateComponentListing.vue';
import DateComponentViewColumn from '@/plugins/customFieldView/component/atom/customFieldViewColumn/dateComponentViewColumn.vue';
import { pickedDateValue } from '@/plugins/customFieldView/dateFieldLimits';
import { customFieldPayload, customFieldText, fieldEditValue } from '@/views/Projects/composables/projectCustomFields';
import { customGroupMatches } from '@/views/Projects/composables/customFieldQuery';

const i18n = createI18n({ legacy: false, locale: 'en', messages: { en }, missingWarn: false, fallbackWarn: false });
const store = createStore({ getters: { 'settings/companyDateFormat': () => ({ dateFormat: 'DD/MM/YYYY' }) } });
const FIELD = 'e1'.repeat(12);
const dateOnly = { _id: FIELD, fieldType: 'date', fieldTitle: 'Review on', fieldDateFormate: 'DD-MM-YYYY', fieldTimeFormate: '', fieldValue: '' };
const dateAndTime = { ...dateOnly, fieldTitle: 'Review at', fieldTimeFormate: '24 Hour' };

const mounted = [];
function open(component, detail) {
    const wrapper = mount(component, { props: { detail }, attachTo: document.body, global: { plugins: [store, i18n], stubs: { ToolTip: true } } });
    mounted.push(wrapper);
    wrapper.getComponent(VueDatePicker).vm.openMenu();
    return wrapper;
}
const dayCell = (day) => [...document.querySelectorAll('.dp__cell_inner')]
    .find((cell) => cell.textContent.trim() === String(day) && !cell.classList.contains('dp__cell_offset'));
const confirm = () => document.querySelector('.dp__action_select');
const saved = (wrapper) => (wrapper.emitted('blurUpdate') || []).map(([value]) => value);

beforeEach(() => {
    document.body.innerHTML = '';
});
afterEach(() => {
    mounted.splice(0).forEach((wrapper) => wrapper.unmount());
});

describe.each([['the task panel', DateComponentListing], ['a list column', DateComponentViewColumn]])('a custom date field in %s', (place, component) => {
    it('saves the day at once, at the start of that day, when the field holds no time', async () => {
        const wrapper = open(component, dateOnly);
        await flushPromises();
        expect(confirm()).toBeNull();
        dayCell(15).click();
        await flushPromises();
        expect(saved(wrapper)).toHaveLength(1);
        const [value] = saved(wrapper);
        expect(value).toBeInstanceOf(Date);
        expect(value.getDate()).toBe(15);
        expect([value.getHours(), value.getMinutes(), value.getSeconds(), value.getMilliseconds()]).toEqual([0, 0, 0, 0]);
    });

    it('waits for the confirm press, and keeps the time, when the field holds a time', async () => {
        const wrapper = open(component, dateAndTime);
        await flushPromises();
        dayCell(15).click();
        await flushPromises();
        expect(saved(wrapper)).toHaveLength(0);
        confirm().click();
        await flushPromises();
        expect(saved(wrapper)).toHaveLength(1);
        expect(saved(wrapper)[0].getDate()).toBe(15);
    });
});

describe('the stored value of a date-only field', () => {
    const afternoon = new Date(2026, 9, 15, 16, 42, 7, 300);
    const stored = () => pickedDateValue(dateOnly, afternoon);
    const task = () => ({ _id: 't1', customField: { [FIELD]: { _id: FIELD, fieldValue: JSON.parse(JSON.stringify(stored())) } } });

    it('is the instant that day starts, the same one the List cell stores', () => {
        expect(stored().getTime()).toBe(new Date(2026, 9, 15).getTime());
        expect(customFieldPayload(dateOnly, '2026-10-15').fieldValue.getTime()).toBe(stored().getTime());
    });

    it('leaves a field that holds a time, and an empty pick, as they are', () => {
        expect(pickedDateValue(dateAndTime, afternoon)).toBe(afternoon);
        expect(pickedDateValue(dateOnly, '')).toBe('');
        expect(pickedDateValue(dateOnly, null)).toBeNull();
    });

    it('reads back as the same day in a cell, an edit box and a date group', () => {
        expect(customFieldText(dateOnly, task(), { dateFormat: 'DD/MM/YYYY' })).toBe('15/10/2026');
        expect(fieldEditValue(dateOnly, task())).toBe('2026-10-15');
        const dayStart = new Date(2026, 9, 15).getTime() / 1000;
        const group = { customFieldId: FIELD, customFieldType: 'date', operation: 'range', seconds: dayStart, endSeconds: dayStart + 86400 };
        expect(customGroupMatches(task(), group)).toBe(true);
        expect(customGroupMatches(task(), { ...group, seconds: dayStart - 86400, endSeconds: dayStart })).toBe(false);
    });
});
