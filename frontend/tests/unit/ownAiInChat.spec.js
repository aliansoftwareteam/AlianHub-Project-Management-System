import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, shallowMount, RouterLinkStub } from '@vue/test-utils';
import { defineComponent, h, nextTick, ref } from 'vue';

const { apiRequest, persistMessage, store, echo, agentSources } = vi.hoisted(() => ({
    apiRequest: vi.fn(),
    persistMessage: vi.fn(),
    store: {
        getters: {
            'settings/fileExtentions': [],
            'settings/companyOwnerDetail': {},
            'settings/companyUsers': [{ userId: 'u1', isDelete: false }, { userId: 'u2', isDelete: false }],
            'settings/designations': [],
            'users/myCounts': { data: {}, type: 'add' },
            'users/users': [{ _id: 'u1' }],
            'projectData/projects': { data: [] },
        },
        commit: vi.fn(),
        dispatch: vi.fn(() => Promise.resolve({})),
    },
    echo: (key, params) => (params ? `${key} ${JSON.stringify(params)}` : key),
    agentSources: { fetchChatAgents: vi.fn(), fetchOwnAiInChat: vi.fn(), fetchConnectedAgents: vi.fn() },
}));

const composable = vi.hoisted(() => ({
    useGetterFunctions: () => ({
        getUser: (id) => ({ _id: id, id, Employee_Name: { u1: 'Asha Rao', u2: 'Ben Ito' }[id], Employee_profileImageURL: '' }),
        getTeam: () => ({}),
    }),
    useCustomComposable: () => ({ changeText: (text) => text, debounce: (fn) => fn, makeUniqueId: () => 'x' }),
    useConvertDate: () => ({ convertDateFormat: (value) => String(value) }),
}));
vi.mock('@/composable', () => composable);
vi.mock('@/composable/index', () => composable);
vi.mock('@/composable/index.js', () => composable);
vi.mock('@/services', () => ({ apiRequest, apiRequestWithoutCompnay: vi.fn() }));
vi.mock('vuex', async (importOriginal) => ({ ...(await importOriginal()), useStore: () => store }));
vi.mock('vue-router', async (importOriginal) => ({
    ...(await importOriginal()), useRoute: () => ({ query: {} }), useRouter: () => ({ push: vi.fn(), replace: vi.fn(() => Promise.resolve()) }),
}));
vi.mock('vue-i18n', async (importOriginal) => ({ ...(await importOriginal()), useI18n: () => ({ t: echo }) }));
vi.mock('sweetalert2', () => ({ default: { fire: vi.fn(() => Promise.resolve({ isConfirmed: true })) } }));
vi.mock('@/utils/TaskOperations', () => ({ default: { create: vi.fn(), updateLastMessageTime: vi.fn(() => Promise.resolve()) } }));
vi.mock('@/composable/commonFunction', () => ({
    taskPlanPermission: () => ({ checkTaskPerSprintPermisssion: vi.fn(() => Promise.resolve(true)) }),
    storageHelper: () => ({ handleStorageImageRequest: vi.fn() }),
}));
vi.mock('@/composable/useCall', () => ({
    useCall: () => ({ startCall: vi.fn(), isBusy: ref(false), isSupported: () => false, isSecure: () => false }),
}));
vi.mock('@/composables/useClipRecorder', () => ({ useClipRecorder: () => ({ openRecorder: vi.fn() }) }));
vi.mock('@/views/Projects/Comments/helper', () => ({
    bakeMessage: async ({ messageData }) => ({ ...messageData, hasReply: false }),
    sendMessage: persistMessage,
    uploadToWasabi: vi.fn(),
    deleteFromWasabi: vi.fn(() => Promise.resolve()),
    checkFile: vi.fn(),
    renderFiles: vi.fn(),
}));
vi.mock('@/components/atom/UserProfile/UserProfile.vue', () => ({ default: { name: 'UserProfile', render: () => null } }));
vi.mock('@/views/Ai/useRunnableAgents', () => agentSources);

import CommentInput from '@/components/atom/CommentInput/CommentInput.vue';
import MainChatMessage from '@/components/organisms/MainChat/MainChatMessage.vue';
import MainChatPanel from '@/components/organisms/MainChat/MainChatPanel.vue';
import MainChatComposer from '@/components/organisms/MainChat/MainChatComposer.vue';
import { useMainChatConversation } from '@/components/organisms/MainChat/useMainChatConversation';
import { AI_STATE, aiAvailability } from '@/composable/aiAvailability';
import en from '@/locales/en';

const ENTRY = { ownerId: 'u1', name: 'Claude', ownerName: 'Asha Rao', shownAs: 'Claude, for Asha Rao', lastWorkedAt: '2026-10-01T09:00:00.000Z', mine: true };
const OWN_AI = { _id: 'own_u1', name: 'Claude', connected: true, ownerId: 'u1', shownAs: 'Claude, for Asha Rao', mentionKey: 'myai_u1' };
const HELPER = { _id: 'a1', name: 'Helper', autonomy: 1 };
const CHANNEL = { projectId: 'proj-1', sprintId: 'chan-1', taskId: 'default' };
const NAMED = '@[Claude](myai_6f0000000000000000000a01)';

beforeEach(() => {
    apiRequest.mockReset();
    apiRequest.mockResolvedValue({ data: { status: true, data: [] } });
    agentSources.fetchChatAgents.mockReset().mockResolvedValue([HELPER]);
    agentSources.fetchOwnAiInChat.mockReset().mockResolvedValue({ agents: [OWN_AI], why: '' });
    agentSources.fetchConnectedAgents.mockReset().mockResolvedValue([ENTRY]);
    persistMessage.mockReset();
    Object.assign(aiAvailability, { state: AI_STATE.UNKNOWN, loaded: false, planAllowsAi: null });
});

describe('where the chat learns of the person\'s own AI', () => {
    const source = async () => (await vi.importActual('@/views/Ai/useRunnableAgents')).fetchOwnAiInChat;

    it('asks the server whether it may be asked in this conversation, and shapes it for the "@" menu', async () => {
        apiRequest.mockResolvedValue({ data: { status: true, data: [ENTRY] } });
        await expect((await source())(CHANNEL)).resolves.toEqual({ agents: [OWN_AI], why: '' });
        expect(apiRequest).toHaveBeenCalledWith('get', '/api/v2/agents/connected?projectId=proj-1&sprintId=chan-1&taskId=default');
    });

    it('carries why the server holds it back, where it does', async () => {
        apiRequest.mockResolvedValue({ data: { status: true, data: [], why: 'project_manager_off' } });
        await expect((await source())(CHANNEL)).resolves.toEqual({ agents: [], why: 'project_manager_off' });
    });

    it('offers none before the conversation exists, when the server refuses, or when the request fails', async () => {
        const fetchOwnAiInChat = await source();
        const NONE = { agents: [], why: '' };
        await expect(fetchOwnAiInChat({ projectId: 'proj-1', sprintId: 'chan-1', taskId: '' })).resolves.toEqual(NONE);
        await expect(fetchOwnAiInChat()).resolves.toEqual(NONE);
        expect(apiRequest).not.toHaveBeenCalled();
        apiRequest.mockResolvedValueOnce({ data: { status: false, statusText: 'no', why: 'project_manager_off' } });
        await expect(fetchOwnAiInChat(CHANNEL)).resolves.toEqual(NONE);
        apiRequest.mockImplementationOnce(() => { throw new Error('network down'); });
        await expect(fetchOwnAiInChat(CHANNEL)).resolves.toEqual(NONE);
    });
});

describe('the "@" menu of a chat conversation', () => {
    const mountPanel = async (props = {}) => {
        const wrapper = shallowMount(MainChatPanel, {
            props: { taskId: 'default', sprintId: 'chan-1', title: 'general', isChannel: true, watchers: ['u1', 'u2'], ...props },
            global: { mocks: { $t: echo }, provide: { selectedProject: ref({ _id: 'proj-1' }), $socket: ref(null) } },
        });
        await flushPromises();
        return wrapper;
    };
    const offered = (wrapper) => wrapper.findComponent(MainChatComposer).props('agents');
    const note = (wrapper) => wrapper.findComponent(MainChatComposer).props('agentsNote');

    it('with no model on the server, offers the connected AI alone and asks for no in-product agent', async () => {
        aiAvailability.state = AI_STATE.UNCONFIGURED;
        const wrapper = await mountPanel();
        expect(agentSources.fetchChatAgents).not.toHaveBeenCalled();
        expect(agentSources.fetchOwnAiInChat).toHaveBeenCalledWith(CHANNEL);
        expect(offered(wrapper)).toEqual([OWN_AI]);
        expect(note(wrapper)).toBe('');
    });

    it('says in one line why the AI is not offered in a channel of a project whose project manager is off', async () => {
        agentSources.fetchOwnAiInChat.mockResolvedValue({ agents: [], why: 'project_manager_off' });
        const wrapper = await mountPanel();
        expect(offered(wrapper)).toEqual([]);
        expect(note(wrapper)).toBe('AgentChat.own_ai_manager_off');
        expect(en.AgentChat.own_ai_manager_off).toMatch(/project manager/);
    });

    it('with a model, offers the in-product agents and the person\'s own AI', async () => {
        Object.assign(aiAvailability, { state: AI_STATE.ON, loaded: true, planAllowsAi: true });
        const wrapper = await mountPanel();
        expect(agentSources.fetchChatAgents).toHaveBeenCalledWith(CHANNEL);
        expect(offered(wrapper)).toEqual([HELPER, OWN_AI]);
    });

    it('offers nothing where the person has no AI of their own, and nothing in a conversation with an in-product agent', async () => {
        agentSources.fetchOwnAiInChat.mockResolvedValue({ agents: [], why: '' });
        aiAvailability.state = AI_STATE.UNCONFIGURED;
        const plain = await mountPanel();
        expect(offered(plain)).toEqual([]);
        expect(note(plain)).toBe('');
        agentSources.fetchOwnAiInChat.mockClear();
        expect(offered(await mountPanel({ agentId: 'a1' }))).toEqual([]);
        expect(agentSources.fetchOwnAiInChat).not.toHaveBeenCalled();
    });
});

describe('the own AI in the mention list', () => {
    const Composer = defineComponent({
        props: { agents: Array, agentsNote: String },
        setup(props) {
            const text = ref('');
            return () => h('div', [h(CommentInput, { modelValue: text.value, 'onUpdate:modelValue': (v) => { text.value = v; }, userIds: ['u1', 'u2'], agents: props.agents, agentsNote: props.agentsNote, reply: {} }), h('output', text.value)]);
        },
    });
    const provide = { $defaultUserAvatar: ref(''), $clientWidth: ref(1280) };
    const open = async (agents, agentsNote = '') => {
        const wrapper = mount(Composer, { props: { agents, agentsNote }, attachTo: document.body, global: { provide, mocks: { $t: echo } } });
        const box = wrapper.find('textarea');
        box.element.value = '@';
        await box.trigger('input');
        box.element.setSelectionRange(1, 1);
        await box.trigger('keyup', { keyCode: 50, key: '@' });
        await nextTick();
        return wrapper;
    };

    it('is named as the member list names it, and an in-product agent keeps its own name', async () => {
        const wrapper = await open([HELPER, OWN_AI]);
        const rows = wrapper.findAll('[role="group"] [role="option"]').map((row) => row.text());
        wrapper.unmount();
        expect(rows).toHaveLength(2);
        expect(rows[0]).toContain('Helper');
        expect(rows[0]).not.toContain('TaskPanel.my_ai');
        expect(rows[1]).toContain('TaskPanel.my_ai {"name":"Claude"}');
    });

    it('shows the one line under the list when the AI is held back, and no line otherwise', async () => {
        const held = await open([], 'AgentChat.own_ai_manager_off');
        const line = held.find('[data-test="mention-note"]');
        expect(line.text()).toBe('AgentChat.own_ai_manager_off');
        expect(line.attributes('role')).toBeUndefined();
        expect(held.findAll('[role="option"]').some((row) => row.text().includes('own_ai_manager_off'))).toBe(false);
        held.unmount();
        const free = await open([OWN_AI]);
        expect(free.find('[data-test="mention-note"]').exists()).toBe(false);
        free.unmount();
    });

    it('writes the name the server reads as the person\'s own AI', async () => {
        const wrapper = await open([OWN_AI]);
        await wrapper.find('[role="group"] [role="option"]').trigger('click');
        await nextTick();
        const text = wrapper.find('output').text();
        wrapper.unmount();
        expect(text).toBe('@[Claude](myai_u1)');
    });
});

describe('the mark on a message that asked the person\'s own AI', () => {
    const mountMessage = async (message, companyId = 'co-member') => {
        const wrapper = mount(MainChatMessage, {
            props: { message: { _id: 'm1', type: 'text', userId: 'u1', message: `${NAMED} what is left?`, createdAt: new Date().toISOString(), ...message } },
            global: {
                provide: { $companyId: ref(companyId) },
                stubs: { RouterLink: RouterLinkStub, DropDown: true, DropDownOption: true, ReactionBar: true, MainChatAvatar: true, MainChatMessageBody: true },
                mocks: { $t: echo },
            },
        });
        await flushPromises();
        return wrapper;
    };
    const mark = (wrapper) => wrapper.find('[data-test="own-ai-asked"]');
    const ASKED = { at: '2026-10-02T09:00:00.000Z' };

    it('tells a member who was asked, for whom, and when that AI gets the question', async () => {
        const wrapper = await mountMessage({ ownAiAsk: ASKED });
        expect(mark(wrapper).text()).toBe('AgentChat.asked_own_ai {"name":"Claude, for Asha Rao"}');
        expect(mark(wrapper).attributes('title')).toBe('AgentChat.asked_own_ai_hint');
    });

    it('tells a guest, who is given no colleague\'s AI, that an AI was asked and not whose or which', async () => {
        agentSources.fetchConnectedAgents.mockResolvedValue([]);
        const wrapper = await mountMessage({ ownAiAsk: ASKED }, 'co-guest');
        expect(mark(wrapper).text()).toBe('AgentChat.asked_their_ai');
        expect(wrapper.text()).not.toMatch(/Claude|Asha/);
    });

    it('asks for the names once for a workspace however many marks it draws, and not at all with no mark to draw', async () => {
        await mountMessage({}, 'co-quiet');
        expect(agentSources.fetchConnectedAgents).not.toHaveBeenCalled();
        await Promise.all([mountMessage({ ownAiAsk: ASKED }, 'co-many'), mountMessage({ _id: 'm2', ownAiAsk: ASKED }, 'co-many')]);
        await mountMessage({ _id: 'm3', ownAiAsk: ASKED }, 'co-many');
        expect(agentSources.fetchConnectedAgents).toHaveBeenCalledTimes(1);
    });

    it('shows what the server stores and hides nothing of it: the mark is there with the field and gone without it', async () => {
        expect(mark(await mountMessage({})).exists()).toBe(false);
        expect(mark(await mountMessage({ ownAiAsk: null })).exists()).toBe(false);
        expect(mark(await mountMessage({ message: 'reworded by its author', ownAiAsk: ASKED })).exists()).toBe(true);
    });

    it('has its words in the locale file', () => {
        expect(en.AgentChat.asked_own_ai).toContain('{name}');
        expect(en.AgentChat.asked_their_ai).not.toContain('{');
        expect(en.AgentChat.asked_own_ai_hint).toBeTruthy();
    });
});

describe('the mark as the sender meets it', () => {
    const MARK = { at: '2026-10-02T09:00:00.000Z' };
    const TEXT = '@[Claude](myai_u1) what is left';
    const open = async () => {
        const handlers = {};
        const socket = ref({ id: 'sock-1', emit: vi.fn(), on: (event, fn) => { handlers[event] = fn; }, off: vi.fn() });
        const chat = useMainChatConversation({
            socket, companyId: ref('company-1'), userId: ref('u1'), target: () => ({ ...CHANNEL, folderId: '', isDefaultProject: false }),
            participants: () => ['u1', 'u2'], currentUser: () => ({ id: 'u1', Employee_Name: 'Asha Rao' }),
        });
        await chat.load();
        chat.attach();
        return { chat, handlers };
    };
    const stored = (messageData) => ({ ...messageData, _id: 'saved-1', userId: 'u1', createdAt: '2026-10-02T09:00:00.000Z' });

    it('stays on the message when the server\'s answer to the send lands after the mark', async () => {
        const { chat, handlers } = await open();
        persistMessage.mockImplementation(async ({ messageData }) => {
            handlers.commentInsert({ fullDocument: stored(messageData) });
            handlers.commentUpdate({ fullDocument: { ...stored(messageData), ownAiAsk: MARK } });
            return { ...messageData, _id: 'saved-1', id: 'saved-1' };
        });
        await chat.sendText(TEXT);
        expect(chat.messages.value).toHaveLength(1);
        expect(chat.messages.value[0]).toMatchObject({ _id: 'saved-1', sent: true, ownAiAsk: MARK });
    });

    it('arrives on the message when the mark lands after the answer', async () => {
        const { chat, handlers } = await open();
        let sent;
        persistMessage.mockImplementation(async ({ messageData }) => { sent = messageData; return { ...messageData, _id: 'saved-1', id: 'saved-1' }; });
        await chat.sendText(TEXT);
        expect(chat.messages.value[0].ownAiAsk).toBeUndefined();
        handlers.commentUpdate({ fullDocument: { ...stored(sent), ownAiAsk: MARK } });
        expect(chat.messages.value).toHaveLength(1);
        expect(chat.messages.value[0]).toMatchObject({ _id: 'saved-1', ownAiAsk: MARK });
    });
});

describe('a mark the server takes off', () => {
    it('goes from the row when the update says so', async () => {
        const handlers = {};
        const socket = ref({ id: 'sock-1', emit: vi.fn(), on: (event, fn) => { handlers[event] = fn; }, off: vi.fn() });
        const row = { _id: 'm-1', userId: 'u1', type: 'text', message: `${NAMED} what is left?`, createdAt: '2026-10-02T09:00:00.000Z', ownAiAsk: { at: '2026-10-02T09:00:00.000Z' } };
        apiRequest.mockResolvedValueOnce({ data: { status: true, data: [row] } });
        const chat = useMainChatConversation({
            socket, companyId: ref('company-1'), userId: ref('u1'), target: () => ({ ...CHANNEL, folderId: '', isDefaultProject: false }),
            participants: () => ['u1', 'u2'], currentUser: () => ({ id: 'u1', Employee_Name: 'Asha Rao' }),
        });
        await chat.load();
        chat.attach();
        expect(chat.messages.value[0].ownAiAsk).toBeTruthy();
        handlers.commentUpdate({ fullDocument: { ...row, message: 'never mind', ownAiAsk: null } });
        expect(chat.messages.value[0]).toMatchObject({ message: 'never mind', ownAiAsk: null });
    });
});
