import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DOMWrapper, flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import { nextTick } from 'vue';

const { apiRequest, create, openTask, route, perms, ensure } = vi.hoisted(() => ({
    apiRequest: vi.fn(),
    create: vi.fn(),
    openTask: vi.fn(),
    route: { name: 'Home', params: {}, query: {} },
    perms: {},
    ensure: vi.fn()
}));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('vue-router', () => ({ useRoute: () => route, useRouter: () => ({ push: vi.fn(() => Promise.resolve()) }) }));
vi.mock('@/utils/TaskOperations', () => ({ default: { create } }));
vi.mock('@/components/organisms/TaskDetailOverlay/useTaskOverlay', () => ({ openTask }));
vi.mock('@/components/molecules/Home/usePersonalList', () => ({ usePersonalList: () => ({ ensure }) }));
vi.mock('@/composable/commonFunction', () => ({ taskPlanPermission: () => ({ checkTaskPerSprintPermisssion: () => Promise.resolve(true) }) }));
vi.mock('@/composable', () => ({
    useCustomComposable: () => ({
        checkPermission: (path, globalPermission = true, options = {}) => {
            const rules = options.gettersVal ? options.gettersVal['settings/projectRules'] : null;
            const key = `${globalPermission === false ? 'project' : 'global'}:${path}`;
            if (rules && rules.denyAll) return null;
            return perms[key] === undefined ? true : perms[key];
        }
    }),
    useGetterFunctions: () => ({ getUser: (id) => ({ id, _id: id, Employee_Name: id === 'user-1' ? 'Me Myself' : `User ${id}` }) })
}));

import {
    canCreateTasksIn,
    closeQuickCreate,
    creatableProjects,
    isCreateTaskShortcut,
    listsOf,
    openQuickCreate,
    pickDefaultProject,
    pickDefaultSprint,
    quickCreate,
    readDraft,
    readLastProject,
    rememberLastProject,
    submitIntent
} from '@/components/organisms/QuickCreateTask/quickCreateTask';
import QuickCreateTask from '@/components/organisms/QuickCreateTask/QuickCreateTask.vue';

const STATUSES = [
    { name: 'To Do', key: 1, value: 'to_do', type: 'default_active' },
    { name: 'Doing', key: 2, value: 'doing', type: 'active' },
    { name: 'Done', key: 3, value: 'done', type: 'close' }
];
const TYPES = [{ key: 1, value: 'task', name: 'Task' }];
const project = (id, extra = {}) => ({
    _id: id, ProjectName: `Project ${id}`, CompanyId: 'company-1', ProjectCode: id.toUpperCase(), lastTaskId: 4,
    taskStatusData: STATUSES, taskTypeCounts: TYPES, AssigneeUserId: ['user-1', 'user-2'], isGlobalPermission: true, statusType: 'active', ...extra
});
const PERSONAL = project('personal', { ProjectName: 'Personal', isPersonal: true, AssigneeUserId: ['user-1'] });
const ALPHA = project('alpha', { apps: [{ key: 'Priority' }] });
const BETA = project('beta', { sprintsObj: { 'beta-s2': { _id: 'beta-s2', id: 'beta-s2', name: 'beta second', tasks: 2, projectId: 'beta' } } });
const CLOSED = project('closed', { statusType: 'close' });
const SPECIFIC = project('specific', { isGlobalPermission: false });

describe('the c shortcut', () => {
    const ev = (init = {}, target = document.body) => ({ key: 'c', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, repeat: false, isComposing: false, defaultPrevented: false, target, ...init });
    const el = (tag, attrs = {}) => { const e = document.createElement(tag); Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v)); document.body.appendChild(e); return e; };

    it('opens on a bare c outside text fields', () => {
        expect(isCreateTaskShortcut(ev())).toBe(true);
        expect(isCreateTaskShortcut(ev({}, el('button')))).toBe(true);
        expect(isCreateTaskShortcut(ev({}, el('input', { type: 'checkbox' })))).toBe(true);
    });

    it('never fires with a modifier, on repeat, while composing or once handled', () => {
        ['metaKey', 'ctrlKey', 'altKey', 'shiftKey', 'repeat', 'isComposing', 'defaultPrevented'].forEach((flag) => {
            expect(isCreateTaskShortcut(ev({ [flag]: true }))).toBe(false);
        });
        expect(isCreateTaskShortcut(ev({ key: 'C' }))).toBe(false);
        expect(isCreateTaskShortcut(ev({ key: 'x' }))).toBe(false);
    });

    it('leaves text fields, selects and editors alone', () => {
        expect(isCreateTaskShortcut(ev({}, el('input', { type: 'text' })))).toBe(false);
        expect(isCreateTaskShortcut(ev({}, el('input')))).toBe(false);
        expect(isCreateTaskShortcut(ev({}, el('textarea')))).toBe(false);
        expect(isCreateTaskShortcut(ev({}, el('select')))).toBe(false);
        const editor = el('div', { contenteditable: 'true' });
        const inner = document.createElement('p');
        editor.appendChild(inner);
        expect(isCreateTaskShortcut(ev({}, inner))).toBe(false);
    });

    it('does nothing while a dialog is open', () => {
        expect(isCreateTaskShortcut(ev(), { dialogOpen: true })).toBe(false);
    });
});

describe('Enter in the create dialog', () => {
    const key = (init) => ({ key: 'Enter', metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, isComposing: false, ...init });

    it('creates on Enter, creates and opens on Cmd or Ctrl+Enter, and keeps going on Shift+Enter', () => {
        expect(submitIntent(key())).toBe('create');
        expect(submitIntent(key({ metaKey: true }))).toBe('open');
        expect(submitIntent(key({ ctrlKey: true }))).toBe('open');
        expect(submitIntent(key({ shiftKey: true }))).toBe('another');
    });

    it('keeps going on a plain Enter when "Create another" is on, and ignores other keys', () => {
        expect(submitIntent(key(), { keepOpen: true })).toBe('another');
        expect(submitIntent(key({ metaKey: true }), { keepOpen: true })).toBe('open');
        expect(submitIntent(key({ key: 'a' }))).toBe(null);
        expect(submitIntent(key({ isComposing: true }))).toBe(null);
    });
});

describe('the default project', () => {
    const projects = [PERSONAL, ALPHA, BETA];

    it('prefers the project asked for, then the one on screen, then the last used', () => {
        expect(pickDefaultProject({ requestedId: 'beta', routeProjectId: 'alpha', lastUsedId: 'alpha', projects })).toBe('beta');
        expect(pickDefaultProject({ routeProjectId: 'alpha', lastUsedId: 'beta', projects })).toBe('alpha');
        expect(pickDefaultProject({ routeProjectId: '', lastUsedId: 'beta', projects })).toBe('beta');
    });

    it('falls back to the personal list when the others are unknown or not allowed', () => {
        expect(pickDefaultProject({ routeProjectId: 'closed', lastUsedId: 'gone', projects })).toBe('personal');
        expect(pickDefaultProject({ projects: [ALPHA] })).toBe('alpha');
        expect(pickDefaultProject({ projects: [] })).toBe('');
    });

    it('remembers the last project per company and user', () => {
        const store = new Map();
        const storage = { getItem: (k) => store.get(k) || null, setItem: (k, v) => store.set(k, v) };
        rememberLastProject('company-1', 'user-1', 'beta', storage);
        expect(readLastProject('company-1', 'user-1', storage)).toBe('beta');
        expect(readLastProject('company-1', 'user-2', storage)).toBe('');
        expect(readLastProject('company-2', 'user-1', storage)).toBe('');
    });

    it('opens the list on screen when it belongs to the project, else the first list', () => {
        const lists = [{ id: 's1' }, { id: 's2' }];
        expect(pickDefaultSprint(lists, 's2')).toBe('s2');
        expect(pickDefaultSprint(lists, 'other')).toBe('s1');
        expect(pickDefaultSprint([], 's1')).toBe('');
    });

    it('drops deleted lists and lists in deleted folders', () => {
        const lists = listsOf(
            [{ _id: 'a', name: 'A' }, { _id: 'b', name: 'B', deletedStatusKey: 1 }, { _id: 'c', name: 'C', folderId: 'f1' }, { _id: 'd', name: 'D', folderId: 'f2' }],
            [{ _id: 'f1', name: 'Folder' }, { _id: 'f2', name: 'Gone', deletedStatusKey: 1 }]
        );
        expect(lists.map((l) => l.id)).toEqual(['a', 'c']);
        expect(lists[1].folderName).toBe('Folder');
    });
});

describe('the projects offered', () => {
    const allow = (map = {}) => (path, p) => {
        const value = map[`${p._id}:${path}`];
        return value === undefined ? true : value;
    };

    it('applies the in-project rule: task create and task list, on an open, ready project', () => {
        expect(canCreateTasksIn(ALPHA, allow())).toBe(true);
        expect(canCreateTasksIn(ALPHA, allow({ 'alpha:task.task_create': null }))).toBe(false);
        expect(canCreateTasksIn(ALPHA, allow({ 'alpha:task.task_list': false }))).toBe(false);
        expect(canCreateTasksIn(CLOSED, allow())).toBe(false);
        expect(canCreateTasksIn(project('deleted', { deletedStatusKey: 1 }), allow())).toBe(false);
        expect(canCreateTasksIn(project('bare', { taskTypeCounts: [] }), allow())).toBe(false);
    });

    it('lists the personal list first, then the allowed projects by name', () => {
        const list = creatableProjects([BETA, CLOSED, ALPHA, PERSONAL], allow({ 'beta:task.task_create': false }));
        expect(list.map((p) => p._id)).toEqual(['personal', 'alpha']);
    });
});

const store = (extra = {}) => createStore({
    modules: {
        projectData: { namespaced: true, getters: { allProjects: () => ({ data: extra.projects || [PERSONAL, ALPHA, BETA, CLOSED] }) }, mutations: { mutateSprints: vi.fn() } },
        settings: {
            namespaced: true,
            getters: {
                companyUserDetail: () => ({ roleType: 3 }),
                rules: () => ({ task: {} }),
                projectRawRules: () => [],
                selectedCompany: () => ({ planFeature: { projectProjectApp: true } }),
                companyOwnerDetail: () => ({ userId: 'owner-1' }),
                companyPriority: () => [{ name: 'High', value: 'HIGH' }, { name: 'Medium', value: 'MEDIUM' }, { name: 'Low', value: 'LOW' }]
            }
        }
    }
});

const mounted = [];
const mountDialog = async (extra) => {
    const wrapper = mount(QuickCreateTask, { attachTo: document.body, global: { plugins: [store(extra)], stubs: { ShellIcon: true } } });
    mounted.push(wrapper);
    await flushPromises();
    return wrapper;
};
const open = async (wrapper, request) => {
    openQuickCreate(request);
    await flushPromises();
    await nextTick();
};
// The dialog teleports to <body>, outside the wrapper's own element.
const $ = (selector) => {
    const el = document.body.querySelector(selector);
    return el ? new DOMWrapper(el) : { exists: () => false };
};
const field = (wrapper, name) => $(`[data-field="${name}"]`);
const title = (wrapper) => field(wrapper, 'title');
const enter = (wrapper, init = {}) => title(wrapper).trigger('keydown', { key: 'Enter', ...init });

beforeEach(() => {
    closeQuickCreate();
    Object.keys(perms).forEach((k) => delete perms[k]);
    Object.assign(route, { name: 'Home', params: {}, query: {} });
    try { localStorage.clear(); sessionStorage.clear(); } catch (e) { /* jsdom storage */ }
    apiRequest.mockReset();
    apiRequest.mockImplementation((type, url) => {
        if (url.includes('collection=sprints')) {
            const pid = url.split('/').slice(-1)[0].split('?')[0];
            return Promise.resolve({ data: [{ _id: `${pid}-s1`, name: `${pid} list`, value: 1 }, { _id: `${pid}-s2`, name: `${pid} second`, value: 2 }] });
        }
        if (url.includes('collection=folders')) return Promise.resolve({ data: [] });
        if (url.includes('/api/v1/projectRules/')) return Promise.resolve({ data: [] });
        return Promise.resolve({ data: {} });
    });
    create.mockReset();
    create.mockResolvedValue({ status: true, id: 'new-task-1' });
    openTask.mockReset();
    ensure.mockReset();
    ensure.mockResolvedValue({ project: PERSONAL, sprint: { _id: 'personal-s', name: 'Personal', value: 1 } });
});

afterEach(() => {
    mounted.splice(0).forEach((w) => w.unmount());
    closeQuickCreate();
});

describe('QuickCreateTask', () => {
    it('is a labelled modal dialog with the title field focused', async () => {
        const wrapper = await mountDialog();
        expect($('[role="dialog"]').exists()).toBe(false);
        await open(wrapper);
        const dialog = $('[role="dialog"]');
        expect(dialog.attributes('aria-modal')).toBe('true');
        expect(document.getElementById(dialog.attributes('aria-labelledby'))).not.toBeNull();
        expect(document.activeElement).toBe(title(wrapper).element);
    });

    it('opens on c from the page and not from a text field', async () => {
        await mountDialog();
        const input = document.createElement('input');
        document.body.appendChild(input);
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', bubbles: true }));
        await flushPromises();
        expect(quickCreate.open).toBe(false);
        document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', bubbles: true }));
        await flushPromises();
        expect(quickCreate.open).toBe(true);
        expect($('[role="dialog"]').exists()).toBe(true);
        input.remove();
    });

    it('defaults to the project on screen and offers only projects the user may create in', async () => {
        perms['global:task.task_list'] = true;
        Object.assign(route, { name: 'ProjectSprint', params: { id: 'beta', sprintId: 'beta-s2' } });
        const wrapper = await mountDialog();
        await open(wrapper);
        const select = field(wrapper, 'project');
        expect(select.element.value).toBe('beta');
        const offered = select.findAll('option').map((o) => o.attributes('value'));
        expect(offered).toEqual(['personal', 'alpha', 'beta']);
    });

    it('hides a project whose own rules deny task creation', async () => {
        apiRequest.mockImplementation((type, url) => {
            if (url.includes('/api/v1/projectRules/specific')) return Promise.resolve({ data: [{ _id: 'r', isParent: true, key: 'denyAll', name: 'deny' }] });
            if (url.includes('collection=')) return Promise.resolve({ data: [] });
            return Promise.resolve({ data: {} });
        });
        perms['project:task.task_create'] = null;
        const wrapper = await mountDialog({ projects: [PERSONAL, ALPHA, SPECIFIC] });
        await open(wrapper);
        const offered = field(wrapper, 'project').findAll('option').map((o) => o.attributes('value'));
        expect(offered).toEqual(['personal', 'alpha']);
    });

    it('falls back to the last used project, else the personal list', async () => {
        const wrapper = await mountDialog();
        await open(wrapper);
        expect(field(wrapper, 'project').element.value).toBe('personal');
        closeQuickCreate();
        await flushPromises();
        rememberLastProject('company-1', 'user-1', 'alpha');
        await open(wrapper);
        expect(field(wrapper, 'project').element.value).toBe('alpha');
    });

    it('shows status, assignee and due date in one row, and priority only where the project has it', async () => {
        const wrapper = await mountDialog();
        await open(wrapper, { projectId: 'beta' });
        expect(field(wrapper, 'status').element.value).toBe('1');
        expect(field(wrapper, 'assignee').element.value).toBe('user-1');
        expect(field(wrapper, 'due').exists()).toBe(true);
        expect(field(wrapper, 'priority').exists()).toBe(false);
        await field(wrapper, 'project').setValue('alpha');
        await flushPromises();
        expect(field(wrapper, 'priority').exists()).toBe(true);
    });

    it('creates on Enter through the list\'s create helper, closes and offers to open the task', async () => {
        Object.assign(route, { name: 'ProjectSprint', params: { id: 'beta', sprintId: 'beta-s2' } });
        const wrapper = await mountDialog();
        await open(wrapper);
        await title(wrapper).setValue('Write the brief');
        await enter(wrapper);
        await flushPromises();

        expect(create).toHaveBeenCalledTimes(1);
        const payload = create.mock.calls[0][0];
        expect(payload.data).toMatchObject({
            TaskName: 'Write the brief', ProjectID: 'beta', sprintId: 'beta-s2', statusKey: 1, AssigneeUserId: ['user-1'], isParentTask: true, CompanyId: 'company-1'
        });
        expect(payload.projectData).toMatchObject({ _id: 'beta', ProjectCode: 'BETA' });
        expect(quickCreate.open).toBe(false);
        expect(readLastProject('company-1', 'user-1')).toBe('beta');

        const done = $('[data-created]');
        expect(done.text()).toContain('QuickCreate.created');
        await done.find('button').trigger('click');
        expect(openTask).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'beta', sprintId: 'beta-s2', taskId: 'new-task-1', companyId: 'company-1' }));
    });

    it('creates and opens the task on Cmd or Ctrl+Enter', async () => {
        const wrapper = await mountDialog();
        await open(wrapper, { projectId: 'alpha' });
        await title(wrapper).setValue('Open me after');
        await enter(wrapper, { metaKey: true });
        await flushPromises();
        expect(create).toHaveBeenCalledTimes(1);
        expect(quickCreate.open).toBe(false);
        expect(openTask).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'alpha', sprintId: 'alpha-s1', taskId: 'new-task-1' }));
    });

    it('stays open with an empty, focused title after Shift+Enter or with "Create another" on', async () => {
        const wrapper = await mountDialog();
        await open(wrapper, { projectId: 'alpha' });
        await title(wrapper).setValue('First of many');
        await enter(wrapper, { shiftKey: true });
        await flushPromises();
        expect(create).toHaveBeenCalledTimes(1);
        expect(quickCreate.open).toBe(true);
        expect(title(wrapper).element.value).toBe('');
        expect(document.activeElement).toBe(title(wrapper).element);

        await field(wrapper, 'another').setValue(true);
        await title(wrapper).setValue('Second of many');
        await enter(wrapper);
        await flushPromises();
        expect(create).toHaveBeenCalledTimes(2);
        expect(create.mock.calls[1][0].data.ProjectID).toBe('alpha');
        expect(quickCreate.open).toBe(true);
    });

    it('refuses a title under three characters without calling the API', async () => {
        const wrapper = await mountDialog();
        await open(wrapper);
        await title(wrapper).setValue('ab');
        await enter(wrapper);
        await flushPromises();
        expect(create).not.toHaveBeenCalled();
        expect(quickCreate.open).toBe(true);
        expect(title(wrapper).attributes('aria-invalid')).toBe('true');
    });

    it('closes on Escape and keeps a typed title as a draft for the session', async () => {
        const wrapper = await mountDialog();
        await open(wrapper);
        await title(wrapper).setValue('Half a thought');
        await $('[role="dialog"]').trigger('keydown', { key: 'Escape' });
        expect(quickCreate.open).toBe(false);
        expect(readDraft()).toBe('Half a thought');
        await open(wrapper);
        expect(title(wrapper).element.value).toBe('Half a thought');
    });
});
