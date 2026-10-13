import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

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

import ProjectFiltersToolbar from '@/views/Projects/components/ProjectFiltersToolbar.vue';

const $t = (key) => key;
const groupByOptions = [{ id: 0, label: 'status', image: 'status.svg' }];
let wrapper;

const mountToolbar = async (props = {}) => {
    wrapper = mount(ProjectFiltersToolbar, {
        props: {
            activeTab: 'ProjectListView',
            projectData: { _id: 'p1', isGlobalPermission: true },
            clientWidth: 390,
            groupBy: 0,
            groupByOptions,
            userId: 'me',
            ...props,
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

const sheet = () => document.querySelector('[data-test="filters-sheet"]');
const filtersButton = () => wrapper.find('[data-test="filters-button"]');
const visible = (el) => !!el && el.style.display !== 'none';

beforeEach(() => {
    document.body.innerHTML = '<div id="my-dropdown"></div><div id="app"></div>';
});

afterEach(() => wrapper?.unmount());

describe('the project filters toolbar on a phone', () => {
    it('shows search and a Filters button, with the rest in a closed sheet', async () => {
        await mountToolbar();
        expect(wrapper.find('.pft__input').exists()).toBe(true);
        expect(filtersButton().exists()).toBe(true);
        expect(filtersButton().attributes('aria-expanded')).toBe('false');
        expect(filtersButton().attributes('aria-haspopup')).toBe('dialog');
        expect(visible(sheet())).toBe(false);
        expect(wrapper.find('.pft .task-filter-assignee').exists()).toBe(false);
    });

    it('counts the active filters on the button', async () => {
        await mountToolbar({ filterUsers: ['me', 'u2', 'u3'], doneBy: 'agent' });
        expect(filtersButton().find('.pft__filters-count').text()).toBe('3');
        expect(filtersButton().attributes('aria-label')).toBe('Projects.filters_active');
    });

    it('hides the count when nothing is filtered', async () => {
        await mountToolbar();
        expect(filtersButton().find('.pft__filters-count').exists()).toBe(false);
        expect(filtersButton().attributes('aria-label')).toBe('Projects.filters');
    });

    it('opens a dialog sheet holding Status, collapse, Me, people, Done by and more, and closes on Escape', async () => {
        await mountToolbar();
        await filtersButton().trigger('click');
        await flushPromises();
        const panel = sheet();
        expect(visible(panel)).toBe(true);
        const dialog = panel.querySelector('[role="dialog"]');
        expect(dialog.getAttribute('aria-modal')).toBe('true');
        expect(dialog.getAttribute('aria-labelledby')).toBeTruthy();
        expect(panel.querySelector('#group_by_trigger')).not.toBeNull();
        expect(panel.querySelector('#more_features_trigger')).not.toBeNull();
        expect(panel.querySelector('.manage__filter-users')).not.toBeNull();
        expect(panel.querySelector('provenance-filter-stub')).not.toBeNull();
        expect(panel.querySelector('task-filter-stub')).not.toBeNull();
        expect(dialog.contains(document.activeElement)).toBe(true);

        dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await flushPromises();
        expect(visible(sheet())).toBe(false);
        expect(filtersButton().attributes('aria-expanded')).toBe('false');
    });
});

describe('the project filters toolbar on a desktop', () => {
    it('keeps the full toolbar in place and no Filters button', async () => {
        await mountToolbar({ clientWidth: 1280 });
        expect(filtersButton().exists()).toBe(false);
        expect(sheet()).toBeNull();
        expect(wrapper.find('.pft .task-filter-assignee #group_by_trigger').exists()).toBe(true);
        expect(wrapper.find('.pft .manage__filter-users').exists()).toBe(true);
    });

    it('takes the density the page hands it on its root, and draws its controls from its own classes', async () => {
        await mountToolbar({ clientWidth: 1280, 'data-density': 'compact' });
        expect(wrapper.element.classList.contains('pft')).toBe(true);
        expect(wrapper.attributes('data-density')).toBe('compact');
        expect(wrapper.find('#group_by_trigger').classes()).toEqual(expect.arrayContaining(['pft__ctl', 'pft__pill']));
        expect(wrapper.findAll('.pft__seg .pft__seg-btn')).toHaveLength(2);
        expect(wrapper.find('.pft__input').classes()).not.toContain('form-control');
    });
});
