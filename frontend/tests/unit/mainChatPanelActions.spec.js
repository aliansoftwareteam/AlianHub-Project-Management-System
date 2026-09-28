import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, shallowMount } from '@vue/test-utils';
import { ref } from 'vue';
import fs from 'fs';
import path from 'path';
import { parse as parseSfc } from '@vue/compiler-sfc';
import { NodeTypes } from '@vue/compiler-core';

const { apiRequest, store, conversation, openRecorder } = vi.hoisted(() => ({
    apiRequest: vi.fn(),
    store: {
        getters: {
            'settings/fileExtentions': [],
            'settings/companyOwnerDetail': {},
            'users/myCounts': { data: {}, type: 'add' },
        },
        commit: vi.fn(),
        dispatch: vi.fn(() => Promise.resolve({})),
    },
    conversation: {},
    openRecorder: vi.fn(),
}));

vi.mock('@/services', () => ({ apiRequest, apiRequestWithoutCompnay: vi.fn() }));
vi.mock('vuex', async (importOriginal) => ({ ...(await importOriginal()), useStore: () => store }));
vi.mock('sweetalert2', () => ({ default: { fire: vi.fn(() => Promise.resolve({})) } }));
vi.mock('@/utils/TaskOperations', () => ({ default: { create: vi.fn() } }));
vi.mock('@/composable', () => ({ useGetterFunctions: () => ({ getUser: () => ({ Employee_Name: 'Alice' }) }) }));
vi.mock('@/composable/commonFunction', () => ({
    taskPlanPermission: () => ({ checkTaskPerSprintPermisssion: vi.fn(() => Promise.resolve(true)) }),
    storageHelper: () => ({ handleStorageImageRequest: vi.fn() }),
}));
vi.mock('@/composable/useCall', () => ({
    useCall: () => ({ startCall: vi.fn(), isBusy: ref(false), isSupported: () => false, isSecure: () => false }),
}));
vi.mock('@/composables/useClipRecorder', () => ({ useClipRecorder: () => ({ openRecorder }) }));
vi.mock('@/components/organisms/MainChat/useMainChatConversation', () => ({ useMainChatConversation: () => conversation }));

import MainChatPanel from '@/components/organisms/MainChat/MainChatPanel.vue';
import MainChatHeader from '@/components/organisms/MainChat/MainChatHeader.vue';
import MainChatComposer from '@/components/organisms/MainChat/MainChatComposer.vue';
import MainChatMessageList from '@/components/organisms/MainChat/MainChatMessageList.vue';
import MakeTaskSheet from '@/components/organisms/MainChat/MakeTaskSheet.vue';
import CommentInput from '@/components/atom/CommentInput/CommentInput.vue';
import { shellState } from '@/components/organisms/Shell/shellState';
import { aiAvailability, AI_STATE } from '@/composable/aiAvailability';

const CHAT_DIR = path.resolve(__dirname, '../../src/components/organisms/MainChat');
const read = (file) => fs.readFileSync(path.join(CHAT_DIR, file), 'utf8');

const declaredEmits = (file) => {
    const match = read(file).match(/defineEmits\(\[([^\]]*)\]\)/);
    return match ? [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]) : [];
};

const boundEvents = (tag) => {
    const { descriptor } = parseSfc(read('MainChatPanel.vue'));
    const found = [];
    const walk = (node) => {
        if (node.type === NodeTypes.ELEMENT && node.tag === tag) {
            found.push(...node.props
                .filter((prop) => prop.type === NodeTypes.DIRECTIVE && prop.name === 'on' && prop.arg)
                .map((prop) => prop.arg.content));
        }
        (node.children || []).forEach(walk);
    };
    walk(descriptor.template.ast);
    return found;
};

/* Reports what happened rather than asking for anything; the panel has nothing to do with it. */
const INFORMATIONAL = { MainChatMessageList: ['transcribed'] };

describe('MainChatPanel listens to every event its children raise', () => {
    it.each([
        'MainChatHeader',
        'MainChatComposer',
        'MainChatMessageList',
        'MainChatInfo',
        'MainChatSearch',
        'MainChatSummary',
        'MakeTaskSheet',
    ])('%s', (child) => {
        const bound = boundEvents(child);
        const unbound = declaredEmits(`${child}.vue`)
            .filter((event) => !(INFORMATIONAL[child] || []).includes(event))
            .filter((event) => !bound.includes(event));
        expect(unbound).toEqual([]);
    });
});

describe('MainChatPanel AI and task actions', () => {
    let wrapper;

    const mountPanel = () => shallowMount(MainChatPanel, {
        props: { taskId: 'default', sprintId: 'sprint-1', title: 'general', isChannel: true, watchers: ['user-1'] },
        global: {
            provide: {
                selectedProject: ref({ _id: 'proj-1' }),
                $userId: ref('user-1'),
                $companyId: ref('company-1'),
                $socket: ref(null),
            },
        },
    });

    beforeEach(() => {
        Object.assign(conversation, {
            messages: ref([{ _id: 'm-1', userId: 'user-1', type: 'text', message: 'hello' }]),
            loading: ref(false),
            loadingOlder: ref(false),
            hasMore: ref(false),
            typingUsers: ref({}),
            load: vi.fn(() => Promise.resolve()),
            loadOlder: vi.fn(),
            catchUp: vi.fn(),
            setTyping: vi.fn(),
            attach: vi.fn(),
            detach: vi.fn(),
            sendText: vi.fn(() => Promise.resolve()),
            sendFiles: vi.fn(() => Promise.resolve()),
            sendMedia: vi.fn(() => Promise.resolve()),
            retry: vi.fn(),
            removeMessage: vi.fn(),
            markRead: vi.fn(() => false),
            toggleReaction: vi.fn(),
            togglePin: vi.fn(() => Promise.resolve(true)),
            markUnreadFrom: vi.fn(),
            editText: vi.fn(),
        });
        apiRequest.mockReset();
        apiRequest.mockResolvedValue({
            data: {
                status: true,
                data: { summary: 'Alice will ship on Friday.', actionItems: [{ id: 'ai_1', title: 'Ship the release', owner: 'Alice', due: 'Fri' }], messageCount: 1 },
            },
        });
        openRecorder.mockReset();
        shellState.talkToText = false;
        aiAvailability.state = AI_STATE.ON;
        wrapper = mountPanel();
    });

    const summaryCalls = () => apiRequest.mock.calls.filter(([, url]) => url === '/api/v1/ai/chat-summary');

    it('Summarize in the header summarises the open conversation and shows it', async () => {
        wrapper.findComponent(MainChatHeader).vm.$emit('summarize');
        await flushPromises();

        expect(summaryCalls()).toEqual([['post', '/api/v1/ai/chat-summary', { projectId: 'proj-1', sprintId: 'sprint-1', taskId: 'default' }]]);
        expect(wrapper.html()).toContain('Alice will ship on Friday.');
        expect(wrapper.findComponent(MainChatHeader).props('summarizing')).toBe(false);
    });

    it('the header shows the summarizing state while the summary runs', async () => {
        let finish;
        apiRequest.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
        wrapper.findComponent(MainChatHeader).vm.$emit('summarize');
        await flushPromises();
        expect(wrapper.findComponent(MainChatHeader).props('summarizing')).toBe(true);

        finish({ data: { status: true, data: { summary: 'Done.', actionItems: [], messageCount: 1 } } });
        await flushPromises();
        expect(wrapper.findComponent(MainChatHeader).props('summarizing')).toBe(false);
    });

    it('the /summarize command does what the header button does', async () => {
        wrapper.findComponent(MainChatComposer).vm.$emit('command', { name: 'summarize', text: '' });
        await flushPromises();
        expect(summaryCalls()).toHaveLength(1);
    });

    it('nothing is summarised while AI is off', async () => {
        aiAvailability.state = AI_STATE.OFF_WORKSPACE;
        wrapper.findComponent(MainChatComposer).vm.$emit('command', { name: 'summarize', text: '' });
        await flushPromises();
        expect(summaryCalls()).toHaveLength(0);
    });

    it('the /task command opens the make-task sheet with the text', async () => {
        expect(wrapper.findComponent(MakeTaskSheet).exists()).toBe(false);
        wrapper.findComponent(MainChatComposer).vm.$emit('command', { name: 'task', text: 'Ship the release' });
        await flushPromises();

        const sheet = wrapper.findComponent(MakeTaskSheet);
        expect(sheet.exists()).toBe(true);
        expect(sheet.props('initialTitle')).toBe('Ship the release');
        expect(sheet.props('sourceText')).toBe('Ship the release');
    });

    it('Make a task on a message opens the sheet with that message', async () => {
        wrapper.findComponent(MainChatMessageList).vm.$emit('make-task', { message: { _id: 'm-1' }, text: 'Fix the login page' });
        await flushPromises();
        expect(wrapper.findComponent(MakeTaskSheet).props('initialTitle')).toBe('Fix the login page');
    });

    it('Send and make a task sends the message and opens the sheet', async () => {
        wrapper.findComponent(MainChatComposer).vm.$emit('send-task', 'Book the venue');
        await flushPromises();
        expect(conversation.sendText).toHaveBeenCalledWith('Book the venue', {});
        expect(wrapper.findComponent(MakeTaskSheet).props('initialTitle')).toBe('Book the venue');
    });

    it('the clip command opens the recorder and posts the saved clip here', async () => {
        wrapper.findComponent(MainChatComposer).vm.$emit('command', { name: 'clip', text: '' });
        expect(openRecorder).toHaveBeenCalledTimes(1);

        const onSaved = openRecorder.mock.calls[0][1];
        await onSaved({ url: 'Clips/c/u/clip.webm', mediaType: 'video', title: 'Walkthrough', size: 10 });
        await flushPromises();
        expect(conversation.sendMedia).toHaveBeenCalledWith(expect.objectContaining({ type: 'video', mediaURL: 'Clips/c/u/clip.webm' }));
    });

    it('the talk command opens talk to text', async () => {
        wrapper.findComponent(MainChatComposer).vm.$emit('command', { name: 'talk', text: '' });
        expect(shellState.talkToText).toBe(true);
    });
});

describe('MainChatComposer commands', () => {
    const commandsShown = async (state) => {
        aiAvailability.state = state;
        const wrapper = shallowMount(MainChatComposer, { props: { conversationKey: `k-${state}` } });
        wrapper.findComponent(CommentInput).vm.$emit('update:modelValue', '/');
        await flushPromises();
        const shown = wrapper.findAll('.mc-cmd kbd').map((node) => node.text());
        wrapper.unmount();
        return shown;
    };

    it('offers /summarize only while AI is usable', async () => {
        expect(await commandsShown(AI_STATE.ON)).toContain('/summarize');
        const off = await commandsShown(AI_STATE.OFF_INSTANCE);
        expect(off).not.toContain('/summarize');
        expect(off).toEqual(expect.arrayContaining(['/task', '/clip', '/voice']));
    });
});
