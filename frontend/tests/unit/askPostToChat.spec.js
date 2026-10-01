import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';

const { apiRequest, toast } = vi.hoisted(() => ({ apiRequest: vi.fn(), toast: { success: vi.fn(), error: vi.fn() } }));
const echo = (key, params) => (params ? `${key} ${JSON.stringify(params)}` : key);

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('vue-toast-notification', () => ({ useToast: () => toast }));
vi.mock('vue-i18n', async (importOriginal) => ({ ...(await importOriginal()), useI18n: () => ({ t: echo }) }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));

import AskPostToChat from '@/views/Ai/AskPostToChat.vue';
import AskAnswer from '@/views/Ai/AskAnswer.vue';

enableAutoUnmount(afterEach);

const TARGETS = '/api/v1/ai/ask/post/targets';
const POST = '/api/v1/ai/ask/post';
const ok = (data) => ({ data: { status: true, data } });
const CHANNEL = { projectId: 'space-1', sprintId: 'ch-1', taskId: 'default', name: 'general', space: 'Team' };
const DIRECT = { projectId: 'space-0', sprintId: 'dm-s', taskId: 'dm-1', name: 'Bob' };
const CITED = [{ kind: 'task', id: 't1', ref: 'WEB-7', title: 'Launch pricing page', project: 'Web', projectId: 'p1' }];
const ANSWER = { question: 'When do we launch?', answer: 'On Friday [WEB-7].', cited: CITED, shareToken: 'signed.token.value' };

let posts;
let reply;
const serve = ({ channels = [CHANNEL], directs = [DIRECT], targets } = {}) => {
    posts = [];
    apiRequest.mockImplementation(async (method, url, body) => {
        if (method === 'get' && url === TARGETS) return targets ? targets() : ok({ channels, directs });
        if (method === 'post' && url === POST) { posts.push(body); return reply(body); }
        return ok({});
    });
};

const LinkStub = defineComponent({ name: 'RouterLink', props: { to: { type: [Object, String], required: true } }, setup: (props, { slots }) => () => h('a', { href: '#' }, slots.default && slots.default()) });
const global = { mocks: { $t: echo }, stubs: { teleport: true, RouterLink: LinkStub } };

const openDialog = async (props = {}) => {
    const wrapper = mount(AskPostToChat, { props: { ...ANSWER, ...props }, global, attachTo: document.body });
    await flushPromises();
    return wrapper;
};
const press = async (wrapper, name) => {
    await wrapper.find(`[data-test="${name}"]`).trigger('click');
    await flushPromises();
};

beforeEach(() => {
    apiRequest.mockReset();
    toast.success.mockReset();
    reply = async () => ok({ id: 'c1', trimmed: false });
    serve();
});

describe('posting an Ask answer to chat', () => {
    it('offers the channels and direct messages the person can post in', async () => {
        const wrapper = await openDialog();
        const groups = wrapper.findAll('optgroup');
        expect(groups.map((g) => g.attributes('label'))).toEqual(['Ask.post_channels', 'Ask.post_directs']);
        expect(wrapper.findAll('option').map((o) => o.text())).toEqual(['#general · Team', 'Bob']);
        expect(posts).toEqual([]);
    });

    it('posts the answer as it was given, with its question, sources and token, to the chosen conversation', async () => {
        const wrapper = await openDialog();
        await wrapper.find('[data-test="post-target"]').setValue('space-0:dm-s:dm-1');
        await press(wrapper, 'post-send');

        expect(posts).toEqual([{ projectId: 'space-0', sprintId: 'dm-s', taskId: 'dm-1', question: ANSWER.question, answer: ANSWER.answer, cited: CITED, shareToken: ANSWER.shareToken }]);
        expect(toast.success).toHaveBeenCalledWith('Ask.post_done {"name":"Bob"}', expect.anything());
        expect(wrapper.emitted('posted')[0][0]).toMatchObject({ taskId: 'dm-1', id: 'c1' });
        expect(wrapper.emitted('close')).toHaveLength(1);
    });

    it('says what was held back, and posts the shared lines only when the person chooses to', async () => {
        reply = async (body) => (body.onlyShared
            ? ok({ id: 'c2', trimmed: true })
            : { data: { status: false, code: 'not_shared', data: { unshared: 2, unsharedCited: ['ALP-1'], postable: true } } });
        const wrapper = await openDialog();
        await press(wrapper, 'post-send');

        const held = wrapper.find('[data-test="post-held"]');
        expect(held.text()).toContain('Ask.post_held {"n":2,"name":"#general · Team"}');
        expect(held.text()).toContain('Ask.post_held_cited {"refs":"ALP-1"}');
        expect(held.text()).toContain('Ask.post_held_choice');
        expect(wrapper.emitted('close')).toBeUndefined();
        expect(wrapper.find('[data-test="post-send"]').exists()).toBe(false);
        expect(posts).toHaveLength(1);

        await press(wrapper, 'post-only-shared');
        expect(posts[1]).toMatchObject({ onlyShared: true, taskId: 'default', answer: ANSWER.answer });
        expect(wrapper.emitted('close')).toHaveLength(1);
    });

    it('lets the person cancel instead, and posts nothing more', async () => {
        reply = async () => ({ data: { status: false, code: 'not_shared', data: { unshared: 1, unsharedCited: [], postable: true } } });
        const wrapper = await openDialog();
        await press(wrapper, 'post-send');
        await press(wrapper, 'post-cancel');
        expect(posts).toHaveLength(1);
        expect(wrapper.emitted('close')).toHaveLength(1);
        expect(toast.success).not.toHaveBeenCalled();
    });

    it('offers no way to post when nothing in the answer is shared', async () => {
        reply = async () => ({ data: { status: false, code: 'not_shared', data: { unshared: 1, unsharedCited: ['ALP-1'], postable: false } } });
        const wrapper = await openDialog();
        await press(wrapper, 'post-send');
        expect(wrapper.find('[data-test="post-held"]').text()).toContain('Ask.post_nothing_shared');
        expect(wrapper.find('[data-test="post-only-shared"]').exists()).toBe(false);
        expect(wrapper.find('[data-test="post-send"]').exists()).toBe(false);
    });

    it('asks the conversation again after another one is picked', async () => {
        reply = async () => ({ data: { status: false, code: 'not_shared', data: { unshared: 1, unsharedCited: [], postable: true } } });
        const wrapper = await openDialog();
        await press(wrapper, 'post-send');
        await wrapper.find('[data-test="post-target"]').setValue('space-0:dm-s:dm-1');
        expect(wrapper.find('[data-test="post-held"]').exists()).toBe(false);
        expect(wrapper.find('[data-test="post-send"]').exists()).toBe(true);
    });

    it('says to ask again when the answer can no longer be posted, and when posting fails', async () => {
        reply = async () => { throw Object.assign(new Error('403'), { response: { status: 403, data: { status: false, code: 'share_refused' } } }); };
        const wrapper = await openDialog();
        await press(wrapper, 'post-send');
        expect(wrapper.find('[data-test="post-error"]').text()).toBe('Ask.post_expired');

        reply = async () => { throw new Error('down'); };
        await press(wrapper, 'post-send');
        expect(wrapper.find('[data-test="post-error"]').text()).toBe('Ask.post_failed');
        expect(wrapper.emitted('close')).toBeUndefined();
    });

    it('says so when there is nowhere to post, or the list could not be read', async () => {
        serve({ channels: [], directs: [] });
        const none = await openDialog();
        expect(none.find('[data-test="post-none"]').text()).toBe('Ask.post_none');
        expect(none.find('[data-test="post-send"]').attributes('disabled')).toBeDefined();

        serve({ targets: async () => { throw new Error('down'); } });
        const failed = await openDialog();
        expect(failed.find('[data-test="post-none"]').text()).toBe('Ask.post_load_failed');
    });
});

describe('the Post to chat action on an Ask answer', () => {
    const mountAnswer = (answer) => mount(AskAnswer, { props: { answer: { mode: 'ask', sources: CITED, scope: {}, usage: { model: 'm' }, ...answer } }, global });

    it('is offered on an answer that can be posted, and opens the dialog with that answer', async () => {
        const wrapper = mountAnswer(ANSWER);
        await wrapper.find('[data-test="ask-post-chat"]').trigger('click');
        await flushPromises();
        const dialog = wrapper.findComponent(AskPostToChat);
        expect(dialog.props()).toMatchObject({ question: ANSWER.question, answer: ANSWER.answer, cited: CITED, shareToken: ANSWER.shareToken });
    });

    it('is not offered on an answer without a token, such as one read back from an old thread', () => {
        const { shareToken, ...old } = ANSWER;
        expect(shareToken).toBeTruthy();
        expect(mountAnswer(old).find('[data-test="ask-post-chat"]').exists()).toBe(false);
        expect(mountAnswer({ ...ANSWER, shareToken: '' }).find('[data-test="ask-post-chat"]').exists()).toBe(false);
    });
});
