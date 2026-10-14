import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('@/locales/main', () => ({ i18n: { global: { t: (key) => `t:${key}` } } }));
vi.mock('@/components/organisms/Shell/shellState', () => ({ shellState: { agentsRunning: 0 } }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));
vi.mock('@/views/Ai/AiSidebar.vue', () => ({ default: { name: 'AiSidebar', render: () => null } }));
vi.mock('@/composable/approvedProjects', () => ({ showProjects: vi.fn(), dropProjects: vi.fn() }));

import AiInbox from '@/views/Ai/AiInbox.vue';

const PROJECT = '64b000000000000000000001';
const proposalOf = (id) => ({
    _id: id, agentName: 'QA', what: `Proposal ${id}`, why: 'Asked', status: 'pending',
    changes: [{ action: 'project.create', label: 'Create', reversible: true }], createdAt: new Date().toISOString(),
});
const store = createStore({ modules: { settings: { namespaced: true, getters: { companyUserDetail: () => ({ roleType: 1 }) } } } });

const answer = (type, url) => {
    if (type === 'post' && url.endsWith('/approve')) return Promise.resolve({ data: { status: true, data: { applied: [{ action: 'project.create', ok: true, result: { projectId: PROJECT } }] } } });
    if (type === 'post') return Promise.resolve({ data: { status: true, data: {} } });
    if (url.includes('/proposals')) return Promise.resolve({ data: { status: true, data: [proposalOf('pr1'), proposalOf('pr2')], counts: { waiting: 2 } } });
    return Promise.resolve({ data: { status: true, data: {} } });
};

const linkTo = (wrapper) => wrapper.find('[data-test="ai-open-made"]');
const approveFirst = async () => {
    apiRequest.mockImplementation(answer);
    const wrapper = mount(AiInbox, {
        global: {
            plugins: [store],
            provide: { $companyId: { value: 'c1' } },
            stubs: { 'router-link': { props: ['to'], template: '<a :data-to="JSON.stringify(to)"><slot /></a>' } },
        },
    });
    await flushPromises();
    await wrapper.findAll('.ai-item')[0].trigger('click');
    await wrapper.findAll('button').find((button) => button.text().includes('Ai.approve')).trigger('click');
    await flushPromises();
    return wrapper;
};

describe('the AI Inbox link to what an approval made', () => {
    beforeEach(() => { apiRequest.mockReset(); });

    it('opens the project the approval made', async () => {
        const wrapper = await approveFirst();
        expect(JSON.parse(linkTo(wrapper).attributes('data-to'))).toMatchObject({ name: 'Project', params: { id: PROJECT } });
    });

    it('goes away when another proposal is opened', async () => {
        const wrapper = await approveFirst();
        await wrapper.findAll('.ai-item')[0].trigger('click');
        await flushPromises();
        expect(linkTo(wrapper).exists()).toBe(false);
    });

    it('goes away when the next proposal is declined', async () => {
        const wrapper = await approveFirst();
        await wrapper.findAll('.ai-item')[0].trigger('click');
        await flushPromises();
        await wrapper.find('[data-test="decline"]').trigger('click');
        await wrapper.find('[data-test="decline-skip"]').trigger('click');
        await flushPromises();
        expect(linkTo(wrapper).exists()).toBe(false);
    });
});
