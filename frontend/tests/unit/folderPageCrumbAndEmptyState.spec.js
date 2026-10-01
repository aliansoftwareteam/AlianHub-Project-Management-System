import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config, flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import { createMemoryHistory, createRouter } from 'vue-router';
import { defineComponent, ref } from 'vue';

const { apiRequest, getters, projects, routeParams, setSprints, setFolders } = await vi.hoisted(async () => ({
    apiRequest: vi.fn(() => Promise.resolve({ data: { status: true, data: [] } })),
    getters: {},
    projects: (await import('vue')).ref([]),
    routeParams: { id: 'p1' },
    setSprints: vi.fn(),
    setFolders: vi.fn()
}));

vi.mock('@/store/index', () => ({ default: { getters } }));
vi.mock('@/services', () => ({ apiRequest, apiRequestWithoutCompnay: vi.fn() }));
vi.mock('@/locales/main', () => ({ i18n: { global: { t: (key) => key } } }));
vi.mock('@/utils/storageQueryBuild', () => ({ storageQueryBuilder: vi.fn() }));
vi.mock('@/composable/commonFunction', () => ({ isBundledPriorityImage: vi.fn() }));
vi.mock('@/views/Projects/helper', () => ({ useProjectsHelper: () => ({ projects }) }));
vi.mock('vue-router', async (original) => ({
    ...(await original()),
    useRouter: () => ({ push: vi.fn() }),
    useRoute: () => ({ params: routeParams, query: {} })
}));

import en from '@/locales/en';
import { useProjectTree } from '@/views/Projects/composables/useProjectTree';
import { folderSprintList, folderWithoutLists, headerLocation } from '@/views/Projects/folderSprints';
import ProjectHeader from '@/views/Projects/components/ProjectHeader.vue';
import FolderEmptyState from '@/views/Projects/components/FolderEmptyState.vue';
import { resetFavourites } from '@/composable/favourites';

const i18n = config.global.plugins[0];
i18n.global.setLocaleMessage('en', en);

const MEMBER = 3;
const rules = (create) => ({ project: { project_sprint_create: { roles: [{ key: MEMBER, permission: create }] } } });

const FOLDER_DOCS = [
    { _id: 'design', name: 'Design', projectId: 'p1', deletedStatusKey: 0 },
    { _id: 'icons', name: 'Icons', projectId: 'p1', deletedStatusKey: 0, parentFolderId: 'design' },
    { _id: 'empty', name: 'Empty', projectId: 'p1', deletedStatusKey: 0 },
    { _id: 'emptySub', name: 'Empty sub', projectId: 'p1', deletedStatusKey: 0, parentFolderId: 'empty' },
    { _id: 'trashed', name: 'Trashed lists', projectId: 'p1', deletedStatusKey: 0 },
    { _id: 'old', name: 'Old', projectId: 'p1', deletedStatusKey: 2 }
];
const SPRINT_DOCS = [
    { _id: 'r1', name: 'Inbox', projectId: 'p1', deletedStatusKey: 0 },
    { _id: 'i1', name: 'Glyphs', projectId: 'p1', folderId: 'icons', deletedStatusKey: 0 },
    { _id: 't1', name: 'Gone', projectId: 'p1', folderId: 'trashed', deletedStatusKey: 1 },
    { _id: 't2', name: 'Shelved', projectId: 'p1', folderId: 'trashed', deletedStatusKey: 2 }
];

const mounted = [];
const keep = (wrapper) => {
    mounted.push(wrapper);
    return wrapper;
};

/* The nested shape every project view reads is folded by useProjectTree from the two flat lists the API answers. */
async function foldedProject() {
    projects.value = [{ _id: 'p1', ProjectName: 'Alpha', isGlobalPermission: true, ProjectRequiredComponent: [{ keyName: 'ProjectListView' }] }];
    setSprints.mockResolvedValue(SPRINT_DOCS.map((doc) => ({ ...doc })));
    setFolders.mockResolvedValue(FOLDER_DOCS.map((doc) => ({ ...doc })));
    const store = createStore({
        getters: {
            'projectData/sprints': () => ({}),
            'projectData/folders': () => ({}),
            'projectData/projects': () => ({ data: projects.value }),
            'settings/companyUserDetail': () => ({ roleType: MEMBER })
        },
        mutations: { 'projectData/mutateCurrentProjectDetails': () => {}, 'projectData/mutateProjects': () => {} },
        actions: { 'projectData/setSprints': () => setSprints(), 'projectData/setFolders': () => setFolders() }
    });
    const projectData = ref({});
    const Host = defineComponent({ setup() { return useProjectTree(projectData); }, render: () => null });
    keep(mount(Host, { global: { plugins: [store] } }));
    await flushPromises();
    return projectData.value;
}

beforeEach(() => {
    resetFavourites();
    Object.assign(getters, {
        'settings/companyUserDetail': { roleType: MEMBER },
        'settings/rules': rules(true),
        'settings/projectRules': rules(false)
    });
});
afterEach(() => {
    while (mounted.length) mounted.pop().unmount();
    document.body.innerHTML = '';
});

describe('the header on a list inside a subfolder', () => {
    const blank = { render: () => null };
    const header = async (project, location) => {
        const router = createRouter({
            history: createMemoryHistory(),
            routes: [
                { path: '/:cid/project/:id/p', name: 'Project', component: blank },
                { path: '/:cid/project/:id/f/:folderId', name: 'ProjectFolder', component: blank },
                { path: '/:cid/project/:id/fs/:folderId/:sprintId', name: 'ProjectFolderSprint', component: blank },
                { path: '/:cid/project/:id/s/:sprintId', name: 'ProjectSprint', component: blank }
            ]
        });
        await router.push({ name: 'Project', params: { cid: 'company-1', id: 'p1' } });
        await router.isReady();
        const wrapper = keep(mount(ProjectHeader, { props: { project, projects: [project], sprint: location.sprint, folders: location.folders }, global: { plugins: [router] } }));
        await flushPromises();
        return { wrapper, router };
    };

    it('reads Project › Folder › Subfolder › List, each part linked to its own page', async () => {
        const project = await foldedProject();
        const sprints = folderSprintList({ folders: project.sprintsfolders, folderId: 'icons', sprintId: 'i1' });
        const location = headerLocation({ folders: project.sprintsfolders, sprints, folderId: 'icons' });
        expect(location.sprint).toMatchObject({ id: 'i1', name: 'Glyphs', folderId: 'icons' });
        expect(location.folders).toEqual([{ id: 'design', name: 'Design' }, { id: 'icons', name: 'Icons' }]);

        const { wrapper, router } = await header(project, location);
        expect(wrapper.find('.ph2__bar').text()).toMatch(/Alpha[\s\S]*›\s*Design\s*›\s*Icons\s*›\s*Glyphs/);
        const href = (name, params) => router.resolve({ name, params: { cid: 'company-1', id: 'p1', ...params } }).href;
        expect(wrapper.findAll('.ph2__folder-crumb a[href]').map((crumb) => crumb.attributes('href'))).toEqual([href('ProjectFolder', { folderId: 'design' }), href('ProjectFolder', { folderId: 'icons' })]);
        expect(wrapper.find('.ph2__crumb a[href]').attributes('href')).toBe(href('ProjectFolderSprint', { folderId: 'icons', sprintId: 'i1' }));
    });

    it('names the folders of the list in view when the route carries no folder', async () => {
        const project = await foldedProject();
        const location = headerLocation({ folders: project.sprintsfolders, sprints: [project.sprintsfolders.icons.sprintsObj.i1], folderId: undefined });
        expect(location.folders.map((folder) => folder.name)).toEqual(['Design', 'Icons']);
    });

    it('names the folders alone on a folder page, and nothing on the project page', async () => {
        const project = await foldedProject();
        const sprints = folderSprintList({ folders: project.sprintsfolders, folderId: 'design' });
        expect(headerLocation({ folders: project.sprintsfolders, sprints: [...sprints, project.sprintsObj.r1], folderId: 'design' })).toEqual({ sprint: null, folders: [{ id: 'design', name: 'Design' }] });
        expect(headerLocation({ folders: project.sprintsfolders, sprints: [], folderId: undefined })).toEqual({ sprint: null, folders: [] });
    });
});

describe('a folder with no lists', () => {
    it('is the folder in view when neither it nor a subfolder of it holds a live list', async () => {
        const { sprintsfolders } = await foldedProject();
        expect(folderWithoutLists(sprintsfolders, 'empty')).toBe(sprintsfolders.empty);
        expect(folderWithoutLists(sprintsfolders, 'emptySub')).toBe(sprintsfolders.emptySub);
        expect(folderWithoutLists(sprintsfolders, 'trashed')).toBe(sprintsfolders.trashed);
    });

    it('is not a folder that holds a list, a folder whose subfolder holds one, an archived folder or a missing one', async () => {
        const { sprintsfolders } = await foldedProject();
        expect(folderWithoutLists(sprintsfolders, 'icons')).toBeNull();
        expect(folderWithoutLists(sprintsfolders, 'design')).toBeNull();
        expect(folderWithoutLists(sprintsfolders, 'old')).toBeNull();
        expect(folderWithoutLists(sprintsfolders, 'gone')).toBeNull();
        expect(folderWithoutLists(undefined, 'empty')).toBeNull();
        expect(folderWithoutLists(sprintsfolders, undefined)).toBeNull();
    });

    const emptyState = (project, folderId) => keep(mount(FolderEmptyState, {
        props: { project, folders: project.sprintsfolders, folder: project.sprintsfolders[folderId] },
        global: { plugins: [createStore({ getters: { 'brandSettingTab/brandSettings': () => ({}) } })], mocks: { $t: i18n.global.t } }
    }));

    it('says so by the folder\'s path instead of guessing about tasks, and offers a new list', async () => {
        const project = await foldedProject();
        const wrapper = emptyState(project, 'emptySub');
        expect(wrapper.text()).toContain('Empty / Empty sub has no lists yet');
        expect(wrapper.text()).not.toContain('No tasks to show here');
        const action = wrapper.find('button');
        expect(action.text()).toBe('New list');
        await action.trigger('click');
        expect(wrapper.emitted('create')).toHaveLength(1);
    });

    it('offers the action by project.project_sprint_create of the project it is handed', async () => {
        const project = await foldedProject();
        getters['settings/rules'] = rules(false);
        expect(emptyState(project, 'empty').find('button').exists()).toBe(false);
        getters['settings/projectRules'] = rules(true);
        expect(emptyState({ ...project, isGlobalPermission: false }, 'empty').find('button').exists()).toBe(true);
        expect(emptyState({ ...project, isGlobalPermission: false, status: 'close' }, 'empty').find('button').exists()).toBe(false);
    });
});
