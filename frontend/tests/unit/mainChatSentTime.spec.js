import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { ref } from 'vue';

const sent = vi.hoisted(() => ({ beforeAnswer: null }));
const blank = vi.hoisted(() => (name) => ({ default: { name, render: () => null } }));

vi.mock('@/services', () => ({ apiRequest: vi.fn(() => Promise.resolve({ data: {} })), apiRequestWithoutCompnay: vi.fn() }));
vi.mock('@/utils/TaskOperations', () => ({ default: {} }));
/* The comments API answers a send with the new id alone: the stored time arrives later, with the document. */
vi.mock('@/views/Projects/Comments/helper', () => ({
    bakeMessage: vi.fn(async ({ messageData }) => ({ ...messageData })),
    sendMessage: vi.fn(async ({ messageData }) => {
        if (sent.beforeAnswer) sent.beforeAnswer({ ...messageData, _id: 'm1' });
        return { ...messageData, _id: 'm1', id: 'm1' };
    }),
    uploadToWasabi: vi.fn(),
    deleteFromWasabi: vi.fn(),
    checkFile: vi.fn(),
    renderFiles: vi.fn(),
}));
vi.mock('@/composable', () => ({
    useGetterFunctions: () => ({ getUser: (id) => ({ _id: id, Employee_Name: 'Me' }) }),
    useCustomComposable: () => ({ changeText: (text) => text, debounce: (fn) => fn }),
    useConvertDate: () => ({ convertDateFormat: (value) => String(value) }),
}));
vi.mock('@/utils/storageQueryBuild.js', () => ({ generateFileName: vi.fn() }));
vi.mock('@/components/molecules/DropDown/DropDown.vue', () => blank('DropDown'));
vi.mock('@/components/molecules/DropDownOption/DropDownOption.vue', () => blank('DropDownOption'));
vi.mock('@/components/atom/ReactionBar/ReactionBar.vue', () => blank('ReactionBar'));
vi.mock('@/components/organisms/MainChat/MainChatAvatar.vue', () => blank('MainChatAvatar'));
vi.mock('@/components/organisms/MainChat/MainChatIcon.vue', () => blank('MainChatIcon'));
vi.mock('@/components/organisms/MainChat/MainChatMessageBody.vue', () => blank('MainChatMessageBody'));
vi.mock('@/components/organisms/MainChat/MainChatThreadFooter.vue', () => blank('MainChatThreadFooter'));

import { useMainChatConversation } from '@/components/organisms/MainChat/useMainChatConversation';
import MainChatMessage from '@/components/organisms/MainChat/MainChatMessage.vue';
import { followClockPrefs } from '@/utils/clockText';

const STORED_AT = '2026-10-01T09:30:00.000Z';

const thread = () => useMainChatConversation({
    socket: ref({ id: 'sock', emit: vi.fn(), on: vi.fn(), off: vi.fn() }),
    companyId: ref('c1'),
    userId: ref('u1'),
    target: () => ({ projectId: 'p1', sprintId: 's1', taskId: 'default' }),
    thread: () => ({ _id: 'root' }),
});

const timeOf = (message) => {
    const wrapper = mount(MainChatMessage, {
        props: { message },
        global: { mocks: { $t: (key) => key } },
    });
    const el = wrapper.find('.mc-msg-time');
    const text = el.exists() ? el.text() : '';
    wrapper.unmount();
    return text;
};

describe('the time on a message that was just sent', () => {
    beforeEach(() => { sent.beforeAnswer = null; });

    it('stays the time it was sent at once the server has answered with the id alone', async () => {
        const chat = thread();
        await chat.sendText('Hello');

        expect(chat.messages.value).toHaveLength(1);
        const [row] = chat.messages.value;
        expect(row).toMatchObject({ _id: 'm1', isSending: false, failed: false });
        expect(Number.isNaN(new Date(row.createdAt).getTime())).toBe(false);
    });

    it('is the stored time when the stored document arrived first', async () => {
        const chat = thread();
        sent.beforeAnswer = (doc) => chat.receive({ ...doc, userId: 'u1', parentId: 'root', createdAt: STORED_AT });
        await chat.sendText('Hello');

        expect(chat.messages.value).toHaveLength(1);
        expect(chat.messages.value[0].createdAt).toBe(STORED_AT);
    });

    it('shows as a time beside the name, and a message with no time shows no stray dot', () => {
        followClockPrefs({ timeFormat: '24' });
        expect(timeOf({ _id: 'm1', userId: 'u1', type: 'text', message: 'Hello', createdAt: '2026-10-01T09:30:00' })).toBe('· 09:30');
        expect(timeOf({ _id: 'm2', userId: 'u1', type: 'text', message: 'Hello' })).toBe('');
    });

    it('is written the way the person chose in My Settings', () => {
        const message = { _id: 'm1', userId: 'u1', type: 'text', message: 'Hello', createdAt: '2026-10-01T14:05:00' };
        followClockPrefs({ timeFormat: '12' });
        expect(timeOf(message)).toBe('· 2:05 PM');
        followClockPrefs({ timeFormat: '24' });
        expect(timeOf(message)).toBe('· 14:05');
    });
});
