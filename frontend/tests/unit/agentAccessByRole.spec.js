/* Task 059: AI rights by role on the web side — who builds and changes agents, the approval states the hub and the
   agent page show, who the agent is shared with, and the Inbox lines for approval requests and answers.
   The test setup stubs $t in templates to the key, so template text is checked by key and script text in English. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, RouterLinkStub } from '@vue/test-utils';
import { createStore } from 'vuex';
import { createI18n } from 'vue-i18n';
import { ref } from 'vue';

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('@/locales/main', () => ({ i18n: { global: { t: (key) => key } } }));
vi.mock('@/components/organisms/Shell/shellState', () => ({ shellState: { agentsRunning: 0 } }));
vi.mock('vue-router', () => ({ useRoute: () => ({ params: { id: 'a1' }, query: {} }), useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));

import en from '@/locales/en';
import { renderNotice } from '@/views/Inbox/renderNotice';
import { aiRightOf, AI_RIGHT } from '@/composable/aiRights';
import { approvalStateOf, awaitsApproval, useAgentAccess } from '@/views/Ai/agentAccess';
import AiHub from '@/views/Ai/AiHub.vue';
import AgentAudience from '@/views/Ai/AgentAudience.vue';
import AgentApprovalPanel from '@/views/Ai/AgentApprovalPanel.vue';
import { useAgents } from '@/views/Ai/useAgents';
import { formFromAgent } from '@/views/Ai/agentSavePatch';

const OWNER = 1;
const MEMBER = 3;
const GUEST = 0;
const i18n = createI18n({ legacy: false, locale: 'en', messages: { en } });
const t = i18n.global.t;

const rulesWith = (memberHolds = {}) => ({
    artificial_intelligence: Object.fromEntries(Object.values(AI_RIGHT).map((key) => [key, { roles: key in memberHolds ? [{ key: MEMBER, permission: memberHolds[key] }] : [] }])),
});

const storeFor = (roleType, rules = rulesWith()) => createStore({ modules: {
    settings: { namespaced: true, getters: { companyUserDetail: () => ({ roleType }), rules: () => rules, companyUsers: () => [{ userId: 'u2', status: 2 }, { userId: 'u3', status: 3 }], teams: () => [{ _id: 't1', name: 'Mobile' }] } },
    users: { namespaced: true, getters: { users: () => [{ _id: 'u2', Employee_Name: 'Priya' }, { _id: 'u3', Employee_Name: 'Gone' }] } },
} });

const ok = (data) => Promise.resolve({ data: { status: true, data } });
const serve = (agents) => apiRequest.mockImplementation((type, url) => {
    if (type !== 'get') return ok({});
    if (url === '/api/v2/agents') return ok(agents);
    if (url === '/api/v2/agents/registry') return ok({ actions: [], never: [], autonomy: [{ level: 0 }, { level: 1 }] });
    return ok(url.endsWith('/summary') ? {} : []);
});

const mounted = [];
const mountAs = async (component, { roleType, rules, userId = 'u1', props = {} }) => {
    const wrapper = mount(component, {
        props,
        global: { plugins: [storeFor(roleType, rules), i18n], provide: { $userId: ref(userId), $companyId: ref('c1') }, stubs: { RouterLink: RouterLinkStub, ShellIcon: true } },
    });
    mounted.push(wrapper);
    await flushPromises();
    return wrapper;
};

beforeEach(() => { apiRequest.mockReset(); useAgents().activeRuns.value = {}; });
afterEach(() => { mounted.splice(0).forEach((w) => w.unmount()); });

describe('reading a role\'s AI rights', () => {
    it('gives owners and admins every right, and anyone else what their role holds', () => {
        const rules = rulesWith({ ai_agents: true, ai_skills: false });
        expect(aiRightOf(rules, OWNER, AI_RIGHT.AGENTS)).toBe(true);
        expect(aiRightOf(rules, MEMBER, AI_RIGHT.AGENTS)).toBe(true);
        expect(aiRightOf(rules, MEMBER, AI_RIGHT.SKILLS)).toBe(false);
        expect(aiRightOf(rules, MEMBER, AI_RIGHT.ASSISTANT)).toBeNull();
        expect(aiRightOf(rules, GUEST, AI_RIGHT.AGENTS)).toBeNull();
        expect(aiRightOf({}, MEMBER, AI_RIGHT.AGENTS)).toBeNull();
    });

    it('lets a member whose role builds agents change only the agents they made', async () => {
        let access;
        const Probe = { setup() { access = useAgentAccess(); return () => null; } };
        await mountAs(Probe, { roleType: MEMBER, rules: rulesWith({ ai_agents: true }) });
        expect(access.canBuild.value).toBe(true);
        expect(access.canManage.value).toBe(false);
        expect(access.mayEdit({ ownerId: 'u1' })).toBe(true);
        expect(access.mayEdit({ ownerId: 'u9' })).toBe(false);
    });

    it('reads an agent with no approval state as approved, and one waiting or declined as not able to run', () => {
        expect(approvalStateOf({})).toBe('approved');
        expect(awaitsApproval({ approval: { state: 'pending' } })).toBe(true);
        expect(awaitsApproval({ approval: { state: 'declined' } })).toBe(true);
        expect(awaitsApproval({ approval: { state: 'approved' } })).toBe(false);
    });

    it('reads an agent with no visibility as everyone\'s', () => {
        expect(formFromAgent({}).visibility).toBe('everyone');
        expect(formFromAgent({ visibility: 'shared', sharedWith: { teamIds: ['t1'] } }).sharedWith).toEqual({ userIds: [], teamIds: ['t1'] });
    });
});

describe('the hub', () => {
    const waitingAgent = { _id: 'a1', name: 'Digest', autonomy: 1, ownerId: 'u2', ownerName: 'Priya', visibility: 'private', approval: { state: 'pending', requestedBy: 'u2' } };

    it('offers New agent to a member whose role builds agents, and not to one whose role does not', async () => {
        serve([]);
        expect((await mountAs(AiHub, { roleType: MEMBER, rules: rulesWith({ ai_agents: true }) })).find('[data-test="new-agent"]').exists()).toBe(true);
        expect((await mountAs(AiHub, { roleType: MEMBER })).find('[data-test="new-agent"]').exists()).toBe(false);
    });

    it('shows who made an agent, who may use it and that it waits, and lists it for an owner to review', async () => {
        serve([waitingAgent]);
        const wrapper = await mountAs(AiHub, { roleType: OWNER });
        expect(wrapper.find('[data-test="agent-maker"]').text()).toBe('Created by Priya');
        expect(wrapper.find('[data-test="agent-visibility"]').text()).toBe('AgentAccess.visibility_private');
        expect(wrapper.find('[data-test="agent-pending"]').exists()).toBe(true);
        expect(wrapper.find('[data-test="waiting-approval"]').text()).toContain('Digest');
    });

    it('keeps the waiting list from a member', async () => {
        serve([waitingAgent]);
        expect((await mountAs(AiHub, { roleType: MEMBER, userId: 'u2', rules: rulesWith({ ai_agents: true }) })).find('[data-test="waiting-approval"]').exists()).toBe(false);
    });
});

describe('the approval panel', () => {
    it('lets an owner approve a waiting agent', async () => {
        serve([]);
        const wrapper = await mountAs(AgentApprovalPanel, { roleType: OWNER, props: { agent: { _id: 'a1', name: 'Digest', ownerId: 'u2', ownerName: 'Priya', approval: { state: 'pending' } }, canManage: true } });
        await wrapper.find('[data-test="approve"]').trigger('click');
        await flushPromises();
        expect(apiRequest).toHaveBeenCalledWith('post', '/api/v2/agents/a1/approve', {});
        expect(wrapper.emitted('changed')).toHaveLength(1);
    });

    it('declines only with a reason, and sends it', async () => {
        serve([]);
        const wrapper = await mountAs(AgentApprovalPanel, { roleType: OWNER, props: { agent: { _id: 'a1', name: 'Digest', ownerId: 'u2', approval: { state: 'pending' } }, canManage: true } });
        expect(wrapper.find('[data-test="decline"]').element.disabled).toBe(true);
        await wrapper.find('textarea').setValue('Too wide');
        await wrapper.find('[data-test="decline"]').trigger('click');
        await flushPromises();
        expect(apiRequest).toHaveBeenCalledWith('post', '/api/v2/agents/a1/decline', { reason: 'Too wide' });
    });

    it('answers a waiting change through its revision', async () => {
        serve([]);
        const wrapper = await mountAs(AgentApprovalPanel, { roleType: OWNER, props: { agent: { _id: 'a1', name: 'Digest', ownerId: 'u2', pendingEdit: { n: 4, createdByName: 'Priya' } }, canManage: true } });
        expect(wrapper.find('[data-test="approval-edit"]').text()).toContain('AgentAccess.edit_waiting_title');
        await wrapper.find('[data-test="approve"]').trigger('click');
        await flushPromises();
        expect(apiRequest).toHaveBeenCalledWith('post', '/api/v2/agents/a1/revisions/4/promote', {});
    });

    it('shows a member the reason their agent was declined, with no buttons', async () => {
        serve([]);
        const wrapper = await mountAs(AgentApprovalPanel, { roleType: MEMBER, props: { agent: { _id: 'a1', ownerId: 'u1', decidedByName: 'Olive', approval: { state: 'declined', reason: 'Too wide' } }, isMine: true } });
        expect(wrapper.find('[data-test="approval-declined"]').text()).toContain('AgentAccess.declined_title');
        expect(wrapper.find('[data-test="approval-declined"]').text()).toContain('Too wide');
        expect(wrapper.find('[data-test="approve"]').exists()).toBe(false);
    });
});

describe('who can use the agent', () => {
    it('lists active members and teams only when shared, and sends what is ticked', async () => {
        const wrapper = await mountAs(AgentAudience, { roleType: OWNER, props: { visibility: 'private', sharedWith: { userIds: [], teamIds: [] } } });
        expect(wrapper.find('.agau__shared').exists()).toBe(false);
        await wrapper.setProps({ visibility: 'shared' });
        expect(wrapper.text()).toContain('Priya');
        expect(wrapper.text()).not.toContain('Gone');
        expect(wrapper.text()).toContain('Mobile');
        await wrapper.findAll('.agau__item input')[0].trigger('change');
        expect(wrapper.emitted('update:sharedWith').at(-1)).toEqual([{ userIds: [], teamIds: ['t1'] }]);
    });

    it('clears the share when the agent goes back to private', async () => {
        const wrapper = await mountAs(AgentAudience, { roleType: OWNER, props: { visibility: 'shared', sharedWith: { userIds: ['u2'], teamIds: [] } } });
        await wrapper.find('[data-test="audience-private"]').trigger('change');
        expect(wrapper.emitted('update:visibility').at(-1)).toEqual(['private']);
        expect(wrapper.emitted('update:sharedWith').at(-1)).toEqual([{ userIds: [], teamIds: [] }]);
    });
});

describe('the Inbox lines', () => {
    const lineOf = (changeType, changeData) => renderNotice({ changeType, key: changeType, message: 'stored', changeData }, { t, changeText: (text) => text });

    it('tells an owner what waits, by kind', () => {
        expect(lineOf('agent_approval_requested', { kind: 'agent', agentName: 'Digest' })).toBe('Digest is a new agent waiting for your approval.');
        expect(lineOf('agent_approval_requested', { kind: 'edit', agentName: 'Digest' })).toBe('A change to Digest is waiting for your approval.');
        expect(lineOf('agent_approval_requested', { kind: 'skill', agentName: 'Summary' })).toBe('The skill Summary is waiting for your approval.');
    });

    it('tells the creator the answer, with the reason when declined, as text', () => {
        expect(lineOf('agent_approval_decided', { kind: 'agent', agentName: 'Digest', approved: true })).toBe('Your agent Digest was approved. It can start work.');
        expect(lineOf('agent_approval_decided', { kind: 'edit', agentName: '<b>x</b>', approved: false, reason: 'Too <i>wide</i>' }))
            .toBe('Your change to &lt;b&gt;x&lt;/b&gt; was declined. Reason: Too &lt;i&gt;wide&lt;/i&gt;');
    });
});
