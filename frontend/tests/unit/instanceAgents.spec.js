import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('@/locales/main', () => ({ i18n: { global: { t: (key) => `t:${key}` } } }));
vi.mock('@/components/organisms/Shell/shellState', () => ({ shellState: { agentsRunning: 0 } }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));

import InstanceAgents from '@/views/Settings/Instance/InstanceAgents.vue';
import { budgetView, featureLabelKey } from '@/views/Settings/Instance/agentBudget';

const settings = { undoHours: 24, monthlyBudgetUsd: 200, provider: { name: 'anthropic', hasKey: true, region: 'eu' } };
const warnBudget = { month: '2026-09', usedUsd: 170, budgetUsd: 200, percent: 85, alerts: { 80: '2026-09-04T10:00:00Z', 100: null } };
const overBudget = { month: '2026-09', usedUsd: 240, budgetUsd: 200, percent: 120, alerts: { 80: '2026-09-02T10:00:00Z', 100: '2026-09-04T18:00:00Z' } };
const features = [
    { feature: 'project_plan', usd: 102, calls: 3, tokens: 900000 },
    { feature: 'agent_run', usd: 51, calls: 40, tokens: 400000 },
    { feature: 'ask', usd: 17, calls: 120, tokens: 90000 },
    { feature: 'mystery_feature', usd: 0, calls: 1, tokens: 10 },
];

const ok = (data) => Promise.resolve({ data: { status: true, data } });

const storeFor = (roleType) => createStore({
    modules: { settings: { namespaced: true, getters: { companyUserDetail: () => ({ roleType }) } } }
});

const mountPanel = async ({ roleType = 1, budget = warnBudget, provider = settings.provider } = {}) => {
    apiRequest.mockImplementation((type, url) => {
        if (url.endsWith('/agents/budget')) return ok(budget);
        return ok({ ...settings, provider });
    });
    const wrapper = mount(InstanceAgents, { global: { plugins: [storeFor(roleType)] } });
    await flushPromises();
    return wrapper;
};

describe('budgetView', () => {
    it('reads the percent the server sends and clamps the bar', () => {
        expect(budgetView(warnBudget)).toMatchObject({ used: 170, cap: 200, percent: 85, width: 85, level: 'warn' });
        expect(budgetView(overBudget)).toMatchObject({ percent: 120, width: 100, level: 'over' });
        expect(budgetView({ usedUsd: 10, budgetUsd: 200 })).toMatchObject({ percent: 5, level: 'ok' });
    });

    it('breaks spend down per feature with each feature\'s share of the month', () => {
        const view = budgetView({ ...warnBudget, features });
        expect(view.features.map((f) => [f.feature, f.usd, f.share, f.calls])).toEqual([
            ['project_plan', 102, 60, 3], ['agent_run', 51, 30, 40], ['ask', 17, 10, 120], ['mystery_feature', 0, 0, 1],
        ]);
        expect(budgetView(warnBudget).features).toEqual([]);
        expect(budgetView({ usedUsd: 0, features: [{ feature: 'ask', usd: 0 }] }).features[0]).toMatchObject({ share: 0, calls: 0 });
        expect(featureLabelKey('project_plan')).toBe('Instance.feature_project_plan');
        expect(featureLabelKey('mystery_feature')).toBe('Instance.feature_unknown');
    });

    it('never warns without a cap and lists both alert thresholds', () => {
        const view = budgetView({ usedUsd: 999, budgetUsd: 0, percent: 0 });
        expect(view.level).toBe('ok');
        expect(view.alerts).toEqual([{ threshold: 80, at: null }, { threshold: 100, at: null }]);
        expect(budgetView(null).alerts.map((a) => a.threshold)).toEqual([80, 100]);
    });
});

describe('InstanceAgents', () => {
    beforeEach(() => { apiRequest.mockReset(); });

    it('renders nothing for a member', async () => {
        const wrapper = await mountPanel({ roleType: 3 });
        expect(wrapper.find('[data-test="instance-agents"]').exists()).toBe(false);
        expect(apiRequest).not.toHaveBeenCalled();
    });

    it('shows the usage bar, the 80% alert as sent and the 100% alert as quiet', async () => {
        const wrapper = await mountPanel();
        const bar = wrapper.find('[data-test="usage-bar"]');
        expect(bar.classes()).toContain('is-warn');
        expect(bar.find('.in-meter__fill').attributes('style')).toContain('width: 85%');
        expect(wrapper.find('[data-test="alert-80"]').attributes('data-state')).toBe('sent');
        expect(wrapper.find('[data-test="alert-80"]').classes()).toContain('ah-chip--warn');
        expect(wrapper.find('[data-test="alert-100"]').attributes('data-state')).toBe('quiet');
        expect(wrapper.find('[data-test="usage-line"]').text()).toBe('Instance.agent_usage_line');
    });

    it('caps the bar at 100% and marks both alerts sent when over budget', async () => {
        const wrapper = await mountPanel({ budget: overBudget });
        const bar = wrapper.find('[data-test="usage-bar"]');
        expect(bar.classes()).toContain('is-over');
        expect(bar.find('.in-meter__fill').attributes('style')).toContain('width: 100%');
        expect(wrapper.find('[data-test="alert-100"]').attributes('data-state')).toBe('sent');
        expect(wrapper.find('[data-test="alert-100"]').classes()).toContain('ah-chip--danger');
    });

    it('shows every feature\'s spend against the budget next to the alerts, unknown tags included', async () => {
        const wrapper = await mountPanel({ budget: { ...warnBudget, features } });
        const rows = wrapper.findAll('[data-test="features"] li');
        expect(rows).toHaveLength(4);
        expect(rows[0].attributes('data-test')).toBe('feature-project_plan');
        expect(rows[0].find('.in-features__name').text()).toBe('Instance.feature_project_plan');
        expect(rows[0].find('.in-features__fill').attributes('style')).toContain('width: 60%');
        expect(rows[0].find('.in-features__line').text()).toBe('Instance.agent_feature_line');
        expect(rows[1].attributes('data-test')).toBe('feature-agent_run');
        expect(rows[3].find('.in-features__name').text()).toBe('Instance.feature_unknown');
        expect(wrapper.find('[data-test="features-empty"]').exists()).toBe(false);
        expect(wrapper.find('[data-test="alert-80"]').attributes('data-state')).toBe('sent');
        expect(wrapper.find('[data-test="usage-line"]').exists()).toBe(true);
    });

    it('says so when nothing has been booked this month', async () => {
        const wrapper = await mountPanel({ budget: { ...warnBudget, usedUsd: 0, percent: 0, features: [] } });
        expect(wrapper.find('[data-test="features"]').exists()).toBe(false);
        expect(wrapper.find('[data-test="features-empty"]').text()).toBe('Instance.agent_features_none');
    });

    it('shows the provider with key presence and never a key field', async () => {
        const wrapper = await mountPanel();
        expect(wrapper.find('[data-test="provider"]').text()).toContain('anthropic');
        expect(wrapper.find('[data-test="key-state"]').text()).toBe('Instance.agent_key_set');
        expect(wrapper.find('input[type="password"]').exists()).toBe(false);

        const noKey = await mountPanel({ provider: { name: 'openai', hasKey: false, region: '' } });
        expect(noKey.find('[data-test="key-state"]').text()).toBe('Instance.agent_key_missing');
    });

    it('seeds the form from the settings and saves only the two limits', async () => {
        const wrapper = await mountPanel();
        expect(wrapper.find('#ag-undo').element.value).toBe('24');
        expect(wrapper.find('#ag-budget').element.value).toBe('200');
        expect(wrapper.find('[data-test="save"]').attributes('disabled')).toBeDefined();

        await wrapper.find('#ag-undo').setValue('48');
        expect(wrapper.find('[data-test="save"]').attributes('disabled')).toBeUndefined();
        await wrapper.find('[data-test="save"]').trigger('click');
        await flushPromises();
        expect(apiRequest).toHaveBeenCalledWith('put', '/api/v2/agents/settings', { undoHours: 48, monthlyBudgetUsd: 200 });
    });
});
