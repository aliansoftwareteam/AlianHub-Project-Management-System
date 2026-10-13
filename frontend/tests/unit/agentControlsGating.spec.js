import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, RouterLinkStub } from '@vue/test-utils';
import { createStore } from 'vuex';
import { ref } from 'vue';

const { apiRequest, route, router } = vi.hoisted(() => ({
    apiRequest: vi.fn(),
    route: { params: { id: 'a1' }, query: {} },
    router: { replace: vi.fn(), push: vi.fn() }
}));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('@/locales/main', () => ({ i18n: { global: { t: (key) => key } } }));
vi.mock('@/components/organisms/Shell/shellState', () => ({ shellState: { agentsRunning: 0 } }));
vi.mock('vue-router', () => ({ useRoute: () => route, useRouter: () => router }));

import AiHub from '@/views/Ai/AiHub.vue';
import AgentLiveStrip from '@/views/Ai/AgentLiveStrip.vue';
import AgentSettings from '@/views/Ai/AgentSettings.vue';
import AgentOutcomes from '@/views/Ai/AgentOutcomes.vue';
import AgentRevisionHistory from '@/views/Ai/AgentRevisionHistory.vue';
import { useAgents } from '@/views/Ai/useAgents';
import { canControlRun } from '@/views/Ai/agentAccess';

const OWNER = 1;
const MEMBER = 3;
const GUEST = 4;

const ok = (data) => Promise.resolve({ data: { status: true, data } });
const agent = { _id: 'a1', name: 'Reviewer', autonomy: 1, rateLimitPerDay: 40, spendCapUsd: 30, skills: [{ key: 'qa', name: 'QA', actions: ['task.comment'] }], allowedActions: ['task.comment'] };

const serve = ({ agents = [agent] } = {}) => apiRequest.mockImplementation((type, url) => {
    if (type !== 'get') return ok({});
    if (url === '/api/v2/agents') return ok(agents);
    if (url === '/api/v2/agents/registry') return ok({ actions: [], never: [], autonomy: [{ level: 0 }, { level: 1 }, { level: 2 }] });
    if (url === '/api/v2/agents/team') return ok({ people: [], agents: [{ id: 'a1', name: 'Reviewer', status: 'running', run: { taskKey: 'AH-1' } }], totals: { running: 1 } });
    if (url.endsWith('/summary')) return ok({ running: 1 });
    if (url === '/api/v2/agents/spend') return ok({});
    return ok([]);
});

const storeFor = (roleType) => createStore({ modules: { settings: { namespaced: true, getters: { companyUserDetail: () => ({ roleType }) } } } });

const mounted = [];
const mountAs = async (component, { roleType, userId = 'u1', props = {} }) => {
    const wrapper = mount(component, {
        props,
        global: {
            plugins: [storeFor(roleType)],
            provide: { $userId: ref(userId), $companyId: ref('company-1') },
            stubs: { RouterLink: RouterLinkStub, ShellIcon: true }
        }
    });
    mounted.push(wrapper);
    await flushPromises();
    return wrapper;
};

beforeEach(() => {
    apiRequest.mockReset();
    serve();
    useAgents().activeRuns.value = {};
});

afterEach(() => {
    mounted.splice(0).forEach((w) => w.unmount());
});

describe('AiHub controls by role', () => {
    it('hides New agent, Pause and Pause all from a guest', async () => {
        const wrapper = await mountAs(AiHub, { roleType: GUEST });
        expect(wrapper.find('.ai-agent__name').text()).toContain('Reviewer');
        expect(wrapper.find('[data-test="new-agent"]').exists()).toBe(false);
        expect(wrapper.find('[data-test="pause"]').exists()).toBe(false);
        expect(wrapper.find('[data-test="pause-all"]').exists()).toBe(false);
    });

    it('still shows New agent, Pause and Pause all to an owner', async () => {
        const wrapper = await mountAs(AiHub, { roleType: OWNER });
        expect(wrapper.find('[data-test="new-agent"]').exists()).toBe(true);
        expect(wrapper.find('[data-test="pause"]').exists()).toBe(true);
        expect(wrapper.find('[data-test="pause-all"]').exists()).toBe(true);
    });

    it('offers the create templates only to a manager when there are no agents', async () => {
        serve({ agents: [] });
        expect((await mountAs(AiHub, { roleType: MEMBER })).find('[data-test="templates"]').exists()).toBe(false);
        expect((await mountAs(AiHub, { roleType: OWNER })).find('[data-test="templates"]').exists()).toBe(true);
    });

    it('shows Stop to the member who started a run and not to another member', async () => {
        useAgents().activeRuns.value = { a1: [{ _id: 'r1', startedBy: 'u1' }] };
        expect((await mountAs(AiHub, { roleType: MEMBER, userId: 'u1' })).find('[data-test="stop"]').exists()).toBe(true);
        expect((await mountAs(AiHub, { roleType: MEMBER, userId: 'u2' })).find('[data-test="stop"]').exists()).toBe(false);
    });

    it('stops only the runs the caller may stop', async () => {
        useAgents().activeRuns.value = { a1: [{ _id: 'r1', startedBy: 'u1' }, { _id: 'r2', startedBy: 'u2' }] };
        const wrapper = await mountAs(AiHub, { roleType: MEMBER, userId: 'u1' });
        await wrapper.find('[data-test="stop"]').trigger('click');
        await flushPromises();
        const stops = apiRequest.mock.calls.filter(([type]) => type === 'post').map(([, url]) => url);
        expect(stops).toEqual(['/api/v2/agents/runs/r1/stop']);
    });
});

describe('AgentLiveStrip pause all', () => {
    it('is hidden from a guest and shown to an owner while agents run', async () => {
        expect((await mountAs(AgentLiveStrip, { roleType: GUEST })).find('[data-test="pause-all"]').exists()).toBe(false);
        expect((await mountAs(AgentLiveStrip, { roleType: OWNER })).find('[data-test="pause-all"]').exists()).toBe(true);
    });
});

describe('AgentSettings by role', () => {
    it('is read-only for a member', async () => {
        const wrapper = await mountAs(AgentSettings, { roleType: MEMBER });
        expect(wrapper.find('[data-test="read-only"]').text()).toBe('Ai.settings_read_only');
        const controls = wrapper.findAll('input[type="checkbox"], input[type="radio"], input[type="number"]');
        expect(controls.length).toBeGreaterThan(0);
        controls.forEach((input) => expect(input.element.disabled).toBe(true));
        expect(wrapper.find('[data-test="save"]').exists()).toBe(false);
        expect(wrapper.find('[data-test="stop-agent"]').exists()).toBe(false);
        expect(wrapper.find('[data-test="danger"]').exists()).toBe(false);
        expect(wrapper.findComponent(AgentRevisionHistory).exists()).toBe(false);
        expect(apiRequest.mock.calls.some(([, url]) => url.endsWith('/revisions'))).toBe(false);
    });

    it('keeps every control for an owner', async () => {
        const wrapper = await mountAs(AgentSettings, { roleType: OWNER });
        expect(wrapper.find('[data-test="read-only"]').exists()).toBe(false);
        wrapper.findAll('input[type="checkbox"], input[type="radio"], input[type="number"]').forEach((input) => expect(input.element.disabled).toBe(false));
        expect(wrapper.find('[data-test="save"]').exists()).toBe(true);
        expect(wrapper.find('[data-test="stop-agent"]').exists()).toBe(true);
        expect(wrapper.find('[data-test="danger"]').exists()).toBe(true);
        expect(wrapper.findComponent(AgentRevisionHistory).exists()).toBe(true);
    });
});

describe('AgentOutcomes stop', () => {
    const runs = [{ _id: 'r1', agentId: 'a1', agentName: 'Reviewer', status: 'running', startedBy: 'u1' }];

    it('shows Stop only when the caller may stop the run', async () => {
        const starter = await mountAs(AgentOutcomes, { roleType: MEMBER, props: { runs, canStop: (run) => canControlRun(run, { userId: 'u1', roleType: MEMBER }) } });
        expect(starter.find('[data-test="stop-run"]').exists()).toBe(true);

        const other = await mountAs(AgentOutcomes, { roleType: MEMBER, props: { runs, canStop: (run) => canControlRun(run, { userId: 'u2', roleType: MEMBER }) } });
        expect(other.find('[data-test="stop-run"]').exists()).toBe(false);

        expect((await mountAs(AgentOutcomes, { roleType: MEMBER, props: { runs } })).find('[data-test="stop-run"]').exists()).toBe(false);
    });
});
