import { describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';
import { createStore } from 'vuex';

const composable = vi.hoisted(() => ({
    useCustomComposable: () => ({ checkPermission: () => true, debounce: (fn) => fn, makeUniqueId: () => 'id' }),
    useConvertDate: () => ({ convertDateFormat: (value) => String(value || '') }),
    useGetterFunctions: () => ({ getUser: () => ({}), getTeam: () => ({}) }),
}));
vi.mock('@/composable', () => composable);
vi.mock('@/composable/index', () => composable);
vi.mock('@/composable/index.js', () => composable);
vi.mock('@vuepic/vue-datepicker/dist/main.css', () => ({}));

const openMenu = vi.fn();
vi.mock('@vuepic/vue-datepicker', () => ({
    default: defineComponent({
        name: 'VueDatePicker',
        setup(_, { slots, expose }) {
            expose({ openMenu, closeMenu: vi.fn() });
            return () => h('div', slots.trigger ? slots.trigger() : []);
        },
    }),
}));

import StoryPoints from '@/components/atom/StoryPoints/StoryPoints.vue';
import CalenderCompo from '@/components/atom/CalenderCompo/CalenderCompo.vue';
import Assignee from '@/components/molecules/Assignee/Assignee.vue';

describe('an empty story points field', () => {
    it('reads the empty label and opens its picker from a button', async () => {
        const wrapper = mount(StoryPoints, { props: { pointsVal: null, emptyLabel: 'Empty' }, attachTo: document.body });
        const trigger = wrapper.get('.sp-trigger');
        expect(trigger.element.tagName).toBe('BUTTON');
        expect(trigger.text()).toBe('Empty');
        await trigger.trigger('click');
        const options = wrapper.findAll('.sp-option');
        expect(options.length).toBeGreaterThan(1);
        expect(options.every((option) => option.element.tagName === 'BUTTON')).toBe(true);
        await options[0].trigger('click');
        expect(wrapper.emitted('select')).toEqual([[1]]);
        wrapper.unmount();
    });

    it('stays read-only without permission', () => {
        const wrapper = mount(StoryPoints, { props: { pointsVal: null, emptyLabel: 'Empty', permission: false } });
        expect(wrapper.get('.sp-trigger').element.disabled).toBe(true);
    });
});

describe('an empty date field', () => {
    const store = createStore({ modules: { settings: { namespaced: true, getters: { companyDateFormat: () => ({ dateFormat: 'DD/MM/YYYY' }) } } } });
    it('reads the empty label and opens the calendar on Enter', async () => {
        openMenu.mockClear();
        const wrapper = mount(CalenderCompo, { props: { displyDate: '', isShowDateAndicon: true, ariaLabel: 'Due Date', emptyText: 'Empty' }, global: { plugins: [store] } });
        await flushPromises();
        const input = wrapper.get('input');
        expect(input.attributes('placeholder')).toBe('Empty');
        await input.trigger('keydown', { key: 'Enter' });
        expect(openMenu).toHaveBeenCalledTimes(1);
    });

    it('keeps the date format hint where no empty label is given', async () => {
        const wrapper = mount(CalenderCompo, { props: { displyDate: '', isShowDateAndicon: true }, global: { plugins: [store] } });
        await flushPromises();
        expect(wrapper.get('input').attributes('placeholder')).toBe('DD/MM/YYYY');
    });
});

describe('an empty assignee field', () => {
    const store = () => createStore({ getters: { 'settings/designations': () => [], 'settings/companyUsers': () => [] } });
    const mountAssignee = (props) => mount(Assignee, {
        props: { users: [], options: [], imageWidth: '30px', showAddUser: true, ...props },
        global: { plugins: [store()], stubs: { Sidebar: { name: 'Sidebar', props: ['visible'], render: () => null }, DropDown: true, DropDownOption: true, UserProfile: true } },
    });

    it('reads the empty label and opens the picker in one click', async () => {
        const wrapper = mountAssignee({ emptyLabel: 'Empty' });
        const button = wrapper.get('button.assignee__add-btn');
        expect(button.text()).toBe('Empty');
        expect(button.attributes('aria-label')).toContain('Empty');
        await button.trigger('click');
        expect(wrapper.findComponent({ name: 'Sidebar' }).props('visible')).toBe(true);
    });

    it('keeps the add-person icon where no empty label is given', () => {
        const wrapper = mountAssignee({});
        expect(wrapper.get('button.assignee__add-btn').text()).toBe('');
        expect(wrapper.find('button.assignee__add-btn img').exists()).toBe(true);
    });
});
