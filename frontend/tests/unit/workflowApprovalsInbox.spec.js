import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';

const { apiRequest, echo } = vi.hoisted(() => ({
    apiRequest: vi.fn(),
    echo: (key, params) => (params ? `${key} ${JSON.stringify(params)}` : key)
}));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('@/locales/main', () => ({ i18n: { global: { t: (key) => `t:${key}` } } }));
vi.mock('@/components/organisms/Shell/shellState', () => ({ shellState: { agentsRunning: 0 } }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));
vi.mock('@/views/Ai/AiSidebar.vue', () => ({ default: { name: 'AiSidebar', render: () => null } }));
vi.mock('vue-i18n', async (importOriginal) => ({ ...(await importOriginal()), useI18n: () => ({ t: echo }) }));
vi.mock('vue-router', () => ({ useRoute: () => ({ params: { id: 'run-1', cid: 'c1' } }) }));

import AiInbox from '@/views/Ai/AiInbox.vue';

const OWNER = 1;
const MEMBER = 3;

const hours = (n) => new Date(Date.now() + n * 3600000).toISOString();

const approval = (over = {}) => ({
    _id: 'ap1',
    runId: 'run-1',
    stepId: 'sApprove',
    workflowId: 'wf-release',
    title: 'Ship the release',
    prompt: 'The release notes are ready. Ship it?',
    status: 'pending',
    ownerUserId: 'u2',
    ownerName: 'Dana Reed',
    ownerRole: null,
    owners: ['u2'],
    ownerNames: ['Dana Reed'],
    escalateToUserId: 'u3',
    escalateToName: 'Sam Ali',
    escalateAt: hours(1),
    escalatedAt: null,
    deadlineAt: hours(2),
    onDeadline: 'escalate',
    reassignments: [],
    canDecide: true,
    run: { _id: 'run-1', name: 'Nightly sweep', workflowId: 'wf-release', status: 'running', startedBy: 'u1' },
    step: { stepId: 'sApprove', type: 'human_approval', status: 'pending' },
    ...over
});

const storeFor = (roleType) => createStore({
    modules: {
        settings: { namespaced: true, getters: { companyUserDetail: () => ({ roleType }) } },
        users: {
            namespaced: true,
            getters: { users: () => [{ _id: 'u2', Employee_Name: 'Dana Reed' }, { _id: 'u3', Employee_Name: 'Sam Ali' }] }
        }
    }
});

const RouterLink = { props: ['to'], template: '<a><slot /></a>' };

const respond = ({ rows = [approval()], approvalsStatus = 200, post } = {}) => (type, url, body) => {
    if (type === 'post') return Promise.resolve({ data: { status: true, data: post ? post(url, body) : {} } });
    if (String(url).includes('/workflows/approvals')) {
        if (approvalsStatus !== 200) return Promise.reject({ response: { status: approvalsStatus, data: { statusText: 'off' } } });
        return Promise.resolve({ data: { status: true, data: rows } });
    }
    if (String(url).includes('/proposals')) return Promise.resolve({ data: { status: true, data: [], counts: { waiting: 0 } } });
    return Promise.resolve({ data: { status: true, data: {} } });
};

const openApprovals = async ({ roleType = OWNER, ...rest } = {}) => {
    apiRequest.mockImplementation(respond(rest));
    const wrapper = mount(AiInbox, { global: { plugins: [storeFor(roleType)], stubs: { RouterLink } } });
    await flushPromises();
    const tab = wrapper.findAll('.ah-tab').find((button) => button.text().includes('Workflows.approvals_tab'));
    await tab.trigger('click');
    await flushPromises();
    return wrapper;
};

const callTo = (suffix) => apiRequest.mock.calls.find(([type, url]) => type === 'post' && String(url).endsWith(suffix));

describe('AiInbox workflow approvals', () => {
    beforeEach(() => { apiRequest.mockReset(); });

    it('shows a workflow approval with its owner and its deadline', async () => {
        const wrapper = await openApprovals();
        const row = wrapper.find('[data-test="approval-row"]');
        expect(row.exists()).toBe(true);
        expect(row.find('[data-test="approval-row-owner"]').text()).toBe('Dana Reed');
        expect(row.find('[data-test="approval-row-deadline"]').exists()).toBe(true);

        await row.trigger('click');
        expect(wrapper.find('[data-test="approval-owner"]').text()).toBe('Dana Reed');
        expect(wrapper.find('[data-test="approval-deadline"]').text()).toContain('approval_deadline_at');
        expect(wrapper.find('[data-test="approval-escalation"]').text()).toContain('Sam Ali');
    });

    it('decides an approval and takes it out of the queue', async () => {
        const wrapper = await openApprovals({ post: () => ({ approval: approval({ status: 'approved', canDecide: false }) }) });
        await wrapper.find('[data-test="approval-row"]').trigger('click');
        await wrapper.find('[data-test="approval-approve"]').trigger('click');
        await flushPromises();

        expect(callTo('/runs/run-1/steps/sApprove/decide')[2]).toEqual({ decision: 'approved', comment: '' });
        expect(wrapper.find('[data-test="approval-row"]').exists()).toBe(false);
        expect(wrapper.find('[data-test="approvals-empty"]').exists()).toBe(true);
    });

    it('reassigns an approval and shows who moved it and to whom', async () => {
        const moved = approval({
            ownerUserId: 'u3',
            ownerName: 'Sam Ali',
            reassignedBy: 'u1',
            reassignments: [{ from: 'u2', fromName: 'Dana Reed', to: 'u3', toName: 'Sam Ali', by: 'u1', byName: 'Ada Lin', at: hours(0), reason: 'Dana is away' }]
        });
        const wrapper = await openApprovals({ post: () => ({ approval: moved }) });
        await wrapper.find('[data-test="approval-row"]').trigger('click');
        await wrapper.find('[data-test="approval-reassign-open"]').trigger('click');
        await wrapper.find('[data-test="approval-reassign-to"]').setValue('u3');
        await wrapper.find('[data-test="approval-reassign-reason"]').setValue('Dana is away');
        await wrapper.find('[data-test="approval-reassign-send"]').trigger('click');
        await flushPromises();

        expect(callTo('/runs/run-1/steps/sApprove/reassign')[2]).toEqual({ toUserId: 'u3', reason: 'Dana is away' });
        const handovers = wrapper.find('[data-test="approval-handovers"]');
        expect(handovers.exists()).toBe(true);
        expect(handovers.text()).toContain('Ada Lin');
        expect(handovers.text()).toContain('Dana Reed');
        expect(handovers.text()).toContain('Sam Ali');
    });

    it('gives a member who owns nothing the approval to read and no control over it', async () => {
        const wrapper = await openApprovals({ roleType: MEMBER, rows: [approval({ canDecide: false })] });
        await wrapper.find('[data-test="approval-row"]').trigger('click');
        expect(wrapper.find('[data-test="approval-read-only"]').exists()).toBe(true);
        expect(wrapper.find('[data-test="approval-actions"]').exists()).toBe(false);
        expect(wrapper.find('[data-test="approval-approve"]').exists()).toBe(false);
        expect(wrapper.find('[data-test="approval-reassign-open"]').exists()).toBe(false);
    });

    it('says the engine is not running rather than failing when the flag is off', async () => {
        const wrapper = await openApprovals({ approvalsStatus: 503 });
        expect(wrapper.find('[data-test="approvals-engine-off"]').exists()).toBe(true);
        expect(wrapper.find('[data-test="approval-row"]').exists()).toBe(false);
    });
});
