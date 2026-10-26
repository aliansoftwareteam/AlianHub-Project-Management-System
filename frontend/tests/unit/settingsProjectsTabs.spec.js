import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';

const { access, apiRequest, stub } = vi.hoisted(() => ({
    access: { granted: new Set() },
    apiRequest: vi.fn(() => Promise.resolve({ data: { data: [] } })),
    stub: (name, props = []) => ({ default: { name, props, render: () => null } })
}));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('@/composable', () => ({
    useCustomComposable: () => ({ checkPermission: (key) => access.granted.has(key) })
}));
vi.mock('@/composable/favourites', () => ({ useFavourites: () => ({ isFavourite: () => false, toggleFavourite: vi.fn() }) }));
vi.mock('@/composable/projects', () => ({ useProjects: () => ({ checkSpecificTypeCount: () => true }) }));
vi.mock('@/composable/commonFunction', () => ({ projectComponentsIcons: () => ({ icon: '', activeIcon: '' }) }));
vi.mock('@/views/Projects/helper', () => ({ useProjectsHelper: () => ({ dispatchProjects: vi.fn(() => Promise.resolve()) }) }));
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/components/molecules/Assignee/Assignee.vue', () => stub('Assignee'));
vi.mock('@/components/atom/WasabiIamgeCompp/WasabiIamgeCompp.vue', () => stub('WasabiImage'));
vi.mock('@/components/atom/TaskTypeIcon/TaskTypeIcon.vue', () => stub('TaskTypeIcon'));
vi.mock('@/components/molecules/ProjectAppsList/ProjectAppsList.vue', () => stub('ProjectAppsList'));
vi.mock('@/components/atom/ProjectSettingSidebar/ProjectSettingSidebar.vue', () => stub('ProjectSettingSidebar'));
vi.mock('@/components/molecules/ConfirmationSidebar/ConfirmationSidebar.vue', () => stub('ConfirmationSidebar', ['modelValue', 'title', 'message', 'confirmationString', 'acceptButton']));
vi.mock('@/components/molecules/DropDown/DropDown.vue', () => ({ default: { name: 'DropDown', template: '<div><slot name="button" /><slot name="options" /></div>' } }));
vi.mock('@/components/molecules/DropDownOption/DropDownOption.vue', () => ({ default: { name: 'DropDownOption', emits: ['click'], template: '<button type="button" @click="$emit(\'click\')"><slot /></button>' } }));

import SettingsProjects from '@/views/Settings/Projects/Projects.vue';
import ProjectsListingSetting from '@/components/molecules/ProjectsListingSetting/ProjectsListingSetting.vue';

const statuses = [
    { value: 'open', name: 'Open', type: 'default_active' },
    { value: 'in_testing', name: 'In Testing', type: 'active' },
    { value: 'close', name: 'Close', type: 'close' }
];
const project = (id, extra = {}) => ({
    _id: id, ProjectName: `Project ${id}`, ProjectCode: id.toUpperCase(), Created_At: 1, deletedStatusKey: 0, statusType: 'default_active', status: 'open',
    projectIcon: { type: 'color', data: '' }, projectStatusData: statuses, taskStatusData: [], ProjectRequiredComponent: [], AssigneeUserId: [], LeadUserId: [], apps: [], ...extra
});

const projects = [
    project('open1'),
    project('open2'),
    project('arch', { deletedStatusKey: 2 }),
    project('closedarch', { deletedStatusKey: 2, statusType: 'close', status: 'close' }),
    project('closed', { statusType: 'close', status: 'close', statusBeforeClose: 'in_testing' }),
    project('trashed', { deletedStatusKey: 1 }),
    project('mine', { isPersonal: true })
];

const storeWith = () => createStore({
    getters: {
        'projectData/allProjects': () => ({ data: projects }),
        'users/users': () => [],
        'settings/projectTabComponents': () => []
    },
    mutations: { 'projectData/projectLocalUpdate': vi.fn(), 'projectData/mutateProjects': vi.fn() }
});

const BASE = ['settings.settings_project_list', 'project.project_details'];

beforeEach(() => {
    apiRequest.mockClear();
    access.granted = new Set([...BASE, 'project.project_close', 'project.project_delete']);
});

describe('Settings › Projects tabs', () => {
    const mountPage = () => mount(SettingsProjects, { global: { plugins: [storeWith()], stubs: { ProjectsListingSetting: { name: 'ProjectsListingSetting', props: ['item'], template: '<div class="row-stub" />' } } } });
    const rows = (wrapper) => wrapper.findAllComponents({ name: 'ProjectsListingSetting' }).map((row) => row.props('item')._id);

    it('counts open, archived and closed projects; personal and trashed ones are left out', () => {
        const wrapper = mountPage();
        expect(wrapper.get('[data-test="projects-tab-active"]').text()).toBe('Projects.tab_open (2)');
        expect(wrapper.get('[data-test="projects-tab-archived"]').text()).toBe('Projects.tab_archived (2)');
        expect(wrapper.get('[data-test="projects-tab-closed"]').text()).toBe('Projects.tab_closed (1)');
    });

    it('lists the chosen tab, an archived closed project under Archived', async () => {
        const wrapper = mountPage();
        expect(rows(wrapper).sort()).toEqual(['open1', 'open2']);
        await wrapper.get('[data-test="projects-tab-archived"]').trigger('click');
        expect(rows(wrapper).sort()).toEqual(['arch', 'closedarch']);
        await wrapper.get('[data-test="projects-tab-closed"]').trigger('click');
        expect(rows(wrapper)).toEqual(['closed']);
    });
});

describe('a project row in Settings › Projects', () => {
    const mountRow = (item) => mount(ProjectsListingSetting, { props: { item }, global: { plugins: [storeWith()] } });
    const actions = (wrapper) => wrapper.findAll('[data-test^="project-action-"]').map((option) => option.attributes('data-test').replace('project-action-', ''));
    const sent = () => apiRequest.mock.calls.filter(([method, url]) => method === 'put' && url.includes('/api/v1/project/')).map(([, , body]) => body.updateObject);

    it.each([
        ['open', projects[0], ['close', 'archive']],
        ['closed', projects[4], ['reopen', 'archive']],
        ['archived', projects[2], ['restore', 'delete']]
    ])('an %s project offers %o', (_state, item, expected) => {
        expect(actions(mountRow(item))).toEqual(expected);
    });

    it('each action needs its own permission', () => {
        access.granted = new Set([...BASE, 'project.project_close']);
        expect(actions(mountRow(projects[0]))).toEqual(['close']);
        access.granted = new Set([...BASE, 'project.project_delete']);
        expect(actions(mountRow(projects[2]))).toEqual(['restore', 'delete']);
        access.granted = new Set(['project.project_close', 'project.project_delete']);
        expect(actions(mountRow(projects[0]))).toEqual([]);
    });

    it('an archived closed project shows that it is closed', () => {
        expect(mountRow(projects[3]).find('[data-test="closed-chip"]').exists()).toBe(true);
        expect(mountRow(projects[2]).find('[data-test="closed-chip"]').exists()).toBe(false);
    });

    it('reopen returns the status the project had before it was closed', async () => {
        const wrapper = mountRow(projects[4]);
        await wrapper.get('[data-test="project-action-reopen"]').trigger('click');
        await flushPromises();
        expect(sent()).toEqual([{ status: 'in_testing', statusType: 'active' }]);
    });

    it('restore sends the project back without touching its tasks from the browser', async () => {
        const wrapper = mountRow(projects[2]);
        await wrapper.get('[data-test="project-action-restore"]').trigger('click');
        await flushPromises();
        expect(sent()).toEqual([{ deletedStatusKey: 0 }]);
        expect(apiRequest.mock.calls.some(([, url]) => String(url).includes('allTask') || String(url).includes('/api/v1/task'))).toBe(false);
    });

    it('archive asks first, with the project message, then archives', async () => {
        const wrapper = mountRow(projects[0]);
        await wrapper.get('[data-test="project-action-archive"]').trigger('click');
        const confirm = wrapper.getComponent({ name: 'ConfirmationSidebar' });
        expect(confirm.props()).toMatchObject({ modelValue: true, message: 'conformationmsg.archive_project', confirmationString: 'archive' });
        expect(sent()).toEqual([]);
        confirm.vm.$emit('confirm');
        await flushPromises();
        expect(sent()).toEqual([{ deletedStatusKey: 2 }]);
    });

    it('archived and closed rows are read-only', () => {
        expect(mountRow(projects[2]).find('.pls__go').exists()).toBe(true);
        expect(mountRow(projects[4]).find('.pls__go').exists()).toBe(false);
        expect(mountRow(projects[2]).find('.pls__share--locked').exists()).toBe(true);
        expect(mountRow(projects[0]).find('.pls__share--locked').exists()).toBe(false);
    });
});
