import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import { defineComponent, ref } from 'vue';

const { push, projects, routeParams, routeQuery, toast, setSprints, setFolders } = await vi.hoisted(async () => ({
    push: vi.fn(),
    projects: (await import('vue')).ref([]),
    routeParams: { id: '' },
    routeQuery: { tab: 'ProjectListView' },
    toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() },
    setSprints: vi.fn(() => Promise.resolve([])),
    setFolders: vi.fn(() => Promise.resolve([]))
}));

vi.mock('vue-router', () => ({
    useRouter: () => ({ push }),
    useRoute: () => ({ params: routeParams, query: routeQuery })
}));
vi.mock('vue-toast-notification', () => ({ useToast: () => toast }));
vi.mock('@/views/Projects/helper', () => ({ useProjectsHelper: () => ({ projects }) }));

import { useProjectTree } from '@/views/Projects/composables/useProjectTree';

const alpha = { _id: 'p1', ProjectName: 'Alpha', isGlobalPermission: true, ProjectRequiredComponent: [{ keyName: 'KanbanView', setAsDefault: true }, { keyName: 'ProjectListView' }] };
const beta = { _id: 'p2', ProjectName: 'Beta', isGlobalPermission: true, ProjectRequiredComponent: [{ keyName: 'ProjectListView' }] };

function mountTree() {
    const commits = [];
    const store = createStore({
        getters: {
            'projectData/sprints': () => ({}),
            'projectData/folders': () => ({}),
            'projectData/projects': () => ({ data: projects.value }),
            'settings/companyUserDetail': () => ({ roleType: 1 })
        },
        mutations: {
            'projectData/mutateCurrentProjectDetails': (state, payload) => commits.push(payload._id),
            'projectData/mutateProjects': () => {}
        },
        actions: {
            'projectData/setSprints': (context, payload) => setSprints(payload),
            'projectData/setFolders': (context, payload) => setFolders(payload)
        }
    });
    const projectData = ref({});
    const Host = defineComponent({ setup() { return useProjectTree(projectData); }, render: () => null });
    const wrapper = mount(Host, { global: { plugins: [store] } });
    mounted.push(wrapper);
    return { wrapper, projectData, commits };
}

const mounted = [];
afterEach(() => {
    while (mounted.length) mounted.pop().unmount();
    delete routeParams.folderId;
});

describe('useProjectTree', () => {
    it('opens the project the URL names and commits it as current', () => {
        projects.value = [alpha, beta];
        routeParams.id = 'p2';
        const { projectData, commits } = mountTree();
        expect(projectData.value._id).toBe('p2');
        expect(commits).toEqual(['p2']);
        expect(push).not.toHaveBeenCalled();
    });

    it('falls back to the first project, says so, and rewrites the route with that project default tab', () => {
        projects.value = [alpha, beta];
        routeParams.id = 'missing';
        const { projectData } = mountTree();
        expect(toast.info).toHaveBeenCalledTimes(1);
        expect(projectData.value._id).toBe('p1');
        expect(push).toHaveBeenCalledWith({ name: 'Project', params: { cid: 'company-1', id: 'p1' }, query: { tab: 'ProjectListView' } });
    });

    it('selectProject keeps the current tab when the project has it, else its default', () => {
        projects.value = [alpha, beta];
        routeParams.id = 'p1';
        routeQuery.tab = 'ProjectListView';
        const { wrapper } = mountTree();
        wrapper.vm.selectProject({ _id: 'p2' }, true);
        expect(push).toHaveBeenLastCalledWith(expect.objectContaining({ params: { cid: 'company-1', id: 'p2' }, query: { tab: 'ProjectListView' } }));
        routeQuery.tab = 'Gantt';
        wrapper.vm.selectProject({ _id: 'p1' }, true);
        expect(push).toHaveBeenLastCalledWith(expect.objectContaining({ query: { tab: 'KanbanView' } }));
    });

    it('loads the sprint and folder tree when a folder deep link opens a global-permission project (PRJ-07)', async () => {
        projects.value = [alpha, beta];
        routeParams.id = 'p1';
        routeParams.folderId = 'f1';
        mountTree();
        await flushPromises();
        expect(setSprints).toHaveBeenCalledWith({ projectId: 'p1' });
        expect(setFolders).toHaveBeenCalledWith({ projectId: 'p1' });
    });

    it('loads the tree for a global-permission project opened without a folder', async () => {
        projects.value = [alpha, beta];
        routeParams.id = 'p1';
        mountTree();
        await flushPromises();
        expect(setSprints).toHaveBeenCalledWith({ projectId: 'p1' });
        expect(setFolders).toHaveBeenCalledWith({ projectId: 'p1' });
    });

    /* The board hangs its tasks off project.sprintsObj, and a sprint created through
       POST /api/v1/sprint is written only to the sprints collection — so a project
       document that embeds no sprintsObj must still end up with one to render. */
    it('makes a sprint that exists only in the sprints collection visible on the project', async () => {
        const project = { _id: 'p3', ProjectName: 'Gamma', isGlobalPermission: true, ProjectRequiredComponent: [{ keyName: 'ProjectListView' }] };
        const sprint = { _id: 's9', name: 'Sprint from the API', projectId: 'p3', deletedStatusKey: 0 };
        setSprints.mockResolvedValueOnce([sprint]);
        setFolders.mockResolvedValueOnce([]);

        projects.value = [project];
        routeParams.id = 'p3';
        mountTree();
        await flushPromises();

        expect(project.sprintsObj).toEqual({ s9: { ...sprint, id: 's9' } });
    });

    it('files a sprint that lives in a folder under that folder rather than the project root', async () => {
        const project = { _id: 'p4', ProjectName: 'Delta', isGlobalPermission: true, ProjectRequiredComponent: [{ keyName: 'ProjectListView' }] };
        const sprint = { _id: 's10', name: 'Foldered', projectId: 'p4', folderId: 'f9', deletedStatusKey: 0 };
        setSprints.mockResolvedValueOnce([sprint]);
        setFolders.mockResolvedValueOnce([{ _id: 'f9', name: 'Folder', projectId: 'p4', deletedStatusKey: 0 }]);

        projects.value = [project];
        routeParams.id = 'p4';
        mountTree();
        await flushPromises();

        expect(project.sprintsObj).toEqual({});
        expect(project.sprintsfolders.f9.sprintsObj.s10).toMatchObject({ _id: 's10', id: 's10', folderName: 'Folder' });
    });
});
