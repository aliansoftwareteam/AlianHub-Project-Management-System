import { describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';

const { echo } = vi.hoisted(() => ({ echo: (key, params) => (params ? `${key} ${JSON.stringify(params)}` : key) }));
vi.mock('vue-i18n', async (importOriginal) => ({ ...(await importOriginal()), useI18n: () => ({ t: echo }) }));

import TaskAgentStrip from '@/components/organisms/TaskDetailOverlay/TaskAgentStrip.vue';

const session = (over = {}) => ({
    id: 's1', taskId: 'task-1', clientName: 'Coder', state: 'active', reason: '', createdAt: '2026-09-21T10:00:00.000Z', firstActivityAt: '2026-09-21T10:00:03.000Z',
    activities: [
        { type: 'thought', text: 'Reading the brief', at: '2026-09-21T10:00:03.000Z' },
        { type: 'action', text: 'Opened branch s10s7', at: '2026-09-21T10:00:05.000Z' },
        { type: 'elicitation', text: 'Which parser?', at: '2026-09-21T10:00:07.000Z' },
        { type: 'error', text: 'Lint failed', at: '2026-09-21T10:00:09.000Z' },
    ],
    ...over,
});

const mountStrip = (run) => mount(TaskAgentStrip, { props: { run }, global: { mocks: { $t: echo } } });

describe('TaskAgentStrip with an outside agent session', () => {
    it('names the outside agent and shows its session state', () => {
        const wrapper = mountStrip({ agentName: 'Coder', status: 'running', session: session() });
        expect(wrapper.find('.ah-agent-strip__name').text()).toBe('Coder');
        expect(wrapper.find('.ah-agent-strip__tag').text()).toBe('TaskPanel.agent_outside_tag');
        expect(wrapper.find('.ah-agent-strip__text').text()).toBe('TaskPanel.agent_session_active');
    });

    it('lists the three latest typed activities, newest first', () => {
        const wrapper = mountStrip({ agentName: 'Coder', status: 'running', session: session() });
        const items = wrapper.findAll('.ah-agent-strip__activity');
        expect(items).toHaveLength(3);
        expect(items.map((item) => item.classes().find((c) => c.startsWith('is-')))).toEqual(['is-error', 'is-elicitation', 'is-action']);
        expect(items[0].find('.ah-agent-strip__kind').text()).toBe('TaskPanel.agent_activity_error');
        expect(items[0].find('.ah-agent-strip__activity-text').text()).toBe('Lint failed');
    });

    it.each([
        ['offered', 'TaskPanel.agent_session_offered'],
        ['completed', 'TaskPanel.agent_session_completed'],
        ['unresponsive', 'TaskPanel.agent_session_unresponsive'],
    ])('reads the %s state', (state, key) => {
        const wrapper = mountStrip({ agentName: 'Coder', status: 'done', session: session({ state, activities: [] }) });
        expect(wrapper.find('.ah-agent-strip__text').text()).toBe(key);
        expect(wrapper.find('.ah-agent-strip__activities').exists()).toBe(false);
    });

    it('gives the reason a revoked or failed session ended', () => {
        const wrapper = mountStrip({ agentName: 'Coder', status: 'failed', session: session({ state: 'revoked', reason: 'the grant was revoked' }) });
        expect(wrapper.find('.ah-agent-strip__text').text()).toBe('TaskPanel.agent_session_with_reason {"state":"TaskPanel.agent_session_revoked","reason":"the grant was revoked"}');
    });

    it('still reads an agent run without a session as before', () => {
        const wrapper = mountStrip({ agentName: 'Reviewer', status: 'review' });
        expect(wrapper.find('.ah-agent-strip__tag').text()).toBe('TaskPanel.agent_tag');
        expect(wrapper.find('.ah-agent-strip__text').text()).toBe('TaskPanel.agent_in_review');
        expect(wrapper.find('.ah-agent-strip__activities').exists()).toBe(false);
    });
});
