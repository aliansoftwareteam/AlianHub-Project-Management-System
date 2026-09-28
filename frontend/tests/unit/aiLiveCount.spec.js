import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import { createMemoryHistory, createRouter } from 'vue-router';

const { apiRequest, echo } = vi.hoisted(() => ({
    apiRequest: vi.fn(),
    echo: (key, params) => (params ? `${key} ${JSON.stringify(params)}` : key),
}));
vi.mock('@/services', () => ({ apiRequest, apiRequestWithoutCompnay: vi.fn(() => Promise.resolve({ data: { status: true } })) }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));

import AiSidebar from '@/views/Ai/AiSidebar.vue';
import AgentLiveStrip from '@/views/Ai/AgentLiveStrip.vue';
import { useAgents } from '@/views/Ai/useAgents';
import { shellState } from '@/components/organisms/Shell/shellState';
import aiRoutes from '@/router/ai';

const ok = (data) => Promise.resolve({ data: { status: true, data } });

const team = {
    people: [],
    agents: [
        { id: 'a1', name: 'Daily PM', status: 'running', run: { taskKey: 'AP-116' } },
        { id: 'a2', name: 'Code Reviewer', status: 'running', run: { taskKey: 'AR-1' } },
        { id: 'a3', name: 'Idle one', status: 'idle', run: null },
    ],
    totals: { running: 2 },
};

const answer = (summaryRunning) => (type, url) => {
    if (url.endsWith('/agents/team')) return ok(team);
    if (url.includes('/runs/summary')) return ok({ running: summaryRunning });
    if (url.includes('/agents/runs')) return ok([]);
    return ok({});
};

const blank = { render: () => null };

const mountWith = async (components) => {
    const router = createRouter({
        history: createMemoryHistory(),
        routes: [
            ...aiRoutes.map((route) => (route.component ? { ...route, component: blank } : route)),
            { path: '/:cid/workflows', name: 'WorkflowBuilder', component: blank },
            { path: '/:cid/connections', name: 'Connections', component: blank },
            { path: '/:cid/audit', name: 'AuditLog', component: blank },
        ],
    });
    await router.push('/c1/ai/inbox');
    await router.isReady();
    const store = createStore({ modules: { settings: { namespaced: true, getters: { companyUserDetail: () => ({ roleType: 1 }) } } } });
    const Host = defineComponent({ render: () => h('div', components.map((c) => h(c))) });
    const wrapper = mount(Host, { global: { plugins: [store, router], provide: { $companyId: 'c1', $userId: 'u1' }, mocks: { $t: echo } } });
    await flushPromises();
    return wrapper;
};

const sidebarLine = (wrapper) => wrapper.find('.ai-side__running').text();

describe('the AI sidebar running count', () => {
    let wrapper;

    beforeEach(() => {
        apiRequest.mockReset();
        shellState.agentsRunning = 0;
    });

    afterEach(() => wrapper?.unmount());

    it('says the same as the live strip, even when the run summary disagrees', async () => {
        apiRequest.mockImplementation(answer(0));
        wrapper = await mountWith([AgentLiveStrip, AiSidebar]);
        await useAgents().loadSummary();
        await flushPromises();

        expect(wrapper.findAll('.live__item')).toHaveLength(2);
        expect(sidebarLine(wrapper)).toBe('Ai.agents_running {"n":2}');
        expect(shellState.agentsRunning).toBe(2);
    });

    it('reads the live source on its own when the strip has not loaded yet', async () => {
        apiRequest.mockImplementation(answer(7));
        wrapper = await mountWith([AiSidebar]);

        expect(sidebarLine(wrapper)).toBe('Ai.agents_running {"n":2}');
        expect(apiRequest.mock.calls.some(([, url]) => url.endsWith('/agents/team'))).toBe(true);
    });

    it('does not poll the team read twice when the strip and the sidebar are both on screen', async () => {
        vi.useFakeTimers();
        try {
            apiRequest.mockImplementation(answer(0));
            wrapper = await mountWith([AgentLiveStrip, AiSidebar]);
            const teamReads = () => apiRequest.mock.calls.filter(([, url]) => url.endsWith('/agents/team')).length;
            const before = teamReads();
            await vi.advanceTimersByTimeAsync(30000);
            expect(teamReads() - before).toBe(1);
        } finally {
            vi.useRealTimers();
        }
    });
});
