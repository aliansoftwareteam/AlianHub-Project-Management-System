import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));
vi.mock('vue-router', async (original) => ({ ...(await original()), useRoute: () => ({ params: { cid: 'c1' } }) }));
vi.mock('@/views/Ai/useAgents', () => ({
    useAgents: () => ({ waiting: { value: 0 }, running: { value: 0 }, spend: { value: { totalUsd: 0, agents: [] } }, pauseAll: vi.fn() }),
}));

import WorkflowBuilderPage from '@/views/Workflows/WorkflowBuilderPage.vue';
import WorkflowApprovalDetail from '@/views/Ai/WorkflowApprovalDetail.vue';
import { membersOnly } from '@/views/Workflows/approvalOwners';

const OWNER = 1;
const GUEST = 0;
const MEMBER = 3;

const USERS = [
    { _id: 'u1', Employee_Name: 'Ada Lin' },
    { _id: 'u2', Employee_Name: 'Dana Reed' },
    { _id: 'u3', Employee_Name: 'Sam Ali' },
    { _id: 'u4', Employee_Name: 'Gus Guest' },
];
const SEATS = [
    { userId: 'u1', roleType: OWNER },
    { userId: 'u2', roleType: MEMBER },
    { userId: 'u3', roleType: MEMBER },
    { userId: 'u4', roleType: GUEST },
];

const store = () => createStore({
    modules: {
        settings: { namespaced: true, getters: { companyUserDetail: () => ({ roleType: OWNER }), companyUsers: () => SEATS } },
        users: { namespaced: true, getters: { users: () => USERS } },
    },
});

const MANIFEST = {
    stepTypes: [{
        key: 'human_approval',
        label: 'Ask a person',
        config: { ownerUserId: { type: 'user', label: 'Owner' }, escalateToUserId: { type: 'user', label: 'Escalate to' } },
        output: {},
    }],
    bounds: {},
};

const namesIn = (select) => select.findAll('option').map((option) => option.text()).filter((name) => USERS.some((user) => user.Employee_Name === name));

describe('who a picker offers as the owner of an approval', () => {
    beforeEach(() => {
        apiRequest.mockReset();
        apiRequest.mockImplementation(async (method, url) => {
            if (url.includes('/workflows/step-types')) return { data: { status: true, data: MANIFEST } };
            return { data: { status: true, data: [] } };
        });
    });

    /* [the seats the workspace holds, who is offered] */
    it.each([
        ['a guest among members', SEATS, ['u1', 'u2', 'u3']],
        ['no seats read yet', undefined, ['u1', 'u2', 'u3', 'u4']],
        ['a seat with its role as text', [{ userId: 'u4', roleType: '0' }], ['u1', 'u2', 'u3']],
    ])('leaves a guest out: %s', (_what, seats, offered) => {
        expect(membersOnly(USERS, seats).map((user) => user._id)).toEqual(offered);
    });

    it('the workflow builder offers members for both people an approval names', async () => {
        const wrapper = mount(WorkflowBuilderPage, { global: { plugins: [store()] } });
        await flushPromises();
        await wrapper.findAll('button').find((button) => button.text().includes('WorkflowBuilder.new')).trigger('click');
        await flushPromises();
        const pickers = wrapper.findAll('select').filter((select) => namesIn(select).length);
        expect(pickers).toHaveLength(2);
        pickers.forEach((picker) => expect(namesIn(picker)).toEqual(['Ada Lin', 'Dana Reed', 'Sam Ali']));
    });

    it('handing an approval on offers members, less the one who holds it', async () => {
        const approval = { _id: 'ap1', runId: 'run-1', stepId: 'sApprove', title: 'Ship it', status: 'pending', ownerUserId: 'u2', ownerName: 'Dana Reed', owners: ['u2'], reassignments: [], canDecide: true };
        const wrapper = mount(WorkflowApprovalDetail, {
            props: { approval },
            global: { plugins: [store()], stubs: { RouterLink: { template: '<a><slot /></a>' } } },
        });
        await wrapper.find('[data-test="approval-reassign-open"]').trigger('click');
        expect(namesIn(wrapper.find('[data-test="approval-reassign-to"]'))).toEqual(['Ada Lin', 'Sam Ali']);
    });
});
