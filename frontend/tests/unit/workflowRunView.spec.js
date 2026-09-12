import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import { ref } from 'vue';

const { apiRequest, toast, echo } = vi.hoisted(() => ({
    apiRequest: vi.fn(),
    toast: { success: vi.fn(), error: vi.fn() },
    echo: (key, params) => (params ? `${key} ${JSON.stringify(params)}` : key)
}));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('@/locales/main', () => ({ i18n: { global: { t: (key) => `t:${key}` } } }));
vi.mock('@/components/organisms/Shell/shellState', () => ({ shellState: { agentsRunning: 0 } }));
vi.mock('vue-toast-notification', () => ({ useToast: () => toast }));
vi.mock('vue-i18n', async (importOriginal) => ({ ...(await importOriginal()), useI18n: () => ({ t: echo }) }));
vi.mock('vue-router', () => ({ useRoute: () => ({ params: { id: 'run-1', cid: 'c1' } }) }));

import WorkflowRunView from '@/views/Ai/WorkflowRunView.vue';

const OWNER = 1;
const MEMBER = 3;

const step = (over = {}) => ({
    stepId: 's1', index: 0, type: 'tool_call', status: 'success', attempts: 1, maxAttempts: 3,
    startedAt: '2026-09-01T10:00:00.000Z', finishedAt: '2026-09-01T10:00:02.000Z', output: {}, ...over
});

const storeFor = (roleType) => createStore({ modules: { settings: { namespaced: true, getters: { companyUserDetail: () => ({ roleType }) } } } });

const mountView = async ({ run, steps, roleType = OWNER, status = true, httpStatus = 200 } = {}) => {
    apiRequest.mockImplementation(() => {
        if (!status) return Promise.reject({ response: { status: httpStatus, data: { statusText: 'nope' } } });
        return Promise.resolve({ data: { status: true, data: { run, steps } } });
    });
    const wrapper = mount(WorkflowRunView, {
        global: {
            plugins: [storeFor(roleType)],
            provide: { $userId: ref('u1'), $companyId: ref('c1') },
            mocks: { $t: echo },
            stubs: {
                AiSidebar: true,
                RouterLink: { props: ['to'], template: '<a><slot /></a>' },
                EmptyState: { props: ['title', 'message'], template: '<div class="empty" :data-title="title"></div>' }
            }
        }
    });
    await flushPromises();
    return wrapper;
};

const run = (over = {}) => ({ _id: 'run-1', workflowId: 'wf', name: 'Nightly sweep', status: 'running', ...over });

describe('WorkflowRunView', () => {
    beforeEach(() => {
        apiRequest.mockReset();
        toast.success.mockReset();
        toast.error.mockReset();
    });

    it('shows the engine-off state rather than an error when the flag is off', async () => {
        const wrapper = await mountView({ status: false, httpStatus: 503 });
        expect(wrapper.find('[data-test="engine-off"]').exists()).toBe(true);
        expect(wrapper.find('[data-test="error"]').exists()).toBe(false);
        expect(wrapper.find('[data-test="graph"]').exists()).toBe(false);
    });

    it('groups a fan-out into one node with a tally instead of a box per child', async () => {
        const children = Array.from({ length: 50 }, (_, i) => step({
            stepId: `sFan#${i + 1}`, index: 1 + (i + 1) / 51, parentStepId: 'sFan', type: 'agent_run',
            status: i === 7 ? 'failed' : (i === 8 ? 'running' : 'success'),
            ...(i === 7 ? { failure: { deterministic: false }, error: 'timed out' } : {})
        }));
        const wrapper = await mountView({
            run: run(),
            steps: [step({ stepId: 'sFan', index: 1, type: 'fan_out', output: { count: 50 } }), ...children]
        });
        expect(wrapper.findAll('.wf-graph__node')).toHaveLength(1);
        expect(wrapper.find('[data-test="fan-tally"]').text()).toContain('"n":50');
        // Only the child a person can act on and the one still working are drawn.
        expect(wrapper.findAll('.wf-graph__children [data-test="step"]')).toHaveLength(2);

        await wrapper.find('[data-test="fan-toggle"]').trigger('click');
        expect(wrapper.findAll('.wf-graph__children [data-test="step"]')).toHaveLength(50);
    });

    it('names why a blocked run is blocked, and at which step', async () => {
        const wrapper = await mountView({
            run: run({ status: 'blocked', blocked: { code: 'budget_exhausted', reason: "the run's budget of $5.00 is spent", stepId: 's2' } }),
            steps: [step()]
        });
        const blocked = wrapper.find('[data-test="blocked"]');
        expect(blocked.exists()).toBe(true);
        expect(wrapper.find('[data-test="blocked-code"]').text()).toBe('Workflows.blocked_budget_exhausted');
        expect(wrapper.find('[data-test="blocked-reason"]').text()).toContain('$5.00 is spent');
        expect(wrapper.find('[data-test="blocked-step"]').text()).toContain('"stepId":"s2"');
    });

    it('names what a waiting run is waiting on, and how many others wait behind it', async () => {
        const wrapper = await mountView({
            run: run(),
            steps: [
                step({ stepId: 's1', status: 'pending', waitReason: 'an approval from the owner', waitUntil: '2026-09-02T10:00:00.000Z', type: 'human_approval' }),
                step({ stepId: 's2', index: 1, status: 'pending', waitReason: 'iteration 2 of at most 5', type: 'loop' })
            ]
        });
        expect(wrapper.find('[data-test="blocked-reason"]').text()).toBe('an approval from the owner');
        expect(wrapper.find('[data-test="blocked-also"]').text()).toContain('"n":1');
    });

    it('offers only skip on a deterministic failure, and retry with its backoff on a transient one', async () => {
        const deterministic = await mountView({
            run: run({ status: 'failed' }),
            steps: [step({ status: 'failed', error: 'no such action', failure: { deterministic: true, code: 'ValidationError' }, attempts: 1 })]
        });
        expect(deterministic.find('[data-test="failure-kind"]').text()).toBe('Workflows.failure_deterministic');
        expect(deterministic.find('[data-test="control-skip"]').exists()).toBe(true);
        expect(deterministic.find('[data-test="control-retry"]').exists()).toBe(false);
        expect(deterministic.find('[data-test="failure-backoff"]').exists()).toBe(false);

        const transient = await mountView({
            run: run({ status: 'running' }),
            steps: [step({
                status: 'failed', error: 'socket hang up', attempts: 2, maxAttempts: 3,
                failure: { deterministic: false, code: 'MongoNetworkError', retryAfterMs: 120000 },
                nextAttemptAt: new Date(Date.now() + 120000).toISOString()
            })]
        });
        expect(transient.find('[data-test="control-retry"]').exists()).toBe(true);
        expect(transient.find('[data-test="control-skip"]').exists()).toBe(false);
        expect(transient.find('[data-test="failure-attempts"]').text()).toContain('"n":2,"max":3');
        expect(transient.find('[data-test="failure-backoff"]').text()).toContain('Workflows.backoff_at');
    });

    it('offers compensate beside the recovery control when the step started an agent run', async () => {
        const wrapper = await mountView({
            run: run({ status: 'failed' }),
            steps: [step({ type: 'agent_run', status: 'failed', error: 'boom', failure: { deterministic: false }, output: { agentRunId: 'ar1' } })]
        });
        expect(wrapper.find('[data-test="control-compensate"]').exists()).toBe(true);

        apiRequest.mockClear();
        await wrapper.find('[data-test="control-compensate"]').trigger('click');
        await flushPromises();
        expect(apiRequest).toHaveBeenCalledWith('post', '/api/v2/workflows/runs/run-1/steps/s1/compensate', { reason: '' });
        expect(toast.success).toHaveBeenCalledWith('Workflows.applied_compensate', { position: 'top-right' });
    });

    it('shows a loop’s iterations and budget, and stops it by skipping the step', async () => {
        const wrapper = await mountView({
            run: run(),
            steps: [step({ type: 'loop', status: 'pending', iteration: 4, budgetUsedUsd: 1.5, waitReason: 'iteration 4 of at most 10', config: { maxIterations: 10, budgetUsd: 6 } })]
        });
        expect(wrapper.find('[data-test="loop-iterations"]').text()).toContain('"n":4,"max":10');
        expect(wrapper.find('[data-test="loop-budget"]').text()).toContain('"used":"1.50","cap":"6.00"');

        apiRequest.mockClear();
        await wrapper.find('[data-test="loop-stop"]').trigger('click');
        await flushPromises();
        expect(apiRequest).toHaveBeenCalledWith('post', '/api/v2/workflows/runs/run-1/steps/s1/skip', { reason: 'Workflows.loop_stop_reason' });
    });

    it('names the agent and the hour when a loop stopped at the run limit', async () => {
        const wrapper = await mountView({
            run: run({ status: 'success' }),
            steps: [step({
                type: 'loop', status: 'success',
                output: { iterations: 3, cap: 10, budgetUsedUsd: 0.4, stoppedBy: 'run_limit', runLimit: { agentId: 'a1', limit: 500, used: 500, resetsAt: '2026-09-01T11:00:00.000Z' } }
            })]
        });
        const stopped = wrapper.find('[data-test="loop-stopped-by"]').text();
        expect(stopped).toContain('Workflows.loop_stopped_run_limit_detail');
        expect(stopped).toContain('"used":500,"limit":500');
        expect(wrapper.find('[data-test="loop-stop"]').exists()).toBe(false);
    });

    it('gives a member the run read-only, with no control anywhere', async () => {
        const wrapper = await mountView({
            roleType: MEMBER,
            run: run({ status: 'failed' }),
            steps: [
                step({ type: 'agent_run', status: 'failed', error: 'boom', failure: { deterministic: false }, output: { agentRunId: 'ar1' } }),
                step({ stepId: 's2', index: 1, type: 'loop', status: 'pending', iteration: 2, config: { maxIterations: 5 } })
            ]
        });
        expect(wrapper.find('[data-test="failure"]').exists()).toBe(true);
        expect(wrapper.find('[data-test="loop"]').exists()).toBe(true);
        expect(wrapper.findAll('[data-test^="control-"]')).toHaveLength(0);
        expect(wrapper.find('[data-test="loop-stop"]').exists()).toBe(false);
        expect(wrapper.find('[data-test="run-read-only"]').exists()).toBe(true);
    });

    it('shows status, duration and cost for every step', async () => {
        const wrapper = await mountView({
            run: run({ status: 'success' }),
            steps: [step({ type: 'agent_run', output: { costUsd: 0.42 } })]
        });
        const row = wrapper.find('[data-test="step"]');
        expect(row.find('[data-test="step-status"]').text()).toBe('Workflows.status_success');
        expect(row.find('[data-test="step-duration"]').text()).toContain('Workflows.duration_s');
        expect(row.find('[data-test="step-cost"]').text()).toContain('"usd":"0.42"');
        expect(wrapper.find('[data-test="run-cost"]').text()).toContain('"usd":"0.42"');
    });
});
