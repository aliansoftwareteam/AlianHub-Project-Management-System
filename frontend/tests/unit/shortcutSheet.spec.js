import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { nextTick, ref } from 'vue';
import { createStore } from 'vuex';

const { push, nav } = vi.hoisted(() => ({ push: vi.fn(() => Promise.resolve()), nav: { items: [] } }));

vi.mock('vue-router', () => ({
    useRouter: () => ({ push, resolve: () => ({ href: '#/' }), hasRoute: () => true }),
    useRoute: () => ({ name: 'Home', params: {}, query: {}, meta: {} })
}));
vi.mock('@/components/organisms/Shell/navItems', () => ({
    useNavItems: () => ({
        rail: { get value() { return nav.items; } },
        more: { value: [] },
        isActive: () => false,
        moreActive: { value: false }
    })
}));
vi.mock('@/components/organisms/Shell/inboxUnread', () => ({ useInboxUnread: () => ({ unread: ref(0), badge: ref('') }) }));
vi.mock('@/composable/index.js', () => ({ useGetterFunctions: () => ({ getUser: () => ({ Employee_Name: 'Asha', Employee_Email: 'asha@example.com' }) }) }));
vi.mock('@/composable/useAppVersion', () => ({ useAppVersion: () => ({ version: ref('1.0.0') }) }));
vi.mock('@/services', () => ({ useAuth: () => ({ logOut: vi.fn() }), apiRequestWithoutCompnay: vi.fn(() => Promise.resolve({ data: { status: true } })) }));
vi.mock('@/components/atom/UserProfile/UserProfile.vue', () => ({ default: { name: 'UserProfile', template: '<span class="user-profile-stub"></span>' } }));

import { SHORTCUTS, closeShortcutSheet, setSingleKeyShortcuts, shortcutSheet } from '@/composable/shortcuts';
import { closePopovers, shellState } from '@/components/organisms/Shell/shellState';
import KeyboardShortcuts from '@/components/organisms/KeyboardShortcuts/KeyboardShortcuts.vue';
import { closeQuickCreate, quickCreate } from '@/components/organisms/QuickCreateTask/quickCreateTask';
import GlobalRail from '@/components/organisms/Shell/GlobalRail.vue';

const store = () => createStore({
    modules: {
        users: { namespaced: true, getters: { users: () => [{ _id: 'user-1' }] } },
        brandSettingTab: { namespaced: true, getters: { brandSettings: () => ({}) } },
        settings: { namespaced: true, getters: { companies: () => [] } }
    }
});

const mounted = [];
const mountInBody = async (component) => {
    const wrapper = mount(component, { attachTo: document.body, global: { plugins: [store()], stubs: { RouterLink: { template: '<a><slot /></a>' } } } });
    mounted.push(wrapper);
    await flushPromises();
    return wrapper;
};

const press = async (key, target = document.body, init = {}) => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
    await flushPromises();
    await nextTick();
};

const sheet = () => document.body.querySelector('[data-test="shortcut-sheet"]');
const labels = () => Array.from(sheet().querySelectorAll('.ksh__label')).map((el) => el.textContent.trim());
const type = async (text) => {
    const box = sheet().querySelector('[data-test="shortcut-search"]');
    box.value = text;
    box.dispatchEvent(new Event('input', { bubbles: true }));
    await flushPromises();
};

const add = (html) => {
    const holder = document.createElement('div');
    holder.innerHTML = html;
    document.body.appendChild(holder);
    return holder;
};

beforeEach(() => {
    nav.items = [{ key: 'home', icon: 'home', label: 'Shell.home', to: { name: 'Home' } }, { key: 'inbox', icon: 'inbox', label: 'Inbox.title', to: { name: 'inbox' } }];
    try { localStorage.clear(); } catch (e) { /* jsdom storage */ }
    setSingleKeyShortcuts(true);
    closeShortcutSheet();
    closePopovers();
});

afterEach(() => {
    mounted.splice(0).forEach((w) => w.unmount());
    closeShortcutSheet();
    closePopovers();
    document.body.innerHTML = '';
});

describe('the ? sheet', () => {
    it('opens on ? as a modal dialog with every group of the registry', async () => {
        await mountInBody(KeyboardShortcuts);
        await press('?', document.body, { shiftKey: true });
        const dialog = sheet();
        expect(dialog.getAttribute('role')).toBe('dialog');
        expect(dialog.getAttribute('aria-modal')).toBe('true');
        expect(dialog.contains(document.activeElement)).toBe(true);
        const groups = Array.from(dialog.querySelectorAll('.ksh__group-title')).map((el) => el.textContent.trim());
        expect(groups).toEqual(['general', 'navigation', 'task', 'inbox', 'create', 'palette', 'docs'].map((g) => `Shortcuts.group_${g}`));
        expect(dialog.querySelectorAll('kbd.ah-kbd').length).toBeGreaterThanOrEqual(SHORTCUTS.length - 2);
    });

    it.each([
        ['an input', '<input type="text" class="typing" />'],
        ['a textarea', '<textarea class="typing"></textarea>'],
        ['a select', '<select class="typing"><option>a</option></select>'],
        ['a contenteditable', '<div contenteditable="true" class="typing" tabindex="0"></div>'],
        ['the Editor.js editor', '<div class="codex-editor"><div class="ce-block" tabindex="0"><span class="typing" tabindex="0">x</span></div></div>']
    ])('stays shut when ? is typed in %s', async (name, html) => {
        await mountInBody(KeyboardShortcuts);
        const target = add(html).querySelector('.typing');
        target.focus();
        await press('?', target, { shiftKey: true });
        expect(sheet(), name).toBeNull();
        expect(shortcutSheet.open).toBe(false);
    });

    it('closes on Escape and hands focus back to where it was', async () => {
        await mountInBody(KeyboardShortcuts);
        const opener = add('<button type="button" class="opener">opener</button>').querySelector('.opener');
        opener.focus();
        await press('?', opener, { shiftKey: true });
        expect(sheet()).not.toBeNull();
        await press('Escape', document.activeElement);
        expect(sheet()).toBeNull();
        expect(document.activeElement).toBe(opener);
    });

    it('has a labelled search box and a close button', async () => {
        await mountInBody(KeyboardShortcuts);
        await press('?', document.body, { shiftKey: true });
        const search = sheet().querySelector('[data-test="shortcut-search"]');
        const close = sheet().querySelector('.ksh__close');
        expect(search.getAttribute('type')).toBe('search');
        expect(search.getAttribute('aria-label')).toBe('Shortcuts.search_label');
        expect(close).not.toBeNull();
    });

    it('narrows to the shortcuts that match the search, by name or by key', async () => {
        await mountInBody(KeyboardShortcuts);
        await press('?', document.body, { shiftKey: true });
        const all = labels().length;
        await type('Shortcuts.inbox_');
        expect(labels().length).toBeLessThan(all);
        expect(labels().every((label) => label.startsWith('Shortcuts.inbox_'))).toBe(true);
        expect(sheet().querySelectorAll('.ksh__group-title')).toHaveLength(1);
        await type('?');
        expect(labels()).toEqual(['Shortcuts.help']);
    });

    it('says when nothing matches and offers to clear the search', async () => {
        await mountInBody(KeyboardShortcuts);
        await press('?', document.body, { shiftKey: true });
        await type('no shortcut is called this');
        expect(labels()).toEqual([]);
        const empty = sheet().querySelector('[data-test="shortcut-none"]');
        expect(empty.textContent).toContain('Shortcuts.none_title');
        empty.querySelector('.empty-state__btn').click();
        await flushPromises();
        expect(labels().length).toBeGreaterThan(10);
        expect(sheet().querySelector('[data-test="shortcut-search"]').value).toBe('');
    });

    it('starts each time with an empty search', async () => {
        await mountInBody(KeyboardShortcuts);
        await press('?', document.body, { shiftKey: true });
        await type('Shortcuts.inbox_');
        await press('Escape', document.activeElement);
        await press('?', document.body, { shiftKey: true });
        expect(sheet().querySelector('[data-test="shortcut-search"]').value).toBe('');
    });
});

describe('the c key', () => {
    afterEach(() => closeQuickCreate());

    it('opens the new task dialog from the shell, before the dialog itself has loaded', async () => {
        await mountInBody(KeyboardShortcuts);
        const input = add('<input type="text" class="typing" />').querySelector('.typing');
        await press('c', input);
        expect(quickCreate.open).toBe(false);
        await press('c');
        expect(quickCreate.open).toBe(true);
    });

    it('leaves an open new task dialog as it is', async () => {
        await mountInBody(KeyboardShortcuts);
        await press('c');
        quickCreate.name = 'Half typed';
        await press('c');
        expect(quickCreate).toMatchObject({ open: true, name: 'Half typed' });
    });
});

describe('the profile menu', () => {
    it('opens the sheet from a row that shows the ? key, and focus returns to the profile button', async () => {
        await mountInBody(KeyboardShortcuts);
        const rail = await mountInBody(GlobalRail);
        const profile = rail.find('.ah-rail__avatar-btn');
        await profile.trigger('click');
        expect(shellState.profileOpen).toBe(true);
        const row = rail.find('[data-test="open-shortcuts"]');
        expect(row.text()).toContain('Shortcuts.title');
        expect(row.find('kbd.ah-kbd--hint').text()).toBe('?');
        expect(row.attributes('aria-keyshortcuts')).toBe('?');

        await row.trigger('click');
        await flushPromises();
        expect(shellState.profileOpen).toBe(false);
        expect(sheet()).not.toBeNull();

        await press('Escape', document.activeElement);
        expect(sheet()).toBeNull();
        expect(document.activeElement).toBe(profile.element);
    });

    it('names the key in the tooltip of the new task button', async () => {
        const rail = await mountInBody(GlobalRail);
        const button = rail.find('.ah-rail__item--new');
        expect(button.attributes('title')).toBe('Shortcuts.with_keys');
        expect(button.attributes('aria-keyshortcuts')).toBe('C');
        setSingleKeyShortcuts(false);
        await nextTick();
        expect(button.attributes('title')).toBe('QuickCreate.rail_title');
        expect(button.attributes('aria-keyshortcuts')).toBeUndefined();
    });
});
