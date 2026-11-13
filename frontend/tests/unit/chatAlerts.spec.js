import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import { reactive, ref } from 'vue';

const mockRoute = reactive({ name: 'Home', fullPath: '/', params: {} });
const mockPush = vi.fn();
const mockDnd = ref(false);
const mockMe = reactive({ _id: 'me' });

vi.mock('vue-router', () => ({ useRoute: () => mockRoute, useRouter: () => ({ push: mockPush }) }));
vi.mock('@/composable', () => ({
    useCustomComposable: () => ({ checkPermission: () => true }),
    useGetterFunctions: () => ({ getUser: (id) => (id === 'me' ? mockMe : { Employee_Name: 'Asha Rao', Employee_profileImageURL: '' }) }),
}));
vi.mock('@/components/molecules/Home/homeState', () => ({ isDnd: () => mockDnd.value }));
vi.mock('@/config/firebaseInit', () => ({ firebaseConfigured: false }));
vi.mock('@/services', () => ({ apiRequest: vi.fn(async () => ({ data: { data: {} } })) }));

import ChatAlerts from '@/components/organisms/Shell/ChatAlerts.vue';
import { describeNotice, isLookingAt } from '@/components/organisms/Shell/chatAlerts';

const fakeSocket = () => {
    const handlers = {};
    return {
        on: (event, fn) => { (handlers[event] = handlers[event] || []).push(fn); },
        off: (event, fn) => { handlers[event] = (handlers[event] || []).filter((h) => h !== fn); },
        deliver: (event, payload) => (handlers[event] || []).forEach((fn) => fn(payload)),
        listeners: (event) => (handlers[event] || []).length,
    };
};

const DM = { commentId: 'c1', projectId: 'direct', sprintId: 'l1', conversationId: 'dm1', channel: false, channelName: '', senderId: 'asha', senderName: 'Asha Rao', preview: 'Lunch at one?', fileName: '', browser: true };

let socket;
let wrapper;
let shown;

const setVisibility = (state, focused = state === 'visible') => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
    vi.spyOn(document, 'hasFocus').mockReturnValue(focused);
};

const mountAlerts = async () => {
    const store = createStore({
        modules: {
            settings: { namespaced: true, getters: { rules: () => ({ ready: true }), getSocketInstance: () => socket } },
        },
    });
    wrapper = mount(ChatAlerts, {
        global: {
            plugins: [store],
            provide: { $companyId: ref('co'), $userId: ref('me') },
            stubs: { teleport: true, UserProfile: true, ShellIcon: true },
        },
    });
    await flushPromises();
};

const notice = async (payload) => {
    socket.deliver('chatMessageNotice', payload);
    await flushPromises();
};

const popUps = () => wrapper.findAll('.ah-chat-alert');

beforeEach(() => {
    socket = fakeSocket();
    shown = [];
    vi.stubGlobal('Notification', class {
        static permission = 'granted';
        constructor(title, options) { shown.push({ title, ...options }); }
        close() {}
    });
    Object.assign(mockRoute, { name: 'Home', fullPath: '/', params: {} });
    mockDnd.value = false;
    mockMe.isDnd = false;
    setVisibility('visible');
});

afterEach(() => {
    wrapper?.unmount();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('a chat message on another page', () => {
    it('pops up with who wrote it and what, and opens the conversation when clicked', async () => {
        await mountAlerts();
        await notice(DM);

        expect(popUps()).toHaveLength(1);
        expect(wrapper.find('.ah-chat-alert__title').text()).toBe('Asha Rao');
        expect(wrapper.find('.ah-chat-alert__body').text()).toBe('Lunch at one?');
        expect(shown).toEqual([]);

        await wrapper.find('.ah-chat-alert__open').trigger('click');
        expect(mockPush).toHaveBeenCalledWith({ name: 'chat_project_channel', params: { cid: 'co', pid: 'direct', sid: 'dm1' } });
        expect(popUps()).toHaveLength(0);
    });

    it('shows each message once, and at most three at a time', async () => {
        await mountAlerts();
        await notice(DM);
        await notice(DM);
        expect(popUps()).toHaveLength(1);

        for (const id of ['c2', 'c3', 'c4']) await notice({ ...DM, commentId: id });
        expect(popUps()).toHaveLength(3);
    });

    it('can be dismissed', async () => {
        await mountAlerts();
        await notice(DM);
        await wrapper.find('.ah-chat-alert__close').trigger('click');
        expect(popUps()).toHaveLength(0);
    });
});

describe('no alert', () => {
    it('for the conversation the person is reading', async () => {
        Object.assign(mockRoute, { name: 'chat_project_channel', fullPath: '/co/chat/direct/dm1', params: { cid: 'co', pid: 'direct', sid: 'dm1' } });
        await mountAlerts();
        await notice(DM);
        expect(popUps()).toHaveLength(0);
        expect(shown).toEqual([]);
    });

    it('in Do Not Disturb', async () => {
        mockDnd.value = true;
        await mountAlerts();
        await notice(DM);
        expect(popUps()).toHaveLength(0);
    });

    it('for the person\'s own message', async () => {
        await mountAlerts();
        await notice({ ...DM, senderId: 'me' });
        expect(popUps()).toHaveLength(0);
    });
});

describe('a tab in the background', () => {
    it('shows one browser notification, tagged by the message', async () => {
        setVisibility('hidden');
        await mountAlerts();
        await notice(DM);

        expect(popUps()).toHaveLength(0);
        expect(shown).toHaveLength(1);
        expect(shown[0]).toMatchObject({ title: 'Asha Rao', body: 'Lunch at one?', tag: 'chat-c1' });
    });

    it('also for the open conversation, since nobody is looking at it', async () => {
        Object.assign(mockRoute, { name: 'chat_project_channel', params: { cid: 'co', pid: 'direct', sid: 'dm1' } });
        setVisibility('hidden');
        await mountAlerts();
        await notice(DM);
        expect(shown).toHaveLength(1);
    });

    it('not when the person turned browser notices off, or never allowed them', async () => {
        setVisibility('hidden');
        await mountAlerts();
        await notice({ ...DM, browser: false });
        Notification.permission = 'default';
        await notice({ ...DM, commentId: 'c2' });
        expect(shown).toEqual([]);
    });
});

describe('the socket', () => {
    it('is listened to once, and let go on unmount', async () => {
        await mountAlerts();
        expect(socket.listeners('chatMessageNotice')).toBe(1);
        wrapper.unmount();
        wrapper = null;
        expect(socket.listeners('chatMessageNotice')).toBe(0);
    });
});

describe('the words of a notice', () => {
    const t = (key, values) => (values ? `${key}:${Object.values(values).join('|')}` : key);

    it('name the channel a post was made in', () => {
        expect(describeNotice({ ...DM, channel: true, channelName: 'design' }, { t }).title).toBe('Chat.alert_in_channel:Asha Rao|design');
    });

    it('name a file sent without text, and fall back for a message with neither', () => {
        expect(describeNotice({ ...DM, preview: '', fileName: 'plan.pdf' }, { t }).body).toBe('Chat.alert_sent_file:plan.pdf');
        expect(describeNotice({ ...DM, preview: '', senderName: '' }, { t }).body).toBe('Chat.alert_new_message');
        expect(describeNotice({ ...DM, senderName: '' }, { t, senderName: 'From the list' }).sender).toBe('From the list');
    });

    it('know the conversation on screen', () => {
        expect(isLookingAt({ name: 'chat_project_channel', params: { pid: 'direct', sid: 'dm1' } }, DM)).toBe(true);
        expect(isLookingAt({ name: 'chat_project_channel', params: { pid: 'direct', sid: 'dm2' } }, DM)).toBe(false);
        expect(isLookingAt({ name: 'Home', params: {} }, DM)).toBe(false);
    });
});
