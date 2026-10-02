import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, RouterLinkStub } from '@vue/test-utils';
import { createStore } from 'vuex';
import { ref } from 'vue';

const { apiRequest, live, pauseAll, refresh } = vi.hoisted(() => ({
    apiRequest: vi.fn(),
    live: { running: null },
    pauseAll: vi.fn(),
    refresh: vi.fn(),
}));

vi.mock('@/services', () => ({ apiRequest, apiRequestWithoutCompnay: vi.fn() }));
vi.mock('vue-router', () => ({ useRoute: () => ({ name: 'AiAsk' }) }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));
vi.mock('@/views/Ai/AiMobileNav.vue', () => ({ default: { name: 'AiMobileNav', render: () => null } }));
vi.mock('@/views/Ai/useLiveAgents', async () => {
    const vue = await import('vue');
    live.running = vue.ref(0);
    return { useLiveAgents: () => ({ running: live.running, refresh }) };
});
vi.mock('@/views/Ai/useAgents', () => ({
    useAgents: () => ({ waiting: { value: 0 }, spend: { value: { totalUsd: 0, agents: [] } }, pauseAll }),
}));

import AiSidebar from '@/views/Ai/AiSidebar.vue';
import WorkspaceConnectedPause from '@/views/Ai/WorkspaceConnectedPause.vue';
import { useAccounts } from '@/views/Ai/useAccounts';
import { AGENTS_CHANGED_EVENT, POLICY_CHANGE } from '@/views/Ai/agentFeed';

const OWNER = 1;
const MEMBER = 3;
const POLICY = '/api/v2/agents/policy';
const CONNECTED = '/api/v2/agents/connected';

const ok = (data) => Promise.resolve({ data: { status: true, data } });
const server = { paused: false, connected: [] };
const policyOf = () => ({ allowedModes: ['workspace'], requireCheckBeforeDone: false, connectedPaused: server.paused });

const serve = () => apiRequest.mockImplementation((type, url, body) => {
    if (url === POLICY && type === 'put') server.paused = body.connectedPaused;
    if (url === POLICY) return ok(policyOf());
    if (url === CONNECTED) return ok(server.connected);
    return ok([]);
});

const mounted = [];
const open = async ({ roleType = OWNER, socket = null, beside = [] } = {}) => {
    const store = createStore({ modules: { settings: { namespaced: true, getters: { companyUserDetail: () => ({ roleType }) } } } });
    const global = { plugins: [store], provide: { $companyId: 'c1', $userId: 'u1', $socket: socket }, stubs: { RouterLink: RouterLinkStub } };
    const others = beside.map((component) => mount(component, { props: { privileged: true }, global }));
    const wrapper = mount(AiSidebar, { global });
    mounted.push(wrapper, ...others);
    await flushPromises();
    return { wrapper, others };
};

const pause = (wrapper) => wrapper.find('[data-test="pause-all"]');
const resume = (wrapper) => wrapper.find('[data-test="resume-all"]');
const line = (wrapper) => wrapper.find('.ai-side__running').text();
const puts = () => apiRequest.mock.calls.filter(([type, url]) => type === 'put' && url === POLICY).map(([, , body]) => body);

beforeEach(() => {
    apiRequest.mockReset();
    pauseAll.mockReset();
    refresh.mockReset();
    live.running.value = 0;
    Object.assign(server, { paused: false, connected: [] });
    useAccounts().policy.value = policyOf();
    serve();
    pauseAll.mockImplementation(async () => { server.paused = true; });
});

afterEach(() => mounted.splice(0).forEach((wrapper) => wrapper.unmount()));

describe('pausing every agent from the AI sidebar', () => {
    it('is offered when a connected app exists, with no run going', async () => {
        server.connected = [{ ownerId: 'u2', name: 'Mira\'s Claude' }];
        const { wrapper } = await open();
        expect(pause(wrapper).attributes('disabled')).toBeUndefined();

        await pause(wrapper).trigger('click');
        await flushPromises();
        expect(pauseAll).toHaveBeenCalledTimes(1);
        expect(line(wrapper)).toBe('Ai.connected_paused');
        expect(pause(wrapper).exists()).toBe(false);
        expect(resume(wrapper).text()).toBe('Ai.resume_connected');
    });

    it('is offered while a run is going, with no connected app', async () => {
        live.running.value = 2;
        const { wrapper } = await open();
        expect(line(wrapper)).toBe('Ai.agents_running');
        expect(pause(wrapper).attributes('disabled')).toBeUndefined();
    });

    it('is not offered when no agent can be at work', async () => {
        const { wrapper } = await open();
        expect(line(wrapper)).toBe('Ai.none_running');
        expect(pause(wrapper).attributes('disabled')).toBeDefined();
    });
});

describe('a workspace whose agents are paused', () => {
    beforeEach(() => { server.paused = true; });

    it('says so and lets an owner resume them', async () => {
        const { wrapper } = await open();
        expect(line(wrapper)).toBe('Ai.connected_paused');
        expect(pause(wrapper).exists()).toBe(false);

        await resume(wrapper).trigger('click');
        await flushPromises();
        expect(puts()).toEqual([{ connectedPaused: false }]);
        expect(resume(wrapper).exists()).toBe(false);
        expect(pause(wrapper).exists()).toBe(true);
        expect(line(wrapper)).toBe('Ai.none_running');
    });

    it('says so to a member, who is offered nothing', async () => {
        const { wrapper } = await open({ roleType: MEMBER });
        expect(line(wrapper)).toBe('Ai.connected_paused');
        expect(pause(wrapper).exists()).toBe(false);
        expect(resume(wrapper).exists()).toBe(false);
        expect(apiRequest.mock.calls.some(([, url]) => url === CONNECTED)).toBe(false);
    });

    it('keeps the resume when the pause could not be lifted', async () => {
        const { wrapper } = await open();
        apiRequest.mockImplementation((type, url) => (type === 'put' ? Promise.reject(new Error('refused')) : ok(url === POLICY ? policyOf() : [])));
        await resume(wrapper).trigger('click');
        await flushPromises();
        expect(resume(wrapper).exists()).toBe(true);
        expect(line(wrapper)).toBe('Ai.connected_paused');
    });
});

describe('the state the sidebar reads', () => {
    it('is the one the card in Accounts sets', async () => {
        const { wrapper, others } = await open({ beside: [WorkspaceConnectedPause] });
        expect(resume(wrapper).exists()).toBe(false);

        await others[0].find('[data-test="connected-pause-switch"]').setValue(true);
        await flushPromises();
        expect(puts()).toEqual([{ connectedPaused: true }]);
        expect(line(wrapper)).toBe('Ai.connected_paused');
        expect(resume(wrapper).exists()).toBe(true);
    });

    it('is read again when someone else changes it', async () => {
        const handlers = {};
        const socket = ref({ on: (event, handler) => { handlers[event] = handler; }, off: vi.fn() });
        const { wrapper } = await open({ socket });
        expect(line(wrapper)).toBe('Ai.none_running');

        server.paused = true;
        handlers[AGENTS_CHANGED_EVENT]({ kind: POLICY_CHANGE });
        await flushPromises();
        expect(line(wrapper)).toBe('Ai.connected_paused');
    });
});
