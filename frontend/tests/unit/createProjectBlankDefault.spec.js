import { describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';

const { apiRequest, stub } = vi.hoisted(() => ({ apiRequest: vi.fn(), stub: (name) => ({ default: { name, render: () => null } }) }));

vi.mock('@/services', () => ({ apiRequest, apiRequestWithoutCompnay: vi.fn() }));
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), useRoute: () => ({ params: {}, query: {} }) }));
vi.mock('@/composable', () => ({ useGetterFunctions: () => ({ getUser: () => ({}) }) }));
vi.mock('@/composable/aiAvailability', () => ({ aiUsable: ref(false) }));
vi.mock('@/components/templates/CreateProject/helper.js', () => ({ HandleProject: vi.fn() }));
vi.mock('@vuepic/vue-datepicker', () => stub('VueDatePicker'));
vi.mock('@vuepic/vue-datepicker/dist/main.css', () => ({}));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => stub('ShellIcon'));
vi.mock('@/components/atom/SpinnerComp/SpinnerComp.vue', () => stub('SpinnerComp'));
vi.mock('@/components/molecules/Assignee/Assignee.vue', () => stub('Assignee'));
vi.mock('@/components/molecules/SkillsSelect/SkillsSelect.vue', () => stub('SkillsSelect'));
vi.mock('@/components/molecules/ProjectSourceSelect/ProjectSourceSelect.vue', () => stub('ProjectSourceSelect'));
vi.mock('@/components/molecules/ProjectAppsList/ProjectAppsList.vue', () => stub('ProjectAppsList'));
vi.mock('@/components/organisms/AiProjectCreator/AiProjectCreator.vue', () => stub('AiProjectCreator'));

import CreateProjectSidebar from '@/components/organisms/CreateProject/CreateProjectSidebar.vue';

const STARTER = { _id: 'tpl-1', TemplateName: 'Implementation Plan', Description: 'Plan it', focus: 'software', taskStatusData: [{ name: 'Open' }], sampleTaskCount: 10, sampleTaskNames: ['An example task'] };

const store = createStore({
    modules: {
        settings: { namespaced: true, getters: { selectedCompany: () => ({ Cst_CompanyName: 'Acme' }), companyUserDetail: () => ({ roleType: 1 }), allCurrencyArray: () => [] } },
        users: { namespaced: true, getters: { users: () => [] } },
        projectData: { namespaced: true, getters: { allProjects: () => ({ data: [] }), projectTemplate: () => ({ data: [] }) }, actions: { setprojectTemplate: () => Promise.resolve() } }
    }
});

describe('a new project', () => {
    it('starts Blank, with no example tasks, until a template is picked', async () => {
        apiRequest.mockImplementation((method, url) => Promise.resolve({ data: url.includes('app') ? { data: [] } : { status: true, statusText: [STARTER] } }));
        const wrapper = mount(CreateProjectSidebar, {
            props: { isActiveCreateSidebar: true },
            global: { plugins: [store], stubs: { teleport: true } }
        });
        await flushPromises();

        const chosen = wrapper.findAll('.ah-cp__tpl.is-on');
        expect(chosen).toHaveLength(1);
        expect(chosen[0].text()).toContain('Auth.blank');
        expect(wrapper.find('.ah-cp__sample').text()).toContain('Auth.no_sample');

        await wrapper.findAll('.ah-cp__tpl').find((b) => b.text().includes('Implementation Plan')).trigger('click');
        expect(wrapper.find('.ah-cp__sample').text()).toContain('Auth.sample_tasks_label');
    });
});

describe('a new project started from the palette', () => {
    it('prefills the typed name and derives the key from it', async () => {
        apiRequest.mockImplementation((method, url) => Promise.resolve({ data: url.includes('app') ? { data: [] } : { status: true, statusText: [STARTER] } }));
        const wrapper = mount(CreateProjectSidebar, {
            props: { isActiveCreateSidebar: true, initialName: '  Website relaunch ' },
            global: { plugins: [store], stubs: { teleport: true } }
        });
        await flushPromises();

        expect(wrapper.find('#cp-name').element.value).toBe('Website relaunch');
        expect(wrapper.find('#cp-key').element.value).toBe('WR');
    });
});
