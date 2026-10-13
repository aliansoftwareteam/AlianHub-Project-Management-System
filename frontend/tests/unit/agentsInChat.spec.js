import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, RouterLinkStub } from '@vue/test-utils';
import { ref } from 'vue';

const { echo, apiRequest, getters } = vi.hoisted(() => ({
    echo: (key, params) => (params ? `${key} ${JSON.stringify(params)}` : key),
    apiRequest: vi.fn(),
    getters: {},
}));
const composable = vi.hoisted(() => ({
    useGetterFunctions: () => ({ getUser: (id) => ({ u2: { _id: 'u2', Employee_Name: 'Ben Ito' } }[id]) }),
    useCustomComposable: () => ({ changeText: (text) => text }),
}));
vi.mock('@/composable', () => composable);
vi.mock('@/composable/index', () => composable);
vi.mock('@/composable/index.js', () => composable);
vi.mock('@/services', () => ({ apiRequest }));
vi.mock('vuex', async (importOriginal) => ({ ...(await importOriginal()), useStore: () => ({ getters, dispatch: vi.fn() }) }));
vi.mock('vue-i18n', async (importOriginal) => ({ ...(await importOriginal()), useI18n: () => ({ t: echo }) }));

import { useChatDirectory, agentPersonId } from '@/views/Chat/useChatDirectory';
import { fetchChatAgents, openAgentConversation } from '@/views/Ai/useRunnableAgents';
import MainChatMessage from '@/components/organisms/MainChat/MainChatMessage.vue';

const DM_SPACE = { _id: 's1', default: true };
const HELPER = { _id: 'a1', name: 'Helper', autonomy: 1 };
const WRITER = { _id: 'a2', name: 'Writer', autonomy: 2 };

const directory = (agents, chats) => {
    Object.assign(getters, {
        'users/myCounts': { data: {} },
        'settings/companyUserDetail': { roleType: 3 },
        'users/users': [{ _id: 'u1', Employee_Name: 'Me' }, { _id: 'u2', Employee_Name: 'Ben Ito' }],
        'mainChat/mainChatSprints': {},
        'mainChat/mainChatFolders': {},
        'mainChat/chats': { data: chats },
    });
    return useChatDirectory({ projects: ref([DM_SPACE]), userId: ref('u1'), canStartDirect: ref(true), agents: ref(agents) });
};

describe('agents in the chat directory', () => {
    it('lists a conversation with an agent under the agent\'s name, marked as an agent', () => {
        const { directMessages } = directory([HELPER], [{ _id: 'c1', ProjectID: 's1', sprintId: 'd1', AssigneeUserId: ['u1'], agentId: 'a1', agentName: 'Old name', TaskName: 'Helper' }]);
        expect(directMessages.value).toEqual([expect.objectContaining({ id: 'c1', isAgent: true, name: 'Helper', agentId: 'a1' })]);
    });

    it('offers the agents a person may message and has not yet, next to the people', () => {
        const { people } = directory([HELPER, WRITER], [{ _id: 'c1', ProjectID: 's1', sprintId: 'd1', AssigneeUserId: ['u1'], agentId: 'a1' }]);
        expect(people.value.map((p) => p.name)).toEqual(['Writer', 'Ben Ito']);
        expect(people.value[0]).toMatchObject({ id: agentPersonId('a2'), agentId: 'a2', isAgent: true, newChat: true });
    });

    it('offers no agents when the person may use none', () => {
        const { people } = directory([], []);
        expect(people.value.every((p) => !p.isAgent)).toBe(true);
    });
});

describe('the chat agents source', () => {
    beforeEach(() => apiRequest.mockReset());

    it('asks which agents may be named in the conversation', async () => {
        apiRequest.mockResolvedValue({ data: { status: true, data: [HELPER] } });
        await expect(fetchChatAgents({ projectId: 'p1', sprintId: 's1', taskId: 'default' })).resolves.toEqual([HELPER]);
        expect(apiRequest).toHaveBeenCalledWith('get', '/api/v2/agents/chat/usable?projectId=p1&sprintId=s1&taskId=default');
    });

    it('asks which agents may be messaged when there is no conversation, and shows none on failure', async () => {
        apiRequest.mockImplementationOnce(async () => { throw new Error('down'); });
        await expect(fetchChatAgents()).resolves.toEqual([]);
        expect(apiRequest).toHaveBeenCalledWith('get', '/api/v2/agents/chat/usable');
    });

    it('opens the conversation with an agent', async () => {
        apiRequest.mockResolvedValue({ data: { status: true, data: { _id: 'c9' } } });
        await expect(openAgentConversation('a1')).resolves.toEqual({ _id: 'c9' });
        expect(apiRequest).toHaveBeenCalledWith('post', '/api/v2/agents/chat/direct', { agentId: 'a1' });
    });
});

describe('an agent reply in chat', () => {
    const mountMessage = (message) => mount(MainChatMessage, {
        props: { message: { _id: 'm1', type: 'text', createdAt: new Date().toISOString(), ...message } },
        global: {
            provide: { $companyId: ref('co1') },
            stubs: { RouterLink: RouterLinkStub, DropDown: true, DropDownOption: true, ReactionBar: true, MainChatAvatar: true, MainChatMessageBody: true },
            mocks: { $t: echo },
        },
    });

    it('lists what it did and what waits for approval, linking the proposal to the AI inbox', () => {
        const wrapper = mountMessage({
            actorType: 'agent', isAgent: true, agentName: 'Helper', message: 'Done',
            agentChanges: [
                { action: 'subtask.create', label: 'Check the pricing copy', outcome: 'proposed', proposalId: 'p1' },
                { action: 'task.comment', label: 'Note the date', outcome: 'done' },
            ],
        });
        const items = wrapper.findAll('.mc-agent-change');
        expect(items.map((i) => [i.find('.mc-agent-tag').text(), i.find('.mc-agent-change-label').text()])).toEqual([
            ['AgentChat.change_proposed', 'Check the pricing copy'],
            ['AgentChat.change_done', 'Note the date'],
        ]);
        expect(wrapper.findComponent(RouterLinkStub).props('to')).toEqual({ name: 'AiInbox', params: { cid: 'co1' } });
    });

    it('shows that the agent is replying to a message, and when it could not', async () => {
        const wrapper = mountMessage({ userId: 'u1', message: 'hi', agentAsk: { state: 'answering' } });
        expect(wrapper.find('[data-test="agent-ask-answering"]').text()).toBe('AgentChat.replying');
        await wrapper.setProps({ message: { _id: 'm1', type: 'text', userId: 'u1', message: 'hi', agentAsk: { state: 'failed' } } });
        expect(wrapper.find('[data-test="agent-ask-failed"]').text()).toBe('AgentChat.could_not_reply');
    });
});
