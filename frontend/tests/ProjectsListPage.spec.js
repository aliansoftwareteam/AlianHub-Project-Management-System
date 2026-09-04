import { describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import { ref } from 'vue';

const { push, stub } = vi.hoisted(() => ({
    push: vi.fn(),
    stub: (name) => ({ default: { name, render: () => null } })
}));

vi.mock('vue-router', () => ({
    useRouter: () => ({ push, hasRoute: () => false }),
    useRoute: () => ({ params: {}, query: {} })
}));
vi.mock('@/composable', () => ({
    useCustomComposable: () => ({ checkPermission: () => true }),
    useGetterFunctions: () => ({ getUser: () => ({}) })
}));
vi.mock('@/views/Projects/helper', () => ({ useProjectsHelper: () => ({ dispatchProjects: vi.fn(() => Promise.resolve()) }) }));
vi.mock('@/views/Projects/composables/useProjectLifecycle', () => ({
    useProjectLifecycle: () => ({ archive: vi.fn(), showSpinner: ref(false), updateProject: vi.fn(), markProjectFavourite: vi.fn() })
}));
vi.mock('@/views/Projects/ProjectsListing/useProjectHealth', () => ({
    deriveHealth: () => ({ key: 'unknown', label: '', bySource: '', reasons: [] }),
    loadProjectSnapshot: vi.fn(),
    projectSnapshot: () => null,
    sprintWindow: () => null
}));
vi.mock('@/components/organisms/CreateProject/CreateProjectSidebar.vue', () => stub('CreateProjectSidebar'));
vi.mock('@/components/organisms/AiProjectCreator/AiProjectCreator.vue', () => stub('AiProjectCreator'));
vi.mock('@/components/molecules/ConfirmationSidebar/ConfirmationSidebar.vue', () => stub('ConfirmationSidebar'));

import ProjectsListPage from '@/views/Projects/ProjectsListing/ProjectsListPage.vue';

const project = { _id: 'proj-1', ProjectName: 'Alpha', deletedStatusKey: 0, favouriteTasks: [] };

function mountPage() {
    const store = createStore({
        getters: {
            'projectData/allProjects': () => ({ data: [project] }),
            'settings/selectedCompany': () => ({})
        }
    });
    return mount(ProjectsListPage, { global: { plugins: [store], stubs: { 'router-link': true } } });
}

describe('ProjectsListPage', () => {
    it('opens the project when its row is clicked', async () => {
        const wrapper = mountPage();
        const row = wrapper.find('.pl2__row[role="button"]');
        expect(row.exists()).toBe(true);
        await row.trigger('click');
        expect(push).toHaveBeenCalledWith({ name: 'Project', params: { cid: 'company-1', id: 'proj-1' } });
    });
});
