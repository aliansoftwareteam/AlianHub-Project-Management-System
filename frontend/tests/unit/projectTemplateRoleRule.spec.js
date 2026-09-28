import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));
vi.mock('@/services', () => ({ apiRequest, apiRequestWithoutCompnay: vi.fn() }));
vi.mock('vue-router', () => ({ useRoute: () => ({ name: 'Template', params: {} }) }));
vi.mock('@/views/Settings/Template/CreateTemplate.vue', () => ({ __esModule: true, default: { name: 'CreateTemplate', render: () => null } }));
vi.mock('@/views/Settings/Template/CreateTemplateWithAI.vue', () => ({ __esModule: true, default: { name: 'CreateTemplateWithAI', render: () => null } }));
vi.mock('@/composable/commonFunction', () => ({ getImageUrl: () => '', projectComponentsIcons: () => ({}) }));
vi.mock('@/components/atom/Modal/Modal.vue', () => ({ __esModule: true, default: { name: 'ConfirmModal', render: () => null } }));
vi.mock('@/components/templates/CreateProject/TemplateAllDetail.vue', () => ({ __esModule: true, default: { name: 'TemplateAllDetail', render: () => null } }));

import Template from '@/views/Settings/Template/Template.vue';
import TemplateDetail from '@/components/templates/CreateProject/TemplateDetail.vue';

const ROLE = { owner: 1, admin: 2, member: 3, guest: 0 };
const TEMPLATE = { _id: 't1', TemplateName: 'Client onboarding', Description: 'Steps', apps: [], taskStatusData: [], TemplateTaskType: [], projectStatusData: [], TemplateRequiredComponent: [] };

const store = (roleType) => createStore({
    modules: {
        settings: { namespaced: true, getters: { companyUserDetail: () => ({ roleType }), companies: () => [] } },
        projectData: {
            namespaced: true,
            getters: { projectTemplate: () => ({ data: [] }) },
            actions: { setprojectTemplate: () => Promise.resolve() },
            mutations: { mutateprojectTemplate: () => {} },
        },
    },
});

const mountPage = (role) => mount(Template, { global: { plugins: [store(ROLE[role])], stubs: { TemplateDetail: true } } });
const mountDetail = (role) => mount(TemplateDetail, { props: { templateView: TEMPLATE, currentSelectedKey: 0 }, global: { plugins: [store(ROLE[role])], stubs: { TaskTypeIcon: true, WasabiIamgeCompp: true } } });

const buttonTexts = (wrapper) => wrapper.findAll('button').map((b) => b.text());

beforeEach(() => { apiRequest.mockResolvedValue({ data: { status: true, statusText: [] } }); });

describe('Settings → Templates', () => {
    it.each(['owner', 'admin'])('offers an %s the new template and describe-it controls', async (role) => {
        const wrapper = mountPage(role);
        await flushPromises();
        const texts = buttonTexts(wrapper);
        expect(texts).toContain('Settings.from_description');
        expect(texts.filter((text) => text === 'Settings.new_template')).toHaveLength(2);
    });

    it.each(['member', 'guest'])('shows a %s the templates without the create controls', async (role) => {
        const wrapper = mountPage(role);
        await flushPromises();
        const texts = buttonTexts(wrapper);
        expect(texts).not.toContain('Settings.from_description');
        expect(texts).not.toContain('Settings.new_template');
        expect(wrapper.text()).toContain('Templates.templates');
        expect(wrapper.find('[role="tablist"]').exists()).toBe(true);
    });
});

describe('a company template\'s detail', () => {
    it.each(['owner', 'admin'])('lets an %s delete it', (role) => {
        expect(mountDetail(role).find('.deleteTemplateBtn').exists()).toBe(true);
    });

    it.each(['member', 'guest'])('shows a %s the template without the delete control', (role) => {
        const wrapper = mountDetail(role);
        expect(wrapper.find('.deleteTemplateBtn').exists()).toBe(false);
        expect(wrapper.text()).toContain('Client onboarding');
    });
});
