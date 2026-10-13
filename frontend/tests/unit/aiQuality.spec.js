import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('@/locales/main', () => ({ i18n: { global: { t: (key) => `t:${key}` } } }));
vi.mock('@/components/organisms/Shell/shellState', () => ({ shellState: { agentsRunning: 0 } }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));
vi.mock('@/views/Ai/AiSidebar.vue', () => ({ default: { name: 'AiSidebar', render: () => null } }));

import AiQuality from '@/views/Ai/AiQuality.vue';
import routes from '@/router/ai/index.js';
import { MODEL_DRIVEN_ROUTES } from '@/router/ai/gate';

const day = (i) => ({ day: `2026-09-${String(i + 1).padStart(2, '0')}`, up: i % 2, down: i % 3 === 0 ? 1 : 0 });

const payload = (over = {}) => ({
    days: 30,
    ratings: {
        up: 3, down: 2,
        byFeature: [{ feature: 'ask', up: 1, down: 2 }, { feature: 'task_estimate', up: 2, down: 0 }],
        byModel: [{ model: 'model-a', up: 0, down: 2 }, { model: 'model-b', up: 3, down: 0 }],
        series: Array.from({ length: 30 }, (_, i) => day(i))
    },
    disliked: [
        { feature: 'ask', kind: 'ask_turn', itemId: 'turn-aaaaaa', model: 'model-a', up: 0, down: 2, reasons: { wrong: 2 }, notes: ['cites the wrong task'], shared: [{ answer: 'shared answer text', sources: [{ kind: 'task', id: 't1', ref: 'OPS-1' }], at: '2026-09-20T00:00:00Z' }] },
        { feature: 'agent_run', kind: 'proposal', itemId: 'pr1', model: '', up: 0, down: 1, reasons: {}, notes: ['wrong_tone'], shared: [] }
    ],
    heldOut: { suite: 'ask_intent', passed: 20, total: 21, failures: [{ question: 'What is due today?', expected: ['SMOKE-5'], got: [] }], ranAt: '2026-09-27T10:00:00Z' },
    cost: { month: '2026-09', usedUsd: 0.3, features: [{ feature: 'ask', usd: 0.25, calls: 3, tokens: 100 }, { feature: 'task_estimate', usd: 0.05, calls: 1, tokens: 10 }] },
    ...over
});

const storeFor = (roleType) => createStore({ modules: { settings: { namespaced: true, getters: { companyUserDetail: () => ({ roleType }) } } } });

const mountAs = async (roleType, data = payload()) => {
    apiRequest.mockImplementation((method) => {
        if (method === 'post') return Promise.resolve({ data: { status: true, data: { suite: 'ask_intent', passed: 21, total: 21, failures: [], ranAt: '2026-09-28T10:00:00Z' } } });
        return Promise.resolve({ data: { status: true, data } });
    });
    const wrapper = mount(AiQuality, { global: { plugins: [storeFor(roleType)] } });
    await flushPromises();
    return wrapper;
};

beforeEach(() => { apiRequest.mockReset(); });

describe('the AI quality page', () => {
    it('is reached from AI setup at /ai/quality and is gated like the other model-driven screens', () => {
        const route = routes.find((r) => r.name === 'AiQuality');
        expect(route.path).toBe('/:cid/ai/quality');
        expect(MODEL_DRIVEN_ROUTES).toContain('AiQuality');
    });

    it('tells a member it is for owners and admins and asks the server nothing', async () => {
        const wrapper = await mountAs(3);
        expect(wrapper.find('[data-test="owner-only"]').exists()).toBe(true);
        expect(apiRequest).not.toHaveBeenCalled();
    });

    it('shows ratings by feature and model with a trend for an admin', async () => {
        const wrapper = await mountAs(2);
        expect(apiRequest.mock.calls[0][1]).toContain('/api/v1/ai/quality?days=30');
        const features = wrapper.findAll('[data-test="by-feature"] tbody tr');
        expect(features.map((r) => r.attributes('data-feature'))).toEqual(['ask', 'task_estimate']);
        expect(features[0].text()).toContain('AiQuality.feature_ask');
        expect(wrapper.findAll('[data-test="by-model"] tbody tr').map((r) => r.attributes('data-model'))).toEqual(['model-a', 'model-b']);
        expect(wrapper.find('[data-test="trend"]').attributes('aria-label')).toBeTruthy();
    });

    it('lists the most disliked items, with an answer only where it was shared', async () => {
        const wrapper = await mountAs(1);
        const items = wrapper.findAll('[data-test="disliked"] [data-item]');
        expect(items.map((i) => i.attributes('data-item'))).toEqual(['turn-aaaaaa', 'pr1']);
        expect(items[0].find('[data-test="shared-answer"]').text()).toContain('shared answer text');
        expect(items[0].text()).toContain('OPS-1');
        expect(items[1].find('[data-test="shared-answer"]').exists()).toBe(false);
    });

    it('shows the held-out pass rate and runs the set again on demand', async () => {
        const wrapper = await mountAs(1);
        expect(wrapper.get('[data-test="held-out"]').text()).toContain('20');
        expect(wrapper.findAll('[data-test="held-out-failure"]')).toHaveLength(1);
        await wrapper.get('[data-test="held-out-run"]').trigger('click');
        await flushPromises();
        expect(apiRequest.mock.calls.some(([method, url]) => method === 'post' && url.endsWith('/api/v1/ai/quality/held-out'))).toBe(true);
        expect(wrapper.findAll('[data-test="held-out-failure"]')).toHaveLength(0);
    });

    it('shows this month\'s cost per feature', async () => {
        const wrapper = await mountAs(1);
        expect(wrapper.findAll('[data-test="cost"] tbody tr').map((r) => r.attributes('data-feature'))).toEqual(['ask', 'task_estimate']);
    });

    it('says the cost could not be read when the server marks it unavailable', async () => {
        const wrapper = await mountAs(1, payload({ cost: { month: '2026-09', unavailable: true, usedUsd: null, features: [] } }));
        expect(wrapper.find('[data-test="cost-unavailable"]').exists()).toBe(true);
        expect(wrapper.find('[data-test="cost"]').exists()).toBe(false);
    });

    it('switches the window with keyboard-reachable tabs', async () => {
        const wrapper = await mountAs(1);
        const tabs = wrapper.findAll('[role="tab"]');
        expect(tabs.map((t) => t.attributes('data-days'))).toEqual(['7', '30', '90']);
        await tabs[2].trigger('click');
        await flushPromises();
        expect(apiRequest.mock.calls.at(-1)[1]).toContain('days=90');
    });

    it('says so when there is no feedback yet', async () => {
        const wrapper = await mountAs(1, payload({ ratings: { up: 0, down: 0, byFeature: [], byModel: [], series: [] }, disliked: [] }));
        expect(wrapper.find('[data-test="no-ratings"]').exists()).toBe(true);
    });
});
