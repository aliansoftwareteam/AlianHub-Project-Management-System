import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, shallowMount } from '@vue/test-utils';
import { reactive, ref } from 'vue';

const { apiRequest, apiRequestWithoutCompnay, toast, store, commentPost } = vi.hoisted(() => {
    const commentPost = { result: () => Promise.resolve({ data: { status: true, data: { _id: 'c-1' } } }) };
    return {
        commentPost,
        apiRequest: vi.fn((method, url) => {
            if (url === '/api/v1/comments' && (method === 'post' || method === 'put')) return commentPost.result();
            return Promise.resolve({ data: { status: true, data: [] } });
        }),
        apiRequestWithoutCompnay: vi.fn(() => Promise.resolve({ data: { status: true, statusText: 'https://files/x.png' } })),
        toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
        store: {
            getters: {
                'settings/fileExtentions': [],
                'settings/selectedCompany': { planFeature: { commentsView: true } },
                'mainChat/getCommentRoomData': {},
                'settings/companyOwnerDetail': {},
                'users/myCounts': { data: {} },
                'settings/companyUsers': [],
                'settings/companyUserDetail': {},
                'mainChat/mainChatSprints': {},
                'mainChat/mainChatFolders': {},
            },
            commit: vi.fn(),
            dispatch: vi.fn(() => Promise.resolve({})),
        },
    };
});

vi.mock('@/services', () => ({ apiRequest, apiRequestWithoutCompnay }));
vi.mock('vue-toast-notification', () => ({ useToast: () => toast }));
vi.mock('@/locales/main', () => ({ i18n: { global: { t: (key) => key } } }));
vi.mock('vuex', async (importOriginal) => ({ ...(await importOriginal()), useStore: () => store }));
vi.mock('vue-router', () => ({
    useRoute: () => reactive({ params: {}, query: {}, hash: '' }),
    useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('@/utils/TaskOperations', () => ({ default: { updateLastMessageTime: vi.fn(() => Promise.resolve()) } }));
vi.mock('@/composable/Validation', () => ({ useValidation: () => ({ checkErrors: vi.fn(), checkAllFields: vi.fn() }) }));
vi.mock('@/composable/commonFunction', () => ({
    taskPlanPermission: () => ({ checkTaskPerSprintPermisssion: vi.fn() }),
    storageHelper: () => ({ handleStorageImageRequest: vi.fn() }),
}));
vi.mock('@/composable', () => ({
    useCustomComposable: () => ({
        debounce: (fn) => fn,
        makeUniqueId: () => 'uid',
        changeText: (text) => text,
        checkLink: () => null,
        compareObjects: () => true,
        checkBucketStorage: () => true,
    }),
    useConvertDate: () => ({ convertDateFormat: () => '' }),
    useGetterFunctions: () => ({ getUser: () => ({}) }),
}));
vi.mock('@/views/Projects/Comments/helper', async (importOriginal) => ({
    ...(await importOriginal()),
    checkFile: vi.fn((files) => Promise.resolve(files.map((file) => ({ data: file, name: file.name, fileType: 'image' })))),
    renderFiles: vi.fn((file) => Promise.resolve({
        isSending: `sending-${file.mediaOriginalName}`,
        reply: {},
        message: '',
        mediaURL: 'data:image/png;base64,x',
        mediaName: file.name,
        mediaOriginalName: file.mediaOriginalName,
        mediaSize: 1,
        type: file.fileType,
        sent: true,
    })),
}));

import { sendMessage } from '@/views/Projects/Comments/helper';
import Comments from '@/views/Projects/Comments/Comments.vue';

const settled = (promise) => Promise.race([
    promise.then(() => 'resolved', () => 'rejected'),
    flushPromises().then(() => 'pending'),
]);

describe('sendMessage', () => {
    it('rejects when the server answers a new comment with status false', async () => {
        commentPost.result = () => Promise.resolve({ data: { status: false, message: 'nope' } });
        const outcome = await settled(sendMessage({ messageData: { message: 'hi', reply: {} }, edited: false }));
        expect(outcome).toBe('rejected');
    });

    it('rejects when the server answers an edit with status false', async () => {
        commentPost.result = () => Promise.resolve({ data: { status: false, message: 'nope' } });
        const outcome = await settled(sendMessage({ messageData: { _id: 'c-1', message: 'hi' }, edited: true }));
        expect(outcome).toBe('rejected');
    });
});

const Composer = {
    name: 'CommentInput',
    props: ['modelValue'],
    emits: ['update:modelValue', 'enter', 'pasteFile'],
    template: '<textarea class="composer" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" @keydown.enter="$emit(\'enter\')" />',
};
const Tray = {
    name: 'MediaConfirmation',
    props: ['modelValue'],
    template: '<ul class="tray"><li v-for="media in modelValue" :key="media.mediaName">{{ media.mediaOriginalName }}</li></ul>',
};

const posts = () => apiRequest.mock.calls.filter(([method, url]) => method === 'post' && url === '/api/v1/comments');

describe('Comments composer when a comment fails to send', () => {
    let wrapper;

    const mountComments = () => shallowMount(Comments, {
        props: { taskId: 'task-1', sprintId: 'sprint-1' },
        global: {
            provide: {
                selectedProject: ref({ _id: 'proj-1', sprintsObj: {}, taskTypeCounts: [] }),
                $userId: ref('user-1'),
                $companyId: ref('company-1'),
                $clientWidth: ref(1280),
                $socket: ref({ id: 'sock', on: vi.fn(), off: vi.fn(), emit: vi.fn() }),
            },
            stubs: { CommentInput: Composer, MediaConfirmation: Tray },
        },
    });

    const type = (text) => wrapper.find('textarea.composer').setValue(text);
    const pressEnter = () => wrapper.find('textarea.composer').trigger('keydown.enter');
    const composerText = () => wrapper.find('textarea.composer').element.value;

    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval'] });
        sessionStorage.clear();
        wrapper = mountComments();
    });

    afterEach(() => {
        wrapper.unmount();
        vi.useRealTimers();
    });

    it('keeps the text and says so when the server answers status false', async () => {
        commentPost.result = () => Promise.resolve({ data: { status: false, message: 'nope' } });
        await type('Ship it on Friday');
        await pressEnter();
        await flushPromises();

        expect(posts()).toHaveLength(1);
        expect(composerText()).toBe('Ship it on Friday');
        expect(toast.error).toHaveBeenCalledWith('Comments.send_failed', expect.anything());
    });

    it('keeps the text and says so when the request fails on the network', async () => {
        commentPost.result = () => Promise.reject(new Error('Network Error'));
        await type('Ship it on Friday');
        await pressEnter();
        await flushPromises();

        expect(composerText()).toBe('Ship it on Friday');
        expect(toast.error).toHaveBeenCalledWith('Comments.send_failed', expect.anything());
    });

    it('clears the composer once the comment is saved', async () => {
        commentPost.result = () => Promise.resolve({ data: { status: true, data: { _id: 'c-1' } } });
        await type('Ship it on Friday');
        await pressEnter();
        await flushPromises();

        expect(composerText()).toBe('');
        expect(toast.error).not.toHaveBeenCalled();
    });

    it('does not post again while the first send is still in flight', async () => {
        let answer;
        commentPost.result = () => new Promise((resolve) => { answer = resolve; });
        await type('First');
        await pressEnter();
        await type('Second');
        await pressEnter();
        await flushPromises();

        expect(posts()).toHaveLength(1);
        expect(composerText()).toBe('Second');

        answer({ data: { status: true, data: { _id: 'c-1' } } });
        await flushPromises();
    });

    it('puts a failed attachment back in the tray and drops its pending bubble', async () => {
        apiRequestWithoutCompnay.mockImplementationOnce(() => Promise.reject(new Error('Network Error')));
        wrapper.findComponent(Composer).vm.$emit('pasteFile', [new File(['x'], 'shot.png', { type: 'image/png' })]);
        await flushPromises();
        expect(wrapper.find('ul.tray').text()).toContain('shot.png');

        await wrapper.find('button.send__media-btn').trigger('click');
        await flushPromises();

        expect(wrapper.find('ul.tray').exists()).toBe(true);
        expect(wrapper.find('ul.tray').text()).toContain('shot.png');
        expect(wrapper.vm.messages.filter((row) => row.isSending)).toHaveLength(0);
        expect(toast.error).toHaveBeenCalledWith('Comments.attachment_send_failed', expect.anything());
    });
});
