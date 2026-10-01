import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, flushPromises } from '@vue/test-utils';

const { apiRequest, openTask } = vi.hoisted(() => ({ apiRequest: vi.fn(), openTask: vi.fn() }));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));
vi.mock('@/components/organisms/TaskDetailOverlay/useTaskOverlay', () => ({ openTask }));

import AtRiskTodayCard from '@/components/organisms/AtRiskTodayCard/AtRiskTodayCard.vue';
import AgentSpendCard from '@/components/organisms/AgentSpendCard/AgentSpendCard.vue';
import { catalogEntry, isBuiltCard } from '@/plugins/dashboard/cardCatalog';
import { cardComponent } from '@/plugins/dashboard/cardRegistry';
import { AI_STATE, applyAiAvailability, resetAiAvailability } from '@/composable/aiAvailability';
import { mountInShell } from '../cardInShell';

enableAutoUnmount(afterEach);

const mountCard = async (component) => {
    const { wrapper, shown } = mountInShell(component);
    await flushPromises();
    return { wrapper, shown };
};

describe('the dashboard catalogue', () => {
    it.each(['AtRiskTodayCard', 'AgentSpendCard'])('lets %s be added and renders it', (key) => {
        expect(isBuiltCard(key)).toBe(true);
        expect(cardComponent(key)).not.toBeNull();
        expect(catalogEntry(key).emptyKey).toBeTruthy();
    });

    it('files At-risk with team and project cards, since no model reads it', () => {
        expect(catalogEntry('AtRiskTodayCard').family).toBe('team');
        expect(catalogEntry('AgentSpendCard').family).toBe('ai');
    });
});

describe('At-risk card', () => {
    const row = (id, over = {}) => ({ taskId: id, taskKey: `K-${id}`, taskName: `Task ${id}`, projectId: 'p1', projectName: 'Website', sprintId: 's1', folderId: '', reasons: ['overdue'], daysLate: 3, ...over });

    beforeEach(() => { apiRequest.mockReset(); openTask.mockReset(); });

    it('asks the at-risk endpoint in the viewer\'s time zone and lists each task with its reason', async () => {
        apiRequest.mockResolvedValue({ data: { status: true, data: { counts: { overdue: 1, blocked: 1, stalled: 0, total: 2 }, tasks: [row('a'), row('b', { reasons: ['blocked'], daysLate: 0 })] } } });
        const { wrapper, shown } = await mountCard(AtRiskTodayCard);
        expect(apiRequest).toHaveBeenCalledWith('post', '/api/v1/dashboard/at-risk', { tz: expect.any(Number) });
        expect(shown.state).toBe('ready');
        expect(wrapper.find('[data-test="risk-total"]').text()).toBe('2');
        const items = wrapper.findAll('[data-test="risk-row"]');
        expect(items).toHaveLength(2);
        expect(items[0].text()).toContain('Task a');
        expect(items[1].find('[data-test="risk-reason"]').text()).toBe('Dash.risk_blocked');
    });

    it('opens a task from its row', async () => {
        apiRequest.mockResolvedValue({ data: { status: true, data: { counts: { overdue: 1, blocked: 0, stalled: 0, total: 1 }, tasks: [row('a')] } } });
        const { wrapper } = await mountCard(AtRiskTodayCard);
        await wrapper.find('[data-test="risk-row"]').trigger('click');
        expect(openTask).toHaveBeenCalledWith(expect.objectContaining({ taskId: 'a', projectId: 'p1' }));
    });

    it('is empty when nothing is at risk', async () => {
        apiRequest.mockResolvedValue({ data: { status: true, data: { counts: { overdue: 0, blocked: 0, stalled: 0, total: 0 }, tasks: [] } } });
        const { shown } = await mountCard(AtRiskTodayCard);
        expect(shown.state).toBe('empty');
    });

    it('reports an error it cannot read past', async () => {
        apiRequest.mockRejectedValue(new Error('down'));
        const { shown } = await mountCard(AtRiskTodayCard);
        expect(shown.state).toBe('error');
    });
});

describe('Agent spend card', () => {
    const spend = (agents) => ({ data: { status: true, data: { month: '2026-09', agents, totalUsd: agents.reduce((s, a) => s + a.usd, 0) } } });

    beforeEach(() => {
        apiRequest.mockReset();
        resetAiAvailability();
        applyAiAvailability({ state: AI_STATE.ON });
    });

    it('shows the month total against the caps and each agent against its own', async () => {
        apiRequest.mockResolvedValue(spend([
            { agentId: 'a1', name: 'Reviewer', usd: 12.5, cap: 30, paused: false },
            { agentId: 'a2', name: 'Triage', usd: 31, cap: 30, paused: true },
            { agentId: 'a3', name: 'Uncapped', usd: 4, cap: 0, paused: false },
        ]));
        const { wrapper, shown } = await mountCard(AgentSpendCard);
        expect(apiRequest).toHaveBeenCalledWith('get', '/api/v2/agents/spend');
        expect(shown.state).toBe('ready');
        expect(wrapper.find('[data-test="spend-total"]').text()).toBe('$47.50');
        expect(wrapper.find('[data-test="spend-cap"]').text()).toContain('Dash.spend_of_caps');
        const rows = wrapper.findAll('[data-test="spend-row"]');
        expect(rows.map((r) => r.find('.dc-row__name').text())).toEqual(['Triage', 'Reviewer', 'Uncapped']);
        expect(rows[0].find('[data-test="spend-over"]').exists()).toBe(true);
        expect(rows[0].find('[data-test="spend-paused"]').exists()).toBe(true);
        expect(rows[2].find('.dc-row__val').text()).toBe('$4.00');
    });

    it('is empty when the workspace has no agents', async () => {
        apiRequest.mockResolvedValue(spend([]));
        const { shown } = await mountCard(AgentSpendCard);
        expect(shown.state).toBe('empty');
    });

    it('says AI is off rather than asking for spend', async () => {
        applyAiAvailability({ state: AI_STATE.OFF_INSTANCE });
        const { shown } = await mountCard(AgentSpendCard);
        expect(apiRequest).not.toHaveBeenCalled();
        expect(shown.state).toBe('empty');
        expect(shown.emptyText).toBe('Dash.spend_ai_off');
    });

    it('reports an error it cannot read past', async () => {
        apiRequest.mockRejectedValue(new Error('down'));
        const { shown } = await mountCard(AgentSpendCard);
        expect(shown.state).toBe('error');
    });
});
