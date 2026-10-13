import { describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import { nextTick, reactive, ref } from 'vue';

const { push, replace, currentRoute, stub, access } = vi.hoisted(() => ({
    access: { create: true, ai: true },
    push: vi.fn(),
    replace: vi.fn(() => Promise.resolve()),
    currentRoute: { value: null },
    stub: (name, props = []) => ({ default: { name, props, render: () => null } })
}));

vi.mock('vue-router', () => ({
    useRouter: () => ({ push, replace, hasRoute: () => false }),
    useRoute: () => currentRoute.value
}));
vi.mock('@/composable', () => ({
    useCustomComposable: () => ({ checkPermission: (key) => (key === 'project.project_create' ? access.create : true) }),
    useGetterFunctions: () => ({ getUser: () => ({}) })
}));
vi.mock('@/composable/aiAvailability', () => ({ canUseAi: () => access.ai }));
vi.mock('@/components/molecules/AdminOnlyNote/AdminOnlyNote.vue', () => stub('AdminOnlyNote', ['what']));
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
vi.mock('@/components/organisms/CreateProject/CreateProjectSidebar.vue', () => stub('CreateProjectSidebar', ['isActiveCreateSidebar', 'initialName']));
vi.mock('@/components/organisms/AiProjectCreator/AiProjectCreator.vue', () => stub('AiProjectCreator'));
vi.mock('@/components/molecules/ConfirmationSidebar/ConfirmationSidebar.vue', () => stub('ConfirmationSidebar'));

import ProjectsListPage from '@/views/Projects/ProjectsListing/ProjectsListPage.vue';

const project = { _id: 'proj-1', ProjectName: 'Alpha', deletedStatusKey: 0, favouriteTasks: [] };

function mountPage(query = {}) {
    currentRoute.value = reactive({ params: { cid: 'company-1' }, query });
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

describe('ProjectsListPage from the palette\'s "New project"', () => {
    const sidebar = (wrapper) => wrapper.findComponent({ name: 'CreateProjectSidebar' });

    it('opens the create sidebar with the typed name and clears the query', async () => {
        const wrapper = mountPage({ create: 'project', name: 'Website relaunch', view: 'grid' });
        await flushPromises();
        expect(sidebar(wrapper).exists()).toBe(true);
        expect(sidebar(wrapper).props('initialName')).toBe('Website relaunch');
        expect(replace).toHaveBeenCalledWith({ query: { view: 'grid' } });
    });

    it('opens it with an empty name when none was typed', async () => {
        const wrapper = mountPage({ create: 'project' });
        await flushPromises();
        expect(sidebar(wrapper).props('initialName')).toBe('');
        expect(replace).toHaveBeenCalledWith({ query: {} });
    });

    it('opens it when the query arrives while Projects is already open', async () => {
        const wrapper = mountPage();
        await flushPromises();
        expect(sidebar(wrapper).exists()).toBe(false);
        expect(replace).not.toHaveBeenCalled();

        currentRoute.value.query = { create: 'project', name: 'Ops' };
        await nextTick();
        await flushPromises();
        expect(sidebar(wrapper).exists()).toBe(true);
        expect(sidebar(wrapper).props('initialName')).toBe('Ops');
        expect(replace).toHaveBeenCalledWith({ query: {} });
    });
});

describe('ProjectsListPage header when projects already exist', () => {
    const newProject = (wrapper) => wrapper.find('[data-test="header-new-project"]');
    const createAi = (wrapper) => wrapper.find('[data-test="header-create-ai"]');
    const setAccess = (create, ai) => { access.create = create; access.ai = ai; };

    it('offers New project and Create with AI to a creator with AI', async () => {
        setAccess(true, true);
        const wrapper = mountPage();
        await flushPromises();
        expect(wrapper.find('.pl2__row[role="button"]').exists()).toBe(true);
        expect(newProject(wrapper).exists()).toBe(true);
        expect(createAi(wrapper).exists()).toBe(true);
        expect(wrapper.findComponent({ name: 'AdminOnlyNote' }).exists()).toBe(false);
    });

    it('offers only New project when AI is off', async () => {
        setAccess(true, false);
        const wrapper = mountPage();
        await flushPromises();
        expect(newProject(wrapper).exists()).toBe(true);
        expect(createAi(wrapper).exists()).toBe(false);
    });

    it('shows neither to a Member, and the admin-only note instead', async () => {
        setAccess(false, true);
        const wrapper = mountPage();
        await flushPromises();
        expect(newProject(wrapper).exists()).toBe(false);
        expect(createAi(wrapper).exists()).toBe(false);
        expect(wrapper.findComponent({ name: 'AdminOnlyNote' }).props('what')).toBe('projects');
    });

    it('opens the create sidebar from New project', async () => {
        setAccess(true, true);
        const wrapper = mountPage();
        await flushPromises();
        await newProject(wrapper).trigger('click');
        expect(wrapper.findComponent({ name: 'CreateProjectSidebar' }).exists()).toBe(true);
    });

    it('opens the AI creator from Create with AI', async () => {
        setAccess(true, true);
        const wrapper = mountPage();
        await flushPromises();
        await createAi(wrapper).trigger('click');
        expect(wrapper.findComponent({ name: 'AiProjectCreator' }).exists()).toBe(true);
    });
});
