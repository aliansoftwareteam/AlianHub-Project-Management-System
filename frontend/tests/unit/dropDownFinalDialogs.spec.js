import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { ref } from 'vue';

const ids = vi.hoisted(() => ({ next: 0 }));
vi.mock('@/composable', () => ({
    useCustomComposable: () => ({
        debounce: (fn) => fn,
        makeUniqueId: () => `u${++ids.next}`,
        checkPermission: () => true,
        checkApps: () => true,
    }),
    useGetterFunctions: () => ({ getUser: (id) => ({ id, Employee_Name: `Name ${id}` }) }),
}));
vi.mock('@/services', () => ({ apiRequest: vi.fn(() => Promise.resolve({ status: 200, data: { status: true, data: [] } })) }));
vi.mock('vue-router', () => ({ useRoute: () => ({ params: {}, query: {} }), useRouter: () => ({ push: vi.fn() }) }));
vi.mock('vuex', async (importOriginal) => ({
    ...(await importOriginal()),
    useStore: () => ({
        getters: {
            'users/users': [
                { _id: 'a', Employee_Name: 'Ann' },
                { _id: 'b', Employee_Name: 'Ben' },
                { _id: 'c', Employee_Name: 'Cy' },
            ],
            'settings/companyPriority': [],
            'settings/companyTaskType': [],
            'settings/companyUsers': [],
        },
        commit: vi.fn(),
        dispatch: vi.fn(() => Promise.resolve()),
    }),
}));

import FieldsActions from '@/components/molecules/TaskFilter/FieldsActions.vue';
import TaskFilter from '@/components/molecules/TaskFilter/TaskFilter.vue';
import ProjectBottomModals from '@/views/Projects/components/ProjectBottomModals.vue';
import TaskInSidebar from '@/components/organisms/TaskInSidebar/TaskInSidebar.vue';
import { findDropDownUses } from '../../../tests/conventions/dropdown-uses';

const provide = { $clientWidth: ref(1280), $companyId: ref('c1'), $userId: ref('u1'), selectedProject: ref({}) };
const stubs = { InputText: true, FieldsTable: true, ConfirmModal: true, UserProfile: true, ConfirmationsInTask: true, SpinnerComp: true };

let wrapper;
const mountOn = async (component, props, extra = {}) => {
    wrapper = mount(component, { props, attachTo: '#app', global: { stubs: { ...stubs, ...extra.stubs }, provide: { ...provide, ...extra.provide } } });
    await flushPromises();
    return wrapper;
};
const settle = async () => {
    await flushPromises();
    vi.advanceTimersByTime(150);
    await flushPromises();
};
const open = async (trigger) => {
    trigger.click();
    await settle();
};
const panelOf = (trigger) => document.getElementById(trigger.getAttribute('aria-controls'));
const nestedButtons = () => document.querySelectorAll('button button');

beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '<div id="my-dropdown"></div><div id="app"></div>';
});

afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    vi.useRealTimers();
});

describe('the task filter panel', () => {
    it('opens a labelled dialog from the call site\'s own filter button', async () => {
        await mountOn(TaskFilter, { projectData: { _id: 'p1' } }, { stubs: { FieldsActions: true } });
        const trigger = document.querySelector('.task-filter-trigger');
        expect(trigger.getAttribute('aria-haspopup')).toBe('dialog');
        expect(trigger.getAttribute('aria-expanded')).toBe('false');
        expect(nestedButtons()).toHaveLength(0);

        await open(trigger);
        const panel = panelOf(trigger);
        expect(trigger.getAttribute('aria-expanded')).toBe('true');
        expect(panel.getAttribute('role')).toBe('dialog');
        expect(panel.getAttribute('aria-label')).toBe('Filters.filter');
        expect(panel.querySelector('[role="menu"], [role="listbox"]')).toBeNull();
    });
});

describe('the save filters form', () => {
    const mountActions = () => mountOn(FieldsActions, { filters: [{ _id: 'f1', name: 'Mine' }], getFiltersData: vi.fn(), handleUpdate: vi.fn() });

    it('opens a labelled dialog, not a list', async () => {
        await mountActions();
        const trigger = [...document.querySelectorAll('[aria-haspopup]')].find((el) => el.textContent.includes('Filters.save_filters'));
        expect(trigger.tagName).toBe('BUTTON');
        expect(trigger.getAttribute('aria-haspopup')).toBe('dialog');

        await open(trigger);
        const panel = panelOf(trigger);
        expect(panel.getAttribute('role')).toBe('dialog');
        expect(panel.getAttribute('aria-label')).toBe('Filters.save_this_filters');
        expect(panel.querySelector('[role="option"], [role="menuitem"]')).toBeNull();
    });

    it('keeps the saved filters search above the listbox, outside its options', async () => {
        await mountActions();
        const trigger = document.querySelector('img[alt="Filters.my_filter"]').closest('[aria-haspopup]');
        await open(trigger);
        const list = document.getElementById(trigger.getAttribute('aria-controls'));
        const search = document.querySelector('#my-dropdown .drop-down-search input-text-stub');
        expect(search).not.toBeNull();
        expect(list.contains(search)).toBe(false);
    });
});

describe('the mobile "All views" sheet', () => {
    it('is a dialog named after the views it offers', async () => {
        wrapper = mount(ProjectBottomModals, {
            props: { clientWidth: 390, projectData: { _id: 'p1' } },
            attachTo: '#app',
            global: {
                stubs: { ViewsDropdown: true, ProjectWatcher: true, ConfirmationSidebar: true, CreateProjectSidebar: true, AiProjectCreator: true, ProjectPermission: true, ConfirmModal: true, AISidebar: true },
            },
        });
        await flushPromises();
        wrapper.vm.openAllViews();
        await settle();
        const sheet = document.querySelector('#my-dropdown .viewlist-mobile-dropdown-new');
        expect(sheet.getAttribute('role')).toBe('dialog');
        expect(sheet.getAttribute('aria-label')).toBe('Projects.all_views');
    });
});

describe('the "+N" assignees popover in the task sidebar', () => {
    it('is a labelled dialog of people, opened from a trigger that says how many', async () => {
        await mountOn(TaskInSidebar, { data: { _id: 't1', TaskKey: 'T-1', AssigneeUserId: ['a', 'b', 'c'] }, task: { _id: 't0' }, taskData: [], fromWhich: 'dashboard', selectedProjectData: { taskStatusData: [], taskTypeCounts: [] } });
        const trigger = document.querySelector('[aria-haspopup]');
        expect(trigger.getAttribute('aria-haspopup')).toBe('dialog');
        expect(trigger.textContent).toContain('Common.more_assignees');

        await open(trigger);
        const panel = panelOf(trigger);
        expect(panel.getAttribute('role')).toBe('dialog');
        expect(panel.getAttribute('aria-label')).toBe('Common.more_assignees');
        expect(panel.querySelector('[role="menuitem"]')).toBeNull();
    });
});

describe('dropdowns on pages too large to mount here', () => {
    const src = (file) => readFileSync(resolve(__dirname, '../../src', file), 'utf8');
    const tagOf = (source, marker) => {
        const at = source.indexOf(marker);
        const start = source.lastIndexOf('<DropDown', at);
        return source.slice(start, source.indexOf('>', at) + 1);
    };

    it('the project "Add view" picker is a labelled dialog whose own button is the trigger', () => {
        const page = src('components/molecules/ProjectViews/AddViewMenu.vue');
        const tag = tagOf(page, 'id="embeddropdown"');
        expect(tag).toMatch(/\bmode="dialog"/);
        expect(tag).toMatch(/:aria-label="\$t\('Projects\.add_view'\)"/);
        const [use] = findDropDownUses(page.slice(page.indexOf(tag)));
        expect(use).toMatchObject({ hasMode: true, nestsButton: false });
        expect(page.slice(page.indexOf(tag), page.indexOf('</DropDown>', page.indexOf(tag)))).toMatch(/v-bind="triggerAttrs"/);
    });

    it('the project row activity clock is a labelled dialog, not a menu of dead items', () => {
        const tag = tagOf(src('components/organisms/Item/Item.vue'), 'userActivityClick()');
        expect(tag).toMatch(/\bmode="dialog"/);
        expect(tag).toMatch(/:aria-label="\$t\('Projects\.active_members'\)"/);
    });
});
