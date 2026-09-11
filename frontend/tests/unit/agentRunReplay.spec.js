import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

const { apiRequest, echo } = vi.hoisted(() => ({
    apiRequest: vi.fn(),
    echo: (key, params) => (params ? `${key} ${JSON.stringify(params)}` : key)
}));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('@/locales/main', () => ({ i18n: { global: { t: (key) => `t:${key}` } } }));
vi.mock('@/components/organisms/Shell/shellState', () => ({ shellState: { agentsRunning: 0 } }));
vi.mock('vue-i18n', async (importOriginal) => ({ ...(await importOriginal()), useI18n: () => ({ t: echo }) }));

import AgentRunReplay from '@/views/Ai/AgentRunReplay.vue';

const ok = (data) => Promise.resolve({ data: { status: true, data } });

const calls = [
    {
        _id: 'rp1', model: 'gpt-4.1', usage: { inputTokens: 1000, outputTokens: 500 }, costUsd: 0.006, durationMs: 812, status: 'ok',
        system: 'You review pages.', messages: [{ role: 'user', content: 'Review [redacted]' }], retrievedChunkIds: [], response: '{"summary":"ok"}', promptHash: 'abc', truncated: false
    },
    {
        _id: 'rp2', model: 'gpt-4.1', usage: { inputTokens: 20, outputTokens: 0 }, costUsd: null, durationMs: 40, status: 'error', errorCode: 'rate_limit_exceeded',
        system: null, messages: [], retrievedChunkIds: ['chunk-1', 'chunk-2'], response: null, truncated: true
    }
];

const mountReplay = async ({ replayId = 'rp1', rows = calls } = {}) => {
    apiRequest.mockImplementation(() => ok(rows));
    const wrapper = mount(AgentRunReplay, { props: { runId: 'r1', replayId }, attachTo: document.body, global: { mocks: { $t: echo } } });
    await flushPromises();
    return wrapper;
};

describe('AgentRunReplay', () => {
    beforeEach(() => {
        apiRequest.mockReset();
        Element.prototype.scrollIntoView = vi.fn();
    });
    afterEach(() => {
        window.location.hash = '';
        document.body.innerHTML = '';
    });

    it('carries the #replay anchor and the redaction line', async () => {
        const wrapper = await mountReplay();
        expect(wrapper.find('section').attributes('id')).toBe('replay');
        expect(wrapper.find('[data-test="replay-policy"]').text()).toBe('Ai.replay_policy');
    });

    it('does not ask the server when the run has no replay records', async () => {
        const wrapper = await mountReplay({ replayId: '' });
        expect(apiRequest).not.toHaveBeenCalled();
        expect(wrapper.find('[data-test="replay-none"]').text()).toBe('Ai.replay_none');
    });

    it('lists each model call with model, tokens, cost, duration and status', async () => {
        const wrapper = await mountReplay();
        expect(apiRequest).toHaveBeenCalledWith('get', '/api/v2/agents/runs/r1/replay', undefined);
        const rows = wrapper.findAll('[data-test="replay-call"]');
        expect(rows).toHaveLength(2);
        expect(rows[0].find('[data-test="replay-model"]').text()).toBe('gpt-4.1');
        expect(rows[0].find('[data-test="replay-tokens"]').text()).toBe('Ai.replay_tokens {"input":1000,"output":500}');
        expect(rows[0].find('[data-test="replay-cost"]').text()).toBe('Ai.replay_cost {"usd":"$0.0060"}');
        expect(rows[0].find('[data-test="replay-duration"]').text()).toBe('Ai.replay_duration {"ms":812}');
        expect(rows[0].find('[data-test="replay-status"]').classes()).toContain('ah-chip--ok');
        expect(rows[1].find('[data-test="replay-cost"]').text()).toBe('Ai.replay_cost_unpriced');
        expect(rows[1].find('[data-test="replay-status"]').classes()).toContain('ah-chip--danger');
        expect(wrapper.find('[data-test="replay-body"]').exists()).toBe(false);
    });

    it('expands a call to the system prompt, messages, passages empty state and raw response in monospace', async () => {
        const wrapper = await mountReplay();
        const row = wrapper.findAll('[data-test="replay-call"]')[0];
        await row.find('button').trigger('click');
        const body = row.find('[data-test="replay-body"]');
        expect(row.find('button').attributes('aria-expanded')).toBe('true');
        expect(body.find('[data-test="replay-system"]').element.tagName).toBe('PRE');
        expect(body.find('[data-test="replay-system"]').text()).toBe('You review pages.');
        expect(body.find('[data-test="replay-message"]').text()).toContain('Review [redacted]');
        expect(body.find('[data-test="replay-passages-empty"]').text()).toBe('Ai.replay_passages_empty');
        expect(body.find('[data-test="replay-response"]').classes()).toContain('ah-mono');
        expect(body.find('[data-test="replay-response"]').text()).toBe('{"summary":"ok"}');

        await row.find('button').trigger('click');
        expect(row.find('[data-test="replay-body"]').exists()).toBe(false);
    });

    it('shows retrieved passages, the error code and the truncation note when present', async () => {
        const wrapper = await mountReplay();
        const row = wrapper.findAll('[data-test="replay-call"]')[1];
        await row.find('button').trigger('click');
        expect(row.findAll('[data-test="replay-passages"] li').map((li) => li.text())).toEqual(['chunk-1', 'chunk-2']);
        expect(row.find('[data-test="replay-error-code"]').text()).toBe('Ai.replay_error_code {"code":"rate_limit_exceeded"}');
        expect(row.find('[data-test="replay-truncated"]').exists()).toBe(true);
        expect(row.find('[data-test="replay-response"]').exists()).toBe(false);
    });

    it('gives every call the #replay-<recordId> anchor', async () => {
        const wrapper = await mountReplay();
        expect(wrapper.findAll('[data-test="replay-call"]').map((row) => row.attributes('id'))).toEqual(['replay-rp1', 'replay-rp2']);
    });

    it('focus expands the named call and scrolls to it', async () => {
        const wrapper = await mountReplay();
        await wrapper.vm.focus('rp2');
        const rows = wrapper.findAll('[data-test="replay-call"]');
        expect(rows[0].find('[data-test="replay-body"]').exists()).toBe(false);
        expect(rows[1].find('[data-test="replay-body"]').exists()).toBe(true);
        expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
        expect(Element.prototype.scrollIntoView.mock.contexts[0]).toBe(rows[1].element);
    });

    it('focus on an unknown record leaves every call collapsed', async () => {
        const wrapper = await mountReplay();
        await wrapper.vm.focus('missing');
        expect(wrapper.find('[data-test="replay-body"]').exists()).toBe(false);
        expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
    });

    it('a focus asked before the calls load is applied once they arrive', async () => {
        let resolve;
        apiRequest.mockImplementation(() => new Promise((r) => { resolve = r; }));
        const wrapper = mount(AgentRunReplay, { props: { runId: 'r1', replayId: 'rp1' }, attachTo: document.body, global: { mocks: { $t: echo } } });
        await wrapper.vm.focus('rp2');
        resolve({ data: { status: true, data: calls } });
        await flushPromises();
        expect(wrapper.findAll('[data-test="replay-call"]')[1].find('[data-test="replay-body"]').exists()).toBe(true);
    });

    it('opens the call named by the page hash on arrival and when the hash changes', async () => {
        window.location.hash = '#replay-rp2';
        const wrapper = await mountReplay();
        expect(wrapper.findAll('[data-test="replay-call"]')[1].find('[data-test="replay-body"]').exists()).toBe(true);

        window.location.hash = '#replay-rp1';
        window.dispatchEvent(new HashChangeEvent('hashchange'));
        await flushPromises();
        expect(wrapper.findAll('[data-test="replay-call"]')[0].find('[data-test="replay-body"]').exists()).toBe(true);
    });

    it('shows the server refusal when the replay cannot be loaded', async () => {
        apiRequest.mockImplementation(() => Promise.reject(Object.assign(new Error('Request failed with status code 403'), { response: { status: 403, data: { status: false, statusText: 'Owner/admin only.' } } })));
        const wrapper = mount(AgentRunReplay, { props: { runId: 'r1', replayId: 'rp1' }, global: { mocks: { $t: echo } } });
        await flushPromises();
        expect(wrapper.find('[data-test="replay-error"]').text()).toBe('Owner/admin only.');
    });
});
