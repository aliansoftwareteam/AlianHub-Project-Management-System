import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';

const { apiRequest, getters, route, push, toast } = vi.hoisted(() => ({
    apiRequest: vi.fn(),
    getters: {},
    route: { params: {}, query: {} },
    push: vi.fn(),
    toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }
}));

/* The real checkPermission runs here, over a store this spec fills: nothing provides `selectedProject`,
   so an entry shows only if the component reads the project it was handed. */
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
import NewInProjectMenu from '@/views/Projects/components/NewInProjectMenu.vue';
import FolderRowMenu from '@/components/molecules/ProjectTree/FolderRowMenu.vue';
import SprintFolderInput from '@/components/atom/SprintFolderInput/SprintFolderInput.vue';

const MEMBER = 3;
const rule = (permission) => ({ roles: [{ key: MEMBER, permission }] });
const rulesWith = (folders) => ({
    project: {
        project_folder_create: rule(folders),
        project_folder_name_edit: rule(folders),
        project_sprint_create: rule(false)
    },
    task: { task_create: rule(false), task_list: rule(false) }
});

const entry = (id, name, extra = {}) => ({ folderId: id, _id: id, id, name, projectId: 'p1', sprintsObj: {}, deletedStatusKey: 0, parentFolderId: null, ...extra });
const FOLDERS = { design: entry('design', 'Design'), icons: entry('icons', 'Icons', { parentFolderId: 'design' }), ops: entry('ops', 'Ops') };
const projectWith = (extra = {}) => ({ _id: 'p1', ProjectName: 'Alpha', isGlobalPermission: true, sprintsObj: {}, sprintsfolders: FOLDERS, ...extra });

const commits = [];
const store = () => createStore({ mutations: { 'projectData/mutateFolders': (state, payload) => commits.push(payload) } });

const mounted = [];
const show = (component, props) => {
    const wrapper = mount(component, { props, attachTo: document.body, global: { plugins: [store()] } });
    mounted.push(wrapper);
    return wrapper;
};
const bodyText = () => document.body.textContent;
const refusal = (statusText) => Object.assign(new Error('Request failed with status code 400'), { response: { status: 400, data: { status: false, statusText, message: statusText } } });

beforeEach(() => {
    commits.length = 0;
    apiRequest.mockReset();
    Object.values(toast).forEach((spy) => spy.mockClear());
    route.params = { cid: 'company-1', id: 'p1' };
    Object.assign(getters, {
        'settings/companyUserDetail': { roleType: MEMBER },
        'settings/rules': rulesWith(true),
        'settings/projectRules': rulesWith(false)
    });
});
afterEach(() => {
    while (mounted.length) mounted.pop().unmount();
    document.body.innerHTML = '';
});

describe('New in project', () => {
    const entries = async (props) => {
        const wrapper = show(NewInProjectMenu, props);
        const trigger = wrapper.find('button[aria-expanded]');
        if (!trigger.exists()) return [];
        await trigger.trigger('click');
        return wrapper.findAll('[role="menuitem"]').map((item) => item.text());
    };

    it('offers a new subfolder on the page of a top-level folder', async () => {
        route.params = { cid: 'company-1', id: 'p1', folderId: 'design' };
        expect(await entries({ projectData: projectWith() })).toEqual(['Projects.new_folder', 'Projects.new_subfolder']);
    });

    it('offers it on a list inside a top-level folder too', async () => {
        route.params = { cid: 'company-1', id: 'p1', folderId: 'ops', sprintId: 's1' };
        expect(await entries({ projectData: projectWith() })).toContain('Projects.new_subfolder');
    });

    it('offers none on a subfolder, on the project itself, or in an archived folder', async () => {
        route.params = { cid: 'company-1', id: 'p1', folderId: 'icons' };
        expect(await entries({ projectData: projectWith() })).toEqual(['Projects.new_folder']);
        route.params = { cid: 'company-1', id: 'p1' };
        expect(await entries({ projectData: projectWith() })).toEqual(['Projects.new_folder']);
        route.params = { cid: 'company-1', id: 'p1', folderId: 'design' };
        const archived = { ...FOLDERS, design: entry('design', 'Design', { deletedStatusKey: 2 }) };
        expect(await entries({ projectData: projectWith({ sprintsfolders: archived }) })).toEqual(['Projects.new_folder']);
    });

    it('reads the permission of the project it is handed, not of one provided around it', async () => {
        route.params = { cid: 'company-1', id: 'p1', folderId: 'design' };
        expect(await entries({ projectData: projectWith({ isGlobalPermission: false }) })).toEqual([]);
        getters['settings/projectRules'] = rulesWith(true);
        getters['settings/rules'] = rulesWith(false);
        expect(await entries({ projectData: projectWith({ isGlobalPermission: false }) })).toContain('Projects.new_subfolder');
        expect(await entries({ projectData: projectWith({ isGlobalPermission: true }) })).toEqual([]);
    });

    it('creates the subfolder in the folder in view', async () => {
        route.params = { cid: 'company-1', id: 'p1', folderId: 'design' };
        const wrapper = show(NewInProjectMenu, { projectData: projectWith() });
        await wrapper.find('button[aria-expanded]').trigger('click');
        await wrapper.findAll('[role="menuitem"]').find((item) => item.text() === 'Projects.new_subfolder').trigger('click');
        await flushPromises();
        const input = wrapper.findComponent(SprintFolderInput);
        expect(input.props()).toMatchObject({ createFolder: true, createSprint: false, parentFolderId: 'design' });
        expect(input.props('project')._id).toBe('p1');
        expect(bodyText()).toContain('Projects.new_subfolder');
    });
});

describe('the folder name input', () => {
    const submit = async (wrapper, name) => {
        const input = wrapper.find('input');
        await input.setValue(name);
        await input.trigger('keypress.enter');
        await flushPromises();
    };

    it('sends the parent and the handed project when it creates a subfolder', async () => {
        const created = { _id: 'fonts', name: 'Fonts', projectId: 'p1', deletedStatusKey: 0, parentFolderId: 'design' };
        apiRequest.mockResolvedValue({ data: { status: true, data: created } });
        const wrapper = show(SprintFolderInput, { createSprint: false, createFolder: true, parentFolderId: 'design', project: { _id: 'p1' }, subItems: [] });

        await submit(wrapper, 'Fonts');

        expect(apiRequest).toHaveBeenCalledWith('post', env.FOLDER, { companyId: 'company-1', projectId: 'p1', folderName: 'Fonts', parentFolderId: 'design', type: 'addFolder' });
        expect(commits).toEqual([{ op: 'added', data: created }]);
        expect(wrapper.emitted('updateData')[0]).toEqual([created, 'Folder']);
    });

    it('sends no parent for a top-level folder', async () => {
        apiRequest.mockResolvedValue({ data: { status: true, data: { _id: 'f9', name: 'Later', projectId: 'p1', deletedStatusKey: 0 } } });
        const wrapper = show(SprintFolderInput, { createSprint: false, createFolder: true, project: { _id: 'p1' }, subItems: [] });
        await submit(wrapper, 'Later');
        expect(apiRequest.mock.calls[0][2]).not.toHaveProperty('parentFolderId');
    });

    it('shows the server\'s reason when the folder is refused, and stores nothing', async () => {
        apiRequest.mockRejectedValue(refusal('A subfolder cannot hold folders: folders nest one level.'));
        const wrapper = show(SprintFolderInput, { createSprint: false, createFolder: true, parentFolderId: 'icons', project: { _id: 'p1' }, subItems: [] });
        await submit(wrapper, 'Too deep');
        expect(toast.error).toHaveBeenCalledWith('A subfolder cannot hold folders: folders nest one level.', { position: 'top-right' });
        expect(commits).toEqual([]);
    });
});

describe('a folder\'s own menu', () => {
    const docs = Object.values(FOLDERS);
    const menu = (folderId, project = projectWith()) => show(FolderRowMenu, { project, folders: docs, folder: { id: folderId, name: FOLDERS[folderId].name, parentFolderId: FOLDERS[folderId].parentFolderId || '' } });
    const open = async (wrapper) => {
        await wrapper.find('.pt-row__more').trigger('click');
        return wrapper.findAll('[role="menuitem"]');
    };
    const choose = async (wrapper, label) => {
        const item = (await open(wrapper)).find((el) => el.text() === label);
        await item.trigger('click');
        await vi.dynamicImportSettled();
        await flushPromises();
    };

    it('reads the permission of the project it is handed', async () => {
        expect(menu('ops', projectWith({ isGlobalPermission: false })).find('.pt-row__more').exists()).toBe(false);
        expect((await open(menu('ops'))).map((item) => item.text())).toEqual(['Projects.new_subfolder', 'Projects.move_folder']);
    });

    it('offers nothing in a closed project', () => {
        expect(menu('ops', projectWith({ status: 'close' })).find('.pt-row__more').exists()).toBe(false);
    });

    it('creates a subfolder under the folder', async () => {
        const wrapper = menu('ops');
        await choose(wrapper, 'Projects.new_subfolder');
        const input = wrapper.findComponent(SprintFolderInput);
        expect(input.exists()).toBe(true);
        expect(input.props()).toMatchObject({ createFolder: true, createSprint: false, parentFolderId: 'ops' });
        expect(input.props('project')._id).toBe('p1');
    });

    it('moves the folder into the top-level folder that is picked', async () => {
        apiRequest.mockResolvedValue({ data: { status: true, data: { ...FOLDERS.ops, parentFolderId: 'design' } } });
        const wrapper = menu('ops');
        await choose(wrapper, 'Projects.move_folder');
        const targets = [...document.body.querySelectorAll('.mtf__item')];
        expect(targets.map((el) => el.querySelector('.mtf__name').textContent.trim())).toEqual(['Projects.top_level', 'Design']);
        targets[1].click();
        await flushPromises();

        expect(apiRequest).toHaveBeenCalledWith('patch', `${env.FOLDER}/ops`, { type: 'moveFolder', companyId: 'company-1', projectId: 'p1', parentFolderId: 'design' });
        expect(commits).toEqual([{ op: 'modified', data: { ...FOLDERS.ops, parentFolderId: 'design' } }]);
        expect(toast.success).toHaveBeenCalledWith('Toast.Folder_moved_successfully', { position: 'top-right' });
        expect(document.body.querySelector('.mtf__item')).toBeNull();
        expect(wrapper.emitted('reveal')).toEqual([['design']]);
    });

    it('asks the tree to open the folder a subfolder was created in', async () => {
        const wrapper = menu('ops');
        await choose(wrapper, 'Projects.new_subfolder');
        wrapper.findComponent(SprintFolderInput).vm.$emit('updateData', { _id: 'new' }, 'Folder');
        expect(wrapper.emitted('reveal')).toEqual([['ops']]);
    });

    it('moves a subfolder out to the top level', async () => {
        apiRequest.mockResolvedValue({ data: { status: true, data: { ...FOLDERS.icons, parentFolderId: undefined } } });
        const wrapper = menu('icons');
        await choose(wrapper, 'Projects.move_folder');
        document.body.querySelector('.mtf__item--root').click();
        await flushPromises();
        expect(apiRequest.mock.calls[0][2]).toMatchObject({ type: 'moveFolder', parentFolderId: null });
    });

    it('shows the server\'s reason when the move is refused', async () => {
        apiRequest.mockRejectedValue(refusal('A deleted folder cannot hold subfolders.'));
        const wrapper = menu('ops');
        await choose(wrapper, 'Projects.move_folder');
        document.body.querySelectorAll('.mtf__item')[1].click();
        await flushPromises();
        expect(toast.error).toHaveBeenCalledWith('A deleted folder cannot hold subfolders.', { position: 'top-right' });
        expect(commits).toEqual([]);
    });
});
