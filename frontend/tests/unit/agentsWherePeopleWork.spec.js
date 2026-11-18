import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, RouterLinkStub } from '@vue/test-utils';
import { defineComponent, h, nextTick, ref } from 'vue';

const { echo, apiRequest } = vi.hoisted(() => ({
    echo: (key, params) => (params ? `${key} ${JSON.stringify(params)}` : key),
    apiRequest: vi.fn(),
}));
const people = { u1: 'Asha Rao', u2: 'Ben Ito' };
const composable = vi.hoisted(() => ({
    useGetterFunctions: () => ({
        getUser: (id) => ({ id, Employee_Name: { u1: 'Asha Rao', u2: 'Ben Ito' }[id], Employee_profileImageURL: '' }),
        getTeam: () => ({}),
    }),
    useCustomComposable: () => ({ makeUniqueId: () => 'x' }),
}));
vi.mock('@/composable', () => composable);
vi.mock('@/composable/index', () => composable);
vi.mock('@/composable/index.js', () => composable);
vi.mock('@/services', () => ({ apiRequest }));
vi.mock('vuex', async (importOriginal) => ({ ...(await importOriginal()), useStore:() => ({ getters: { 'settings/companyUsers': [{ userId: 'u1', isDelete: false }, { userId: 'u2', isDelete: false }], 'settings/designations': [] } }) }));
vi.mock('vue-i18n', async (importOriginal) => ({ ...(await importOriginal()), useI18n: () => ({ t: echo }) }));
vi.mock('@/components/atom/UserProfile/UserProfile.vue', () => ({ default: { name: 'UserProfile', render: () => null } }));

import Assignee from '@/components/molecules/Assignee/Assignee.vue';
import CommentInput from '@/components/atom/CommentInput/CommentInput.vue';
import TaskAgentStrip from '@/components/organisms/TaskDetailOverlay/TaskAgentStrip.vue';
import { assignAgent, fetchRunnableAgents } from '@/views/Ai/useRunnableAgents';

const REVIEWER = { _id: 'a1', name: 'Reviewer', autonomy: 1 };
const SidebarStub = { name: 'Sidebar', props: ['options', 'visible'], emits: ['selected', 'itemClicked'], render: () => null };

const mountPicker = (agents) => mount(Assignee, {
    props: { users: [], options: ['u1', 'u2'], agents },
    global: { stubs: { Sidebar: SidebarStub, DropDown: true, DropDownOption: true }, mocks: { $t: echo } },
});

const openPicker = async (wrapper) => {
    await wrapper.find('.assignee__add-btn').trigger('click');
    await nextTick();
    return wrapper.findComponent(SidebarStub);
};

describe('the task assignee picker', () => {
    it('lists the agents the person may run in their own group, marked as agents', async () => {
        const sidebar = await openPicker(mountPicker([REVIEWER]));
        const groups = sidebar.props('options');
        expect(groups.map((g) => g.label)).toEqual(['Projects.assignee_user', 'TaskPanel.agents_group']);
        const [option] = groups[1].options;
        expect(option).toMatchObject({ label: 'Reviewer', type: 'agent', agentId: 'a1', tag: 'TaskPanel.agent_tag' });
        expect(groups[0].options.map((o) => o.id)).toEqual(['u1', 'u2']);
    });

    it('has no agents group when the person may run none', async () => {
        const sidebar = await openPicker(mountPicker([]));
        expect(sidebar.props('options').map((g) => g.label)).toEqual(['Projects.assignee_user']);
    });

    it('starts the agent instead of adding it to the assignees', async () => {
        const wrapper = mountPicker([REVIEWER]);
        const sidebar = await openPicker(wrapper);
        const [option] = sidebar.props('options')[1].options;
        sidebar.vm.$emit('selected', option);
        await nextTick();
        expect(wrapper.emitted('agent')).toEqual([[option]]);
        expect(wrapper.emitted('selected')).toBeUndefined();
    });
});

describe('the runnable agents source', () => {
    beforeEach(() => apiRequest.mockReset());

    it('asks the server which agents may run on the task', async () => {
        apiRequest.mockResolvedValue({ data: { status: true, data: [REVIEWER] } });
        await expect(fetchRunnableAgents('t1')).resolves.toEqual([REVIEWER]);
        expect(apiRequest).toHaveBeenCalledWith('get', '/api/v2/agents/runnable?taskId=t1');
    });

    it('shows none when there is no task or the server refuses', async () => {
        await expect(fetchRunnableAgents('')).resolves.toEqual([]);
        expect(apiRequest).not.toHaveBeenCalled();
        apiRequest.mockResolvedValueOnce({ data: { status: false, statusText: 'Task not found.' } });
        await expect(fetchRunnableAgents('t1')).resolves.toEqual([]);
        apiRequest.mockImplementationOnce(() => { throw new Error('network down'); });
        await expect(fetchRunnableAgents('t1')).resolves.toEqual([]);
    });

    it('assigns by starting an assignment run', async () => {
        apiRequest.mockResolvedValue({ data: { status: true, data: { _id: 'r1' } } });
        await expect(assignAgent('a1', 't1')).resolves.toEqual({ _id: 'r1' });
        expect(apiRequest).toHaveBeenCalledWith('post', '/api/v2/agents/runs', { agentId: 'a1', taskId: 't1', trigger: 'assignment' });
    });
});

describe('the comment mention list', () => {
    const Composer = defineComponent({
        props: { agents: Array },
        setup(props) {
            const text = ref('');
            return () => h('div', [h(CommentInput, { modelValue: text.value, 'onUpdate:modelValue': (v) => { text.value = v; }, userIds: Object.keys(people), agents: props.agents, reply: {} }), h('output', text.value)]);
        },
    });
    const provide = { $defaultUserAvatar: ref(''), $clientWidth: ref(1280) };

    const typeAt = async (wrapper) => {
        const box = wrapper.find('textarea');
        box.element.value = '@';
        await box.trigger('input');
        box.element.setSelectionRange(1, 1);
        await box.trigger('keyup', { keyCode: 50, key: '@' });
        await nextTick();
        return box;
    };

    it('offers the runnable agents in a group of their own after the people', async () => {
        const wrapper = mount(Composer, { props: { agents: [REVIEWER] }, attachTo: document.body, global: { provide, mocks: { $t: echo } } });
        await typeAt(wrapper);
        const group = wrapper.find('[role="listbox"] [role="group"]');
        expect(group.attributes('aria-label')).toBe('Comments.mention_agents');
        const spoken = (option) => option.findAll('span').filter((s) => s.attributes('aria-hidden') !== 'true').map((s) => s.text());
        expect(group.findAll('[role="option"]').map(spoken)).toEqual([['Reviewer', 'TaskPanel.agent_tag']]);
        expect(wrapper.findAll('[role="option"]')).toHaveLength(3);
        wrapper.unmount();
    });

    it('inserts an agent mention the server can tell from a person', async () => {
        const wrapper = mount(Composer, { props: { agents: [REVIEWER] }, attachTo: document.body, global: { provide, mocks: { $t: echo } } });
        await typeAt(wrapper);
        await wrapper.find('[role="group"] [role="option"]').trigger('click');
        await nextTick();
        expect(wrapper.find('output').text()).toBe('@[Reviewer](agent_a1)');
        wrapper.unmount();
    });

    it('has no agents group without runnable agents', async () => {
        const wrapper = mount(Composer, { props: { agents: [] }, attachTo: document.body, global: { provide, mocks: { $t: echo } } });
        await typeAt(wrapper);
        expect(wrapper.find('[role="group"]').exists()).toBe(false);
        wrapper.unmount();
    });
});

describe('the task agent strip', () => {
    const mountStrip = (run) => mount(TaskAgentStrip, { props: { run }, global: { provide: { $companyId: ref('c1') }, stubs: { RouterLink: RouterLinkStub }, mocks: { $t: echo } } });

    it('links to the run', () => {
        const links = mountStrip({ agentName: 'Reviewer', status: 'running', runId: 'r1' }).findAllComponents(RouterLinkStub);
        expect(links.map((l) => l.props('to'))).toEqual([{ name: 'AiRun', params: { cid: 'c1', runId: 'r1' } }]);
    });

    it('links to the proposal in the AI Inbox once there is one', () => {
        const links = mountStrip({ agentName: 'Reviewer', status: 'review', runId: 'r1', proposalId: 'p1' }).findAllComponents(RouterLinkStub);
        expect(links.map((l) => l.props('to'))).toEqual([
            { name: 'AiRun', params: { cid: 'c1', runId: 'r1' } },
            { name: 'AiInbox', params: { cid: 'c1' }, query: { proposal: 'p1' } },
        ]);
        expect(links.map((l) => l.text())).toEqual(['TaskPanel.agent_open_run', 'TaskPanel.agent_open_proposal']);
    });

    it('has no links for an outside agent session', () => {
        expect(mountStrip({ agentName: 'Coder', status: 'running', session: { state: 'active', activities: [] } }).findAllComponents(RouterLinkStub)).toHaveLength(0);
    });
});
