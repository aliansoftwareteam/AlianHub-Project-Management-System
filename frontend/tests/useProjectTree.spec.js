import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import { defineComponent, ref } from 'vue';

const { push, projects, routeParams, routeQuery, toast } = await vi.hoisted(async () => ({
    push: vi.fn(),
    projects: (await import('vue')).ref([]),
    routeParams: { id: '' },
    routeQuery: { tab: 'ProjectListView' },
    toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() }
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
            'projectData/setSprints': () => Promise.resolve([]),
            'projectData/setFolders': () => Promise.resolve([])
        }
    });
    const projectData = ref({});
    const Host = defineComponent({ setup() { return useProjectTree(projectData); }, render: () => null });
    const wrapper = mount(Host, { global: { plugins: [store] } });
    mounted.push(wrapper);
    return { wrapper, projectData, commits };
}

const mounted = [];
afterEach(() => { while (mounted.length) mounted.pop().unmount(); });

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
});
