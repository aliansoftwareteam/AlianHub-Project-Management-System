import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('@/locales/main', () => ({ i18n: { global: { t: (key) => `t:${key}` } } }));
vi.mock('@/components/organisms/Shell/shellState', () => ({ shellState: { agentsRunning: 0 } }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));
vi.mock('@/views/Ai/AiSidebar.vue', () => ({ default: { name: 'AiSidebar', render: () => null } }));

import AiHealth from '@/views/Ai/AiHealth.vue';
import { sortAgents, nextSort, warningsOf, sparkPoints, isEmptyMetrics, durationParts } from '@/views/Ai/healthTable';

const agent = (agentId, over = {}) => ({ agentId, agentName: agentId.toUpperCase(), runs: 1, errorRate: 0, approvalRate: null, p95DurationMs: 1000, costUsd: 0, series: [{ runs: 0 }, { runs: 1 }], ...over });

const payload = (agents, totals = { runs: agents.reduce((n, a) => n + a.runs, 0), calls: 0 }) => ({
    window: '24h', totals, agents,
    models: [{ model: 'claude-x', calls: 2, tokens: 10, costUsd: 0.5, errorRate: 0.5 }],
    features: [{ feature: 'ask', calls: 2, costUsd: 0.5 }]
});

const storeFor = (roleType) => createStore({ modules: { settings: { namespaced: true, getters: { companyUserDetail: () => ({ roleType }) } } } });

const mountWith = async (roleType, data) => {
    apiRequest.mockImplementation(() => Promise.resolve({ data: { status: true, data } }));
    const wrapper = mount(AiHealth, { global: { plugins: [storeFor(roleType)] } });
    await flushPromises();
    return wrapper;
};

const rowIds = (wrapper) => wrapper.findAll('[data-test="agents"] tbody tr').map((r) => r.attributes('data-agent'));

describe('healthTable sorting', () => {
    const rows = [agent('a', { errorRate: 0.2, agentName: 'Beta' }), agent('b', { errorRate: null, agentName: 'alpha' }), agent('c', { errorRate: 0.05, agentName: 'Gamma' })];

    it('sorts numbers in either direction and keeps blanks last', () => {
        expect(sortAgents(rows, 'errorRate', 'desc').map((r) => r.agentId)).toEqual(['a', 'c', 'b']);
        expect(sortAgents(rows, 'errorRate', 'asc').map((r) => r.agentId)).toEqual(['c', 'a', 'b']);
    });

    it('sorts names alphabetically', () => {
        expect(sortAgents(rows, 'agentName', 'asc').map((r) => r.agentName)).toEqual(['alpha', 'Beta', 'Gamma']);
    });

    it('does not mutate the rows it was given', () => {
        const before = rows.map((r) => r.agentId);
        sortAgents(rows, 'errorRate', 'asc');
        expect(rows.map((r) => r.agentId)).toEqual(before);
    });

    it('toggles direction on the same column and starts names ascending, numbers descending', () => {
        expect(nextSort({ key: 'runs', dir: 'desc' }, 'runs')).toEqual({ key: 'runs', dir: 'asc' });
        expect(nextSort({ key: 'runs', dir: 'desc' }, 'agentName')).toEqual({ key: 'agentName', dir: 'asc' });
        expect(nextSort({ key: 'agentName', dir: 'asc' }, 'costUsd')).toEqual({ key: 'costUsd', dir: 'desc' });
    });
});

describe('healthTable chips and helpers', () => {
    it('warns on an error rate over 10% and an approval rate under 50%', () => {
        expect(warningsOf({ errorRate: 0.1, approvalRate: 0.5 })).toEqual([]);
        expect(warningsOf({ errorRate: 0.11, approvalRate: 0.5 })).toEqual(['error']);
        expect(warningsOf({ errorRate: 0, approvalRate: 0.49 })).toEqual(['approval']);
        expect(warningsOf({ errorRate: 0.5, approvalRate: 0.2 })).toEqual(['error', 'approval']);
        expect(warningsOf({ errorRate: null, approvalRate: null })).toEqual([]);
    });

    it('draws a sparkline scaled to the busiest bucket', () => {
        expect(sparkPoints([{ runs: 0 }, { runs: 2 }, { runs: 1 }], 10, 10)).toBe('0,10 5,0 10,5');
        expect(sparkPoints([], 10, 10)).toBe('');
    });

    it('treats a window with no runs and no model calls as empty', () => {
        expect(isEmptyMetrics(null)).toBe(true);
        expect(isEmptyMetrics({ totals: { runs: 0, calls: 0 } })).toBe(true);
        expect(isEmptyMetrics({ totals: { runs: 0, calls: 3 } })).toBe(false);
    });

    it('picks a duration unit', () => {
        expect(durationParts(850)).toEqual({ key: 'AiHealth.duration_ms', n: 850 });
        expect(durationParts(12340)).toEqual({ key: 'AiHealth.duration_s', n: 12.3 });
        expect(durationParts(252000)).toEqual({ key: 'AiHealth.duration_min', n: 4.2 });
    });
});

describe('AiHealth view', () => {
    beforeEach(() => { apiRequest.mockReset(); });

    it('shows members the owner-only message and asks the server nothing', async () => {
        const wrapper = await mountWith(3, payload([agent('a')]));
        expect(wrapper.find('[data-test="owner-only"]').exists()).toBe(true);
        expect(wrapper.find('[data-test="agents"]').exists()).toBe(false);
        expect(wrapper.find('.ah-tabs').exists()).toBe(false);
        expect(apiRequest).not.toHaveBeenCalled();
    });

    it('shows the owner-only message when the server refuses with 403', async () => {
        apiRequest.mockImplementation(() => Promise.reject(Object.assign(new Error('Request failed with status code 403'), { response: { status: 403, data: { status: false } } })));
        const wrapper = mount(AiHealth, { global: { plugins: [storeFor(1)] } });
        await flushPromises();
        expect(wrapper.find('[data-test="owner-only"]').exists()).toBe(true);
    });

    it('shows the empty state when the window has no runs', async () => {
        const wrapper = await mountWith(1, { ...payload([]), totals: { runs: 0, calls: 0 }, models: [], features: [] });
        expect(wrapper.find('[data-test="empty"]').exists()).toBe(true);
        expect(wrapper.find('[data-test="agents"]').exists()).toBe(false);
        expect(apiRequest).toHaveBeenCalledWith('get', '/api/v2/agents/metrics?window=24h');
    });

    it('marks only the unhealthy agents with warning chips', async () => {
        const wrapper = await mountWith(2, payload([
            agent('ok', { runs: 5, errorRate: 0.05, approvalRate: 0.9 }),
            agent('flaky', { runs: 4, errorRate: 0.25, approvalRate: 0.8 }),
            agent('ignored', { runs: 3, errorRate: 0, approvalRate: 0.3 })
        ]));
        const chipsOf = (id) => wrapper.find(`[data-agent="${id}"]`).findAll('[data-chip]').map((c) => c.attributes('data-chip'));
        expect(chipsOf('ok')).toEqual([]);
        expect(chipsOf('flaky')).toEqual(['error']);
        expect(chipsOf('ignored')).toEqual(['approval']);
        expect(wrapper.find('[data-test="models"] [data-chip="error"]').exists()).toBe(true);
        expect(wrapper.find('[data-test="features"]').exists()).toBe(true);
    });

    it('sorts the agents table by the clicked column', async () => {
        const wrapper = await mountWith(1, payload([
            agent('a', { runs: 1, costUsd: 3 }),
            agent('b', { runs: 9, costUsd: 1 }),
            agent('c', { runs: 5, costUsd: 2 })
        ]));
        expect(rowIds(wrapper)).toEqual(['b', 'c', 'a']);
        await wrapper.find('[data-sort="costUsd"]').trigger('click');
        expect(rowIds(wrapper)).toEqual(['a', 'c', 'b']);
        await wrapper.find('[data-sort="costUsd"]').trigger('click');
        expect(rowIds(wrapper)).toEqual(['b', 'c', 'a']);
        expect(wrapper.find('[data-sort="costUsd"]').element.closest('th').getAttribute('aria-sort')).toBe('ascending');
    });

    it('reloads for the picked window', async () => {
        const wrapper = await mountWith(1, payload([agent('a')]));
        await wrapper.find('[data-window="7d"]').trigger('click');
        await flushPromises();
        expect(apiRequest).toHaveBeenLastCalledWith('get', '/api/v2/agents/metrics?window=7d');
        expect(wrapper.find('[data-window="7d"]').classes()).toContain('is-active');
    });
});
