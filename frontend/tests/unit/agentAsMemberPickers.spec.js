import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, h, nextTick, ref } from 'vue';

const { echo, apiRequest } = vi.hoisted(() => ({
    echo: (key, params) => (params ? `${key} ${JSON.stringify(params)}` : key),
    apiRequest: vi.fn(),
}));
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
vi.mock('vuex', async (importOriginal) => ({ ...(await importOriginal()), useStore: () => ({ getters: { 'settings/companyUsers': [{ userId: 'u1', isDelete: false }, { userId: 'u2', isDelete: false }], 'settings/designations': [] } }) }));
vi.mock('vue-i18n', async (importOriginal) => ({ ...(await importOriginal()), useI18n: () => ({ t: echo }) }));
vi.mock('@/components/atom/UserProfile/UserProfile.vue', () => ({ default: { name: 'UserProfile', render: () => null } }));

import Assignee from '@/components/molecules/Assignee/Assignee.vue';
import CommentInput from '@/components/atom/CommentInput/CommentInput.vue';
import TaskAgentClaim from '@/components/organisms/TaskDetailOverlay/TaskAgentClaim.vue';
import { fetchOwnAi, fetchRunnableAgents, handToOwnAi, pickAgent } from '@/views/Ai/useRunnableAgents';
import { AI_STATE, aiAvailability } from '@/composable/aiAvailability';
import { mentionsOwnAi } from '@/utils/agentMention';
import en from '@/locales/en';

const ENTRY = { ownerId: 'u1', name: 'Claude', ownerName: 'Asha Rao', shownAs: 'Claude, for Asha Rao', lastWorkedAt: '2026-10-01T09:00:00.000Z', mine: true };
const OWN_AI = { _id: 'own_u1', name: 'Claude', connected: true, ownerId: 'u1', shownAs: 'Claude, for Asha Rao', mentionKey: 'myai_u1' };
const REVIEWER = { _id: 'a1', name: 'Reviewer', autonomy: 1 };
const HAND_OVER = '/api/v2/agents/work-queue/task/t1/hand-over';
const SidebarStub = { name: 'Sidebar', props: ['options', 'visible'], emits: ['selected', 'itemClicked'], render: () => null };

beforeEach(() => apiRequest.mockReset());

describe('where the pickers learn of the person\'s own AI', () => {
    it('asks the server whether it may be handed this task, and shapes it for the pickers', async () => {
        apiRequest.mockResolvedValue({ data: { status: true, data: [ENTRY] } });
        await expect(fetchOwnAi('t1')).resolves.toEqual([OWN_AI]);
        expect(apiRequest).toHaveBeenCalledWith('get', '/api/v2/agents/connected?taskId=t1');
    });

    it('offers none without a task, when the server refuses, or when the request fails', async () => {
        await expect(fetchOwnAi('')).resolves.toEqual([]);
        expect(apiRequest).not.toHaveBeenCalled();
        apiRequest.mockResolvedValueOnce({ data: { status: false, statusText: 'no' } });
        await expect(fetchOwnAi('t1')).resolves.toEqual([]);
        apiRequest.mockImplementationOnce(() => { throw new Error('network down'); });
        await expect(fetchOwnAi('t1')).resolves.toEqual([]);
    });

    it('with no model on the server, offers the connected AI alone and no in-product agent that would fail', async () => {
        apiRequest.mockResolvedValue({ data: { status: true, data: [ENTRY] } });
        aiAvailability.state = AI_STATE.UNCONFIGURED;
        try {
            await expect(fetchRunnableAgents('t1')).resolves.toEqual([]);
            expect(apiRequest).not.toHaveBeenCalled();
            await expect(fetchOwnAi('t1')).resolves.toEqual([OWN_AI]);
        } finally {
            aiAvailability.state = AI_STATE.UNKNOWN;
        }
        apiRequest.mockResolvedValue({ data: { status: true, data: [REVIEWER] } });
        await expect(fetchRunnableAgents('t1')).resolves.toEqual([REVIEWER]);
    });

    it('hands the task over through the work queue, naming the person and nothing else', async () => {
        apiRequest.mockResolvedValue({ data: { status: true, data: { on: true, items: [] } } });
        await handToOwnAi('t1', 'u1');
        expect(apiRequest).toHaveBeenCalledWith('post', HAND_OVER, { to: 'u1' });
        apiRequest.mockResolvedValueOnce({ data: { status: false, statusText: 'You can hand a task only to your own connected AI.' } });
        await expect(handToOwnAi('t1', 'u2')).rejects.toThrow('You can hand a task only to your own connected AI.');
    });

    it('a pick of the own AI hands over; a pick of an in-product agent still starts a run', async () => {
        apiRequest.mockResolvedValue({ data: { status: true, data: {} } });
        await expect(pickAgent({ type: 'agent', connected: true, ownerId: 'u1', agentId: 'own_u1' }, 't1')).resolves.toEqual({ handed: true });
        expect(apiRequest.mock.calls).toEqual([['post', HAND_OVER, { to: 'u1' }]]);
        apiRequest.mockClear();
        await expect(pickAgent({ type: 'agent', agentId: 'a1' }, 't1')).resolves.toEqual({ handed: false });
        expect(apiRequest.mock.calls).toEqual([['post', '/api/v2/agents/runs', { agentId: 'a1', taskId: 't1', trigger: 'assignment' }]]);
    });
});

describe('the task assignee picker', () => {
    const mountPicker = (agents) => mount(Assignee, {
        props: { users: [], options: ['u1', 'u2'], agents },
        global: { stubs: { Sidebar: SidebarStub, DropDown: true, DropDownOption: true }, mocks: { $t: echo } },
    });
    const openPicker = async (wrapper) => {
        await wrapper.find('.assignee__add-btn').trigger('click');
        await nextTick();
        return wrapper.findComponent(SidebarStub);
    };

    it('lists the person\'s own AI among the agents, as theirs, and never among the people', async () => {
        const groups = (await openPicker(mountPicker([REVIEWER, OWN_AI]))).props('options');
        expect(groups.map((g) => g.label)).toEqual(['Projects.assignee_user', 'TaskPanel.agents_group']);
        expect(groups[0].options.map((o) => o.id)).toEqual(['u1', 'u2']);
        expect(groups[1].options.map((o) => o.label)).toEqual(['Reviewer', 'TaskPanel.my_ai {"name":"Claude"}']);
        expect(groups[1].options[1]).toMatchObject({ type: 'agent', connected: true, ownerId: 'u1', tag: 'TaskPanel.agent_tag' });
        expect(groups[1].options[1].id).not.toBe('u1');
    });

    it('picking it asks for a hand-over and adds nobody to the assignees', async () => {
        const wrapper = mountPicker([OWN_AI]);
        const sidebar = await openPicker(wrapper);
        const [option] = sidebar.props('options')[1].options;
        sidebar.vm.$emit('selected', option);
        await nextTick();
        expect(wrapper.emitted('agent')).toEqual([[option]]);
        expect(wrapper.emitted('selected')).toBeUndefined();
    });
});

describe('the comment mention list', () => {
    const Composer = defineComponent({
        props: { agents: Array },
        setup(props) {
            const text = ref('');
            return () => h('div', [h(CommentInput, { modelValue: text.value, 'onUpdate:modelValue': (v) => { text.value = v; }, userIds: ['u1', 'u2'], agents: props.agents, reply: {} }), h('output', text.value)]);
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
    };
    const mentionOf = async (agent) => {
        const wrapper = mount(Composer, { props: { agents: [agent] }, attachTo: document.body, global: { provide, mocks: { $t: echo } } });
        await typeAt(wrapper);
        await wrapper.find('[role="group"] [role="option"]').trigger('click');
        await nextTick();
        const text = wrapper.find('output').text();
        wrapper.unmount();
        return text;
    };

    it('names the own AI in a form the server keeps apart from a person and from an in-product agent', async () => {
        const text = await mentionOf(OWN_AI);
        expect(text).toBe('@[Claude](myai_u1)');
        expect(mentionsOwnAi(text)).toBe(false);
        expect(mentionsOwnAi('@[Claude](myai_6f0000000000000000000a01) please')).toBe(true);
        expect(mentionsOwnAi('@[Reviewer](agent_6f0000000000000000000a01)')).toBe(false);
    });

    it('writes a name the comment can draw as a mention, whatever the app is called', async () => {
        expect(await mentionOf({ ...OWN_AI, name: 'Claude.ai (web)' })).toBe('@[Claude ai web](myai_u1)');
    });
});

describe('the line on a task handed to one person\'s AI', () => {
    const about = (items) => Promise.resolve({ data: { status: true, data: { on: true, canHandOver: false, items } } });
    const mountLine = async (items) => {
        apiRequest.mockImplementation(() => about(items));
        const wrapper = mount(TaskAgentClaim, { props: { taskId: 't1' }, global: { mocks: { $t: echo } } });
        await flushPromises();
        return wrapper.find('[data-test="claim-line"]').text();
    };

    it('says whose AI it went to while nobody has taken it', async () => {
        expect(await mountLine([{ id: 'i1', rule: 'handed_over', claim: null, to: 'Claude, for Priya', canTakeBack: true }])).toContain('ProjectManager.handed_to {"name":"Claude, for Priya"}');
        expect(en.ProjectManager.handed_to).toContain('{name}');
    });

    it('keeps the plain wording for a task handed to any agent, and the working line once one holds it', async () => {
        expect(await mountLine([{ id: 'i1', rule: 'handed_over', claim: null, canTakeBack: true }])).toContain('ProjectManager.waiting_for_agent');
        expect(await mountLine([{ id: 'i1', rule: 'handed_over', claim: { name: 'Claude, for Priya' }, to: 'Claude, for Priya', canTakeBack: true }])).toContain('ProjectManager.claimed_by');
    });
});
