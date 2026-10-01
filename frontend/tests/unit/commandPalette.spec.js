import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import { reactive } from 'vue';

const { apiRequest, router, perms, toast, routeRef } = vi.hoisted(() => ({
    routeRef: { current: null },
    apiRequest: vi.fn(),
    router: {
        push: vi.fn(() => Promise.resolve()),
        replace: vi.fn(() => Promise.resolve()),
        resolve: vi.fn((loc) => ({ href: `#${typeof loc === 'string' ? loc : `/named/${loc.name}`}` })),
        hasRoute: vi.fn(() => true)
    },
    perms: { 'task.advance_search': true },
    toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }
}));

vi.mock('@/services', () => ({ apiRequest, useAuth: () => ({ logOut: vi.fn() }) }));
vi.mock('vue-router', () => ({ useRouter: () => router, useRoute: () => routeRef.current }));
vi.mock('vue-toast-notification', () => ({ useToast: () => toast }));
vi.mock('@/components/organisms/Shell/shellState', () => ({ shellState: { theme: 'light' }, toggleTheme: vi.fn() }));
vi.mock('@/composable', () => ({
    useCustomComposable: () => ({ debounce: (fn) => fn, checkPermission: (key) => (perms[key] === undefined ? true : perms[key]) })
}));

import CommandPalette from '@/components/molecules/AdvanceSearch/CommandPalette.vue';
import { isMacPlatform, isPaletteShortcut } from '@/components/molecules/AdvanceSearch/paletteKeys';
import { commandLeads, relativeAge, taskLocation } from '@/components/molecules/AdvanceSearch/paletteRows';
import { closeQuickCreate, quickCreate } from '@/components/organisms/QuickCreateTask/quickCreateTask';
import { bindRouter, closeTask, isExpanded, overlayState, registerTaskSequence } from '@/components/organisms/TaskDetailOverlay/useTaskOverlay';
import { taskNavAttrs } from '@/components/organisms/TaskDetailOverlay/taskNavigation';
import { applyAiAvailability, resetAiAvailability } from '@/composable/aiAvailability';

const DAY = 24 * 60 * 60 * 1000;
const twoDaysAgo = new Date(Date.now() - 2 * DAY - 60 * 1000).toISOString();
const ok = (data) => Promise.resolve({ data: { status: true, data } });
const RECENTS_URL = '/api/v2/recent-visits?types=task,project,sprint,doc';

const TASK = {
    _id: 't1', TaskName: 'Budget plan', TaskKey: 'AH-1', ProjectID: 'p1', sprintId: 's1', folderObjId: '',
    sprintName: 'Sprint 4', folderName: '', updatedAt: twoDaysAgo, status: { text: 'Open', color: '#ccc' }
};
const respond = (type, url) => {
    if (type === 'post' && url === '/api/v2/search') {
        return ok({
            tasks: [TASK],
            projects: [{ _id: 'p1', ProjectName: 'Budget ops', sprintId: 's1', folderId: null, updatedAt: twoDaysAgo }],
            pages: [{ _id: 'd1', title: 'Budget wiki', ProjectID: 'p1', updatedAt: twoDaysAgo }],
            comments: []
        });
    }
    if (type === 'get' && url.startsWith('/api/v2/recent-visits')) {
        return ok([{ visitedAt: twoDaysAgo, task: { ...TASK, _id: 't9', TaskName: 'Recently seen', TaskKey: 'AH-9', sprintArray: { name: 'Sprint 2' } } }]);
    }
    return ok([]);
};
const serve = () => apiRequest.mockImplementation(respond);

const store = ({ roleType = 3, projects = [{ _id: 'p1', ProjectName: 'Budget ops' }], teams = [] } = {}) => createStore({
    modules: {
        users: { namespaced: true, getters: { users: () => [{ _id: 'u1', Employee_Name: 'Budget Bob', Employee_Email: 'bob@example.com' }] } },
        projectData: { namespaced: true, getters: { projects: () => ({ data: projects }), allProjects: () => ({ data: projects }) } },
        settings: { namespaced: true, getters: { companyUserDetail: () => ({ roleType }), teams: () => teams } }
    }
});

const mounted = [];
const mountPalette = async (session) => {
    const wrapper = mount(CommandPalette, {
        props: { open: true },
        attachTo: document.body,
        global: { plugins: [store(session)], stubs: { ShellIcon: true, teleport: true } }
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
const currentRoute = { name: 'inbox', path: '/company-1/inbox', params: { cid: 'company-1' }, query: {} };
const expectTaskPanel = (taskId, extra = {}) => {
    expect(overlayState.open).toBe(true);
    expect(overlayState.current).toMatchObject({ companyId: 'company-1', projectId: 'p1', sprintId: 's1', folderId: '', taskId, ...extra });
    expect(isExpanded.value).toBe(false);
    expect(router.push).not.toHaveBeenCalled();
    expect(router.replace).toHaveBeenCalledWith({ query: { task: taskId } });
};

beforeEach(() => {
    routeRef.current = reactive({ name: 'inbox', path: '/company-1/inbox', params: { cid: 'company-1' }, query: {} });
    apiRequest.mockReset();
    serve();
    Object.assign(perms, { 'task.advance_search': true });
    router.push.mockClear();
    router.replace.mockClear();
    closeTask({ keepRoute: true });
    bindRouter(router, currentRoute);
    window.open = vi.fn();
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn(() => Promise.resolve()) }, configurable: true });
});

afterEach(() => {
    mounted.splice(0).forEach((w) => w.unmount());
    resetAiAvailability();
    sessionStorage.clear();
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
        expectTaskPanel('t1');
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
        expectTaskPanel('t1');
    });

    it('closes on Escape', async () => {
        const wrapper = await mountPalette();
        await wrapper.find('[role="dialog"]').trigger('keydown', { key: 'Escape' });
        expect(wrapper.emitted('close')).toBeTruthy();
    });

    it('lists recently opened tasks, with their location, before anything is typed', async () => {
        const wrapper = await mountPalette();
        expect(apiRequest).toHaveBeenCalledWith('get', RECENTS_URL);
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

describe('opening a task from the palette', () => {
    it('opens a clicked task in the side panel over the current page', async () => {
        const wrapper = await mountPalette();
        await typeQuery(wrapper);
        await options(wrapper).find((o) => o.attributes('data-kind') === 'task').trigger('click');
        expectTaskPanel('t1');
        expect(wrapper.emitted('close')).toBeTruthy();
    });

    it('keeps the folder of a recently opened task', async () => {
        apiRequest.mockImplementation((type, url) => (url === RECENTS_URL
            ? ok([{ visitedAt: twoDaysAgo, task: { ...TASK, _id: 't9', TaskName: 'Recently seen', folderObjId: 'f1' } }])
            : ok([])));
        const wrapper = await mountPalette();
        await options(wrapper).find((o) => o.text().includes('Recently seen')).trigger('click');
        expectTaskPanel('t9', { folderId: 'f1' });
    });

    it('still copies and opens in a new tab the task\'s full page link', async () => {
        const wrapper = await mountPalette();
        await typeQuery(wrapper);
        const action = (name) => wrapper.find(`[role="toolbar"] button[aria-label="Palette.action_${name}"]`);
        await action('copy').trigger('click');
        await flushPromises();
        const fullPage = new URL('#/company-1/project/p1/s/s1/t1', window.location.href).href;
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith(fullPage);
        await action('new_tab').trigger('click');
        await key(wrapper, { key: 'Enter', metaKey: true });
        expect(window.open.mock.calls.map((c) => c[0])).toEqual([fullPage, fullPage]);
        expect(overlayState.open).toBe(false);
    });

    it('offers no previous or next through a list on screen that does not hold the task', async () => {
        const root = document.createElement('div');
        ['a1', 'a2'].forEach((id) => {
            const row = document.createElement('div');
            Object.entries(taskNavAttrs({ _id: id, ProjectID: 'p2', sprintId: 's2' })).forEach(([k, v]) => row.setAttribute(k, v));
            root.appendChild(row);
        });
        const unregister = registerTaskSequence(() => root);
        try {
            const wrapper = await mountPalette();
            await typeQuery(wrapper);
            await key(wrapper, { key: 'Enter' });
            expect(overlayState.current?.taskId).toBe('t1');
            expect(overlayState.nav).toBeNull();
        } finally {
            unregister();
        }
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

describe('the "New project" command', () => {
    const runNewProject = async (value) => {
        const wrapper = await mountPalette();
        await typeQuery(wrapper, value);
        expect(activeOption(wrapper).attributes('data-kind')).toBe('command');
        expect(activeOption(wrapper).text()).toContain('Inbox.cmd_new_project');
        await key(wrapper, { key: 'Enter' });
        return wrapper;
    };

    it('takes the text typed after the command as the project name', async () => {
        await runNewProject('new project Website relaunch');
        expect(router.push).toHaveBeenCalledWith({ name: 'Projects', params: { cid: 'company-1' }, query: { create: 'project', name: 'Website relaunch' } });
    });

    it('does not use the command\'s own words as the name', async () => {
        await runNewProject('new proj');
        expect(router.push).toHaveBeenCalledWith({ name: 'Projects', params: { cid: 'company-1' }, query: { create: 'project', name: undefined } });
    });
});

describe('the "New doc" command', () => {
    const OPEN_PROJECT = { _id: 'p1', ProjectName: 'Budget ops', isPrivateSpace: false, AssigneeUserId: [] };
    const PRIVATE_PROJECT = { _id: 'p2', ProjectName: 'Board only', isPrivateSpace: true, AssigneeUserId: ['user-9', 'tId_team-1'] };
    const projects = [OPEN_PROJECT, PRIVATE_PROJECT];
    const created = () => apiRequest.mock.calls.filter(([type, url]) => type === 'post' && url === '/api/v2/pages').map(([, , body]) => body);
    const showProject = (id) => {
        routeRef.current = reactive({ name: 'ProjectSprint', path: `/company-1/project/${id}/s1`, params: { cid: 'company-1', id, sprintId: 's1' }, query: {} });
    };
    const offered = async (session) => {
        const wrapper = await mountPalette({ projects, ...session });
        await typeQuery(wrapper, 'new doc');
        return wrapper;
    };
    const runNewDoc = async (session) => {
        const wrapper = await offered(session);
        expect(activeOption(wrapper).attributes('data-kind')).toBe('command');
        expect(activeOption(wrapper).text()).toContain('Docs.new_doc');
        await key(wrapper, { key: 'Enter' });
        await flushPromises();
        return wrapper;
    };

    beforeEach(() => {
        apiRequest.mockImplementation((type, url) => (type === 'post' && url === '/api/v2/pages' ? ok({ _id: 'd9' }) : respond(type, url)));
    });

    it('makes a workspace doc outside a project and opens it', async () => {
        const wrapper = await runNewDoc();
        expect(created()).toEqual([{ title: 'Docs.untitled' }]);
        expect(router.push).toHaveBeenCalledWith({ name: 'PageEditor', params: { cid: 'company-1', pageId: 'd9' } });
        expect(wrapper.emitted('close')).toBeTruthy();
    });

    it('makes the doc in the project the page is showing', async () => {
        showProject('p1');
        await runNewDoc();
        expect(created()).toEqual([{ title: 'Docs.untitled', projectId: 'p1' }]);
        expect(router.push).toHaveBeenCalledWith({ name: 'PageEditor', params: { cid: 'company-1', pageId: 'd9' } });
    });

    it('is not offered in a private project the person is not on', async () => {
        showProject('p2');
        const wrapper = await offered();
        expect(options(wrapper).some((option) => option.text().includes('Docs.new_doc'))).toBe(false);
    });

    it('is offered in a private project to its team and to an admin', async () => {
        showProject('p2');
        await runNewDoc({ teams: [{ _id: 'team-1', assigneeUsersArray: ['user-1'] }] });
        mounted.splice(0).forEach((w) => w.unmount());
        await runNewDoc({ roleType: 2 });
        expect(created()).toEqual([{ title: 'Docs.untitled', projectId: 'p2' }, { title: 'Docs.untitled', projectId: 'p2' }]);
    });

    it('says so, and stays put, when the server refuses', async () => {
        apiRequest.mockImplementation((type, url) => (type === 'post' && url === '/api/v2/pages'
            ? Promise.resolve({ data: { status: false, statusText: 'Project not found.' } })
            : respond(type, url)));
        await runNewDoc();
        expect(toast.error).toHaveBeenCalledWith('Project not found.', { position: 'top-right' });
        expect(router.push).not.toHaveBeenCalled();
    });
});

describe('asking AI inside the palette', () => {
    const CITED = [
        { kind: 'task', id: 't1', ref: 'AH-1', title: 'Budget plan', project: 'Budget ops', projectId: 'p1' },
        { kind: 'page', id: 'd1', ref: 'page:0000d1', title: 'Budget wiki', project: 'Budget ops', projectId: 'p1' }
    ];
    const ANSWER = { configured: true, mode: 'ask', answer: 'The budget is on track [AH-1], see [page:0000d1].', cited: CITED, sources: CITED, usage: { model: 'gpt-test', tokens: 42 } };
    const serveAsk = (reply) => {
        const signals = [];
        apiRequest.mockImplementation((type, url, body, dataType, options) => {
            if (type === 'post' && url === '/api/v1/ai/ask') { signals.push(options && options.signal); return reply(); }
            if (type === 'post' && url === '/api/v2/search') return ok({ tasks: [TASK], projects: [], pages: [], comments: [] });
            return ok([]);
        });
        return signals;
    };
    const askRow = (wrapper) => options(wrapper).find((o) => o.attributes('data-kind') === 'ask');
    const pressAsk = async (wrapper) => {
        await askRow(wrapper).trigger('mouseenter');
        await key(wrapper, { key: 'Enter' });
        await flushPromises();
    };
    const answerRegion = (wrapper) => wrapper.find('[aria-live="polite"]');
    const escape = (wrapper) => wrapper.find('[role="dialog"]').trigger('keydown', { key: 'Escape' });

    it('answers in the palette on Enter, with the model and the cited task and doc as rows', async () => {
        serveAsk(() => ok(ANSWER));
        const wrapper = await mountPalette();
        await typeQuery(wrapper, 'budget');
        await pressAsk(wrapper);

        expect(apiRequest).toHaveBeenCalledWith('post', '/api/v1/ai/ask', { question: 'budget', mode: 'ask' }, undefined, expect.objectContaining({ signal: expect.anything() }));
        expect(router.push).not.toHaveBeenCalled();
        expect(wrapper.emitted('close')).toBeFalsy();
        expect(answerRegion(wrapper).text()).toContain('The budget is on track');
        expect(answerRegion(wrapper).text()).toContain('gpt-test');

        const sources = options(wrapper).filter((o) => o.attributes('data-kind') === 'source');
        expect(sources.map((o) => o.text())).toEqual([expect.stringContaining('Budget plan'), expect.stringContaining('Budget wiki')]);
        expect(kinds(wrapper)).toContain('continue');
        expect(activeOption(wrapper).attributes('data-kind')).toBe('source');
        const cont = options(wrapper).find((o) => o.attributes('data-kind') === 'continue');
        expect(wrapper.find(`#${cont.attributes('aria-describedby')}`).text()).toContain('The budget is on track');
    });

    it('opens, copies and opens in a new tab a cited source with the usual row keys', async () => {
        serveAsk(() => ok(ANSWER));
        const wrapper = await mountPalette();
        await typeQuery(wrapper, 'budget');
        await pressAsk(wrapper);

        expect(activeOption(wrapper).attributes('data-kind')).toBe('source');
        await key(wrapper, { key: 'Tab' });
        const toolbar = wrapper.find('[role="toolbar"]');
        expect(toolbar.exists()).toBe(true);
        await toolbar.find('button[aria-label="Palette.action_copy"]').trigger('click');
        await flushPromises();
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('task=t1'));

        await key(wrapper, { key: 'ArrowDown' });
        await key(wrapper, { key: 'Enter', metaKey: true });
        expect(window.open).toHaveBeenCalledWith(expect.stringContaining('/named/PageEditor'), '_blank', expect.stringContaining('noopener'));

        await key(wrapper, { key: 'ArrowUp' });
        await key(wrapper, { key: 'Enter' });
        expect(router.push).toHaveBeenCalledWith({ query: { task: 't1' } });
        expect(wrapper.emitted('close')).toBeTruthy();
    });

    it('shows a loading state, and Esc cancels the request before a second Esc closes', async () => {
        const signals = serveAsk(() => new Promise(() => {}));
        const wrapper = await mountPalette();
        await typeQuery(wrapper, 'budget');
        await pressAsk(wrapper);

        expect(answerRegion(wrapper).attributes('aria-busy')).toBe('true');
        expect(answerRegion(wrapper).text()).toContain('Palette.ask_loading');

        await escape(wrapper);
        expect(signals[0].aborted).toBe(true);
        expect(wrapper.emitted('close')).toBeFalsy();
        expect(wrapper.find('.pal__answer').exists()).toBe(false);
        expect(kinds(wrapper)).toContain('ask');

        await escape(wrapper);
        expect(wrapper.emitted('close')).toBeTruthy();
    });

    it('drops the answer when the query changes', async () => {
        const signals = serveAsk(() => new Promise(() => {}));
        const wrapper = await mountPalette();
        await typeQuery(wrapper, 'budget');
        await pressAsk(wrapper);
        await typeQuery(wrapper, 'budget plan');
        expect(signals[0].aborted).toBe(true);
        expect(wrapper.find('.pal__answer').exists()).toBe(false);
        expect(kinds(wrapper)).toContain('task');
    });

    it('continues in Ask with the question, handing the answer over so the page does not ask again', async () => {
        serveAsk(() => ok(ANSWER));
        const wrapper = await mountPalette();
        await typeQuery(wrapper, 'budget');
        await pressAsk(wrapper);

        await options(wrapper).find((o) => o.attributes('data-kind') === 'continue').trigger('click');
        expect(router.push).toHaveBeenCalledWith({ name: 'AiAsk', params: { cid: 'company-1' }, query: { q: 'budget' } });
        const handoff = JSON.parse(sessionStorage.getItem('alianhub.ask.handoff'));
        expect(handoff).toMatchObject({ question: 'budget', answer: { answer: ANSWER.answer } });
    });

    it('explains a failed answer in words, not the server\'s raw message', async () => {
        serveAsk(() => Promise.resolve({ data: { status: false, statusText: 'TypeError: cannot read properties of undefined' } }));
        const wrapper = await mountPalette();
        await typeQuery(wrapper, 'budget');
        await pressAsk(wrapper);
        expect(answerRegion(wrapper).text()).toContain('Palette.ask_failed');
        expect(answerRegion(wrapper).text()).not.toContain('TypeError');
        expect(kinds(wrapper)).toContain('continue');
    });

    it('offers no Ask row while AI is off', async () => {
        applyAiAvailability({ state: 'off_workspace' });
        const wrapper = await mountPalette();
        await typeQuery(wrapper, 'budget');
        expect(kinds(wrapper)).not.toContain('ask');
    });
});

describe('recently opened projects, sprints and docs', () => {
    const recentTask = { visitedAt: twoDaysAgo, type: 'task', id: 't9', title: 'Recently seen', task: { ...TASK, _id: 't9', TaskName: 'Recently seen', TaskKey: 'AH-9' } };
    const recentSprint = { visitedAt: twoDaysAgo, type: 'sprint', id: 's2', title: 'Sprint 2', projectId: 'p1', projectName: 'Budget ops', route: { projectId: 'p1', sprintId: 's2', folderId: 'f1' } };
    const recentDoc = { visitedAt: twoDaysAgo, type: 'doc', id: 'd1', title: 'Budget wiki', projectId: 'p1', projectName: 'Budget ops', route: { pageId: 'd1', projectId: 'p1' } };
    const recentProject = { visitedAt: twoDaysAgo, type: 'project', id: 'p2', title: 'Launch', projectId: 'p2', projectName: 'Launch', route: { projectId: 'p2', sprintId: 's7', folderId: '' } };
    const serveRecents = (items) => apiRequest.mockImplementation((type, url) => (url === RECENTS_URL ? ok(items) : ok([])));
    const row = (wrapper, text) => options(wrapper).find((o) => o.text().includes(text));
    const iconOf = (option) => option.find('shell-icon-stub').attributes('name');

    it('lists them with the tasks, newest first, each with its own icon and place', async () => {
        serveRecents([recentSprint, recentDoc, recentProject, recentTask]);
        const wrapper = await mountPalette();
        expect(apiRequest).toHaveBeenCalledWith('get', RECENTS_URL);
        expect(kinds(wrapper).slice(0, 4)).toEqual(['sprint', 'page', 'project', 'task']);
        expect(wrapper.find('.pal__group').text()).toBe('Palette.group_recent_opened');
        expect(iconOf(row(wrapper, 'Sprint 2'))).toBe('layout');
        expect(row(wrapper, 'Sprint 2').text()).toContain('Palette.sprint_in');
        expect(iconOf(row(wrapper, 'Budget wiki'))).toBe('docs');
        expect(row(wrapper, 'Budget wiki').text()).toContain('Budget ops');
        expect(iconOf(row(wrapper, 'Launch'))).toBe('projects');
    });

    it('opens a recent sprint, project and doc where they live', async () => {
        serveRecents([recentSprint, recentDoc, recentProject]);
        const wrapper = await mountPalette();
        await row(wrapper, 'Sprint 2').trigger('click');
        expect(router.push).toHaveBeenLastCalledWith(expect.stringContaining('/project/p1/fs/f1/s2?tab=ProjectListView'));
        await row(wrapper, 'Launch').trigger('click');
        expect(router.push).toHaveBeenLastCalledWith(expect.stringContaining('/project/p2/s/s7?tab=ProjectListView'));
        await row(wrapper, 'Budget wiki').trigger('click');
        expect(router.push).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'Pages', query: { page: 'd1' } }));
    });

    it('folds a recent project into a recent sprint of the same project', async () => {
        serveRecents([recentSprint, { ...recentProject, id: 'p1', title: 'Budget ops', projectId: 'p1' }]);
        const wrapper = await mountPalette();
        expect(kinds(wrapper).filter((k) => k === 'sprint' || k === 'project')).toEqual(['sprint']);
    });

    it('keeps sprints under the Projects chip and docs under Docs', async () => {
        serveRecents([recentSprint, recentDoc, recentProject, recentTask]);
        const wrapper = await mountPalette();
        const chip = (name) => wrapper.findAll('.pal__chip').find((c) => c.text() === `Palette.chip_${name}`);
        await chip('projects').trigger('click');
        expect(kinds(wrapper).filter((k) => k !== 'command')).toEqual(['sprint', 'project']);
        await chip('docs').trigger('click');
        expect(kinds(wrapper).filter((k) => k !== 'command')).toEqual(['page']);
    });
});

describe('comments in the search results', () => {
    const COMMENT = { _id: 'c1', message: 'Budget is approved', taskId: 't1', projectId: 'p1', sprintId: 's1', folderObjId: '', taskKey: 'AH-1', taskName: 'Budget plan' };

    it('finds comments, as the retired search did, and opens their task', async () => {
        apiRequest.mockImplementation((type, url) => (type === 'post' && url === '/api/v2/search'
            ? ok({ tasks: [], projects: [], pages: [], comments: [COMMENT] })
            : ok([])));
        const wrapper = await mountPalette();
        await typeQuery(wrapper);
        const comment = options(wrapper).find((o) => o.attributes('data-kind') === 'comment');
        expect(comment.text()).toContain('Budget is approved');
        expect(comment.text()).toContain('Palette.comment_on');
        await comment.trigger('click');
        expectTaskPanel('t1');
    });
});

describe('closing on navigation', () => {
    it('closes when the page changes underneath it', async () => {
        const wrapper = await mountPalette();
        routeRef.current.path = '/company-1/pages';
        await flushPromises();
        expect(wrapper.emitted('close')).toBeTruthy();
    });

    it('stays open when only the query changes, as when a side panel opens', async () => {
        const wrapper = await mountPalette();
        routeRef.current.query = { task: 't1' };
        await flushPromises();
        expect(wrapper.emitted('close')).toBeFalsy();
    });

    it('says nothing when it is already closed', async () => {
        const wrapper = mount(CommandPalette, { props: { open: false }, global: { plugins: [store()], stubs: { ShellIcon: true, teleport: true } } });
        mounted.push(wrapper);
        routeRef.current.path = '/company-1/pages';
        await flushPromises();
        expect(wrapper.emitted('close')).toBeFalsy();
    });
});
