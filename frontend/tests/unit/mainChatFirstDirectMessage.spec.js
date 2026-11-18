import { describe, expect, it, vi } from 'vitest';
import { flushPromises, shallowMount } from '@vue/test-utils';
import { ref } from 'vue';

const { store, conversation, created } = vi.hoisted(() => ({
    store: {
        getters: { 'settings/fileExtentions': [], 'settings/companyOwnerDetail': {}, 'users/myCounts': { data: {}, type: 'add' } },
        commit: vi.fn(),
        dispatch: vi.fn(() => Promise.resolve({})),
    },
    conversation: {},
    created: vi.fn(() => Promise.resolve({ id: 'task-new' })),
}));

vi.mock('@/services', () => ({ apiRequest: vi.fn(() => Promise.resolve({ data: {} })), apiRequestWithoutCompnay: vi.fn() }));
vi.mock('vuex', async (importOriginal) => ({ ...(await importOriginal()), useStore: () => store }));
vi.mock('sweetalert2', () => ({ default: { fire: vi.fn(() => Promise.resolve({})) } }));
vi.mock('@/utils/TaskOperations', () => ({ default: { create: created } }));
vi.mock('@/composable', () => ({ useGetterFunctions: () => ({ getUser: () => ({ id: 'user-1', Employee_Name: 'Alice' }) }) }));
vi.mock('@/composable/commonFunction', () => ({
    taskPlanPermission: () => ({ checkTaskPerSprintPermisssion: vi.fn(() => Promise.resolve(true)) }),
    storageHelper: () => ({ handleStorageImageRequest: vi.fn() }),
}));
vi.mock('@/composable/useCall', () => ({
    useCall: () => ({ startCall: vi.fn(), isBusy: ref(false), isSupported: () => false, isSecure: () => false }),
}));
vi.mock('@/composables/useClipRecorder', () => ({ useClipRecorder: () => ({ openRecorder: vi.fn() }) }));
vi.mock('@/components/organisms/MainChat/useMainChatConversation', () => ({
    useMainChatConversation: (options) => {
        conversation.target = options.target;
        return conversation;
    },
}));

import MainChatPanel from '@/components/organisms/MainChat/MainChatPanel.vue';
import MainChatComposer from '@/components/organisms/MainChat/MainChatComposer.vue';

const DIRECT_SPACE = {
    _id: 'space-1',
    default: true,
    sprintsObj: { s1: { id: 'sprint-1', name: 'Direct' } },
    taskStatusData: [{ key: 1, name: 'To Do', value: 'to_do', type: 'default_active' }],
    taskTypeCounts: [{ key: 0, value: 'task', name: 'Task' }],
};

describe('the first message of a new direct conversation', () => {
    it('is sent into the conversation the send created', async () => {
        const sentTo = [];
        Object.assign(conversation, {
            messages: ref([]), loading: ref(false), loadingOlder: ref(false), hasMore: ref(false), typingUsers: ref({}),
            load: vi.fn(() => Promise.resolve()), loadOlder: vi.fn(), catchUp: vi.fn(), setTyping: vi.fn(), attach: vi.fn(), detach: vi.fn(),
            sendText: vi.fn(() => { sentTo.push(conversation.target().taskId); return Promise.resolve(); }),
            sendFiles: vi.fn(), sendMedia: vi.fn(), retry: vi.fn(), removeMessage: vi.fn(), markRead: vi.fn(() => false),
            toggleReaction: vi.fn(), togglePin: vi.fn(), markUnreadFrom: vi.fn(), editText: vi.fn(),
        });
        const wrapper = shallowMount(MainChatPanel, {
            props: { taskId: 'user-2', newChat: true, sprintId: 'sprint-1', title: 'Bob', isChannel: false, watchers: [] },
            global: { provide: { selectedProject: ref(DIRECT_SPACE), $userId: ref('user-1'), $companyId: ref('company-1'), $socket: ref(null) } },
        });

        wrapper.findComponent(MainChatComposer).vm.$emit('send', 'Hello Bob');
        await flushPromises();

        expect(created).toHaveBeenCalledTimes(1);
        expect(sentTo).toEqual(['task-new']);
        expect(wrapper.emitted('created')).toEqual([['task-new']]);
    });
});
