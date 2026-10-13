import { describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent, h, ref } from 'vue';
import { createStore } from 'vuex';

const composable = vi.hoisted(() => ({
    useCustomComposable: () => ({ checkPermission: () => true, debounce: (fn) => fn, makeUniqueId: () => 'id' }),
    useConvertDate: () => ({ convertDateFormat: (value) => String(value || '') }),
    useGetterFunctions: () => ({}),
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

import SidebarItems from '@/components/molecules/SidebarItems/SidebarItems.vue';
import TaskStatus from '@/components/molecules/TaskStatus/TaskStatus.vue';
import CalenderCompo from '@/components/atom/CalenderCompo/CalenderCompo.vue';

describe('picker options', () => {
    const mountItem = (selected = false) => mount(SidebarItems, {
        props: { item: { label: 'To Do', value: 1 }, selected },
        global: { stubs: { DropDown: true, DropDownOption: true, UserProfile: true, WasabiImage: true, TaskTypeIcon: true } },
    });

    it('are focusable options that report their selected state', () => {
        const option = mountItem(true).find('.sidebar_item_main');
        expect(option.attributes('role')).toBe('option');
        expect(option.attributes('tabindex')).toBe('0');
        expect(option.attributes('aria-selected')).toBe('true');
        expect(mountItem(false).find('.sidebar_item_main').attributes('aria-selected')).toBe('false');
    });

    it('select on Enter and on Space', async () => {
        const wrapper = mountItem();
        const option = wrapper.find('.sidebar_item_main');
        await option.trigger('keydown', { key: 'Enter' });
        await option.trigger('keydown', { key: ' ' });
        expect(wrapper.emitted('select')).toHaveLength(2);
    });
});

describe('task status', () => {
    const selectedProject = ref({ isGlobalPermission: true, taskStatusData: [{ key: 1, name: 'To Do', textColor: '#000', bgColor: '#eee' }] });

    it('opens its picker from a real button', async () => {
        const wrapper = mount(TaskStatus, {
            props: { taskKey: 1, projectId: 'p', sprintId: 's', taskId: 't' },
            global: { provide: { selectedProject }, stubs: { Sidebar: true } },
        });
        const trigger = wrapper.find('.task-status-name');
        expect(trigger.element.tagName).toBe('BUTTON');
        expect(trigger.attributes('type')).toBe('button');
        expect(trigger.attributes('aria-expanded')).toBe('false');
        await trigger.trigger('click');
        expect(trigger.attributes('aria-expanded')).toBe('true');
    });
});

describe('date field', () => {
    const store = createStore({ modules: { settings: { namespaced: true, getters: { companyDateFormat: () => ({ dateFormat: 'DD/MM/YYYY' }) } } } });

    it('is labelled and opens the calendar from the keyboard', async () => {
        openMenu.mockClear();
        const wrapper = mount(CalenderCompo, {
            props: { isShowDateAndicon: true, ariaLabel: 'Due Date', displyDate: '' },
            global: { plugins: [store] },
        });
        const input = wrapper.find('input.date_format_cal');
        expect(input.attributes('aria-label')).toBe('Due Date');
        await input.trigger('keydown', { key: 'Enter' });
        await input.trigger('keydown', { key: ' ' });
        expect(openMenu).toHaveBeenCalledTimes(2);
    });

    it('opens from the icon-only trigger too, which is named for screen readers', async () => {
        openMenu.mockClear();
        const wrapper = mount(CalenderCompo, { props: { isShowDateAndicon: false, displyDate: '' }, global: { plugins: [store] } });
        const trigger = wrapper.find('.calendar-trigger');
        expect(trigger.attributes('role')).toBe('button');
        expect(trigger.attributes('tabindex')).toBe('0');
        expect(trigger.attributes('aria-label')).toBe('errorPage.select_a_date');
        await trigger.trigger('keydown', { key: 'Enter' });
        expect(openMenu).toHaveBeenCalledTimes(1);
    });
});
