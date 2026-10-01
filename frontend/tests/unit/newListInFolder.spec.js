import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config, flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';

const { apiRequest, getters, route, push, toast } = vi.hoisted(() => ({
    apiRequest: vi.fn(),
    getters: {},
    route: { params: {}, query: {} },
    push: vi.fn(),
    toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }
}));

/* The real checkPermission runs here over a store this spec fills, and nothing provides `selectedProject`:
   an entry shows, and a list is created, only if the component reads the project it was handed. */
vi.mock('@/store/index', () => ({ default: { getters } }));
vi.mock('@/services', () => ({ apiRequest, apiRequestWithoutCompnay: vi.fn() }));
vi.mock('@/locales/main', () => ({ i18n: { global: { t: (key) => key } } }));
vi.mock('@/utils/storageQueryBuild', () => ({ storageQueryBuilder: vi.fn() }));
vi.mock('@/composable/commonFunction', () => ({
    isBundledPriorityImage: vi.fn(),
    sprintPlanPermission: () => ({ checkPerProjectSprintPermission: () => Promise.resolve(true) })
}));
vi.mock('@/components/organisms/QuickCreateTask/quickCreateTask', () => ({ openQuickCreate: vi.fn() }));
vi.mock('vue-router', () => ({ useRouter: () => ({ push }), useRoute: () => route }));
vi.mock('vue-toast-notification', () => ({ useToast: () => toast }));

import * as env from '@/config/env';
import en from '@/locales/en';
import NewInProjectMenu from '@/views/Projects/components/NewInProjectMenu.vue';
import FolderRowMenu from '@/components/molecules/ProjectTree/FolderRowMenu.vue';
import SprintFolderInput from '@/components/atom/SprintFolderInput/SprintFolderInput.vue';

const i18n = config.global.plugins[0];
i18n.global.setLocaleMessage('en', en);

const MEMBER = 3;
const KEYS = ['project_sprint_create', 'project_folder_create', 'project_folder_name_edit', 'folder_archive', 'folder_delete'];
const rule = (permission) => ({ roles: [{ key: MEMBER, permission }] });
const rulesGranting = (...granted) => ({
    project: Object.fromEntries(KEYS.map((key) => [key, rule(granted.includes(key))])),
    task: { task_create: rule(false), task_list: rule(false) }
});

const list = (id, name, folderId) => ({ id, _id: id, name, projectId: 'p1', deletedStatusKey: 0, ...(folderId ? { folderId } : {}) });
const entry = (id, name, extra = {}) => ({ folderId: id, _id: id, id, name, projectId: 'p1', sprintsObj: {}, deletedStatusKey: 0, parentFolderId: null, ...extra });
const FOLDERS = {
    design: entry('design', 'Design', { sprintsObj: { d1: list('d1', 'Roadmap', 'design') } }),
    icons: entry('icons', 'Icons', { parentFolderId: 'design' }),
    old: entry('old', 'Old', { deletedStatusKey: 2 }),
    oldSub: entry('oldSub', 'Old sub', { parentFolderId: 'old', deletedStatusKey: 6 })
};
const projectWith = (extra = {}) => ({ _id: 'p1', ProjectName: 'Alpha', isGlobalPermission: true, sprintsObj: { r1: list('r1', 'Inbox') }, sprintsfolders: FOLDERS, ...extra });

const commits = [];
const record = (type) => (state, payload) => commits.push({ type, payload });
const store = () => createStore({
    mutations: {
        'projectData/mutateSprints': record('projectData/mutateSprints'),
        'projectData/mutateFolders': record('projectData/mutateFolders')
    }
});

const mounted = [];
const show = (component, props) => {
    const wrapper = mount(component, { props, attachTo: document.body, global: { plugins: [store()], mocks: { $t: i18n.global.t } } });
    mounted.push(wrapper);
    return wrapper;
};
const submit = async (wrapper, name) => {
    const input = wrapper.findComponent(SprintFolderInput).find('input');
    await input.setValue(name);
    await input.trigger('keypress.enter');
    await flushPromises();
};
const created = (extra = {}) => ({ _id: 's9', name: 'Backlog', projectId: 'p1', deletedStatusKey: 0, ...extra });
const answers = (data) => apiRequest.mockResolvedValue({ data: { status: true, data } });

beforeEach(() => {
    commits.length = 0;
    apiRequest.mockReset();
    push.mockReset();
    Object.values(toast).forEach((spy) => spy.mockClear());
    route.params = { cid: 'company-1', id: 'p1' };
    Object.assign(getters, {
        'settings/companyUserDetail': { roleType: MEMBER },
        'settings/rules': rulesGranting('project_sprint_create'),
        'settings/projectRules': rulesGranting()
    });
});
afterEach(() => {
    while (mounted.length) mounted.pop().unmount();
    document.body.innerHTML = '';
});

describe('+ New → New list', () => {
    const startNewList = async (projectData = projectWith()) => {
        const wrapper = show(NewInProjectMenu, { projectData });
        await wrapper.find('button[aria-expanded]').trigger('click');
        await wrapper.findAll('[role="menuitem"]').find((item) => item.text() === 'New list').trigger('click');
        await flushPromises();
        return wrapper;
    };
    const title = () => document.body.querySelector('.nip__title').textContent.trim();

    it('creates the list in the folder in view, says so, and opens it there', async () => {
        route.params = { cid: 'company-1', id: 'p1', folderId: 'design' };
        answers(created({ folderId: 'design' }));
        const wrapper = await startNewList();
        expect(title()).toBe('New list in Design');

        await submit(wrapper, 'Backlog');

        expect(apiRequest).toHaveBeenCalledWith('post', env.SPRINT, {
            companyId: 'company-1',
            projectId: 'p1',
            sprintName: 'Backlog',
            folder: { folderId: 'design', folderName: 'Design' },
            type: 'addSprint'
        });
        expect(commits).toEqual([{ type: 'projectData/mutateSprints', payload: { op: 'added', data: created({ folderId: 'design' }) } }]);
        expect(push).toHaveBeenCalledWith({ name: 'ProjectFolderSprint', params: { cid: 'company-1', id: 'p1', folderId: 'design', sprintId: 's9' } });
    });

    it('creates it in the subfolder in view and names the whole path', async () => {
        route.params = { cid: 'company-1', id: 'p1', folderId: 'icons' };
        answers(created({ folderId: 'icons' }));
        const wrapper = await startNewList();
        expect(title()).toBe('New list in Design / Icons');

        await submit(wrapper, 'Backlog');

        expect(apiRequest.mock.calls[0][2].folder).toEqual({ folderId: 'icons', folderName: 'Icons' });
        expect(push).toHaveBeenCalledWith({ name: 'ProjectFolderSprint', params: { cid: 'company-1', id: 'p1', folderId: 'icons', sprintId: 's9' } });
    });

    it('creates it in the folder of the list in view', async () => {
        route.params = { cid: 'company-1', id: 'p1', folderId: 'design', sprintId: 'd1' };
        answers(created({ folderId: 'design' }));
        const wrapper = await startNewList();
        await submit(wrapper, 'Backlog');
        expect(apiRequest.mock.calls[0][2].folder).toEqual({ folderId: 'design', folderName: 'Design' });
    });

    it('creates it at the top level when no folder is in view', async () => {
        answers(created());
        const wrapper = await startNewList();
        expect(title()).toBe('New list');

        await submit(wrapper, 'Backlog');

        expect(apiRequest).toHaveBeenCalledWith('post', env.SPRINT, { companyId: 'company-1', projectId: 'p1', sprintName: 'Backlog', folder: null, type: 'addSprint' });
        expect(push).toHaveBeenCalledWith({ name: 'ProjectSprint', params: { cid: 'company-1', id: 'p1', sprintId: 's9' } });
    });

    it.each(['old', 'oldSub', 'gone'])('creates it at the top level when the folder in view (%s) cannot take a list', async (folderId) => {
        route.params = { cid: 'company-1', id: 'p1', folderId };
        answers(created());
        const wrapper = await startNewList();
        expect(title()).toBe('New list');
        await submit(wrapper, 'Backlog');
        expect(apiRequest.mock.calls[0][2].folder).toBeNull();
    });

    it('refuses the name of a list beside it, and allows one used in another place', async () => {
        route.params = { cid: 'company-1', id: 'p1', folderId: 'design' };
        answers(created({ folderId: 'design' }));
        let wrapper = await startNewList();
        await submit(wrapper, 'roadmap');
        expect(toast.error).toHaveBeenCalledWith('Sprint already exists', { position: 'top-right' });
        expect(apiRequest).not.toHaveBeenCalled();

        await submit(wrapper, 'Inbox');
        expect(apiRequest).toHaveBeenCalledTimes(1);

        apiRequest.mockClear();
        toast.error.mockClear();
        route.params = { cid: 'company-1', id: 'p1' };
        wrapper = await startNewList();
        await submit(wrapper, 'inbox');
        expect(toast.error).toHaveBeenCalledWith('Sprint already exists', { position: 'top-right' });
        expect(apiRequest).not.toHaveBeenCalled();
        await submit(wrapper, 'Roadmap');
        expect(apiRequest).toHaveBeenCalledTimes(1);
    });

    it('reads the permission of the project it is handed', async () => {
        const offered = async (projectData) => {
            const wrapper = show(NewInProjectMenu, { projectData });
            const trigger = wrapper.find('button[aria-expanded]');
            if (!trigger.exists()) return false;
            await trigger.trigger('click');
            return wrapper.findAll('[role="menuitem"]').some((item) => item.text() === 'New list');
        };
        expect(await offered(projectWith())).toBe(true);
        expect(await offered(projectWith({ isGlobalPermission: false }))).toBe(false);
        getters['settings/projectRules'] = rulesGranting('project_sprint_create');
        expect(await offered(projectWith({ isGlobalPermission: false }))).toBe(true);
    });
});

describe('a folder\'s own menu', () => {
    const docs = Object.values(FOLDERS).map((folder) => ({ ...folder, sprintsObj: undefined }));
    const sprints = [list('d1', 'Roadmap', 'design'), list('r1', 'Inbox')];
    const menu = (folderId, project = projectWith()) => show(FolderRowMenu, {
        project,
        folders: docs,
        sprints,
        folder: { id: folderId, name: FOLDERS[folderId].name, parentFolderId: FOLDERS[folderId].parentFolderId || '' }
    });
    const entries = async (wrapper) => {
        if (!wrapper.find('.pt-row__more').exists()) return [];
        await wrapper.find('.pt-row__more').trigger('click');
        return wrapper.findAll('[role="menuitem"]').map((item) => item.text());
    };
    const choose = async (wrapper, label) => {
        await wrapper.find('.pt-row__more').trigger('click');
        await wrapper.findAll('[role="menuitem"]').find((item) => item.text() === label).trigger('click');
        await vi.dynamicImportSettled();
        await flushPromises();
    };

    it('offers a new list on a folder and on a subfolder', async () => {
        expect(await entries(menu('design'))).toEqual(['New list']);
        expect(await entries(menu('icons'))).toEqual(['New list']);
    });

    it('offers it by project.project_sprint_create of the project it is handed', async () => {
        getters['settings/rules'] = rulesGranting('project_folder_create');
        expect(await entries(menu('design'))).toEqual(['New subfolder']);

        getters['settings/projectRules'] = rulesGranting('project_sprint_create');
        expect(await entries(menu('design', projectWith({ isGlobalPermission: false })))).toEqual(['New list']);
    });

    it('offers none in a closed project', async () => {
        expect(await entries(menu('design', projectWith({ status: 'close' })))).toEqual([]);
    });

    it('creates the list in that folder of the handed project and asks the tree to open the folder', async () => {
        answers(created({ folderId: 'icons' }));
        const wrapper = menu('icons');
        await choose(wrapper, 'New list');
        expect(document.body.querySelector('.pt-menu__title').textContent.trim()).toBe('New list in Design / Icons');

        await submit(wrapper, 'Backlog');

        expect(apiRequest).toHaveBeenCalledWith('post', env.SPRINT, {
            companyId: 'company-1',
            projectId: 'p1',
            sprintName: 'Backlog',
            folder: { folderId: 'icons', folderName: 'Icons' },
            type: 'addSprint'
        });
        expect(commits).toEqual([{ type: 'projectData/mutateSprints', payload: { op: 'added', data: created({ folderId: 'icons' }) } }]);
        expect(wrapper.emitted('reveal')).toEqual([['icons']]);
    });

    it('refuses the name of a list already in the folder', async () => {
        const wrapper = menu('design');
        await choose(wrapper, 'New list');
        await submit(wrapper, 'Roadmap');
        expect(toast.error).toHaveBeenCalledWith('Sprint already exists', { position: 'top-right' });
        expect(apiRequest).not.toHaveBeenCalled();
    });
});
