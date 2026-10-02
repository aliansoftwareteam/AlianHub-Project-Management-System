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
    agentSources: { fetchChatAgents: vi.fn(), fetchOwnAiInChat: vi.fn() },
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
    agentSources.fetchOwnAiInChat.mockReset().mockResolvedValue([OWN_AI]);
    persistMessage.mockReset();
    Object.assign(aiAvailability, { state: AI_STATE.UNKNOWN, loaded: false, planAllowsAi: null });
});

describe('where the chat learns of the person\'s own AI', () => {
    const source = async () => (await vi.importActual('@/views/Ai/useRunnableAgents')).fetchOwnAiInChat;

    it('asks the server whether it may be asked in this conversation, and shapes it for the "@" menu', async () => {
        apiRequest.mockResolvedValue({ data: { status: true, data: [ENTRY] } });
        await expect((await source())(CHANNEL)).resolves.toEqual([OWN_AI]);
        expect(apiRequest).toHaveBeenCalledWith('get', '/api/v2/agents/connected?projectId=proj-1&sprintId=chan-1&taskId=default');
    });

    it('offers none before the conversation exists, when the server refuses, or when the request fails', async () => {
        const fetchOwnAiInChat = await source();
        await expect(fetchOwnAiInChat({ projectId: 'proj-1', sprintId: 'chan-1', taskId: '' })).resolves.toEqual([]);
        await expect(fetchOwnAiInChat()).resolves.toEqual([]);
        expect(apiRequest).not.toHaveBeenCalled();
        apiRequest.mockResolvedValueOnce({ data: { status: false, statusText: 'no' } });
        await expect(fetchOwnAiInChat(CHANNEL)).resolves.toEqual([]);
        apiRequest.mockImplementationOnce(() => { throw new Error('network down'); });
        await expect(fetchOwnAiInChat(CHANNEL)).resolves.toEqual([]);
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

    it('with no model on the server, offers the connected AI alone and asks for no in-product agent', async () => {
        aiAvailability.state = AI_STATE.UNCONFIGURED;
        const wrapper = await mountPanel();
        expect(agentSources.fetchChatAgents).not.toHaveBeenCalled();
        expect(agentSources.fetchOwnAiInChat).toHaveBeenCalledWith(CHANNEL);
        expect(offered(wrapper)).toEqual([OWN_AI]);
    });

    it('with a model, offers the in-product agents and the person\'s own AI', async () => {
        Object.assign(aiAvailability, { state: AI_STATE.ON, loaded: true, planAllowsAi: true });
        const wrapper = await mountPanel();
        expect(agentSources.fetchChatAgents).toHaveBeenCalledWith(CHANNEL);
        expect(offered(wrapper)).toEqual([HELPER, OWN_AI]);
    });

    it('offers nothing where the person has no AI of their own, and nothing in a conversation with an in-product agent', async () => {
        agentSources.fetchOwnAiInChat.mockResolvedValue([]);
        aiAvailability.state = AI_STATE.UNCONFIGURED;
        expect(offered(await mountPanel())).toEqual([]);
        agentSources.fetchOwnAiInChat.mockClear();
        expect(offered(await mountPanel({ agentId: 'a1' }))).toEqual([]);
        expect(agentSources.fetchOwnAiInChat).not.toHaveBeenCalled();
    });
});

describe('the own AI in the mention list', () => {
    const Composer = defineComponent({
        props: { agents: Array },
        setup(props) {
            const text = ref('');
            return () => h('div', [h(CommentInput, { modelValue: text.value, 'onUpdate:modelValue': (v) => { text.value = v; }, userIds: ['u1', 'u2'], agents: props.agents, reply: {} }), h('output', text.value)]);
        },
    });
    const provide = { $defaultUserAvatar: ref(''), $clientWidth: ref(1280) };
    const open = async (agents) => {
        const wrapper = mount(Composer, { props: { agents }, attachTo: document.body, global: { provide, mocks: { $t: echo } } });
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
    const mountMessage = (message) => mount(MainChatMessage, {
        props: { message: { _id: 'm1', type: 'text', userId: 'u1', message: `${NAMED} what is left?`, createdAt: new Date().toISOString(), ...message } },
        global: {
            provide: { $companyId: ref('co1') },
            stubs: { RouterLink: RouterLinkStub, DropDown: true, DropDownOption: true, ReactionBar: true, MainChatAvatar: true, MainChatMessageBody: true },
            mocks: { $t: echo },
        },
    });
    const mark = (wrapper) => wrapper.find('[data-test="own-ai-asked"]');
    const ASKED = { ownerId: 'u1', name: 'Claude, for Asha Rao', at: '2026-10-02T09:00:00.000Z' };

    it('says who was asked, for whom, and when that AI gets the question', () => {
        const wrapper = mountMessage({ ownAiAsk: ASKED });
        expect(mark(wrapper).text()).toBe('AgentChat.asked_own_ai {"name":"Claude, for Asha Rao"}');
        expect(mark(wrapper).attributes('title')).toBe('AgentChat.asked_own_ai_hint');
    });

    it('is on no other message, and goes with a deleted one and with one edited to name the AI no more', () => {
        expect(mark(mountMessage({})).exists()).toBe(false);
        expect(mark(mountMessage({ ownAiAsk: { ownerId: 'u1' } })).exists()).toBe(false);
        expect(mark(mountMessage({ isDeleted: true, ownAiAsk: ASKED })).exists()).toBe(false);
        expect(mark(mountMessage({ message: 'never mind', ownAiAsk: ASKED })).exists()).toBe(false);
    });

    it('has its words in the locale file', () => {
        expect(en.AgentChat.asked_own_ai).toContain('{name}');
        expect(en.AgentChat.asked_own_ai_hint).toBeTruthy();
    });
});

describe('the mark as the sender meets it', () => {
    const MARK = { ownerId: 'u1', name: 'Claude, for Asha Rao', at: '2026-10-02T09:00:00.000Z' };
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
