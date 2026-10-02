/* Tenth sweep, defect 6: the workspace pause of connected agents is one state, read from the store the card in
   AI > Accounts sets, and every place that speaks of agents at work shows it. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import { ref } from 'vue';

const { apiRequest, toast } = vi.hoisted(() => ({ apiRequest: vi.fn(), toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/services', () => ({ apiRequest, apiRequestWithoutCompnay: vi.fn(() => Promise.resolve({ data: { status: true } })) }));
vi.mock('vue-toast-notification', () => ({ useToast: () => toast }));
vi.mock('@/composable/index.js', () => ({ useCustomComposable: () => ({ checkPermission: () => 0 }) }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));

import en from '@/locales/en';
import AgentLiveStrip from '@/views/Ai/AgentLiveStrip.vue';
import WorkspaceConnectedPause from '@/views/Ai/WorkspaceConnectedPause.vue';
import ProjectAgentLimitsCard from '@/views/Projects/ProjectDetail/ProjectAgentLimitsCard.vue';
import { useAccounts } from '@/views/Ai/useAccounts';
import * as feed from '@/views/Ai/agentFeed';
import { shellState } from '@/components/organisms/Shell/shellState';
import { noteAgentLimits, replaceProject } from '@/store/ProjectData/mutations';

const ok = (data) => Promise.resolve({ data: { status: true, data } });
const echo = (key, params) => (params ? `${key} ${JSON.stringify(params)}` : key);

const AT_WORK = { id: 'a1', name: 'Daily PM', status: 'running', run: { status: 'running', taskKey: 'AP-116' } };
const HELD = { id: 'a2', name: 'Code Reviewer', status: 'running', run: { status: 'waiting_approval', taskKey: 'AR-49' } };
const LIMITS = { limits: { atOnce: 3, paused: false, directTasks: 10 }, atOnceRange: { min: 1, max: 20 }, directTasksRange: { min: 1, max: 100 }, directTasksMinutes: 10, canEdit: true };

let world;
const answer = (method, url, body) => {
    if (url.endsWith('/agents/team')) return ok({ people: [], agents: world.agents, ...(world.paused === undefined ? {} : { connectedPaused: world.paused }) });
    if (url.includes('/agents/runs')) return ok([]);
    if (url.endsWith('/agents/policy')) {
        if (method === 'put') world.policy = { ...world.policy, ...body };
        return ok({ allowedModes: ['workspace'], requireCheckBeforeDone: false, ...world.policy });
    }
    if (url.includes('/agents/project-limits/')) return ok({ ...LIMITS, limits: { ...LIMITS.limits, paused: world.projectPaused } });
    return ok({});
};

const store = () => createStore({
    modules: {
        settings: { namespaced: true, getters: { companyUserDetail: () => ({ roleType: 1 }) } },
        projectData: { namespaced: true, state: () => ({ allProjects: { data: [{ _id: 'p1', ProjectName: 'Alpha' }] } }), getters: { allProjects: (state) => state.allProjects }, mutations: { noteAgentLimits, replaceProject } }
    }
});
const mounted = [];
const show = async (component, props = {}) => {
    const wrapper = mount(component, {
        props,
        global: { plugins: [store()], provide: { $companyId: 'c1', $userId: 'u1', $clientWidth: ref(1280) }, mocks: { $t: echo }, stubs: { 'router-link': true, transition: false } }
    });
    mounted.push(wrapper);
    await flushPromises();
    return wrapper;
};
const pausedNow = () => useAccounts().policy.value.connectedPaused;

beforeEach(async () => {
    world = { agents: [AT_WORK, HELD], paused: false, policy: { connectedPaused: false }, projectPaused: false };
    apiRequest.mockReset();
    apiRequest.mockImplementation(answer);
    shellState.agentsRunning = 0;
    await useAccounts().loadPolicy();
});
afterEach(() => { while (mounted.length) mounted.pop().unmount(); });

describe('an agent whose run waits on a person', () => {
    it('is held, not at work: the strip, the count and the rail leave it out', async () => {
        const strip = await show(AgentLiveStrip);
        expect(feed.live.value.map((agent) => agent.name)).toEqual(['Daily PM']);
        expect(feed.running.value).toBe(1);
        expect(shellState.agentsRunning).toBe(1);
        expect(strip.findAll('.live__item')).toHaveLength(1);
        expect(strip.text()).toContain('Daily PM');
        expect(strip.text()).not.toContain('Code Reviewer');
    });

    it('leaves nothing running when every run waits on a person', async () => {
        world.agents = [HELD];
        const strip = await show(AgentLiveStrip);
        expect(feed.running.value).toBe(0);
        expect(shellState.agentsRunning).toBe(0);
        expect(strip.find('[data-test="pause-all"]').exists()).toBe(false);
    });
});

describe('the workspace pause of connected agents', () => {
    it('comes with the agents the feed reads, into the store the card sets', async () => {
        world.paused = true;
        await show(AgentLiveStrip);
        expect(pausedNow()).toBe(true);
        world.paused = false;
        await feed.refreshAgentFeed();
        expect(pausedNow()).toBe(false);
    });

    it('is left as it is by an answer that does not say', async () => {
        world.policy = { connectedPaused: true };
        await useAccounts().loadPolicy();
        world.paused = undefined;
        await show(AgentLiveStrip);
        expect(pausedNow()).toBe(true);
    });

    it('is said on the strip, also when no agent is at work', async () => {
        world.agents = [];
        world.paused = true;
        const strip = await show(AgentLiveStrip);
        expect(strip.find('[data-test="live-paused"]').text()).toBe('Ai.connected_paused');
    });

    it('is not said on the strip while it is off', async () => {
        const strip = await show(AgentLiveStrip);
        expect(strip.find('[data-test="live-paused"]').exists()).toBe(false);
    });

    it('is said on the card itself while it is on, and no longer once it is turned off', async () => {
        world.policy = { connectedPaused: true };
        await useAccounts().loadPolicy();
        const card = await show(WorkspaceConnectedPause, { privileged: true });
        expect(card.get('[data-test="connected-paused-now"]').text()).toBe('Ai.connected_paused');
        await card.get('[data-test="connected-pause-switch"]').setValue(false);
        await flushPromises();
        expect(card.find('[data-test="connected-paused-now"]').exists()).toBe(false);
    });

    it('stands above the project\'s own pause on Project Details', async () => {
        world.policy = { connectedPaused: true };
        world.projectPaused = true;
        const card = await show(ProjectAgentLimitsCard, { projectId: 'p1' });
        const notes = card.findAll('[role="status"]').map((note) => note.attributes('data-test'));
        expect(notes).toEqual(['workspace-paused-note', 'paused-note']);
        expect(card.get('[data-test="workspace-paused-note"]').text()).toBe('AgentLimits.workspace_paused_note');
    });

    it('is not said on Project Details while it is off', async () => {
        const card = await show(ProjectAgentLimitsCard, { projectId: 'p1' });
        expect(card.find('[data-test="workspace-paused-note"]').exists()).toBe(false);
    });

    it('has words that say whom it holds and who lifts it', () => {
        expect(en.Ai.connected_paused).toBe('Connected agents are paused');
        expect(en.AgentLimits.workspace_paused_note).toMatch(/whole workspace/);
        expect(en.AgentLimits.workspace_paused_note).toMatch(/owner or an admin/);
    });
});
