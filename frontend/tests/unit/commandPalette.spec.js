import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';

const { apiRequest, router, perms, toast } = vi.hoisted(() => ({
    apiRequest: vi.fn(),
    router: {
        push: vi.fn(() => Promise.resolve()),
        resolve: vi.fn((loc) => ({ href: `#${typeof loc === 'string' ? loc : `/named/${loc.name}`}` })),
        hasRoute: vi.fn(() => true)
    },
    perms: { 'task.advance_search': true },
    toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }
}));

vi.mock('@/services', () => ({ apiRequest, useAuth: () => ({ logOut: vi.fn() }) }));
vi.mock('vue-router', () => ({ useRouter: () => router, useRoute: () => ({ params: {}, query: {} }) }));
vi.mock('vue-toast-notification', () => ({ useToast: () => toast }));
vi.mock('@/components/organisms/Shell/shellState', () => ({ shellState: { theme: 'light' }, toggleTheme: vi.fn() }));
vi.mock('@/composable', () => ({
    useCustomComposable: () => ({ debounce: (fn) => fn, checkPermission: (key) => (perms[key] === undefined ? true : perms[key]) })
}));

import CommandPalette from '@/components/molecules/AdvanceSearch/CommandPalette.vue';
import { isMacPlatform, isPaletteShortcut } from '@/components/molecules/AdvanceSearch/paletteKeys';
import { commandLeads, relativeAge, taskLocation } from '@/components/molecules/AdvanceSearch/paletteRows';
import { closeQuickCreate, quickCreate } from '@/components/organisms/QuickCreateTask/quickCreateTask';

const DAY = 24 * 60 * 60 * 1000;
const twoDaysAgo = new Date(Date.now() - 2 * DAY - 60 * 1000).toISOString();
const ok = (data) => Promise.resolve({ data: { status: true, data } });

const TASK = {
    _id: 't1', TaskName: 'Budget plan', TaskKey: 'AH-1', ProjectID: 'p1', sprintId: 's1', folderObjId: '',
    sprintName: 'Sprint 4', folderName: '', updatedAt: twoDaysAgo, status: { text: 'Open', color: '#ccc' }
};
const serve = () => apiRequest.mockImplementation((type, url) => {
    if (type === 'post' && url === '/api/v2/search') {
        return ok({
            tasks: [TASK],
            projects: [{ _id: 'p1', ProjectName: 'Budget ops', sprintId: 's1', folderId: null, updatedAt: twoDaysAgo }],
            pages: [{ _id: 'd1', title: 'Budget wiki', ProjectID: 'p1', updatedAt: twoDaysAgo }],
            comments: []
        });
    }
    if (type === 'get' && url === '/api/v2/recent-visits') {
        return ok([{ visitedAt: twoDaysAgo, task: { ...TASK, _id: 't9', TaskName: 'Recently seen', TaskKey: 'AH-9', sprintArray: { name: 'Sprint 2' } } }]);
    }
    return ok([]);
});

const store = () => createStore({
    modules: {
        users: { namespaced: true, getters: { users: () => [{ _id: 'u1', Employee_Name: 'Budget Bob', Employee_Email: 'bob@example.com' }] } },
        projectData: { namespaced: true, getters: { projects: () => ({ data: [{ _id: 'p1', ProjectName: 'Budget ops' }] }) } }
    }
});

const mounted = [];
const mountPalette = async () => {
    const wrapper = mount(CommandPalette, {
        props: { open: true },
        attachTo: document.body,
        global: { plugins: [store()], stubs: { ShellIcon: true, teleport: true } }
    });
    mounted.push(wrapper);
    await flushPromises();
    return wrapper;
};
const typeQuery = async (wrapper, value = 'budget') => {
    await wrapper.find('input').setValue(value);
    await flushPromises();
};
const options = (wrapper) => wrapper.findAll('[role="option"]');
const kinds = (wrapper) => options(wrapper).map((o) => o.attributes('data-kind'));
const key = (wrapper, init) => wrapper.find('input').trigger('keydown', init);
const activeOption = (wrapper) => wrapper.find(`#${wrapper.find('input').attributes('aria-activedescendant')}`);

beforeEach(() => {
    apiRequest.mockReset();
    serve();
    Object.assign(perms, { 'task.advance_search': true });
    router.push.mockClear();
    window.open = vi.fn();
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn(() => Promise.resolve()) }, configurable: true });
});

afterEach(() => {
    mounted.splice(0).forEach((w) => w.unmount());
});

describe('the palette shortcut', () => {
    const input = () => { const el = document.createElement('input'); el.type = 'text'; return el; };
    const editor = () => { const el = document.createElement('div'); el.setAttribute('contenteditable', 'true'); document.body.appendChild(el); const inner = document.createElement('p'); el.appendChild(inner); return inner; };
    const ev = (init = {}, target = document.body) => ({ key: 'k', metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, defaultPrevented: false, isComposing: false, target, ...init });

    it('opens on Cmd+K on macOS and on Ctrl+K elsewhere', () => {
        expect(isPaletteShortcut(ev({ metaKey: true }), { mac: true })).toBe(true);
        expect(isPaletteShortcut(ev({ ctrlKey: true }), { mac: false })).toBe(true);
        expect(isPaletteShortcut(ev({ key: 'K', ctrlKey: true }), { mac: false })).toBe(true);
    });

    it('takes the other modifier too when focus is not in a text field', () => {
        expect(isPaletteShortcut(ev({ ctrlKey: true }), { mac: true })).toBe(true);
        expect(isPaletteShortcut(ev({ metaKey: true }), { mac: false })).toBe(true);
    });

    it('leaves Ctrl+K to a text field on macOS, where it deletes to the end of the line', () => {
        expect(isPaletteShortcut(ev({ ctrlKey: true }, input()), { mac: true })).toBe(false);
        expect(isPaletteShortcut(ev({ metaKey: true }, input()), { mac: true })).toBe(true);
    });

    it('leaves Meta+K to a text field outside macOS and opens on Ctrl+K there', () => {
        expect(isPaletteShortcut(ev({ metaKey: true }, document.createElement('textarea')), { mac: false })).toBe(false);
        expect(isPaletteShortcut(ev({ ctrlKey: true }, document.createElement('textarea')), { mac: false })).toBe(true);
    });

    it('never takes the shortcut from a rich-text editor, where it inserts a link', () => {
        expect(isPaletteShortcut(ev({ metaKey: true }, editor()), { mac: true })).toBe(false);
        expect(isPaletteShortcut(ev({ ctrlKey: true }, editor()), { mac: false })).toBe(false);
    });

    it('ignores Shift, Alt, both modifiers, other keys, IME composition and a key already handled', () => {
        expect(isPaletteShortcut(ev({ metaKey: true, shiftKey: true }), { mac: true })).toBe(false);
        expect(isPaletteShortcut(ev({ ctrlKey: true, altKey: true }), { mac: false })).toBe(false);
        expect(isPaletteShortcut(ev({ ctrlKey: true, metaKey: true }), { mac: false })).toBe(false);
        expect(isPaletteShortcut(ev({ key: 'j', ctrlKey: true }), { mac: false })).toBe(false);
        expect(isPaletteShortcut(ev({}), { mac: false })).toBe(false);
        expect(isPaletteShortcut(ev({ ctrlKey: true, isComposing: true }), { mac: false })).toBe(false);
        expect(isPaletteShortcut(ev({ ctrlKey: true, defaultPrevented: true }), { mac: false })).toBe(false);
    });

    it('recognises macOS and iOS from the platform', () => {
        expect(isMacPlatform({ platform: 'MacIntel' })).toBe(true);
        expect(isMacPlatform({ platform: 'iPhone' })).toBe(true);
        expect(isMacPlatform({ userAgentData: { platform: 'macOS' } })).toBe(true);
        expect(isMacPlatform({ platform: 'Win32' })).toBe(false);
        expect(isMacPlatform({ platform: 'Linux x86_64' })).toBe(false);
        expect(isMacPlatform(undefined)).toBe(false);
    });
});

describe('result location and age', () => {
    const t = (k, p) => (p ? `${k}:${p.n}` : k);
    const now = Date.parse('2026-09-24T12:00:00Z');

    it('says how long ago a row changed', () => {
        expect(relativeAge('2026-09-24T11:59:40Z', t, now)).toBe('Palette.age_now');
        expect(relativeAge('2026-09-24T11:15:00Z', t, now)).toBe('Palette.age_minutes:45');
        expect(relativeAge('2026-09-24T07:00:00Z', t, now)).toBe('Palette.age_hours:5');
        expect(relativeAge('2026-09-22T11:00:00Z', t, now)).toBe('Palette.age_days:2');
        expect(relativeAge('2026-06-20T12:00:00Z', t, now)).toBe('Palette.age_months:3');
        expect(relativeAge('2024-09-01T12:00:00Z', t, now)).toBe('Palette.age_years:2');
        expect(relativeAge('', t, now)).toBe('');
        expect(relativeAge('not a date', t, now)).toBe('');
    });

    it('places a task in its project, folder and sprint', () => {
        expect(taskLocation({ sprintName: 'Sprint 4', folderName: 'Q3' }, 'Budget ops')).toBe('Budget ops / Q3 / Sprint 4');
        expect(taskLocation({ sprintArray: { name: 'Sprint 2' } }, 'Budget ops')).toBe('Budget ops / Sprint 2');
        expect(taskLocation({}, '')).toBe('');
    });
});

describe('CommandPalette', () => {
    it('is a labelled modal dialog whose combobox drives a listbox of options', async () => {
        const wrapper = await mountPalette();
        await typeQuery(wrapper);
        const dialog = wrapper.find('[role="dialog"]');
        expect(dialog.attributes('aria-modal')).toBe('true');
        const label = wrapper.find(`#${dialog.attributes('aria-labelledby')}`);
        expect(label.exists()).toBe(true);
        expect(label.text()).toBe('Palette.title');
        const input = wrapper.find('input');
        expect(input.attributes('role')).toBe('combobox');
        expect(input.attributes('aria-label')).toBe('Palette.input_label');
        const listbox = wrapper.find(`#${input.attributes('aria-controls')}`);
        expect(listbox.attributes('role')).toBe('listbox');
        expect(listbox.findAll('[role="option"]').length).toBeGreaterThan(0);
        expect(listbox.find('button').exists()).toBe(false);
    });

    it('shows each record with its location and age', async () => {
        const wrapper = await mountPalette();
        await typeQuery(wrapper);
        const task = options(wrapper).find((o) => o.attributes('data-kind') === 'task');
        expect(task.text()).toContain('Budget plan');
        expect(task.text()).toContain('Budget ops / Sprint 4');
        expect(task.text()).toContain('Palette.age_days');
        const doc = options(wrapper).find((o) => o.attributes('data-kind') === 'page');
        expect(doc.text()).toContain('Budget ops');
        expect(doc.text()).toContain('Palette.age_days');
    });

    it('filters the results by type with the chips', async () => {
        const wrapper = await mountPalette();
        await typeQuery(wrapper);
        expect(kinds(wrapper)).toEqual(expect.arrayContaining(['task', 'project', 'page', 'person']));

        const chip = (name) => wrapper.findAll('.pal__chip').find((c) => c.text() === `Palette.chip_${name}`);
        await chip('tasks').trigger('click');
        expect(chip('tasks').attributes('aria-pressed')).toBe('true');
        expect(chip('all').attributes('aria-pressed')).toBe('false');
        expect(kinds(wrapper).filter((k) => k !== 'ask')).toEqual(['task']);

        await chip('docs').trigger('click');
        expect(kinds(wrapper).filter((k) => k !== 'ask')).toEqual(['page']);

        await chip('people').trigger('click');
        expect(kinds(wrapper).filter((k) => k !== 'ask')).toEqual(['person']);

        await chip('projects').trigger('click');
        expect(kinds(wrapper).filter((k) => k !== 'ask')).toEqual(['project']);
    });

    it('moves with the arrows and opens the active row with Enter', async () => {
        const wrapper = await mountPalette();
        await typeQuery(wrapper);
        const ids = options(wrapper).map((o) => o.attributes('id'));
        // The teleport stub re-renders its children, so the field is looked up again after each key.
        const activeId = () => wrapper.find('input').attributes('aria-activedescendant');
        expect(activeId()).toBe(ids[0]);
        expect(options(wrapper)[0].attributes('aria-selected')).toBe('true');

        await key(wrapper, { key: 'ArrowDown' });
        expect(activeId()).toBe(ids[1]);
        await key(wrapper, { key: 'ArrowUp' });
        await key(wrapper, { key: 'ArrowUp' });
        expect(activeId()).toBe(ids[0]);

        expect(activeOption(wrapper).attributes('data-kind')).toBe('task');
        await key(wrapper, { key: 'Enter' });
        expect(router.push).toHaveBeenCalledWith('/company-1/project/p1/s/s1/t1');
        expect(wrapper.emitted('close')).toBeTruthy();
    });

    it('opens the active row in a new tab with Cmd or Ctrl+Enter', async () => {
        const wrapper = await mountPalette();
        await typeQuery(wrapper);
        await key(wrapper, { key: 'Enter', metaKey: true });
        await key(wrapper, { key: 'Enter', ctrlKey: true });
        expect(window.open).toHaveBeenCalledTimes(2);
        const [url, target, features] = window.open.mock.calls[0];
        expect(url).toContain('/company-1/project/p1/s/s1/t1');
        expect(target).toBe('_blank');
        expect(features).toContain('noopener');
        expect(router.push).not.toHaveBeenCalled();
    });

    it('moves Tab from the search field to the active row\'s actions', async () => {
        const wrapper = await mountPalette();
        await typeQuery(wrapper);
        wrapper.find('input').element.focus();
        await key(wrapper, { key: 'Tab' });
        const toolbar = wrapper.find('[role="toolbar"]');
        expect(toolbar.exists()).toBe(true);
        expect(toolbar.attributes('aria-label')).toBe('Palette.actions_for');
        expect(document.activeElement).toBe(toolbar.find('button').element);
        expect(document.activeElement.getAttribute('aria-label')).toBe('Palette.action_open');
    });

    it('offers open, new tab, copy link and Ask AI on a row', async () => {
        const wrapper = await mountPalette();
        await typeQuery(wrapper);
        const action = (name) => wrapper.find(`[role="toolbar"] button[aria-label="Palette.action_${name}"]`);

        await action('copy').trigger('click');
        await flushPromises();
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('/company-1/project/p1/s/s1/t1'));
        expect(toast.success).toHaveBeenCalledWith('Palette.link_copied', expect.anything());

        await action('new_tab').trigger('click');
        expect(window.open).toHaveBeenCalledWith(expect.stringContaining('/company-1/project/p1/s/s1/t1'), '_blank', expect.stringContaining('noopener'));

        await action('ask').trigger('click');
        expect(router.push).toHaveBeenCalledWith({ name: 'AiAsk', params: { cid: 'company-1' }, query: { q: 'budget' } });

        router.push.mockClear();
        const again = await mountPalette();
        await typeQuery(again);
        await again.find('[role="toolbar"] button[aria-label="Palette.action_open"]').trigger('click');
        expect(router.push).toHaveBeenCalledWith('/company-1/project/p1/s/s1/t1');
    });

    it('closes on Escape', async () => {
        const wrapper = await mountPalette();
        await wrapper.find('[role="dialog"]').trigger('keydown', { key: 'Escape' });
        expect(wrapper.emitted('close')).toBeTruthy();
    });

    it('lists recently opened tasks, with their location, before anything is typed', async () => {
        const wrapper = await mountPalette();
        expect(apiRequest).toHaveBeenCalledWith('get', '/api/v2/recent-visits');
        const recent = options(wrapper).find((o) => o.text().includes('Recently seen'));
        expect(recent).toBeDefined();
        expect(recent.attributes('data-kind')).toBe('task');
        expect(recent.text()).toContain('Budget ops / Sprint 2');
    });

    it('keeps navigation open to everyone but runs the record search only with the advanced-search permission', async () => {
        perms['task.advance_search'] = null;
        const wrapper = await mountPalette();
        await typeQuery(wrapper, 'home');
        expect(apiRequest).not.toHaveBeenCalledWith('post', '/api/v2/search', expect.anything());
        expect(kinds(wrapper)).toContain('nav');
    });

    it('ranks a matching command above the records and Ask AI, so "new task" + Enter opens the create dialog', async () => {
        closeQuickCreate();
        const wrapper = await mountPalette();
        await typeQuery(wrapper, 'new task');
        const order = kinds(wrapper);
        expect(order[0]).toBe('command');
        expect(order.indexOf('command')).toBeLessThan(order.indexOf('ask'));
        expect(activeOption(wrapper).attributes('data-kind')).toBe('command');

        await key(wrapper, { key: 'Enter' });
        expect(quickCreate.open).toBe(true);
        expect(router.push).not.toHaveBeenCalled();
        expect(wrapper.emitted('close')).toBeTruthy();
        closeQuickCreate();
    });

    it('keeps Ask AI below a command that only partly matches, and records first', async () => {
        const wrapper = await mountPalette();
        await typeQuery(wrapper, 'budget');
        expect(kinds(wrapper)[0]).toBe('task');
    });
});

describe('command ranking', () => {
    it('leads with commands when the query starts a command label or alias', () => {
        expect(commandLeads('new task', ['New task', 'new task'])).toBe(true);
        expect(commandLeads('New', ['New task'])).toBe(true);
        expect(commandLeads('  new t ', ['New task'])).toBe(true);
    });

    it('does not lead for a query that is too short or only appears inside a label', () => {
        expect(commandLeads('n', ['New task'])).toBe(false);
        expect(commandLeads('task', ['New task'])).toBe(false);
        expect(commandLeads('budget', ['New task', 'New project'])).toBe(false);
        expect(commandLeads('', ['New task'])).toBe(false);
    });
});
