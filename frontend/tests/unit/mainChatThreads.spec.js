import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, shallowMount } from '@vue/test-utils';
import { defineComponent, h, ref } from 'vue';

const { apiRequest, persistMessage, store, route, router, echo } = vi.hoisted(() => ({
    apiRequest: vi.fn(),
    persistMessage: vi.fn(),
    store: {
        getters: {
            'settings/fileExtentions': [],
            'settings/companyOwnerDetail': {},
            'users/myCounts': { data: {}, type: 'add' },
            'users/users': [{ _id: 'user-1' }],
            'projectData/projects': { data: [] },
        },
        commit: vi.fn(),
        dispatch: vi.fn(() => Promise.resolve({})),
    },
    route: { query: {} },
    router: { push: vi.fn(), replace: vi.fn(() => Promise.resolve()) },
    echo: (key, params) => (params ? `${key} ${JSON.stringify(params)}` : key),
}));

const PEOPLE = {
    'user-1': { _id: 'user-1', id: 'user-1', Employee_Name: 'Me' },
    'user-2': { _id: 'user-2', id: 'user-2', Employee_Name: 'Ben Ito' },
    'user-3': { _id: 'user-3', id: 'user-3', Employee_Name: 'Cara Diaz' },
};

vi.mock('@/services', () => ({ apiRequest, apiRequestWithoutCompnay: vi.fn() }));
vi.mock('vuex', async (importOriginal) => ({ ...(await importOriginal()), useStore: () => store }));
vi.mock('vue-router', async (importOriginal) => ({ ...(await importOriginal()), useRoute: () => route, useRouter: () => router }));
vi.mock('vue-i18n', async (importOriginal) => ({ ...(await importOriginal()), useI18n: () => ({ t: echo }) }));
vi.mock('sweetalert2', () => ({ default: { fire: vi.fn(() => Promise.resolve({ isConfirmed: true })) } }));
vi.mock('@/utils/TaskOperations', () => ({ default: { create: vi.fn(), updateLastMessageTime: vi.fn(() => Promise.resolve()) } }));
vi.mock('@/composable', () => ({
    useGetterFunctions: () => ({ getUser: (id) => PEOPLE[id] }),
    useCustomComposable: () => ({ changeText: (text) => text, debounce: (fn) => fn }),
    useConvertDate: () => ({ convertDateFormat: (value) => String(value) }),
}));
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
vi.mock('@/views/Ai/useRunnableAgents', () => ({ fetchChatAgents: vi.fn(() => Promise.resolve([])) }));

import { useMainChatConversation } from '@/components/organisms/MainChat/useMainChatConversation';
import MainChatMessage from '@/components/organisms/MainChat/MainChatMessage.vue';
import MainChatMessageList from '@/components/organisms/MainChat/MainChatMessageList.vue';
import MainChatPanel from '@/components/organisms/MainChat/MainChatPanel.vue';
import MainChatThread from '@/components/organisms/MainChat/MainChatThread.vue';
import MainChatThreadFooter from '@/components/organisms/MainChat/MainChatThreadFooter.vue';
import MainChatComposer from '@/components/organisms/MainChat/MainChatComposer.vue';
import MainChatSearch from '@/components/organisms/MainChat/MainChatSearch.vue';
import { useHelper } from '@/components/organisms/Header/helper';

const CHANNEL = { projectId: 'proj-1', sprintId: 'chan-1', taskId: 'default', folderId: '', isDefaultProject: false };
const ROOT = { _id: 'm-1', userId: 'user-2', type: 'text', message: 'Ship on Friday?', createdAt: '2026-10-01T09:00:00.000Z', projectId: 'proj-1', sprintId: 'chan-1', taskId: 'default' };
const REPLY = { _id: 'r-1', parentId: 'm-1', userId: 'user-3', type: 'text', message: 'Yes', createdAt: '2026-10-01T09:05:00.000Z' };

const liveSocket = () => {
    const handlers = {};
    return {
        handlers,
        socket: ref({ id: 'sock-1', emit: vi.fn(), on: (event, fn) => { handlers[event] = fn; }, off: vi.fn() }),
    };
};

const engine = (options = {}) => useMainChatConversation({
    socket: ref(null),
    companyId: ref('company-1'),
    userId: ref('user-1'),
    target: () => CHANNEL,
    participants: () => ['user-1', 'user-2', 'user-3'],
    currentUser: () => ({ id: 'user-1', Employee_Name: 'Me' }),
    ...options,
});

beforeEach(() => {
    apiRequest.mockReset();
    apiRequest.mockResolvedValue({ data: { status: true, data: [] } });
    persistMessage.mockReset();
    persistMessage.mockImplementation(async ({ messageData }) => ({ ...messageData, _id: 'saved-1' }));
    router.push.mockReset();
    router.replace.mockClear();
    route.query = {};
});

describe('the channel transcript and thread replies', () => {
    const openChannel = async () => {
        const { socket, handlers } = liveSocket();
        const observe = vi.fn();
        const chat = engine({ socket, observe });
        apiRequest.mockResolvedValueOnce({ data: { status: true, data: [{ ...ROOT, replyCount: 1 }] } });
        await chat.load();
        chat.attach();
        return { chat, handlers, observe };
    };

    it('keeps a new thread reply out of the channel and hands it to the open thread', async () => {
        const { chat, handlers, observe } = await openChannel();

        handlers.commentInsert({ fullDocument: REPLY });

        expect(chat.messages.value.map((m) => m._id)).toEqual(['m-1']);
        expect(observe).toHaveBeenCalledWith(REPLY);
    });

    it('takes the new reply count, repliers and time from the server\'s update of the message', async () => {
        const { chat, handlers } = await openChannel();

        handlers.commentUpdate({ fullDocument: { ...ROOT, replyCount: 2, replierIds: ['user-3', 'user-1'], lastReplyAt: '2026-10-01T09:06:00.000Z' } });

        expect(chat.messages.value).toHaveLength(1);
        expect(chat.messages.value[0]).toMatchObject({ replyCount: 2, replierIds: ['user-3', 'user-1'], lastReplyAt: '2026-10-01T09:06:00.000Z' });
    });

    it('does not add a message it never loaded when that message is only updated', async () => {
        const { chat, handlers } = await openChannel();

        handlers.commentUpdate({ fullDocument: { _id: 'old-1', userId: 'user-2', type: 'text', message: 'From last year', replyCount: 4, createdAt: '2025-01-01T09:00:00.000Z' } });

        expect(chat.messages.value.map((m) => m._id)).toEqual(['m-1']);
    });
});

describe('a thread', () => {
    const openThread = async (replies = [REPLY]) => {
        const thread = engine({ thread: () => ROOT });
        apiRequest.mockResolvedValueOnce({ data: { status: true, data: replies, root: ROOT } });
        await thread.load();
        return thread;
    };

    it('loads the root message and its replies', async () => {
        const thread = await openThread();

        expect(apiRequest).toHaveBeenCalledWith('get', '/api/v1/comments/replies?parentId=m-1');
        expect(thread.messages.value.map((m) => m._id)).toEqual(['m-1', 'r-1']);
        expect(thread.hasMore.value).toBe(false);
    });

    it('sends a reply under the root message, into the same conversation, without pushing it to the whole channel', async () => {
        const thread = await openThread();
        apiRequest.mockClear();

        await thread.sendText('Agreed');

        expect(persistMessage).toHaveBeenCalledTimes(1);
        expect(persistMessage.mock.calls[0][0].messageData).toMatchObject({
            parentId: 'm-1', message: 'Agreed', taskId: 'default', project: false, objId: { projectId: 'proj-1', sprintId: 'chan-1' },
        });
        expect(thread.messages.value.map((m) => m._id)).toEqual(['m-1', 'r-1', 'saved-1']);
        expect(apiRequest).not.toHaveBeenCalled();
    });

    it('takes live replies and changes for this thread only', async () => {
        const thread = await openThread();

        thread.receive({ _id: 'r-2', parentId: 'm-1', userId: 'user-2', type: 'text', message: 'Done' });
        thread.receive({ _id: 'r-9', parentId: 'm-other', userId: 'user-2', type: 'text', message: 'Elsewhere' });
        thread.receive({ _id: 'm-2', userId: 'user-2', type: 'text', message: 'A channel message' });
        thread.receive({ ...REPLY, message: 'Yes!' });
        thread.receive({ ...ROOT, isDeleted: true, message: '' });

        expect(thread.messages.value.map((m) => [m._id, m.message])).toEqual([['m-1', ''], ['r-1', 'Yes!'], ['r-2', 'Done']]);
        expect(thread.messages.value[0].isDeleted).toBe(true);
    });

    it('settles its own reply once, whether the socket or the response comes first', async () => {
        const thread = await openThread([]);
        persistMessage.mockImplementation(async ({ messageData }) => {
            thread.receive({ ...messageData, _id: 'saved-1' });
            return { ...messageData, _id: 'saved-1' };
        });

        await thread.sendText('Agreed');

        expect(thread.messages.value.map((m) => m._id)).toEqual(['m-1', 'saved-1']);
    });
});

describe('a chat message', () => {
    const mountMessage = (message, props = {}) => mount(MainChatMessage, {
        props: { message, senderName: 'Ben Ito', ...props },
        global: { mocks: { $t: echo }, stubs: { DropDown: true, DropDownOption: true, ReactionBar: true, RouterLink: true, WasabiImageComp: true } },
    });

    it('offers Reply in thread', async () => {
        const wrapper = mountMessage(ROOT);

        await wrapper.find('[data-test="reply-in-thread"]').trigger('click');

        expect(wrapper.emitted('thread')[0][0]).toMatchObject({ _id: 'm-1' });
        expect(wrapper.findComponent(MainChatThreadFooter).exists()).toBe(false);
    });

    it('with replies shows how many, who replied last and when, and opens the thread', async () => {
        const wrapper = mountMessage({ ...ROOT, replyCount: 2, replierIds: ['user-3', 'ai'], lastReplyAt: '2026-10-01T09:06:00.000Z' });

        const footer = wrapper.find('[data-test="thread-footer"]');
        expect(footer.text()).toContain('MainChat.thread_replies {"count":2}');
        expect(footer.text()).toContain('MainChat.thread_last_reply');
        expect(footer.findAll('.mc-av')).toHaveLength(2);
        expect(footer.find('.mc-av').attributes('title')).toBe('Cara Diaz');
        expect(footer.find('.mc-av--agent').exists()).toBe(true);

        await footer.trigger('click');
        expect(wrapper.emitted('thread')[0][0]).toMatchObject({ _id: 'm-1' });
    });

    it('that was deleted still leads to its replies', () => {
        const wrapper = mountMessage({ _id: 'm-1', userId: 'user-2', type: 'text', message: '', isDeleted: true, replyCount: 1, replierIds: ['user-3'], createdAt: ROOT.createdAt });

        expect(wrapper.text()).toContain('MainChat.deleted');
        expect(wrapper.find('[data-test="thread-footer"]').exists()).toBe(true);
        expect(wrapper.find('[data-test="reply-in-thread"]').exists()).toBe(false);
    });

    it('inside a thread offers no further thread', () => {
        const wrapper = mountMessage({ ...ROOT, replyCount: 2, replierIds: ['user-3'] }, { inThread: true });

        expect(wrapper.find('[data-test="reply-in-thread"]').exists()).toBe(false);
        expect(wrapper.find('[data-test="thread-footer"]').exists()).toBe(false);
        expect(wrapper.attributes('id')).toBe('thread_m-1');
    });
});

describe('the thread panel', () => {
    const mountThread = async (props = {}) => {
        apiRequest.mockResolvedValueOnce({ data: { status: true, data: [REPLY], root: ROOT } });
        const wrapper = shallowMount(MainChatThread, {
            props: { root: ROOT, target: CHANNEL, where: '#general', userIds: ['user-1', 'user-2'], agents: [{ _id: 'a1', name: 'Helper' }], conversationKey: 'proj-1:chan-1:default', ...props },
            global: { mocks: { $t: echo } },
        });
        await flushPromises();
        return wrapper;
    };

    it('shows the root message, its replies and a composer that mentions the same people and agents', async () => {
        const wrapper = await mountThread();

        const list = wrapper.findComponent(MainChatMessageList);
        expect(list.props('messages').map((m) => m._id)).toEqual(['m-1', 'r-1']);
        expect(list.props('inThread')).toBe(true);
        const composer = wrapper.findComponent(MainChatComposer);
        expect(composer.props()).toMatchObject({ userIds: ['user-1', 'user-2'], agents: [{ _id: 'a1', name: 'Helper' }], conversationKey: 'proj-1:chan-1:default:thread:m-1', disabled: false });
        expect(wrapper.text()).toContain('#general');
    });

    it('sends what the composer sends as a reply in the thread', async () => {
        const wrapper = await mountThread();

        wrapper.findComponent(MainChatComposer).vm.$emit('send', '@[AI](ai_ask) when do we ship?');
        await flushPromises();

        expect(persistMessage.mock.calls[0][0].messageData).toMatchObject({ parentId: 'm-1', message: '@[AI](ai_ask) when do we ship?' });
    });

    it('closes from its header', async () => {
        const wrapper = await mountThread();

        await wrapper.find('[data-test="thread-close"]').trigger('click');

        expect(wrapper.emitted('close')).toHaveLength(1);
    });

    it('is read-only where the conversation is', async () => {
        const wrapper = await mountThread({ disabled: true, disabledReason: 'Read-only' });

        expect(wrapper.findComponent(MainChatComposer).props()).toMatchObject({ disabled: true, disabledReason: 'Read-only' });
    });

    it('says so when the thread cannot be opened', async () => {
        apiRequest.mockReset();
        apiRequest.mockRejectedValueOnce(new Error('404'));
        const wrapper = shallowMount(MainChatThread, {
            props: { root: { _id: 'gone' }, target: CHANNEL },
            global: { mocks: { $t: echo } },
        });
        await flushPromises();

        expect(wrapper.find('[role="alert"]').text()).toBe('MainChat.thread_failed');
        expect(wrapper.findComponent(MainChatComposer).exists()).toBe(false);
    });
});

describe('the chat panel', () => {
    const mountPanel = async () => {
        apiRequest.mockResolvedValue({ data: { status: true, data: [{ ...ROOT, replyCount: 1 }] } });
        const wrapper = shallowMount(MainChatPanel, {
            props: { taskId: 'default', sprintId: 'chan-1', title: 'general', isChannel: true, watchers: ['user-1', 'user-2'] },
            global: { mocks: { $t: echo }, provide: { selectedProject: ref({ _id: 'proj-1' }), $socket: ref(null) } },
        });
        await flushPromises();
        return wrapper;
    };

    it('opens a thread beside the conversation and closes it again', async () => {
        const wrapper = await mountPanel();
        expect(wrapper.findComponent(MainChatThread).exists()).toBe(false);

        wrapper.findComponent(MainChatMessageList).vm.$emit('thread', { _id: 'm-1' });
        await flushPromises();

        const thread = wrapper.findComponent(MainChatThread);
        expect(thread.props('root')).toMatchObject({ _id: 'm-1', message: 'Ship on Friday?' });
        expect(thread.props('target')).toMatchObject({ projectId: 'proj-1', sprintId: 'chan-1', taskId: 'default' });
        expect(thread.props('where')).toBe('#general');

        thread.vm.$emit('close');
        await flushPromises();
        expect(wrapper.findComponent(MainChatThread).exists()).toBe(false);
    });

    it('opens the thread of a reply found by search, at that reply', async () => {
        const wrapper = await mountPanel();
        wrapper.findComponent({ name: 'MainChatHeader' }).vm.$emit('search');
        await flushPromises();

        wrapper.findComponent(MainChatSearch).vm.$emit('open', { ...REPLY });
        await flushPromises();

        const thread = wrapper.findComponent(MainChatThread);
        expect(thread.props('root')).toMatchObject({ _id: 'm-1' });
        expect(thread.props('focusId')).toBe('r-1');
        expect(wrapper.findComponent(MainChatSearch).exists()).toBe(false);
    });

    it('opens the thread a notice links to', async () => {
        route.query = { thread: 'm-7' };
        const wrapper = await mountPanel();

        expect(wrapper.findComponent(MainChatThread).props('root')).toEqual({ _id: 'm-7' });
    });
});

describe('opening a notice about a chat thread', () => {
    const open = (data, key) => {
        mount(defineComponent({
            setup() {
                useHelper().openRoute(data, key, { gettersVal: store.getters });
                return () => h('div');
            },
        }));
    };

    it('goes to the conversation with the thread open, for a reply notice', () => {
        open({ type: 'tasks', key: 'comment_reply', projectId: 'proj-1', sprintId: 'chan-1', taskId: 'chan-1', changeType: 'chat_thread_reply', changeData: { threadId: 'm-1', commentId: 'r-1' } }, 'notifications');

        expect(router.push).toHaveBeenCalledWith({ name: 'chat_project_channel', params: { cid: 'company-1', pid: 'proj-1', sid: 'chan-1' }, query: { thread: 'm-1' } });
    });

    it('goes to the thread for a mention made in a reply', () => {
        open({ mainChat: true, projectId: 'proj-1', sprintId: 'chan-1', taskId: 'default', comment_id: 'r-1', threadId: 'm-1' }, 'mentions');

        expect(router.push).toHaveBeenCalledWith(expect.objectContaining({ name: 'chat_project_channel', query: { thread: 'm-1' } }));
    });
});
