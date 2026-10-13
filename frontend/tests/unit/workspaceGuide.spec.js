import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, RouterLinkStub } from '@vue/test-utils';
import { createStore } from 'vuex';
import { ref } from 'vue';

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('@/locales/main', () => ({ i18n: { global: { t: (key) => key } } }));
vi.mock('@/components/organisms/Shell/shellState', () => ({ shellState: { agentsRunning: 0 } }));
vi.mock('@/composable', () => ({ useGetterFunctions: () => ({ getUser: () => ({}) }) }));
vi.mock('vue-router', () => ({ useRoute: () => ({ params: {}, query: {} }), useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));

import AgentTeammates from '@/views/Ai/AgentTeammates.vue';
import AgentMentionBox from '@/views/Ai/AgentMentionBox.vue';
import AgentMemberRow from '@/views/Ai/AgentMemberRow.vue';
import WorkspaceGuideAdd from '@/views/Ai/WorkspaceGuideAdd.vue';
import { fetchRunnableAgents } from '@/views/Ai/useRunnableAgents';
import { reasonOf, useAgents } from '@/views/Ai/useAgents';
import { aiAvailability, AI_STATE } from '@/composable/aiAvailability';

const OWNER = 1;
const MEMBER = 3;
const GUIDE = { _id: 'g1', name: 'Workspace Guide', autonomy: 1, builtIn: 'workspace-guide', skills: [], allowedActions: ['task.get'] };

const ok = (data) => Promise.resolve({ data: { status: true, data } });

const serve = ({ workspaceGuide = 'missing', agents = [] } = {}) => apiRequest.mockImplementation((type, url) => {
    if (type === 'post' && url === '/api/v2/agents/workspace-guide') return ok({ state: 'present', created: true, agent: GUIDE });
    if (type !== 'get') return ok({});
    if (url === '/api/v2/agents') return ok(agents);
    if (url === '/api/v2/agents/registry') return ok({ actions: [], never: [], autonomy: [] });
    if (url === '/api/v2/agents/team') return ok({ people: [], agents: [], totals: {}, workspaceGuide });
    return ok([]);
});

const mounted = [];
const board = async (roleType) => {
    const wrapper = mount(AgentTeammates, {
        global: {
            plugins: [createStore({ modules: { settings: { namespaced: true, getters: { companyUserDetail: () => ({ roleType }), companyOwnerDetail: () => ({}) } } } })],
            provide: { $userId: ref('u1'), $companyId: ref('company-1') },
            stubs: { RouterLink: RouterLinkStub, ShellIcon: true, AiSidebar: true, AgentPicker: true, AgentOutcomes: true, AgentIdentity: true, EmptyState: true }
        }
    });
    mounted.push(wrapper);
    await flushPromises();
    return wrapper;
};

beforeEach(() => { apiRequest.mockReset(); });
afterEach(() => { mounted.splice(0).forEach((w) => w.unmount()); });

describe('Add the Workspace Guide on the Team board', () => {
    it('shows an owner the button while the workspace has no guide', async () => {
        serve();
        const wrapper = await board(OWNER);
        expect(wrapper.text()).toContain('Parity.guide_add');
    });

    it('hides it from a member', async () => {
        serve();
        expect(await board(MEMBER).then((w) => w.text())).not.toContain('Parity.guide_add');
    });

    it.each(['present', 'removed'])('hides it once the guide is %s', async (state) => {
        serve({ workspaceGuide: state });
        expect(await board(OWNER).then((w) => w.text())).not.toContain('Parity.guide_add');
    });

    it('posts once and reloads the board', async () => {
        serve();
        const wrapper = await board(OWNER);
        const button = wrapper.findAll('button').find((b) => b.text().includes('Parity.guide_add'));
        await button.trigger('click');
        await flushPromises();
        expect(apiRequest.mock.calls.filter(([type, url]) => type === 'post' && url === '/api/v2/agents/workspace-guide')).toHaveLength(1);
        expect(apiRequest.mock.calls.filter(([, url]) => url === '/api/v2/agents/team').length).toBeGreaterThan(1);
    });

    it('marks the built-in agent in its row', () => {
        const wrapper = mount(AgentMemberRow, { props: { agent: GUIDE }, global: { stubs: { AgentIdentity: true } } });
        expect(wrapper.text()).toContain('Parity.built_in_tag');
    });
});

describe('the Workspace Guide in the @ menu', () => {
    it('is offered when @ is typed and fills the mention', async () => {
        const wrapper = mount(AgentMentionBox, { props: { agents: [GUIDE] }, global: { stubs: { ShellIcon: true } } });
        await wrapper.find('textarea').setValue('what next @Wor');
        const item = wrapper.find('.ah-pop__item');
        expect(item.text()).toContain('Workspace Guide');
        await item.trigger('click');
        expect(wrapper.find('textarea').element.value).toContain('@WorkspaceGuide ');
    });

    it('is not offered from the runnable list while no model is set up', async () => {
        apiRequest.mockImplementation(() => ok([GUIDE]));
        Object.assign(aiAvailability, { state: AI_STATE.UNCONFIGURED, loaded: true });
        expect(await fetchRunnableAgents('t1')).toEqual([]);
        Object.assign(aiAvailability, { state: AI_STATE.ON, loaded: true });
        expect(await fetchRunnableAgents('t1')).toEqual([GUIDE]);
    });
});

describe('the Workspace Guide keeps its limits in the UI', () => {
    it('shows its own words, not the server\'s, when adding fails', async () => {
        apiRequest.mockRejectedValue({ response: { data: { status: false, statusText: 'Server said no in English' } } });
        const wrapper = mount(WorkspaceGuideAdd, { props: { state: 'missing', canManage: true } });
        await wrapper.find('button').trigger('click');
        await flushPromises();
        expect(wrapper.text()).toContain('Parity.guide_add_failed');
        expect(wrapper.text()).not.toContain('Server said no');
    });

    it('saves only the name of a built-in agent', async () => {
        apiRequest.mockImplementation(() => ok([]));
        await useAgents().saveAgent({ ...GUIDE, name: 'Ask Ally' });
        const put = apiRequest.mock.calls.find(([type]) => type === 'put');
        expect(put[2]).toEqual({ name: 'Ask Ally' });
    });

    it('words a locked built-in refusal in the reader\'s language', () => {
        expect(reasonOf({ response: { data: { code: 'built_in_locked', statusText: 'English' } } }, 'Ai.save_failed')).toBe('Ai.built_in_locked');
    });
});
