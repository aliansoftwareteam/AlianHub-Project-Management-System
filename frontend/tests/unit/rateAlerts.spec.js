import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import { createI18n } from 'vue-i18n';
import { h } from 'vue';

const { apiRequest, hasRoute } = vi.hoisted(() => ({ apiRequest: vi.fn(), hasRoute: vi.fn(() => true) }));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('vue-router', () => ({ useRouter: () => ({ hasRoute, push: vi.fn(() => Promise.resolve()) }), useRoute: () => ({ query: {}, params: {} }) }));
vi.mock('@/locales/main', () => ({ i18n: { global: { t: (key) => `t:${key}` } } }));
vi.mock('@/components/organisms/Shell/shellState', () => ({ shellState: { agentsRunning: 0 } }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));
vi.mock('@/components/atom/SpinnerComp/SpinnerComp.vue', () => ({ default: { name: 'SpinnerComp', render: () => null } }));
vi.mock('@/composable/firstRunProgress', () => ({ markFirstRunStep: vi.fn(), FIRST_RUN_STEPS: { NOTIFICATIONS: 'notifications' } }));
vi.mock('@/views/Ai/AiSidebar.vue', () => ({ default: { name: 'AiSidebar', render: () => null } }));

import * as env from '@/config/env';
import AiOpenAlerts from '@/views/Ai/AiOpenAlerts.vue';
import AiAlertThresholds from '@/views/Ai/AiAlertThresholds.vue';
import AiHealth from '@/views/Ai/AiHealth.vue';
import Notifications from '@/views/Settings/Notifications/Notifications.vue';
import { ALERT_DEFAULTS, ALERT_FORMS, ALERT_TYPES, alertSettingsOf, changedSettings, explanationOf, noticeTextOf, thresholdErrors } from '@/views/Ai/rateAlerts';

const messages = {
    en: {
        AiAlerts: {
            explain_agent_error_rate: 'When an agent fails {pct}% or more of at least {runs} runs in an hour.',
            explain_approval_rate_falling: 'Below {floor}% or {drop} points under the 7-day rate.',
            explain_cost_forecast: 'On course for {pct}% of the monthly budget.',
            explain_queue_age: 'Waited {minutes} minutes.',
            incident_agent_error_rate: '{agent} is failing {value}% (threshold {threshold}%)',
            incident_queue_age: 'Waited {value} minutes (threshold {threshold})',
            unnamed_agent: 'An agent'
        }
    }
};
const realI18n = () => createI18n({ legacy: false, globalInjection: true, locale: 'en', messages, missingWarn: false, fallbackWarn: false });
const ok = (data) => Promise.resolve({ data: { status: true, data } });

describe('rateAlerts helpers', () => {
    it('fills missing and out-of-range thresholds with the defaults', () => {
        expect(alertSettingsOf(undefined)).toEqual(ALERT_DEFAULTS);
        expect(alertSettingsOf({ errorRatePct: 35, queueAgeMinutes: 0, enabled: false })).toEqual({ ...ALERT_DEFAULTS, errorRatePct: 35, enabled: false });
    });

    it('reports a range error per field and only the fields that changed', () => {
        const draft = { ...ALERT_DEFAULTS, errorRatePct: 150, errorMinRuns: 2.5 };
        expect(Object.keys(thresholdErrors(draft))).toEqual(['errorRatePct', 'errorMinRuns']);
        expect(thresholdErrors(draft).errorMinRuns).toEqual({ key: 'AiAlerts.error_whole_range', params: { min: 1, max: 1000 } });
        expect(thresholdErrors({ ...ALERT_DEFAULTS, queueAgeMinutes: '' }).queueAgeMinutes).toBeTruthy();
        expect(changedSettings({ ...ALERT_DEFAULTS, costForecastPct: 125, enabled: true }, ALERT_DEFAULTS)).toEqual({ enabled: true, costForecastPct: 125 });
    });

    it('explains each type with its current threshold', () => {
        expect(explanationOf('agent_error_rate', { errorRatePct: 30 })).toEqual({ key: 'AiAlerts.explain_agent_error_rate', params: { pct: 30, runs: 5 } });
        expect(explanationOf('queue_age', null).params).toEqual({ minutes: 15 });
    });

    it('gives every type its own form', () => {
        expect(new Set(ALERT_TYPES.map((type) => ALERT_FORMS[type])).size).toBe(ALERT_TYPES.length);
    });

    it('builds inbox text for open and resolved notices and ignores anything else', () => {
        expect(noticeTextOf({ alertType: 'cost_forecast', state: 'open', lastValue: 140, threshold: 110 })).toEqual({ key: 'AiAlerts.notice_open_cost_forecast', params: { agent: '', value: 140, threshold: 110 } });
        expect(noticeTextOf({ alertType: 'queue_age', state: 'resolved' }).key).toBe('AiAlerts.notice_resolved_queue_age');
        expect(noticeTextOf({ alertType: 'disk_full' })).toBeNull();
        expect(noticeTextOf(undefined)).toBeNull();
    });
});

describe('AiOpenAlerts', () => {
    beforeEach(() => { apiRequest.mockReset(); });

    it('lists open incidents with a chip and a form per type', async () => {
        apiRequest.mockImplementation(() => ok({
            open: [
                { _id: 'i1', type: 'agent_error_rate', key: 'a1', agentName: 'Sentinel', lastValue: 40, threshold: 20, openedAt: '2026-09-11T10:00:00.000Z' },
                { _id: 'i2', type: 'queue_age', key: 'company', lastValue: 22, threshold: 15, openedAt: '2026-09-11T11:00:00.000Z' }
            ],
            resolved: []
        }));
        const wrapper = mount(AiOpenAlerts, { global: { plugins: [realI18n()] } });
        await flushPromises();
        expect(apiRequest).toHaveBeenCalledWith('get', env.AGENT_ALERTS);
        const rows = wrapper.findAll('[data-state="open"]');
        expect(rows.map((r) => r.attributes('data-type'))).toEqual(['agent_error_rate', 'queue_age']);
        expect(rows[0].find('[data-chip="agent_error_rate"] .ai-alerts__mark--diamond').exists()).toBe(true);
        expect(rows[1].find('.ai-alerts__mark--circle').exists()).toBe(true);
        expect(rows[0].text()).toContain('Sentinel is failing 40% (threshold 20%)');
        expect(wrapper.find('[data-test="open-count"]').exists()).toBe(true);
    });

    it('says so when nothing is open', async () => {
        apiRequest.mockImplementation(() => ok({ open: [], resolved: [] }));
        const wrapper = mount(AiOpenAlerts);
        await flushPromises();
        expect(wrapper.find('[data-test="alerts-none"] .ai-alerts__mark--clear').exists()).toBe(true);
        expect(wrapper.find('[data-test="open-count"]').exists()).toBe(false);
    });

    it('shows a load failure instead of an empty list', async () => {
        apiRequest.mockImplementation(() => Promise.reject({ response: { data: { statusText: 'Owner/admin only.' } } }));
        const wrapper = mount(AiOpenAlerts);
        await flushPromises();
        expect(wrapper.find('[data-test="alerts-error"]').text()).toBe('Owner/admin only.');
        expect(wrapper.find('[data-test="alerts-none"]').exists()).toBe(false);
    });
});

describe('AiAlertThresholds', () => {
    beforeEach(() => { apiRequest.mockReset(); });

    const mountPanel = async (alerts = { enabled: true, errorRatePct: 25 }) => {
        apiRequest.mockImplementation((method, url, body) => {
            if (method === 'get') return ok({ undoHours: 24, alerts: { ...ALERT_DEFAULTS, ...alerts } });
            return ok({ undoHours: 24, alerts: { ...ALERT_DEFAULTS, ...alerts, ...body.alerts } });
        });
        const wrapper = mount(AiAlertThresholds);
        await flushPromises();
        return wrapper;
    };

    it('loads the stored thresholds into the form', async () => {
        const wrapper = await mountPanel();
        expect(apiRequest).toHaveBeenCalledWith('get', env.AGENT_SETTINGS);
        expect(wrapper.find('[data-field="errorRatePct"]').element.value).toBe('25');
        expect(wrapper.find('[data-field="queueAgeMinutes"]').element.value).toBe('15');
        expect(wrapper.find('[data-test="enabled-state"]').attributes('data-state')).toBe('on');
        expect(wrapper.find('[data-test="thresholds-save"]').attributes('disabled')).toBeDefined();
    });

    it('blocks saving an out-of-range value and marks the field', async () => {
        const wrapper = await mountPanel();
        await wrapper.find('[data-field="errorRatePct"]').setValue('150');
        expect(wrapper.find('[data-field="errorRatePct"]').attributes('aria-invalid')).toBe('true');
        expect(wrapper.find('[data-error="errorRatePct"]').exists()).toBe(true);
        expect(wrapper.find('[data-test="thresholds-save"]').attributes('disabled')).toBeDefined();
    });

    it('saves only what changed through the agent settings and emits the result', async () => {
        const wrapper = await mountPanel();
        await wrapper.find('[data-field="costForecastPct"]').setValue('125');
        await wrapper.find('form').trigger('submit');
        await flushPromises();
        expect(apiRequest).toHaveBeenCalledWith('put', env.AGENT_SETTINGS, { alerts: { costForecastPct: 125 } });
        expect(wrapper.emitted('saved')[0][0]).toMatchObject({ costForecastPct: 125, errorRatePct: 25 });
        expect(wrapper.find('[data-test="thresholds-saved"]').exists()).toBe(true);
    });

    it('switches rate alerts off for the workspace', async () => {
        const wrapper = await mountPanel();
        await wrapper.find('.ah-switch').trigger('click');
        expect(wrapper.find('[data-test="enabled-state"]').attributes('data-state')).toBe('off');
        await wrapper.find('form').trigger('submit');
        await flushPromises();
        expect(apiRequest).toHaveBeenCalledWith('put', env.AGENT_SETTINGS, { alerts: { enabled: false } });
    });
});

describe('AiHealth alert thresholds', () => {
    beforeEach(() => { apiRequest.mockReset(); });

    it('opens the thresholds panel from the header and lists open alerts for an owner', async () => {
        apiRequest.mockImplementation((method, url) => {
            if (url === env.AGENT_ALERTS) return ok({ open: [{ _id: 'i1', type: 'cost_forecast', key: 'company', lastValue: 130, threshold: 110 }], resolved: [] });
            if (url === env.AGENT_SETTINGS) return ok({ alerts: ALERT_DEFAULTS });
            return ok({ window: '24h', totals: { runs: 0, calls: 0 }, agents: [], models: [], features: [] });
        });
        const store = createStore({ modules: { settings: { namespaced: true, getters: { companyUserDetail: () => ({ roleType: 1 }) } } } });
        const wrapper = mount(AiHealth, { global: { plugins: [store] } });
        await flushPromises();
        expect(wrapper.find('[data-type="cost_forecast"][data-state="open"]').exists()).toBe(true);
        expect(wrapper.find('[data-test="alert-thresholds"]').exists()).toBe(false);
        const toggle = wrapper.find('[data-test="thresholds-toggle"]');
        expect(toggle.attributes('aria-expanded')).toBe('false');
        await toggle.trigger('click');
        await flushPromises();
        expect(toggle.attributes('aria-expanded')).toBe('true');
        expect(wrapper.find('[data-test="alert-thresholds"]').exists()).toBe(true);
    });

    it('shows neither to a member', async () => {
        apiRequest.mockImplementation(() => ok({}));
        const store = createStore({ modules: { settings: { namespaced: true, getters: { companyUserDetail: () => ({ roleType: 3 }) } } } });
        const wrapper = mount(AiHealth, { global: { plugins: [store] } });
        await flushPromises();
        expect(wrapper.find('[data-test="thresholds-toggle"]').exists()).toBe(false);
        expect(wrapper.find('[data-test="open-alerts"]').exists()).toBe(false);
        expect(apiRequest).not.toHaveBeenCalled();
    });
});

describe('Notification settings · AI alerts', () => {
    const doc = { _id: '6f0000000000000000000d01', userId: 'user-1', tasks: { key: 'tasks', items: [] }, agentActivity: true };
    const RouterLink = { name: 'RouterLink', props: ['to'], setup: (props, { slots }) => () => h('a', { 'data-to': props.to?.name }, slots.default?.()) };

    const mountFor = async (roleType, { prefs, alerts = ALERT_DEFAULTS, put } = {}) => {
        apiRequest.mockImplementation((method, url, body) => {
            if (method === 'get' && url === env.NOTIFICATION_PREFERENCES) return ok(prefs || { ...doc, aiAlertsEligible: true, aiAlerts: { agent_error_rate: true, approval_rate_falling: true, cost_forecast: true, queue_age: true } });
            if (method === 'get' && url === env.AGENT_SETTINGS) return ok({ alerts });
            if (method === 'put') return put ? put(url, body) : ok({});
            return ok({});
        });
        const store = createStore({
            modules: {
                settings: {
                    namespaced: true,
                    getters: { notificationSettings: () => doc, companyUserDetail: () => ({ roleType }) },
                    actions: { setNotificationRules: vi.fn() }
                }
            }
        });
        const wrapper = mount(Notifications, { global: { plugins: [store, realI18n()], stubs: { 'router-link': RouterLink, RouterLink } } });
        await flushPromises();
        return wrapper;
    };

    beforeEach(() => { apiRequest.mockReset(); hasRoute.mockReturnValue(true); });

    it('gives an owner one toggle per alert type, each stating its current threshold', async () => {
        const wrapper = await mountFor(1, { alerts: { ...ALERT_DEFAULTS, costForecastPct: 125, queueAgeMinutes: 30 } });
        const section = wrapper.find('[data-test="ai-alerts"]');
        expect(section.exists()).toBe(true);
        expect(section.findAll('.nt__ai-row').map((r) => r.attributes('data-type'))).toEqual(ALERT_TYPES);
        expect(section.find('[data-explain="cost_forecast"]').text()).toBe('On course for 125% of the monthly budget.');
        expect(section.find('[data-explain="queue_age"]').text()).toBe('Waited 30 minutes.');
        expect(section.find('[data-explain="agent_error_rate"]').text()).toContain('20%');
        expect(section.find('[data-test="ai-alerts-thresholds"]').attributes('data-to')).toBe('AiHealth');
    });

    it('marks an alert that is off by form as well as by the switch', async () => {
        const wrapper = await mountFor(2, { prefs: { ...doc, aiAlertsEligible: true, aiAlerts: { agent_error_rate: false, approval_rate_falling: false, cost_forecast: true, queue_age: true } } });
        const row = wrapper.find('.nt__ai-row[data-type="agent_error_rate"]');
        expect(row.attributes('data-state')).toBe('off');
        expect(row.classes()).toContain('is-off');
        expect(row.find('.ah-switch').attributes('aria-checked')).toBe('false');
        expect(wrapper.find('.nt__ai-row[data-type="queue_age"]').attributes('data-state')).toBe('on');
    });

    it('saves a toggle as that one alert type', async () => {
        const wrapper = await mountFor(1);
        await wrapper.find('.nt__ai-row[data-type="queue_age"] .ah-switch').trigger('click');
        await flushPromises();
        expect(apiRequest).toHaveBeenCalledWith('put', env.NOTIFICATION_PREFERENCES, { id: doc._id, aiAlerts: { queue_age: false } });
        expect(wrapper.find('.nt__ai-row[data-type="queue_age"]').attributes('data-state')).toBe('off');
    });

    it('puts the switch back and says why when the save is refused', async () => {
        const wrapper = await mountFor(1, { put: () => Promise.reject({ response: { data: { message: 'AI alerts are for owners and admins only.' } } }) });
        await wrapper.find('.nt__ai-row[data-type="cost_forecast"] .ah-switch').trigger('click');
        await flushPromises();
        expect(wrapper.find('.nt__ai-row[data-type="cost_forecast"]').attributes('data-state')).toBe('on');
        expect(wrapper.find('[data-test="ai-alerts-error"]').text()).toBe('AI alerts are for owners and admins only.');
    });

    it('notes when the workspace has alerts switched off', async () => {
        const wrapper = await mountFor(1, { alerts: { ...ALERT_DEFAULTS, enabled: false } });
        expect(wrapper.find('[data-test="ai-alerts-off"]').exists()).toBe(true);
    });

    it('shows nothing to a member and never asks for their alert choices', async () => {
        const wrapper = await mountFor(3);
        expect(wrapper.find('[data-test="ai-alerts"]').exists()).toBe(false);
        expect(apiRequest).not.toHaveBeenCalledWith('get', env.NOTIFICATION_PREFERENCES);
    });
});
