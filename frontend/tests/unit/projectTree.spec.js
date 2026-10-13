import fs from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import { createMemoryHistory, createRouter } from 'vue-router';
import { ref } from 'vue';

const { apiRequest, perms } = vi.hoisted(() => ({ apiRequest: vi.fn(), perms: {} }));
vi.mock('@/services', () => ({ apiRequest, apiRequestWithoutCompnay: vi.fn() }));
vi.mock('@/composable', () => ({ useCustomComposable: () => ({ checkPermission: (key) => perms[key] !== false }) }));

import * as env from '@/config/env';
import ProjectTree from '@/components/molecules/ProjectTree/ProjectTree.vue';
import ProjectTreePanel from '@/views/Projects/components/ProjectTreePanel.vue';
import { resetProjectTreeCache } from '@/components/molecules/ProjectTree/projectTreeData';
import { resetFavourites } from '@/composable/favourites';
import { projectTreePanelState } from '@/views/Projects/components/projectTreePanelState';

const SPRINTS = {
    p1: [
        { _id: 's1', name: 'Backlog', projectId: 'p1', deletedStatusKey: 0, private: false, tasks: 4 },
        { _id: 's2', name: 'Sprint 2', projectId: 'p1', folderId: 'f1', deletedStatusKey: 0, private: false, tasks: 3 },
        { _id: 's3', name: 'Secret sprint', projectId: 'p1', deletedStatusKey: 0, private: true, AssigneeUserId: ['someone-else'], tasks: 9 },
        { _id: 's4', name: 'Team sprint', projectId: 'p1', folderId: 'f1', deletedStatusKey: 0, private: true, AssigneeUserId: ['tId_team-1'], tasks: 2 },
        { _id: 's5', name: 'Mine', projectId: 'p1', deletedStatusKey: 0, private: true, AssigneeUserId: ['user-1'], tasks: 1 },
        { _id: 's6', name: 'Deleted sprint', projectId: 'p1', deletedStatusKey: 1, private: false, tasks: 5 }
    ],
    p2: [{ _id: 's9', name: 'Beta list', projectId: 'p2', deletedStatusKey: 0, private: false, tasks: 0 }],
    p3: [
        { _id: 'n1', name: 'Parent list', projectId: 'p3', folderId: 'fp', deletedStatusKey: 0, private: false, tasks: 1 },
        { _id: 'n2', name: 'Nested list', projectId: 'p3', folderId: 'fc', deletedStatusKey: 0, private: false, tasks: 2 },
        { _id: 'n3', name: 'Orphan list', projectId: 'p3', folderId: 'fo', deletedStatusKey: 0, private: false, tasks: 7 }
    ]
};
const FOLDERS = {
    p1: [{ _id: 'f1', name: 'Design', projectId: 'p1', deletedStatusKey: 0 }],
    p2: [],
    p3: [
        { _id: 'fp', name: 'Parent folder', projectId: 'p3', deletedStatusKey: 0, parentFolderId: null },
        { _id: 'fc', name: 'Child folder', projectId: 'p3', deletedStatusKey: 0, parentFolderId: 'fp' },
        { _id: 'fo', name: 'Orphan folder', projectId: 'p3', deletedStatusKey: 2, parentFolderId: 'deleted-parent' },
        { _id: 'fe', name: 'Empty folder', projectId: 'p3', deletedStatusKey: 0, parentFolderId: null }
    ]
};
const PROJECTS = [{ _id: 'p1', ProjectName: 'Alpha' }, { _id: 'p2', ProjectName: 'Beta' }];
const NESTED = [{ _id: 'p3', ProjectName: 'Gamma', isGlobalPermission: true }, { _id: 'p1', ProjectName: 'Alpha', isGlobalPermission: true }];
const NESTED_LIST = { name: 'ProjectFolderSprint', params: { cid: 'company-1', id: 'p3', folderId: 'fc', sprintId: 'n2' } };

const blank = { render: () => null };
const routes = [
    { path: '/:cid/home', name: 'Home', component: blank },
    { path: '/:cid/project/:id/p', name: 'Project', component: blank },
    { path: '/:cid/project/:id/f/:folderId', name: 'ProjectFolder', component: blank },
    { path: '/:cid/project/:id/fs/:folderId/:sprintId', name: 'ProjectFolderSprint', component: blank },
    { path: '/:cid/project/:id/s/:sprintId', name: 'ProjectSprint', component: blank }
];

const makeStore = (roleType = 3) => createStore({
    getters: {
        'projectData/sprints': () => ({}),
        'projectData/folders': () => ({}),
        'settings/companyUserDetail': () => ({ roleType }),
        'settings/teams': () => [{ _id: 'team-1', assigneeUsersArray: ['user-1'] }]
    },
    mutations: { 'projectData/mutateFolders': () => {} }
});

const mounted = [];
const mountWith = async (component, props, { at, roleType, width = 1280 } = {}) => {
    const router = createRouter({ history: createMemoryHistory(), routes });
    await router.push(at || { name: 'ProjectFolderSprint', params: { cid: 'company-1', id: 'p1', folderId: 'f1', sprintId: 's2' } });
    await router.isReady();
    const wrapper = mount(component, {
        props,
        attachTo: document.body,
        global: { plugins: [makeStore(roleType), router], provide: { $clientWidth: ref(width) } }
    });
    mounted.push(wrapper);
    await flushPromises();
    return { wrapper, router };
};

const items = (wrapper) => wrapper.findAll('[role="treeitem"]');
const itemNamed = (wrapper, name) => items(wrapper).find((el) => el.text().includes(name));

beforeEach(() => {
    resetProjectTreeCache();
    resetFavourites();
    projectTreePanelState.collapsed = false;
    projectTreePanelState.open = false;
    apiRequest.mockImplementation((method, url) => {
        const match = /sprintFolder\/(\w+)\?collection=(\w+)/.exec(url);
        if (match) return Promise.resolve({ data: ((match[2] === 'sprints' ? SPRINTS : FOLDERS)[match[1]] || []).map((row) => ({ ...row })) });
        return Promise.resolve({ data: { status: true, data: [] } });
    });
});
afterEach(() => {
    while (mounted.length) mounted.pop().unmount();
    Object.keys(perms).forEach((key) => { delete perms[key]; });
});

describe('the project tree', () => {
    it('is a tree of projects, folders and sprints with the current location opened and marked', async () => {
        const { wrapper } = await mountWith(ProjectTree, { projects: PROJECTS, label: 'Projects' });
        expect(wrapper.find('[role="tree"]').attributes('aria-label')).toBe('Projects');

        const project = itemNamed(wrapper, 'Alpha');
        expect(project.attributes('aria-level')).toBe('1');
        expect(project.attributes('aria-expanded')).toBe('true');
        const folder = itemNamed(wrapper, 'Design');
        expect(folder.attributes('aria-level')).toBe('2');
        const current = itemNamed(wrapper, 'Sprint 2');
        expect(current.attributes('aria-level')).toBe('3');
        expect(current.attributes('aria-current')).toBe('page');
        expect(current.attributes('aria-selected')).toBe('true');
        expect(current.attributes('tabindex')).toBe('0');
        expect(items(wrapper).filter((el) => el.attributes('aria-current') === 'page')).toHaveLength(1);
    });

    it('shows task counts on sprints and folders', async () => {
        const { wrapper } = await mountWith(ProjectTree, { projects: PROJECTS, label: 'Projects' });
        const row = (name) => itemNamed(wrapper, name).element.closest('.pt-row');
        expect(row('Backlog').textContent).toContain('4');
        expect(row('Design').textContent).toContain('5');
    });

    it('hides private sprints the member is not on, and deleted ones', async () => {
        const { wrapper } = await mountWith(ProjectTree, { projects: PROJECTS, label: 'Projects' });
        const text = wrapper.text();
        expect(text).not.toContain('Secret sprint');
        expect(text).not.toContain('Deleted sprint');
        expect(text).toContain('Team sprint');
        expect(text).toContain('Mine');
    });

    it('shows an admin every private sprint', async () => {
        const { wrapper } = await mountWith(ProjectTree, { projects: PROJECTS, label: 'Projects' }, { roleType: 2 });
        expect(wrapper.text()).toContain('Secret sprint');
    });

    it('moves focus with the arrow keys and opens a closed project with the right arrow', async () => {
        const { wrapper } = await mountWith(ProjectTree, { projects: PROJECTS, label: 'Projects' });
        const current = itemNamed(wrapper, 'Sprint 2');
        current.element.focus();
        await current.trigger('keydown', { key: 'ArrowUp' });
        expect(document.activeElement.textContent).toContain('Design');
        await wrapper.find('[role="tree"]').trigger('keydown', { key: 'End' });
        expect(document.activeElement.textContent).toContain('Beta');

        const beta = itemNamed(wrapper, 'Beta');
        expect(beta.attributes('aria-expanded')).toBe('false');
        await beta.trigger('keydown', { key: 'ArrowRight' });
        await flushPromises();
        expect(itemNamed(wrapper, 'Beta').attributes('aria-expanded')).toBe('true');
        expect(wrapper.text()).toContain('Beta list');

        await itemNamed(wrapper, 'Beta').trigger('keydown', { key: 'ArrowLeft' });
        expect(itemNamed(wrapper, 'Beta').attributes('aria-expanded')).toBe('false');
    });

    it('puts no control inside another and links each item', async () => {
        const { wrapper, router } = await mountWith(ProjectTree, { projects: PROJECTS, label: 'Projects' });
        const interactive = 'a[href], button, [tabindex]:not([tabindex="-1"])';
        const nested = [...wrapper.element.querySelectorAll('*')].filter((el) => el.matches(interactive) && el.querySelector(interactive));
        expect(nested).toEqual([]);
        expect(itemNamed(wrapper, 'Backlog').attributes('href')).toBe(router.resolve({ name: 'ProjectSprint', params: { cid: 'company-1', id: 'p1', sprintId: 's1' } }).href);
    });
});

describe('the tree panel on project pages', () => {
    it('shows the tree beside the project at 1024px and wider', async () => {
        const { wrapper } = await mountWith(ProjectTreePanel, { projects: PROJECTS }, { width: 1024 });
        const panel = wrapper.find('#project-tree-panel');
        expect(panel.exists()).toBe(true);
        expect(panel.find('[role="tree"]').exists()).toBe(true);
        expect(itemNamed(wrapper, 'Sprint 2').attributes('aria-current')).toBe('page');
        expect(wrapper.text()).not.toContain('Secret sprint');
    });

    it('stays out of the way on a narrow screen until its button opens it', async () => {
        const { wrapper } = await mountWith(ProjectTreePanel, { projects: PROJECTS }, { width: 390 });
        expect(wrapper.find('[role="tree"]').exists()).toBe(false);
        projectTreePanelState.open = true;
        await flushPromises();
        expect(wrapper.find('[role="tree"]').exists()).toBe(true);
    });

    it('can be collapsed on a wide screen', async () => {
        const { wrapper } = await mountWith(ProjectTreePanel, { projects: PROJECTS }, { width: 1280 });
        projectTreePanelState.collapsed = true;
        await flushPromises();
        expect(wrapper.find('[role="tree"]').exists()).toBe(false);
    });

    it('takes no density from the open view: it lists every project, so its rows keep one height', async () => {
        const { wrapper } = await mountWith(ProjectTreePanel, { projects: PROJECTS }, { width: 1280 });
        expect(Object.keys(ProjectTreePanel.props)).toEqual(['projects']);
        expect(wrapper.find('#project-tree-panel').attributes('data-density')).toBeUndefined();
        expect(wrapper.find('[data-density]').exists()).toBe(false);
    });

    it('is mounted by the project page', () => {
        const source = fs.readFileSync(path.resolve(__dirname, '../../src/views/Projects/Projects.vue'), 'utf8');
        expect(source).toMatch(/<ProjectTreePanel\b/);
    });
});

describe('subfolders in the project tree', () => {
    const rowOf = (wrapper, name) => itemNamed(wrapper, name).element.closest('.pt-row');
    const menuOf = (wrapper, name) => rowOf(wrapper, name).querySelector('.pt-row__more');
    const openMenu = async (wrapper, name) => {
        menuOf(wrapper, name).click();
        await flushPromises();
        return [...rowOf(wrapper, name).querySelectorAll('[role="menuitem"]')].map((item) => item.textContent.trim());
    };

    it('nests a subfolder under its folder and its lists under it, opened down to the current list', async () => {
        const { wrapper } = await mountWith(ProjectTree, { projects: NESTED, label: 'Projects' }, { at: NESTED_LIST });
        const parent = itemNamed(wrapper, 'Parent folder');
        expect(parent.attributes('aria-level')).toBe('2');
        expect(parent.attributes('aria-expanded')).toBe('true');
        const child = itemNamed(wrapper, 'Child folder');
        expect(child.attributes('aria-level')).toBe('3');
        expect(child.attributes('aria-expanded')).toBe('true');
        expect(itemNamed(wrapper, 'Parent list').attributes('aria-level')).toBe('3');
        const current = itemNamed(wrapper, 'Nested list');
        expect(current.attributes('aria-level')).toBe('4');
        expect(current.attributes('aria-current')).toBe('page');
        expect(rowOf(wrapper, 'Nested list').className).toContain('pt-row--l4');
    });

    it('lists a folder\'s subfolders before its own lists and counts their tasks on the folder', async () => {
        const { wrapper } = await mountWith(ProjectTree, { projects: NESTED, label: 'Projects' }, { at: NESTED_LIST });
        const order = items(wrapper).map((el) => el.find('.pt-row__name').text());
        expect(order.indexOf('Child folder')).toBeLessThan(order.indexOf('Parent list'));
        expect(order.indexOf('Parent folder')).toBeLessThan(order.indexOf('Child folder'));
        expect(rowOf(wrapper, 'Parent folder').querySelector('.pt-row__count').textContent).toBe('3');
        expect(rowOf(wrapper, 'Child folder').querySelector('.pt-row__count').textContent).toBe('2');
    });

    it('links a subfolder as a folder and its list through it', async () => {
        const { wrapper, router } = await mountWith(ProjectTree, { projects: NESTED, label: 'Projects' }, { at: NESTED_LIST });
        expect(itemNamed(wrapper, 'Child folder').attributes('href')).toBe(router.resolve({ name: 'ProjectFolder', params: { cid: 'company-1', id: 'p3', folderId: 'fc' } }).href);
        expect(itemNamed(wrapper, 'Nested list').attributes('href')).toBe(router.resolve(NESTED_LIST).href);
    });

    it('hides a subfolder whose parent is not in the list, and its lists', async () => {
        const { wrapper } = await mountWith(ProjectTree, { projects: NESTED, label: 'Projects' }, { at: NESTED_LIST });
        expect(wrapper.text()).not.toContain('Orphan folder');
        expect(wrapper.text()).not.toContain('Orphan list');
        expect(rowOf(wrapper, 'Gamma').querySelector('.pt-row__count').textContent).toBe('3');
    });

    it('steps from a nested list back to its subfolder with the left arrow', async () => {
        const { wrapper } = await mountWith(ProjectTree, { projects: NESTED, label: 'Projects' }, { at: NESTED_LIST });
        const current = itemNamed(wrapper, 'Nested list');
        current.element.focus();
        await current.trigger('keydown', { key: 'ArrowLeft' });
        expect(document.activeElement.textContent).toContain('Child folder');
    });

    it('offers every action on a top-level folder, and all but a new subfolder on a subfolder', async () => {
        const { wrapper } = await mountWith(ProjectTree, { projects: NESTED, label: 'Projects' }, { at: NESTED_LIST });
        expect(await openMenu(wrapper, 'Empty folder')).toEqual(['Projects.new_list', 'Projects.new_subfolder', 'Projects.rename', 'Projects.move_folder', 'Projects.archive', 'Projects.delete']);
        expect(await openMenu(wrapper, 'Child folder')).toEqual(['Projects.new_list', 'Projects.rename', 'Projects.move_folder', 'Projects.archive', 'Projects.delete']);
    });

    it('offers no move on a folder that holds subfolders: it has nowhere to go', async () => {
        const { wrapper } = await mountWith(ProjectTree, { projects: NESTED, label: 'Projects' }, { at: NESTED_LIST });
        expect(await openMenu(wrapper, 'Parent folder')).toEqual(['Projects.new_list', 'Projects.new_subfolder', 'Projects.rename', 'Projects.archive', 'Projects.delete']);
    });

    it('opens a folder\'s actions from the keyboard and closes them with Escape', async () => {
        const { wrapper } = await mountWith(ProjectTree, { projects: NESTED, label: 'Projects' }, { at: NESTED_LIST });
        const folder = itemNamed(wrapper, 'Empty folder');
        folder.element.focus();
        await folder.trigger('keydown', { key: 'F10', shiftKey: true });
        await flushPromises();
        expect(rowOf(wrapper, 'Empty folder').querySelector('[role="menu"]')).not.toBeNull();
        expect(document.activeElement.getAttribute('role')).toBe('menuitem');
        await wrapper.find('[role="menu"]').trigger('keydown', { key: 'Escape' });
        expect(rowOf(wrapper, 'Empty folder').querySelector('[role="menu"]')).toBeNull();
        expect(document.activeElement.textContent).toContain('Empty folder');
    });

    it('keeps folder actions to the open project', async () => {
        const { wrapper } = await mountWith(ProjectTree, { projects: NESTED, label: 'Projects' }, { at: NESTED_LIST });
        await rowOf(wrapper, 'Alpha').querySelector('.pt-row__chev').click();
        await flushPromises();
        expect(itemNamed(wrapper, 'Design')).toBeTruthy();
        expect(menuOf(wrapper, 'Design')).toBeNull();
        expect(menuOf(wrapper, 'Empty folder')).not.toBeNull();
    });

    const deny = (...keys) => keys.forEach((key) => { perms[`project.${key}`] = false; });

    it('offers nothing to someone who holds no folder permission', async () => {
        deny('project_sprint_create', 'project_folder_create', 'project_folder_name_edit', 'folder_archive', 'folder_delete');
        const { wrapper } = await mountWith(ProjectTree, { projects: NESTED, label: 'Projects' }, { at: NESTED_LIST });
        expect(menuOf(wrapper, 'Empty folder')).toBeNull();
        expect(menuOf(wrapper, 'Child folder')).toBeNull();
    });

    it('lets someone who may only rename folders rename and move one', async () => {
        deny('project_sprint_create', 'project_folder_create', 'folder_archive', 'folder_delete');
        const { wrapper } = await mountWith(ProjectTree, { projects: NESTED, label: 'Projects' }, { at: NESTED_LIST });
        expect(await openMenu(wrapper, 'Empty folder')).toEqual(['Projects.rename', 'Projects.move_folder']);
        expect(await openMenu(wrapper, 'Parent folder')).toEqual(['Projects.rename']);
    });

    it('lets someone who may only archive folders archive one', async () => {
        deny('project_sprint_create', 'project_folder_create', 'project_folder_name_edit', 'folder_delete');
        const { wrapper } = await mountWith(ProjectTree, { projects: NESTED, label: 'Projects' }, { at: NESTED_LIST });
        expect(await openMenu(wrapper, 'Child folder')).toEqual(['Projects.archive']);
    });

    describe('renaming in the row', () => {
        const renamed = { _id: 'fe', name: 'Archive box', projectId: 'p3', deletedStatusKey: 0, parentFolderId: null };
        const startRename = async (wrapper, name) => {
            await openMenu(wrapper, name);
            [...rowOf(wrapper, name).querySelectorAll('[role="menuitem"]')].find((item) => item.textContent.trim() === 'Projects.rename').click();
            await flushPromises();
            return wrapper.find('input.pt-row__rename');
        };
        const patches = () => apiRequest.mock.calls.filter(([method]) => method === 'patch');

        beforeEach(() => {
            const read = apiRequest.getMockImplementation();
            apiRequest.mockImplementation((method, url, body) => (method === 'patch'
                ? Promise.resolve({ data: { status: true, data: renamed } })
                : read(method, url, body)));
        });

        it('swaps the row for an input holding the name, focused', async () => {
            const { wrapper } = await mountWith(ProjectTree, { projects: NESTED, label: 'Projects' }, { at: NESTED_LIST });
            const input = await startRename(wrapper, 'Empty folder');
            expect(input.exists()).toBe(true);
            expect(input.element.value).toBe('Empty folder');
            expect(document.activeElement).toBe(input.element);
            expect(itemNamed(wrapper, 'Empty folder')).toBeUndefined();
            expect(input.attributes('aria-label')).toBe('ProjectTree.rename_folder');
        });

        it('saves on Enter and gives the row back its focus', async () => {
            const { wrapper } = await mountWith(ProjectTree, { projects: NESTED, label: 'Projects' }, { at: NESTED_LIST });
            const input = await startRename(wrapper, 'Empty folder');
            await input.setValue('  Archive box ');
            await input.trigger('keydown', { key: 'Enter' });
            await flushPromises();

            expect(patches()).toEqual([['patch', `${env.FOLDER}/fe`, { type: 'editFolderName', companyId: 'company-1', projectId: 'p3', folderName: 'Archive box' }]]);
            expect(wrapper.find('input.pt-row__rename').exists()).toBe(false);
            expect(document.activeElement.getAttribute('data-key')).toBe('folder:fe');
        });

        it('cancels on Escape without a request', async () => {
            const { wrapper } = await mountWith(ProjectTree, { projects: NESTED, label: 'Projects' }, { at: NESTED_LIST });
            const input = await startRename(wrapper, 'Empty folder');
            await input.setValue('Something else');
            await input.trigger('keydown', { key: 'Escape' });
            await flushPromises();
            expect(patches()).toEqual([]);
            expect(wrapper.find('input.pt-row__rename').exists()).toBe(false);
            expect(itemNamed(wrapper, 'Empty folder')).toBeTruthy();
        });

        it('saves nothing when the name is unchanged, too short, or a sibling\'s', async () => {
            const { wrapper } = await mountWith(ProjectTree, { projects: NESTED, label: 'Projects' }, { at: NESTED_LIST });
            const input = await startRename(wrapper, 'Empty folder');
            for (const name of ['ab', 'parent FOLDER']) {
                await input.setValue(name);
                await input.trigger('keydown', { key: 'Enter' });
                await flushPromises();
                expect(wrapper.find('input.pt-row__rename').exists()).toBe(true);
            }
            await input.setValue('Empty folder');
            await input.trigger('keydown', { key: 'Enter' });
            await flushPromises();
            expect(wrapper.find('input.pt-row__rename').exists()).toBe(false);
            expect(patches()).toEqual([]);
        });

        it('lets a subfolder take a name that only a folder at another level has', async () => {
            const { wrapper } = await mountWith(ProjectTree, { projects: NESTED, label: 'Projects' }, { at: NESTED_LIST });
            const input = await startRename(wrapper, 'Child folder');
            await input.setValue('Empty folder');
            await input.trigger('keydown', { key: 'Enter' });
            await flushPromises();
            expect(patches()).toHaveLength(1);
            expect(patches()[0][1]).toBe(`${env.FOLDER}/fc`);
        });

        it('keeps the tree\'s arrow keys out of the input', async () => {
            const { wrapper } = await mountWith(ProjectTree, { projects: NESTED, label: 'Projects' }, { at: NESTED_LIST });
            const input = await startRename(wrapper, 'Empty folder');
            await input.trigger('keydown', { key: 'ArrowUp' });
            await input.trigger('keydown', { key: 'Home' });
            expect(document.activeElement).toBe(input.element);
        });
    });

    describe('archiving the folder in view', () => {
        const confirm = async () => {
            await vi.dynamicImportSettled();
            await flushPromises();
            document.body.querySelector('[data-action="confirm"]').click();
            await flushPromises();
            await flushPromises();
        };

        it('asks first, then leaves the folder\'s page for the project', async () => {
            const read = apiRequest.getMockImplementation();
            apiRequest.mockImplementation((method, url, body) => (method === 'patch'
                ? Promise.resolve({ data: { status: true, data: { ...FOLDERS.p3[0], deletedStatusKey: 2 }, subfolders: [{ _id: 'fc', deletedStatusKey: 6 }] } })
                : read(method, url, body)));
            const { wrapper, router } = await mountWith(ProjectTree, { projects: NESTED, label: 'Projects' }, { at: NESTED_LIST });
            await openMenu(wrapper, 'Parent folder');
            [...rowOf(wrapper, 'Parent folder').querySelectorAll('[role="menuitem"]')].find((item) => item.textContent.trim() === 'Projects.archive').click();
            await flushPromises();
            expect(apiRequest.mock.calls.filter(([method]) => method === 'patch')).toEqual([]);
            expect(router.currentRoute.value.name).toBe('ProjectFolderSprint');

            await confirm();

            const [, url, body] = apiRequest.mock.calls.find(([method]) => method === 'patch');
            expect(url).toBe(`${env.FOLDER}/fp`);
            expect(body).toMatchObject({ type: 'updateFolder', updateObject: { $set: { deletedStatusKey: 2 } } });
            expect(router.currentRoute.value.name).toBe('Project');
            expect(router.currentRoute.value.params.id).toBe('p3');
        });

        it('stays where it is when another folder is archived', async () => {
            const read = apiRequest.getMockImplementation();
            apiRequest.mockImplementation((method, url, body) => (method === 'patch'
                ? Promise.resolve({ data: { status: true, data: { ...FOLDERS.p3[3], deletedStatusKey: 2 }, subfolders: [] } })
                : read(method, url, body)));
            const { wrapper, router } = await mountWith(ProjectTree, { projects: NESTED, label: 'Projects' }, { at: NESTED_LIST });
            await openMenu(wrapper, 'Empty folder');
            [...rowOf(wrapper, 'Empty folder').querySelectorAll('[role="menuitem"]')].find((item) => item.textContent.trim() === 'Projects.archive').click();
            await flushPromises();
            await confirm();
            expect(router.currentRoute.value.name).toBe('ProjectFolderSprint');
        });
    });
});
