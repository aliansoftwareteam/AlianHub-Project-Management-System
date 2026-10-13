import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import { ref } from 'vue';

const { apiRequest, echo } = vi.hoisted(() => ({
    apiRequest: vi.fn(),
    echo: (key, params) => (params ? `${key} ${JSON.stringify(params)}` : key)
}));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('@/locales/main', () => ({ i18n: { global: { t: (key) => `t:${key}` } } }));
vi.mock('@/components/organisms/Shell/shellState', () => ({ shellState: { agentsRunning: 0 } }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));
vi.mock('vue-i18n', async (importOriginal) => ({ ...(await importOriginal()), useI18n: () => ({ t: echo }) }));
vi.mock('vue-router', () => ({ useRoute: () => ({ params: { id: 'run-1', cid: 'c1' } }) }));

import WorkflowLineageView from '@/views/Ai/WorkflowLineageView.vue';

const step = (over = {}) => ({
    stepId: 's1', index: 0, type: 'tool_call', status: 'success', attempts: 1, maxAttempts: 3,
    dependsOn: [], config: {}, output: {},
    startedAt: '2026-09-01T10:00:00.000Z', finishedAt: '2026-09-01T10:00:02.000Z', ...over
});

const run = (over = {}) => ({ _id: 'run-1', workflowId: 'wf', name: 'Nightly sweep', status: 'running', startedBy: 'u1', ...over });

const store = createStore({
    modules: {
        settings: { namespaced: true, getters: { companyUserDetail: () => ({ roleType: 1 }) } },
        users: { namespaced: true, getters: { users: () => [{ _id: 'u1', Employee_Name: 'Ada Lin' }, { _id: 'u2', Employee_Name: 'Dana Reed' }] } }
    }
});

const RouterLink = { props: ['to'], template: '<a><slot /></a>' };

const mountView = async ({ steps = [], rows = run(), agents = [{ _id: 'ag1', name: 'Release bot' }], httpStatus = 200 } = {}) => {
    apiRequest.mockImplementation((type, url) => {
        if (String(url).includes('/workflows/runs')) {
            if (httpStatus !== 200) return Promise.reject({ response: { status: httpStatus, data: { statusText: 'off' } } });
            return Promise.resolve({ data: { status: true, data: { run: rows, steps } } });
        }
        return Promise.resolve({ data: { status: true, data: agents } });
    });
    const wrapper = mount(WorkflowLineageView, {
        global: {
            plugins: [store],
            provide: { $userId: ref('u1'), $companyId: ref('c1') },
            mocks: { $t: echo },
            stubs: { AiSidebar: true, RouterLink, EmptyState: { props: ['title'], template: '<div class="empty" :data-title="title"></div>' } }
        }
    });
    await flushPromises();
    return wrapper;
};

describe('WorkflowLineageView', () => {
    beforeEach(() => { apiRequest.mockReset(); });

    it('draws the chain: who handed off to whom, the typed result and who answers for each step', async () => {
        const wrapper = await mountView({
            steps: [
                step({ stepId: 'sAgent', index: 0, type: 'agent_run', config: { agentId: 'ag1' }, output: { agentRunId: 'ar1', status: 'finished', costUsd: 0.4 } }),
                step({
                    stepId: 'sApprove', index: 1, type: 'human_approval', dependsOn: ['sAgent'],
                    config: { ownerUserId: 'u2', prompt: '$sAgent.status' },
                    output: { approvalId: 'ap1', decision: 'approved', decidedBy: 'u2' }
                })
            ]
        });

        const links = wrapper.findAll('.wf-chain__link');
        expect(links).toHaveLength(2);
        expect(links[0].find('[data-test="chain-start"]').exists()).toBe(true);
        expect(links[0].find('[data-test="chain-accountable"]').text()).toContain('Release bot');

        const edges = links[1].findAll('[data-test="chain-edge"]');
        expect(edges.length).toBe(2);
        expect(edges.map((edge) => edge.text()).join(' ')).toContain('sAgent');
        expect(links[1].find('[data-test="chain-edges"]').text()).toContain('finished');
        expect(links[1].find('[data-test="chain-accountable"]').text()).toContain('Dana Reed');
    });

    it('keeps a fan-out of dozens to one link with a tally until it is asked to open', async () => {
        const children = Array.from({ length: 40 }, (_, i) => step({
            stepId: `sFan#${i + 1}`, index: 1 + (i + 1) / 41, parentStepId: 'sFan', type: 'agent_run',
            dependsOn: ['sFan'], config: { agentId: 'ag1' }, status: i === 3 ? 'failed' : 'success'
        }));
        const wrapper = await mountView({
            steps: [step({ stepId: 'sFan', index: 1, type: 'fan_out', output: { count: 40 } }), ...children]
        });

        expect(wrapper.findAll('.wf-chain__link')).toHaveLength(1);
        expect(wrapper.find('[data-test="chain-fan-tally"]').text()).toContain('"n":40');
        expect(wrapper.findAll('.wf-graph__children [data-test="step"]')).toHaveLength(1);

        await wrapper.find('[data-test="chain-fan-toggle"]').trigger('click');
        expect(wrapper.findAll('.wf-graph__children [data-test="step"]')).toHaveLength(40);
    });

    it('shows the engine-off state rather than an error when the flag is off', async () => {
        const wrapper = await mountView({ httpStatus: 503 });
        expect(wrapper.find('[data-test="engine-off"]').exists()).toBe(true);
        expect(wrapper.find('[data-test="chain"]').exists()).toBe(false);
    });
});
