import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { createStore } from 'vuex';

const { push, nav, apiRequestWithoutCompnay } = vi.hoisted(() => ({
    push: vi.fn(() => Promise.resolve()),
    nav: { items: [] },
    apiRequestWithoutCompnay: vi.fn()
}));

vi.mock('vue-router', () => ({
    useRouter: () => ({ push }),
    useRoute: () => ({ name: 'Home', params: {}, query: {}, meta: {} })
}));
vi.mock('@/components/organisms/Shell/navItems', () => ({ useNavItems: () => ({ rail: { get value() { return nav.items; } } }) }));
vi.mock('@/services', () => ({ apiRequestWithoutCompnay }));

import en from '@/locales/en';
import * as env from '@/config/env';
import {
    SHORTCUTS,
    SHORTCUT_GROUPS,
    bindShortcut,
    closeShortcutSheet,
    handleShortcutKey,
    setSingleKeyShortcuts,
    shortcutPrefs,
    shortcutSheet,
    syncShortcutPreferences
} from '@/composable/shortcuts';
import { saveSingleKeyShortcuts } from '@/composable/shortcutPreferences';
import { PALETTE_OPEN_EVENT, isPaletteShortcut } from '@/components/molecules/AdvanceSearch/paletteKeys';
import { navKeyDirection } from '@/components/organisms/TaskDetailOverlay/taskNavigation';
import KeyboardShortcuts from '@/components/organisms/KeyboardShortcuts/KeyboardShortcuts.vue';
import { resetOnboardingRecord } from '@/composable/onboardingState';

const HOME = { key: 'home', to: { name: 'Home', params: { cid: 'company-1' } } };
const INBOX = { key: 'inbox', to: { name: 'inbox', params: { cid: 'company-1' } } };
const PROJECTS = { key: 'projects', to: { name: 'Projects', params: { cid: 'company-1' } } };
const TIME = { key: 'time', to: { name: 'User Timesheet', params: { cid: 'company-1' } } };

const lookup = (path) => path.split('.').reduce((node, part) => (node == null ? undefined : node[part]), en);

const store = (me = {}) => createStore({
    modules: {
        users: { namespaced: true, getters: { users: () => [{ _id: 'user-1', ...me }] } }
    }
});

const mounted = [];
const mountShortcuts = async (me) => {
    const wrapper = mount(KeyboardShortcuts, { attachTo: document.body, global: { plugins: [store(me)] } });
    mounted.push(wrapper);
    await flushPromises();
    return wrapper;
};

const press = async (key, target = document.body, init = {}) => {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
    target.dispatchEvent(event);
    await flushPromises();
    await nextTick();
    return event;
};

const sheet = () => document.body.querySelector('[data-test="shortcut-sheet"]');

const add = (html) => {
    const holder = document.createElement('div');
    holder.innerHTML = html;
    const el = holder.firstElementChild;
    document.body.appendChild(el);
    return el;
};

beforeEach(() => {
    nav.items = [HOME, INBOX, PROJECTS];
    push.mockClear();
    apiRequestWithoutCompnay.mockReset();
    apiRequestWithoutCompnay.mockResolvedValue({ data: { status: true } });
    resetOnboardingRecord();
    try { localStorage.clear(); } catch (e) { /* jsdom storage */ }
    setSingleKeyShortcuts(true);
    closeShortcutSheet();
});

afterEach(() => {
    mounted.splice(0).forEach((w) => w.unmount());
    closeShortcutSheet();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
});

describe('the shortcut registry', () => {
    it('gives every shortcut a unique id, a known group and an English label', () => {
        const ids = SHORTCUTS.map((s) => s.id);
        expect(new Set(ids).size).toBe(ids.length);
        SHORTCUTS.forEach((s) => {
            expect(SHORTCUT_GROUPS).toContain(s.group);
            expect(Array.isArray(s.keys) && s.keys.length).toBeTruthy();
            expect(typeof lookup(s.label), s.label).toBe('string');
        });
    });

    it('lists the global keys, the g keys and the per-screen keys', () => {
        const byKeys = Object.fromEntries(SHORTCUTS.map((s) => [s.id, s.keys.join(' ')]));
        expect(byKeys).toMatchObject({
            palette: 'mod+k',
            search: '/',
            'create-task': 'c',
            help: '?',
            'go-home': 'g h',
            'go-inbox': 'g i',
            'go-projects': 'g p',
            'go-time': 'g t',
            'task-next': 'j',
            'task-prev': 'k',
            'inbox-next': 'j',
            'inbox-prev': 'k'
        });
    });

    it('runs the handler bound to a single key and to a g sequence', () => {
        const create = vi.fn();
        const home = vi.fn();
        const unbindCreate = bindShortcut('create-task', create);
        const unbindHome = bindShortcut('go-home', home);
        const ev = (key) => ({ key, target: document.body, preventDefault: vi.fn() });
        expect(handleShortcutKey(ev('c'))).toBe('create-task');
        expect(create).toHaveBeenCalledTimes(1);
        expect(handleShortcutKey(ev('g'))).toBe(null);
        expect(handleShortcutKey(ev('h'))).toBe('go-home');
        expect(home).toHaveBeenCalledTimes(1);
        unbindCreate();
        unbindHome();
        expect(handleShortcutKey(ev('c'))).toBe(null);
    });

    it('drops a g that is not followed in time', () => {
        const home = vi.fn();
        const unbind = bindShortcut('go-home', home);
        const now = vi.spyOn(Date, 'now');
        now.mockReturnValue(1000);
        handleShortcutKey({ key: 'g', target: document.body, preventDefault() {} });
        now.mockReturnValue(5000);
        expect(handleShortcutKey({ key: 'h', target: document.body, preventDefault() {} })).toBe(null);
        expect(home).not.toHaveBeenCalled();
        unbind();
    });

    it('lets a handler decline a key it cannot act on', () => {
        const unbind = bindShortcut('create-task', () => false);
        const event = { key: 'c', target: document.body, preventDefault: vi.fn() };
        expect(handleShortcutKey(event)).toBe(null);
        expect(event.preventDefault).not.toHaveBeenCalled();
        unbind();
    });
});

describe('the ? sheet', () => {
    it('opens on ? as a labelled modal listing the registry', async () => {
        await mountShortcuts();
        await press('?', document.body, { shiftKey: true });
        const dialog = sheet();
        expect(dialog).not.toBeNull();
        expect(dialog.getAttribute('role')).toBe('dialog');
        expect(dialog.getAttribute('aria-modal')).toBe('true');
        expect(document.getElementById(dialog.getAttribute('aria-labelledby'))).not.toBeNull();
        const text = dialog.textContent;
        SHORTCUTS.filter((s) => s.id !== 'go-time').forEach((s) => expect(text, s.id).toContain(s.label));
        expect(dialog.contains(document.activeElement)).toBe(true);
    });

    it('leaves out a g key for a screen the user cannot see', async () => {
        await mountShortcuts();
        await press('?');
        expect(sheet().textContent).not.toContain('Shortcuts.go_time');
    });

    it('closes on Escape and hands focus back', async () => {
        await mountShortcuts();
        const opener = add('<button type="button">opener</button>');
        opener.focus();
        await press('?', opener);
        expect(sheet()).not.toBeNull();
        await press('Escape', document.activeElement);
        expect(sheet()).toBeNull();
        expect(shortcutSheet.open).toBe(false);
        expect(document.activeElement).toBe(opener);
    });
});

describe('/ and the g keys', () => {
    it('/ opens the palette when the page has no search box', async () => {
        await mountShortcuts();
        const opened = vi.fn();
        window.addEventListener(PALETTE_OPEN_EVENT, opened);
        const event = await press('/');
        window.removeEventListener(PALETTE_OPEN_EVENT, opened);
        expect(opened).toHaveBeenCalledTimes(1);
        expect(event.defaultPrevented).toBe(true);
    });

    it('/ focuses the page search box when there is one', async () => {
        await mountShortcuts();
        const main = add('<main id="ah-main"><input type="search" aria-label="Search tasks"></main>');
        const opened = vi.fn();
        window.addEventListener(PALETTE_OPEN_EVENT, opened);
        await press('/');
        window.removeEventListener(PALETTE_OPEN_EVENT, opened);
        expect(document.activeElement).toBe(main.querySelector('input'));
        expect(opened).not.toHaveBeenCalled();
    });

    it('g h, g i and g p go to Home, Inbox and Projects', async () => {
        await mountShortcuts();
        await press('g'); await press('h');
        await press('g'); await press('i');
        await press('g'); await press('p');
        expect(push.mock.calls.map((c) => c[0])).toEqual([HOME.to, INBOX.to, PROJECTS.to]);
    });

    it('g t goes to Time only when the user can see it', async () => {
        await mountShortcuts();
        await press('g'); await press('t');
        expect(push).not.toHaveBeenCalled();
        nav.items = [HOME, INBOX, PROJECTS, TIME];
        await press('g'); await press('t');
        expect(push).toHaveBeenCalledWith(TIME.to);
    });
});

describe('never while typing or under a dialog', () => {
    const fields = {
        input: '<input type="text">',
        textarea: '<textarea></textarea>',
        select: '<select><option>a</option></select>',
        editor: '<div contenteditable="true"><p>text</p></div>'
    };

    Object.entries(fields).forEach(([name, html]) => {
        it(`ignores ?, /, g h and c typed in a ${name}`, async () => {
            await mountShortcuts();
            const create = vi.fn();
            const unbind = bindShortcut('create-task', create);
            const field = add(html);
            const target = field.querySelector('p') || field;
            const opened = vi.fn();
            window.addEventListener(PALETTE_OPEN_EVENT, opened);
            for (const key of ['?', '/', 'g', 'h', 'c']) await press(key, target);
            window.removeEventListener(PALETTE_OPEN_EVENT, opened);
            unbind();
            expect(sheet()).toBeNull();
            expect(opened).not.toHaveBeenCalled();
            expect(push).not.toHaveBeenCalled();
            expect(create).not.toHaveBeenCalled();
        });
    });

    it('ignores keys while an input method is composing', async () => {
        await mountShortcuts();
        await press('?', document.body, { isComposing: true });
        await press('g', document.body, { isComposing: true });
        await press('h', document.body, { isComposing: true });
        expect(sheet()).toBeNull();
        expect(push).not.toHaveBeenCalled();
    });

    it('ignores keys while another modal dialog is open', async () => {
        await mountShortcuts();
        add('<div role="dialog" aria-modal="true"><button type="button">x</button></div>');
        await press('?');
        await press('g'); await press('h');
        expect(sheet()).toBeNull();
        expect(push).not.toHaveBeenCalled();
    });

    it('ignores letters with a modifier', async () => {
        await mountShortcuts();
        await press('g'); await press('h', document.body, { ctrlKey: true });
        await press('g', document.body, { metaKey: true }); await press('i');
        expect(push).not.toHaveBeenCalled();
    });
});

describe('turning single-key shortcuts off', () => {
    it('stops c, ?, / and the g keys but keeps Cmd/Ctrl+K', async () => {
        await mountShortcuts();
        const create = vi.fn();
        const unbind = bindShortcut('create-task', create);
        setSingleKeyShortcuts(false);
        const opened = vi.fn();
        window.addEventListener(PALETTE_OPEN_EVENT, opened);
        for (const key of ['c', '?', '/', 'g', 'h']) await press(key);
        window.removeEventListener(PALETTE_OPEN_EVENT, opened);
        unbind();
        expect(create).not.toHaveBeenCalled();
        expect(sheet()).toBeNull();
        expect(opened).not.toHaveBeenCalled();
        expect(push).not.toHaveBeenCalled();
        const metaK = { key: 'k', metaKey: true, ctrlKey: false, shiftKey: false, altKey: false, target: document.body };
        expect(isPaletteShortcut(metaK, { mac: true })).toBe(true);
    });

    it('also stops j and k in the task panel, leaving the arrow keys', () => {
        const target = document.createElement('div');
        document.body.appendChild(target);
        expect(navKeyDirection({ key: 'j', target })).toBe(1);
        setSingleKeyShortcuts(false);
        expect(navKeyDirection({ key: 'j', target })).toBe(0);
        expect(navKeyDirection({ key: 'k', target })).toBe(0);
    });

    it('says in the sheet that they are off', async () => {
        await mountShortcuts();
        setSingleKeyShortcuts(false);
        shortcutSheet.open = true;
        await flushPromises();
        expect(sheet().textContent).toContain('Shortcuts.single_keys_off');
    });

    it('reads the choice from the user record, defaulting to on', async () => {
        syncShortcutPreferences({ singleKeyShortcuts: false });
        expect(shortcutPrefs.singleKeys).toBe(false);
        syncShortcutPreferences(undefined);
        expect(shortcutPrefs.singleKeys).toBe(true);
        await mountShortcuts({ accessibilityPreferences: { singleKeyShortcuts: false } });
        expect(shortcutPrefs.singleKeys).toBe(false);
    });

    it('records the first opening of the sheet on the user, once', async () => {
        await mountShortcuts();
        await press('?');
        expect(apiRequestWithoutCompnay).toHaveBeenCalledWith('put', env.USER_ONBOARDING, { viewedShortcuts: true });
        closeShortcutSheet();
        await nextTick();
        await press('?');
        expect(apiRequestWithoutCompnay).toHaveBeenCalledTimes(1);
    });

    it('does not record it again for someone whose record already has it', async () => {
        await mountShortcuts({ homeChecklist: { viewedShortcuts: true } });
        await press('?');
        expect(sheet()).not.toBeNull();
        expect(apiRequestWithoutCompnay).not.toHaveBeenCalled();
    });

    it('saves the choice on the user', async () => {
        apiRequestWithoutCompnay.mockResolvedValue({ data: { data: { _id: 'user-1' } } });
        await saveSingleKeyShortcuts('user-1', false);
        expect(shortcutPrefs.singleKeys).toBe(false);
        expect(apiRequestWithoutCompnay).toHaveBeenCalledWith('put', env.USER_UPATE, expect.objectContaining({
            userId: 'user-1',
            updateObject: { $set: { 'accessibilityPreferences.singleKeyShortcuts': false } }
        }));
    });

    it('puts the switch back when the save fails', async () => {
        apiRequestWithoutCompnay.mockRejectedValue(new Error('offline'));
        await expect(saveSingleKeyShortcuts('user-1', false)).rejects.toThrow('offline');
        expect(shortcutPrefs.singleKeys).toBe(true);
    });
});
