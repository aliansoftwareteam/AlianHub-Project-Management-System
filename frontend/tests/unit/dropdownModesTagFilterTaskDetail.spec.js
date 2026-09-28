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
    useGetterFunctions: () => ({ getUser: (id) => ({ id, Employee_Name: `Name ${id}`, Employee_profileImage: 'x.png' }) }),
}));
vi.mock('@/services', () => ({ apiRequest: vi.fn(() => Promise.resolve({ status: 200, data: {} })) }));
vi.mock('@/utils/TaskOperations', () => ({ default: { updateTags: vi.fn(() => Promise.resolve()) } }));
vi.mock('vuex', async (importOriginal) => ({
    ...(await importOriginal()),
    useStore: () => ({
        getters: {
            'settings/projectSkills': [{ slug: 'vue', name: 'Vue' }, { slug: 'node', name: 'Node' }],
            'settings/companyUsers': [{ userId: 'user-2' }],
        },
        commit: vi.fn(),
    }),
}));

import CreateTagPopup from '@/components/molecules/TagList/CreateTagPopup.vue';
import SkillsSelect from '@/components/molecules/SkillsSelect/SkillsSelect.vue';
import TaskDetailAction from '@/components/molecules/TaskDetailAction/TaskDetailAction.vue';
import FieldsActions from '@/components/molecules/TaskFilter/FieldsActions.vue';

const stubs = { ConfirmationSidebar: true, InputText: true, SpinnerComp: true, TagChip: true, ConvertToSubTaskSidebar: true, ConvertToList: true, WasabiIamgeCompp: true, SubtaskProgressBadge: true, Skelaton: true };

let wrapper;
const mountOn = async (component, props, provide = {}) => {
    wrapper = mount(component, { props, attachTo: '#app', global: { stubs, provide } });
    await flushPromises();
    return wrapper;
};

const triggerNamed = (label) => document.querySelector(`[aria-haspopup][aria-label="${label}"]`)
    || document.querySelector(`img[alt="${label}"]`)?.closest('[aria-haspopup]');
const popupOf = (trigger) => document.getElementById(trigger.getAttribute('aria-controls'));
const open = async (trigger) => {
    trigger.click();
    await flushPromises();
    vi.advanceTimersByTime(150);
    await flushPromises();
};

beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '<div id="my-dropdown"></div><div id="app"></div>';
});

afterEach(() => {
    wrapper?.unmount();
    vi.useRealTimers();
});

describe('the tag picker', () => {
    const tag = (uid, tagName) => ({ uid, tagName, tagColor: '#2f3990', tagBgColor: '#2f399035' });
    const props = { task: { _id: 't1', sprintId: 's1', TaskName: 'Ship it', tagsArray: ['a'] }, project: { _id: 'p1', isGlobalPermission: true, tagsArray: [tag('a', 'Alpha'), tag('b', 'Beta')] } };

    it('opens a listbox of tags from its own add-tag button', async () => {
        await mountOn(CreateTagPopup, props);
        const trigger = triggerNamed('Tags.add_tag');
        expect(trigger.tagName).toBe('BUTTON');
        expect(trigger.classList.contains('taglist__add-btn')).toBe(true);
        expect(trigger.querySelector('button')).toBeNull();
        expect(trigger.closest('button:not(.taglist__add-btn)')).toBeNull();
        expect(trigger.getAttribute('aria-haspopup')).toBe('listbox');
        expect(trigger.getAttribute('aria-expanded')).toBe('false');

        await open(trigger);
        expect(trigger.getAttribute('aria-expanded')).toBe('true');
        const list = popupOf(trigger);
        expect(list.getAttribute('role')).toBe('listbox');
        const options = [...list.querySelectorAll('[role="option"]')];
        expect(options.map((o) => o.textContent.trim())).toEqual(['Beta']);
        expect(options[0].getAttribute('aria-selected')).toBe('false');
    });

    it('names the per-tag actions menu', async () => {
        await mountOn(CreateTagPopup, props);
        await open(triggerNamed('Tags.add_tag'));
        const actions = triggerNamed('Tags.tag_actions');
        expect(actions.getAttribute('aria-haspopup')).toBe('menu');
    });
});

describe('the skills picker', () => {
    it('is a listbox that marks the chosen skills', async () => {
        await mountOn(SkillsSelect, { modelValue: ['node'] });
        const trigger = document.querySelector('[aria-haspopup]');
        expect(trigger.tagName).toBe('BUTTON');
        expect(trigger.getAttribute('aria-haspopup')).toBe('listbox');
        expect(trigger.getAttribute('aria-expanded')).toBe('false');

        await open(trigger);
        expect(popupOf(trigger).getAttribute('role')).toBe('listbox');
        const selected = Object.fromEntries([...document.querySelectorAll('#my-dropdown [role="option"]')].map((o) => [o.textContent.trim(), o.getAttribute('aria-selected')]));
        expect(selected).toEqual({ Vue: 'false', Node: 'true' });
    });
});

describe('the task detail header', () => {
    const provide = { selectedProject: ref({ isGlobalPermission: true, isPrivateSpace: false }) };
    const props = { watchers: ['user-1'], task: { _id: 't1', sprintId: 's1', TaskKey: 'T-1', AssigneeUserId: [], isParentTask: true } };

    it('opens a menu of task actions from its own labelled button', async () => {
        await mountOn(TaskDetailAction, props, provide);
        const trigger = triggerNamed('TaskPanel.more_actions');
        expect(trigger.classList.contains('task-action__btn')).toBe(true);
        expect(trigger.closest('.horizontalDocs').querySelectorAll('button')).toHaveLength(1);
        expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
        expect(trigger.getAttribute('aria-expanded')).toBe('false');

        await open(trigger);
        expect(trigger.getAttribute('aria-expanded')).toBe('true');
        expect(popupOf(trigger).getAttribute('role')).toBe('menu');
        expect(popupOf(trigger).querySelectorAll('[role="menuitem"]').length).toBeGreaterThan(0);
    });

    it('opens a listbox of watchers that marks who is watching', async () => {
        await mountOn(TaskDetailAction, { ...props, watchers: [] }, provide);
        await wrapper.setProps({ watchers: ['user-1'] });
        const trigger = document.querySelector('.watcher-action [aria-haspopup]');
        expect(trigger.classList.contains('task-action__btn')).toBe(true);
        expect(trigger.getAttribute('aria-haspopup')).toBe('listbox');

        await open(trigger);
        expect(popupOf(trigger).getAttribute('role')).toBe('listbox');
        const selected = Object.fromEntries([...popupOf(trigger).querySelectorAll('[role="option"]')].map((o) => [o.textContent.trim(), o.getAttribute('aria-selected')]));
        expect(selected).toEqual({ 'Name user-1': 'true', 'Name user-2': 'false' });
    });
});

describe('the saved filters picker', () => {
    it('opens a listbox of saved filters from a named icon button', async () => {
        await mountOn(FieldsActions, { filters: [{ _id: 'f1', name: 'Mine' }], getFiltersData: vi.fn(), handleUpdate: vi.fn() });
        const trigger = triggerNamed('Filters.my_filter');
        expect(trigger.tagName).toBe('BUTTON');
        expect(trigger.getAttribute('aria-haspopup')).toBe('listbox');

        await open(trigger);
        expect(popupOf(trigger).getAttribute('role')).toBe('listbox');
        expect([...popupOf(trigger).querySelectorAll('[role="option"]')].map((o) => o.textContent.trim())).toEqual(['Mine']);
    });
});
