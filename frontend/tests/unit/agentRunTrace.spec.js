import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

const { toast, echo } = vi.hoisted(() => ({
    toast: { success: vi.fn(), error: vi.fn() },
    echo: (key, params) => (params ? `${key} ${JSON.stringify(params)}` : key)
}));

vi.mock('vue-toast-notification', () => ({ useToast: () => toast }));
vi.mock('vue-i18n', async (importOriginal) => ({ ...(await importOriginal()), useI18n: () => ({ t: echo }) }));

import AgentRunTrace from '@/views/Ai/AgentRunTrace.vue';

const TRACE_ID = '4bf92f3577b34da6a3ce929d0e0e4736';
const run = {
    _id: 'r1',
    traceId: TRACE_ID,
    steps: [{ node: 'gather' }],
    trace: [
        { kind: 'step', node: 'gather', status: 'ok', durationMs: 12, tokens: 0, costUsd: 0 },
        { kind: 'step', node: 'analyse', status: 'ok', durationMs: 2400, tokens: 1200, costUsd: 0.0042 },
        { kind: 'tool', action: 'task.comment', event: 'agent.action', decision: 'act', status: 'applied', durationMs: 40, tokens: null, costUsd: null },
        { kind: 'tool', action: 'task.delete', event: 'agent.action_refused', decision: 'refuse', status: 'refused', durationMs: null, tokens: null, costUsd: null },
        { kind: 'step', node: 'hold', status: 'interrupted', durationMs: 3, tokens: 0, costUsd: 0 },
        { kind: 'tool', action: 'agent.proposal_decided', event: 'agent.proposal_decided', decision: 'declined: wrong_tone', status: null, durationMs: null, tokens: null, costUsd: null }
    ]
};

const mountTrace = (props) => mount(AgentRunTrace, { props: { run: props }, global: { mocks: { $t: echo } } });

describe('AgentRunTrace', () => {
    beforeEach(() => {
        toast.success.mockReset();
        toast.error.mockReset();
        Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn(() => Promise.resolve()) }, configurable: true });
    });

    it('lists steps and tool calls in order with duration, tokens, cost and decision', () => {
        const wrapper = mountTrace(run);
        const rows = wrapper.findAll('.run-trace__row');
        expect(rows).toHaveLength(6);
        expect(rows.map((r) => r.attributes('data-test'))).toEqual(['trace-step', 'trace-step', 'trace-tool', 'trace-tool', 'trace-step', 'trace-tool']);

        expect(rows[1].text()).toContain('analyse');
        expect(rows[1].find('[data-test="trace-duration"]').text()).toBe('Ai.trace_duration_s {"n":"2.4"}');
        expect(rows[1].find('[data-test="trace-tokens"]').text()).toBe('Ai.trace_tokens {"n":1200}');
        expect(rows[1].find('[data-test="trace-cost"]').text()).toBe('Ai.trace_cost {"usd":"0.0042"}');

        expect(rows[2].find('[data-test="trace-duration"]').text()).toBe('Ai.trace_duration_ms {"n":40}');
        expect(rows[2].find('[data-test="trace-decision"]').text()).toBe('Ai.trace_decision_act');
        expect(rows[2].find('[data-test="trace-decision"]').classes()).toContain('ah-chip--ok');
        expect(rows[2].find('[data-test="trace-tokens"]').exists()).toBe(false);

        expect(rows[3].find('[data-test="trace-status"]').classes()).toContain('ah-chip--danger');
        expect(rows[4].find('[data-test="trace-status"]').text()).toBe('Ai.trace_status_interrupted');
        expect(rows[5].find('[data-test="trace-decision"]').text()).toBe('Ai.trace_decision_declined');
        expect(wrapper.find('[data-test="trace-empty"]').exists()).toBe(false);
    });

    it('shows the trace id and copies it', async () => {
        const wrapper = mountTrace(run);
        expect(wrapper.find('[data-test="trace-id"]').text()).toBe(TRACE_ID);
        await wrapper.find('[data-test="copy-trace-id"]').trigger('click');
        await flushPromises();
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith(TRACE_ID);
        expect(toast.success).toHaveBeenCalledWith('Ai.trace_copied', { position: 'top-right' });
    });

    it('offers the replay only when the payload carries a replay id', async () => {
        expect(mountTrace(run).find('[data-test="view-replay"]').exists()).toBe(false);
        const wrapper = mountTrace({ ...run, replayId: 'rp1' });
        const link = wrapper.find('[data-test="view-replay"]');
        expect(link.text()).toBe('Ai.trace_view_replay');
        await link.trigger('click');
        expect(wrapper.emitted('view-replay')).toEqual([['rp1']]);
    });

    it('a run from before tracing shows one empty line and still lists its tool calls', () => {
        const wrapper = mountTrace({ _id: 'r0', steps: [], trace: [{ kind: 'tool', action: 'task.comment', decision: null, status: 'applied', durationMs: null, tokens: null, costUsd: null }] });
        expect(wrapper.find('[data-test="trace-empty"]').text()).toBe('Ai.trace_empty');
        expect(wrapper.find('[data-test="trace-id"]').exists()).toBe(false);
        expect(wrapper.findAll('.run-trace__row')).toHaveLength(1);
        expect(mountTrace({ _id: 'r0' }).findAll('.run-trace__row')).toHaveLength(0);
    });

    it('falls back to the run steps when the payload has no merged trace', () => {
        const wrapper = mountTrace({ _id: 'r2', traceId: TRACE_ID, steps: [{ node: 'gather', status: 'ok', durationMs: 5, tokens: 0, costUsd: 0 }] });
        expect(wrapper.findAll('[data-test="trace-step"]')).toHaveLength(1);
        expect(wrapper.find('[data-test="trace-empty"]').exists()).toBe(false);
    });
});
