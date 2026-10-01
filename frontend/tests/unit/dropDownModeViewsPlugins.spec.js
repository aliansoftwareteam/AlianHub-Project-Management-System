import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';

const ids = vi.hoisted(() => ({ next: 0 }));
vi.mock('@/composable', () => ({
    useCustomComposable: () => ({
        debounce: (fn) => fn,
        makeUniqueId: () => `u${++ids.next}`,
        checkPermission: () => true,
        checkApps: () => true,
    }),
}));
vi.mock('@/composable/aiAvailability', () => ({ aiUsable: false, canUseAi: () => false }));
vi.mock('vue-router', () => ({ useRoute: () => ({ params: {} }) }));
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key) => key }) }));
vi.mock('@/components/atom/AlertBox/helper', () => ({ showAlertModal: vi.fn() }));

import DesignationMapping from '@/plugins/importUsers/components/molecules/DesignationMapping.vue';
import ProjectFiltersToolbar from '@/views/Projects/components/ProjectFiltersToolbar.vue';
import { PALETTE_OPEN_EVENT } from '@/components/molecules/AdvanceSearch/paletteKeys';

const $t = (key) => key;
let wrapper;

const settle = async () => {
    vi.advanceTimersByTime(150);
    await flushPromises();
};
const openPanel = () => document.querySelector('#my-dropdown .drop-down-options');
const nestedButtons = (root) => root.querySelectorAll('button button');

beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '<div id="my-dropdown"></div><div id="app"></div>';
});

afterEach(() => {
    wrapper?.unmount();
    vi.useRealTimers();
});

describe('the import users designation picker', () => {
    const mountMapping = async () => {
        const store = createStore({ getters: { 'settings/designations': () => [{ name: 'Engineer' }, { name: 'Designer' }] } });
        wrapper = mount(DesignationMapping, {
            props: { roleMappedData: [['Name', 'Role'], { 1: 'designation' }, ['Ada', 'Dev']] },
            global: { plugins: [store], mocks: { $t } },
            attachTo: '#app',
        });
        await flushPromises();
        return wrapper;
    };

    it('is a listbox whose own button is the trigger, with no button around it', async () => {
        await mountMapping();
        const trigger = wrapper.find('[aria-haspopup]');
        expect(trigger.element.tagName).toBe('BUTTON');
        expect(trigger.classes()).toContain('border-groupBy');
        expect(trigger.attributes('aria-haspopup')).toBe('listbox');
        expect(trigger.attributes('aria-expanded')).toBe('false');
        expect(nestedButtons(wrapper.element)).toHaveLength(0);

        await trigger.trigger('click');
        await settle();
        expect(trigger.attributes('aria-expanded')).toBe('true');
        expect(openPanel().getAttribute('role')).toBe('listbox');
    });

    it('marks the picked designation selected and keeps the search box out of the options', async () => {
        await mountMapping();
        const trigger = wrapper.find('[aria-haspopup]');
        await trigger.trigger('click');
        await settle();
        const options = () => [...openPanel().querySelectorAll('[role="option"]')];
        expect(options().map((el) => el.textContent.trim())).toEqual(['Engineer', 'Designer']);
        expect(openPanel().querySelector('input').closest('[role="option"]')).toBeNull();

        options()[1].click();
        await settle();
        if (!openPanel()) {
            await trigger.trigger('click');
            await settle();
        }
        expect(options().map((el) => el.getAttribute('aria-selected'))).toEqual(['false', 'true']);
    });
});

describe('the project filters toolbar', () => {
    const groupByOptions = [
        { id: 0, label: 'status', image: 'status.svg' },
        { id: 1, label: 'assignee', image: 'assignee.svg' },
    ];
    const mountToolbar = async () => {
        wrapper = mount(ProjectFiltersToolbar, {
            props: {
                activeTab: 'ProjectListView',
                projectData: { _id: 'p1', isGlobalPermission: true },
                clientWidth: 1280,
                groupBy: 1,
                groupByOptions,
                taskKeySearch: true,
            },
            global: {
                mocks: { $t },
                stubs: {
                    ShellIcon: true, Assignee: true, TaskFilter: true, ProvenanceFilter: true, MonthlyCalendarMilestone: true,
                    BurndownModal: true, RecentVisitsDropdown: true, EpicsPanel: true,
                    ExportTasksDropdown: true, PagesPanel: true, PublicShareModal: true, ImportDialog: true,
                    AutoArchiveModal: true, EstimationScaleModal: true, Toggle: true,
                },
            },
            attachTo: '#app',
        });
        await flushPromises();
        return wrapper;
    };
    const triggerFor = (id) => wrapper.find(`#${id}_trigger`);
    const open = async (id) => {
        await triggerFor(id).trigger('click');
        await settle();
        return document.getElementById(`${id}_list`);
    };

    it('renders every trigger as the call site\'s own button, never a button in a button', async () => {
        await mountToolbar();
        expect(triggerFor('group_by').classes()).toContain('pft__pill');
        expect(triggerFor('more_features').classes()).toContain('pft__icon-btn');
        expect(triggerFor('searchfilterdropdownoptions_driver').classes()).toContain('pft__search-scope');
        expect(nestedButtons(wrapper.element)).toHaveLength(0);
    });

    it('group by is a listbox that marks the current grouping', async () => {
        await mountToolbar();
        expect(triggerFor('group_by').attributes('aria-haspopup')).toBe('listbox');
        const list = await open('group_by');
        expect(triggerFor('group_by').attributes('aria-expanded')).toBe('true');
        expect(list.getAttribute('role')).toBe('listbox');
        const options = [...list.querySelectorAll('[role="option"]')];
        expect(options.map((el) => el.getAttribute('aria-selected'))).toEqual(['false', 'true']);
    });

    it('search in is a listbox that marks the fields searched', async () => {
        await mountToolbar();
        const list = await open('searchfilterdropdownoptions_driver');
        expect(list.getAttribute('role')).toBe('listbox');
        const options = [...list.querySelectorAll('[role="option"]')];
        expect(options.map((el) => el.getAttribute('aria-selected'))).toEqual(['true', 'true', 'false']);
    });

    it('more features is a menu of actions', async () => {
        await mountToolbar();
        expect(triggerFor('more_features').attributes('aria-haspopup')).toBe('menu');
        const list = await open('more_features');
        expect(list.getAttribute('role')).toBe('menu');
        expect(list.querySelectorAll('[role="menuitem"]').length).toBeGreaterThan(0);
    });

    it('global search opens the command palette rather than a search of its own', async () => {
        const opened = vi.fn();
        window.addEventListener(PALETTE_OPEN_EVENT, opened);
        await mountToolbar();
        const list = await open('more_features');
        const item = [...list.querySelectorAll('[role="menuitem"]')].find((el) => el.textContent.includes('Projects.global_search'));
        item.click();
        await settle();
        window.removeEventListener(PALETTE_OPEN_EVENT, opened);
        expect(opened).toHaveBeenCalledTimes(1);
    });
});
