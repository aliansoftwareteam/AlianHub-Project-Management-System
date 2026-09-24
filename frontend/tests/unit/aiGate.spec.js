import { describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';

vi.mock('@/services', () => ({ apiRequest: vi.fn() }));

import { AI_GATE, MODEL_DRIVEN_ROUTES, aiGateFor } from '@/router/ai/gate';
import { aiOff, applyAiAvailability, resetAiAvailability } from '@/composable/aiAvailability';
import AiModelNotice from '@/components/molecules/AiUnavailable/AiModelNotice.vue';
import aiRoutes from '@/router/ai';

const STATES = ['unknown', 'on', 'unconfigured', 'off_instance', 'off_workspace'];
const CONFIG_ONLY = ['AiHome', 'AiAnalytics', 'AiSkills', 'AiAgent', 'AgentTeammates', 'AgentRouting', 'AiHealth', 'AiAccounts', 'WorkflowRun', 'WorkflowLineage', 'WorkflowBuilder', 'Connections'];

const expected = (route, state) => {
    if (!MODEL_DRIVEN_ROUTES.includes(route)) return null;
    if (state === 'off_instance' || state === 'off_workspace') return AI_GATE.PAGE;
    if (state === 'unconfigured') return AI_GATE.NOTICE;
    return null;
};

describe('the AI gate, per state and route', () => {
    it('treats Ask, the agents hub, the AI Inbox, pipeline and release as model-driven', () => {
        expect([...MODEL_DRIVEN_ROUTES].sort()).toEqual(['AiAsk', 'AiHub', 'AiInbox', 'AiPipeline', 'AiRelease']);
    });

    it('classifies every AI-section route as model-driven or configuration', () => {
        const names = aiRoutes.map((r) => r.name);
        expect(names.filter((n) => !MODEL_DRIVEN_ROUTES.includes(n) && !CONFIG_ONLY.includes(n))).toEqual([]);
    });

    for (const route of [...MODEL_DRIVEN_ROUTES, ...CONFIG_ONLY, 'Home', undefined]) {
        for (const state of STATES) {
            it(`${route || '(no route)'} while ${state}: ${expected(route, state) || 'unchanged'}`, () => {
                expect(aiGateFor(route, state)).toBe(expected(route, state));
            });
        }
    }

    it('never replaces a page because no provider is configured', () => {
        for (const route of [...MODEL_DRIVEN_ROUTES, ...CONFIG_ONLY]) expect(aiGateFor(route, 'unconfigured')).not.toBe(AI_GATE.PAGE);
    });

    it('hides the links into AI screens (palette Ask, Inbox review) only while AI is off', () => {
        for (const state of STATES) {
            resetAiAvailability();
            applyAiAvailability({ state });
            expect(aiOff.value).toBe(state === 'off_instance' || state === 'off_workspace');
        }
        resetAiAvailability();
    });

    it('keeps coding accounts, MCP tokens and connections reachable while AI is off', () => {
        for (const route of ['AiAccounts', 'Connections', 'AiSkills', 'AiAgent', 'AgentRouting']) {
            expect(aiGateFor(route, 'off_instance')).toBeNull();
            expect(aiGateFor(route, 'off_workspace')).toBeNull();
        }
    });
});

describe('the non-blocking notice', () => {
    const mountOn = async (name, data) => {
        resetAiAvailability();
        applyAiAvailability(data);
        const blank = { render: () => null };
        const router = createRouter({
            history: createMemoryHistory(),
            routes: [
                { path: '/:cid/ai/ask', name: 'AiAsk', component: blank },
                { path: '/:cid/ai/skills', name: 'AiSkills', component: blank },
                { path: '/:cid/settings/instance/settings', name: 'InstanceSettings', component: blank },
            ],
        });
        await router.push({ name, params: { cid: 'c1' } });
        await router.isReady();
        const wrapper = mount(AiModelNotice, { global: { plugins: [router], provide: { $companyId: 'c1' } } });
        await flushPromises();
        return wrapper;
    };

    it('shows the owner a set-up link on Ask when no provider is configured', async () => {
        const wrapper = await mountOn('AiAsk', { state: 'unconfigured', canConfigureInstance: true });
        expect(wrapper.find('[role="status"]').text()).toContain('AiAvailability.notice_owner');
        expect(wrapper.find('a').attributes('href')).toBe('/c1/settings/instance/settings?group=ai');
    });

    it('tells a member answers are not available yet, with nothing to click', async () => {
        const wrapper = await mountOn('AiAsk', { state: 'unconfigured', canConfigureInstance: false });
        expect(wrapper.text()).toContain('AiAvailability.notice_member');
        expect(wrapper.find('a').exists()).toBe(false);
    });

    it('says nothing on a configuration screen or when AI is on', async () => {
        expect((await mountOn('AiSkills', { state: 'unconfigured' })).find('[role="status"]').exists()).toBe(false);
        expect((await mountOn('AiAsk', { state: 'on' })).find('[role="status"]').exists()).toBe(false);
    });
});
