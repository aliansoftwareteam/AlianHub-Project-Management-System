import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { ref } from 'vue';

const ids = vi.hoisted(() => ({ next: 0 }));
vi.mock('@/composable', () => ({
    useCustomComposable: () => ({
        debounce: (fn) => fn,
        makeUniqueId: () => `u${++ids.next}`,
        checkPermission: () => true,
        checkApps: () => true,
    }),
}));
vi.mock('@/composable/commonFunction', () => ({ projectComponentsIcons: () => ({ icon: 'icon.svg', activeIcon: 'icon.svg' }) }));
vi.mock('@/services', () => ({ apiRequest: vi.fn(() => Promise.resolve({ status: 200, data: {} })) }));
vi.mock('@/utils/TaskOperations', () => ({ default: { updateTags: vi.fn(() => Promise.resolve()) } }));
vi.mock('@/components/molecules/EmbedView/helper', () => ({ editView: vi.fn(() => Promise.resolve({ data: {} })), deleteView: vi.fn(() => Promise.resolve({ data: {} })) }));
vi.mock('vue-router', () => ({ useRoute: () => ({ params: {}, query: {} }), useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock('vuex', () => ({ useStore: () => ({ commit: vi.fn(), dispatch: vi.fn(), getters: {} }) }));

import TaskStatus from '@/components/atom/TaskStatus/TaskStatus.vue';
import TaskType from '@/components/atom/TaskType/TaskType.vue';
import TagChip from '@/components/atom/TagChip/TagChip.vue';
import ViewsList from '@/components/atom/ViewsList/ViewsList.vue';

const stubs = { TaskTypeIcon: { template: '<span class="tticon" />' }, InputText: true, ConfirmationSidebar: true, SpinnerComp: true };

let wrapper;
const mountAtom = async (component, props, provide = {}) => {
    wrapper = mount(component, { props, attachTo: '#app', global: { stubs, provide: { $clientWidth: ref(1280), ...provide } } });
    await flushPromises();
    return wrapper;
};

const trigger = () => document.querySelector('#app [aria-haspopup]');
const openPanel = async () => {
    trigger().click();
    await flushPromises();
    vi.advanceTimersByTime(150);
    await flushPromises();
    return document.getElementById(trigger().getAttribute('aria-controls'));
};
const items = (role) => [...document.querySelectorAll(`#my-dropdown [role="${role}"]`)];

beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '<div id="my-dropdown"></div><div id="app"></div>';
});

afterEach(() => {
    wrapper?.unmount();
    vi.useRealTimers();
});

describe('atom pickers are listboxes that mark the current value', () => {
    const statuses = [{ key: 1, name: 'To do', textColor: '#111111' }, { key: 2, name: 'Doing', textColor: '#222222' }];
    const types = [{ key: 'bug', name: 'Bug' }, { key: 'story', name: 'Story' }];

    it('the task status picker', async () => {
        await mountAtom(TaskStatus, { id: 'status_t1', modelValue: statuses[1], options: statuses });
        const button = trigger();
        expect(button.tagName).toBe('BUTTON');
        expect(button.getAttribute('aria-haspopup')).toBe('listbox');
        expect(button.getAttribute('aria-expanded')).toBe('false');
        expect(button.querySelector('[role="img"]').getAttribute('aria-label')).toBe('Doing');
        const list = await openPanel();
        expect(button.getAttribute('aria-expanded')).toBe('true');
        expect(list.getAttribute('role')).toBe('listbox');
        expect(items('option').map((el) => el.getAttribute('aria-selected'))).toEqual(['false', 'true']);
    });

    it('the task type picker', async () => {
        await mountAtom(TaskType, { id: 'type_t1', modelValue: types[0], options: types });
        const button = trigger();
        expect(button.getAttribute('aria-haspopup')).toBe('listbox');
        expect(button.textContent).toContain('Bug');
        const list = await openPanel();
        expect(list.getAttribute('role')).toBe('listbox');
        expect(items('option').map((el) => el.getAttribute('aria-selected'))).toEqual(['true', 'false']);
    });
});

describe('atom action menus are menus', () => {
    it("a tag's rename, colour and delete actions", async () => {
        const tag = { uid: 'tag-1', tagName: 'Urgent', tagColor: '#2f3990', tagBgColor: '#2f399035' };
        await mountAtom(TagChip, { data: tag, ids: { companyId: 'c1', projectId: 'p1', sprintId: 's1', taskId: 't1', tagsArray: ['tag-1'] }, tagsArray: [tag], taskId: 't1', sprintId: 's1' });
        const button = trigger();
        expect(button.getAttribute('aria-haspopup')).toBe('menu');
        expect(button.querySelector('img').getAttribute('alt')).toBe('Tags.tag_actions');
        const list = await openPanel();
        expect(button.getAttribute('aria-expanded')).toBe('true');
        expect(list.getAttribute('role')).toBe('menu');
        expect(items('menuitem')).toHaveLength(3);
    });

    it("a view tab's own options button gets the trigger attributes and no nested menu", async () => {
        await mountAtom(ViewsList, { item: { _id: 'view_1234567', name: 'list', keyName: 'ListView', isPin: false } }, { selectedProject: ref({ _id: 'p1', ProjectRequiredComponent: [] }) });
        const button = trigger();
        expect(button.classList).toContain('dots');
        expect(button.querySelector('button')).toBeNull();
        expect(button.parentElement.closest('button')).toBeNull();
        expect(button.getAttribute('aria-haspopup')).toBe('menu');
        const list = await openPanel();
        expect(button.getAttribute('aria-expanded')).toBe('true');
        expect(list.getAttribute('role')).toBe('menu');
        expect(list.querySelectorAll('[role="menu"]')).toHaveLength(0);
        expect(items('menuitem').length).toBeGreaterThan(0);
    });
});
