import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

const ids = vi.hoisted(() => ({ next: 0 }));
vi.mock('@/composable', () => ({
    useCustomComposable: () => ({ debounce: (fn) => fn, makeUniqueId: () => `u${++ids.next}`, checkPermission: () => true }),
}));

import TaskQuickMenu from '@/components/organisms/Task/components/TaskQuickMenu.vue';
import MainChatMessage from '@/components/organisms/MainChat/MainChatMessage.vue';
import DropDownListComponent from '@/components/templates/Dashboard/DropDownListComponent.vue';

const STATUSES = [{ _id: 's1', name: 'To do' }, { _id: 's2', name: 'Doing' }, { _id: 's3', name: 'Done' }];

let wrapper;
const attach = async (component, options) => {
    wrapper = mount(component, { attachTo: '#app', ...options });
    await flushPromises();
    return wrapper;
};
const trigger = () => document.querySelector('[aria-haspopup]');
const popup = () => document.getElementById(trigger().getAttribute('aria-controls'));
const items = () => [...document.querySelectorAll('#my-dropdown .drop-down-item')];
const itemNamed = (text) => items().find((el) => el.textContent.includes(text));
const isOpen = () => document.querySelector('#my-dropdown .drop-down-menu') !== null;
const open = async () => {
    trigger().click();
    await flushPromises();
};
const settle = async () => {
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

describe('the task quick menu', () => {
    const mountMenu = () => attach(TaskQuickMenu, {
        props: { task: { _id: 't1', TaskName: 'Write docs', deletedStatusKey: 0, isParentTask: true }, projectData: { isGlobalPermission: false } },
    });

    it('is a named menu button whose entries are menu items', async () => {
        await mountMenu();
        const button = trigger();
        expect(button.tagName).toBe('BUTTON');
        expect(button.getAttribute('aria-haspopup')).toBe('menu');
        expect(button.getAttribute('aria-expanded')).toBe('false');
        expect(button.querySelector('img').getAttribute('alt')).toBe('ProjectDetails.task_actions');
        await open();
        expect(button.getAttribute('aria-expanded')).toBe('true');
        expect(popup().getAttribute('role')).toBe('menu');
        expect(items().length).toBeGreaterThan(0);
        expect(items().every((el) => el.getAttribute('role') === 'menuitem')).toBe(true);
    });

    it('runs the picked action and closes itself', async () => {
        await mountMenu();
        await open();
        itemNamed('ProjectDetails.copy_task_link').click();
        await settle();
        expect(wrapper.emitted('copyLink')).toHaveLength(1);
        expect(isOpen()).toBe(false);
        expect(trigger().getAttribute('aria-expanded')).toBe('false');
    });
});

describe('the main chat message menu', () => {
    const mountMessage = () => attach(MainChatMessage, {
        props: { message: { _id: 'm1', userId: 'user-1', sent: true, type: 'text', message: 'hi', createdAt: 1, updatedAt: 1 }, senderName: 'Max' },
        global: { stubs: { MainChatAvatar: true, MainChatMessageBody: true, ReactionBar: true } },
    });

    it('keeps its own button as the menu trigger, with no button around it', async () => {
        await mountMessage();
        const button = trigger();
        expect(button.getAttribute('title')).toBe('MainChat.more');
        expect(button.getAttribute('aria-haspopup')).toBe('menu');
        expect(button.getAttribute('aria-expanded')).toBe('false');
        expect(button.parentElement.closest('button')).toBeNull();
        expect(document.querySelector('.dropdown-trigger')).toBeNull();
    });

    it('runs the picked action and closes itself', async () => {
        await mountMessage();
        await open();
        expect(popup().getAttribute('role')).toBe('menu');
        itemNamed('MainChat.copy').click();
        await settle();
        expect(wrapper.emitted('copy')).toHaveLength(1);
        expect(isOpen()).toBe(false);
    });
});

describe('the dashboard card field picker', () => {
    const mountPicker = (props) => attach(DropDownListComponent, {
        props: { id: 'status_field', items: STATUSES, field: { label: 'status' }, ...props },
        global: { stubs: { InputText: true, UserProfile: true, WasabiImage: true, ToolTip: true } },
    });

    it('is a listbox that marks the current value as selected', async () => {
        await mountPicker({ selectedItem: STATUSES[1] });
        expect(trigger().tagName).toBe('BUTTON');
        expect(trigger().getAttribute('aria-haspopup')).toBe('listbox');
        await open();
        expect(popup().getAttribute('role')).toBe('listbox');
        expect(items().map((el) => [el.getAttribute('role'), el.getAttribute('aria-selected')])).toEqual([
            ['option', 'false'], ['option', 'true'], ['option', 'false'],
        ]);
    });

    it('closes after a single pick', async () => {
        await mountPicker({ selectedItem: STATUSES[1] });
        await open();
        itemNamed('Done').click();
        await settle();
        expect(wrapper.emitted('update:selected')[0][0]).toEqual(STATUSES[2]);
        expect(isOpen()).toBe(false);
    });

    it('marks every chosen value and stays open for more picks when it takes several', async () => {
        await mountPicker({ isMultiSelect: true, selectedItems: ['s1', 's3'] });
        await open();
        expect(items().map((el) => el.getAttribute('aria-selected'))).toEqual(['true', 'false', 'true']);
        itemNamed('Doing').click();
        await settle();
        expect(wrapper.emitted('update:selected')[0][0]).toEqual(['s1', 's3', 's2']);
        expect(isOpen()).toBe(true);
    });
});
