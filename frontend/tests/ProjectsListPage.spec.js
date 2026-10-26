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

function mountPage(query = {}, projects = [project]) {
    currentRoute.value = reactive({ params: { cid: 'company-1' }, query });
    const store = createStore({
        getters: {
            'projectData/allProjects': () => ({ data: projects }),
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

describe('ProjectsListPage search', () => {
    const projects = [
        project,
        { _id: 'proj-2', ProjectName: 'Shopify Store Locator', ProjectCode: 'SSL', deletedStatusKey: 0, favouriteTasks: [] },
        { _id: 'proj-3', ProjectName: 'Marketing Team Task', ProjectCode: 'MKT', deletedStatusKey: 0, favouriteTasks: [] }
    ];
    const titles = (wrapper) => wrapper.findAll('.pl2__title').map((el) => el.text());
    const search = (wrapper) => wrapper.find('[data-test="project-search"]');

    it('narrows the rows by name or code, ignoring case', async () => {
        const wrapper = mountPage({}, projects);
        await flushPromises();
        expect(titles(wrapper)).toHaveLength(3);
        await search(wrapper).setValue('  shopify ');
        expect(titles(wrapper)).toEqual(['Shopify Store Locator']);
        await search(wrapper).setValue('mkt');
        expect(titles(wrapper)).toEqual(['Marketing Team Task']);
    });

    it('says nothing matched and clears back to every project', async () => {
        const wrapper = mountPage({}, projects);
        await flushPromises();
        await search(wrapper).setValue('zzz');
        expect(titles(wrapper)).toHaveLength(0);
        const empty = wrapper.find('[data-test="project-search-empty"]');
        expect(empty.exists()).toBe(true);
        await empty.find('button').trigger('click');
        expect(titles(wrapper)).toHaveLength(3);
    });

    it('clears on Escape', async () => {
        const wrapper = mountPage({}, projects);
        await flushPromises();
        await search(wrapper).setValue('alpha');
        expect(titles(wrapper)).toEqual(['Alpha']);
        await search(wrapper).trigger('keydown', { key: 'Escape' });
        expect(titles(wrapper)).toHaveLength(3);
    });
});
