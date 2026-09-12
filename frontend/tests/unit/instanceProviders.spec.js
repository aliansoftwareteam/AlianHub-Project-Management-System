import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

const { apiRequestWithoutCompnay } = vi.hoisted(() => ({ apiRequestWithoutCompnay: vi.fn() }));

vi.mock('@/services', () => ({ apiRequestWithoutCompnay }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));

import InstanceProviders from '@/views/Settings/Instance/InstanceProviders.vue';

const health = (over = {}) => ({
    calls: 0, successes: 0, failures: 0, successRate: null, failureRate: null, rateLimited: 0,
    latencyMs: { p50: null, p95: null }, lastErrorType: null, lastErrorAt: null, lastSuccessAt: null,
    breaker: { state: 'closed', openedAt: null, retryAt: null, cooldownMs: 0, consecutiveFailures: 0, trips: 0 },
    ...over,
});

const row = (provider, over = {}) => ({
    provider, model: `${provider}-model`, configured: true, priced: true,
    health: health(over.health), rateLimit: { provider, limitPerMinute: 0, available: null, blockedUntil: null, refusals: 0, ...over.rateLimit },
    ...over,
});

const payload = (providers, routerEnabled = false) => ({
    node: 'node-a', routerEnabled,
    breakerPolicy: { windowMs: 300000, samples: 50, volume: 5, threshold: 0.5, cooldownMs: 30000, maxCooldownMs: 300000, scope: 'process' },
    providers,
});

const mountWith = async (data) => {
    apiRequestWithoutCompnay.mockImplementation(() => Promise.resolve({ data: { status: true, data } }));
    const wrapper = mount(InstanceProviders);
    await flushPromises();
    return wrapper;
};

describe('InstanceProviders', () => {
    beforeEach(() => { apiRequestWithoutCompnay.mockReset(); });

    it('lists one row per provider', async () => {
        const wrapper = await mountWith(payload([row('openai'), row('anthropic')]));
        expect(wrapper.findAll('tbody tr')).toHaveLength(2);
        expect(wrapper.find('[data-test="provider-openai"]').exists()).toBe(true);
    });

    it('says the router is off, and that health is only observation', async () => {
        const wrapper = await mountWith(payload([row('openai')], false));
        expect(wrapper.find('[data-test="router-flag"]').text()).toContain('Providers.router_off');
        expect(wrapper.find('[data-test="router-flag"]').classes()).toContain('in-banner--warn');
    });

    it('shows the breaker state of each provider', async () => {
        const wrapper = await mountWith(payload([
            row('openai', { health: { breaker: { state: 'open', retryAt: '2026-09-12T10:00:00Z', cooldownMs: 30000, trips: 1, openedAt: null, consecutiveFailures: 5 } } }),
            row('anthropic'),
        ]));
        expect(wrapper.find('[data-test="breaker-openai"]').text()).toBe('Providers.breaker_open');
        expect(wrapper.find('[data-test="breaker-openai"]').classes()).toContain('ah-chip--danger');
        expect(wrapper.find('[data-test="breaker-anthropic"]').classes()).toContain('ah-chip--ok');
    });

    it('shouts when a configured model has no price', async () => {
        const wrapper = await mountWith(payload([row('openai', { priced: false }), row('anthropic')]));
        const warning = wrapper.find('[data-test="unpriced-warning"]');
        expect(warning.exists()).toBe(true);
        expect(warning.classes()).toContain('in-banner--danger');
        expect(wrapper.findAll('[data-test="unpriced-chip"]')).toHaveLength(1);
    });

    it('says nothing about price when every configured model has one', async () => {
        const wrapper = await mountWith(payload([row('openai'), row('anthropic', { configured: false, priced: false })]));
        expect(wrapper.find('[data-test="unpriced-warning"]').exists()).toBe(false);
    });

    it('shows the rate-limit budget and a pause when the bucket is blocked', async () => {
        const wrapper = await mountWith(payload([
            row('openai', { rateLimit: { limitPerMinute: 500, available: 480 } }),
            row('anthropic', { rateLimit: { limitPerMinute: 200, available: 0, blockedUntil: '2026-09-12T10:00:00Z' } }),
        ]));
        const cells = wrapper.findAll('tbody tr').map((r) => r.findAll('td')[7].text());
        expect(cells[0]).toBe('Providers.rate_budget');
        expect(cells[1]).toBe('Providers.rate_blocked');
    });

    it('reports a failure to load rather than an empty table', async () => {
        apiRequestWithoutCompnay.mockImplementation(() => Promise.reject(new Error('nope')));
        const wrapper = mount(InstanceProviders);
        await flushPromises();
        expect(wrapper.find('.in-banner--danger').text()).toContain('nope');
        expect(wrapper.find('tbody').exists()).toBe(false);
    });
});
