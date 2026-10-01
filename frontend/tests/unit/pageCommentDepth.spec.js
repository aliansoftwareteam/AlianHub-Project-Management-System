import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { ref } from 'vue';

const ME = 'user-1';
const PRIYA = '6f0000000000000000000a02';
const OMAR = '6f0000000000000000000a03';
const DOC = '6f0000000000000000000e09';
const TASK = '6f0000000000000000000b09';
const KEY = 'Pages/p1/Comments/1234_brief.pdf';

const { api, upload, router, signedLink } = vi.hoisted(() => ({
    api: { rows: [], people: [], docs: [], limit: 500, calls: [] },
    upload: { calls: [] },
    router: { push: vi.fn(() => Promise.resolve()) },
    signedLink: { calls: [] },
}));

const NAMES = { [ME]: 'Me', [PRIYA]: 'Priya Shah', [OMAR]: 'Omar Haddad' };

vi.mock('@/services', () => ({
    apiRequest: vi.fn((method, url, body) => {
        api.calls.push({ method, url, body });
        const ok = (data, extra = {}) => Promise.resolve({ data: { status: true, data, ...extra } });
        if (method === 'get' && url === '/api/v2/pages/p1/comments/people') return ok(api.people);
        if (method === 'get' && url === '/api/v2/pages/p1/comments') return ok(api.rows, { limit: api.limit, atLimit: api.rows.length >= api.limit });
        if (method === 'get' && url.startsWith('/api/v2/pages?')) return ok(api.docs);
        if (url === '/api/v1/task/find') return Promise.resolve({ data: [{ _id: TASK, TaskKey: 'AH-1', TaskName: 'Fix it' }] });
        if (url === '/api/v1/comments/assigned-to-me') return ok(api.assigned || []);
        if (method === 'post') return ok({ _id: 'new', userId: ME, createdAt: '2026-09-30T11:00:00Z', ...body });
        const id = url.split('/comments/')[1].split('/')[0];
        const row = api.rows.find((r) => r._id === id) || {};
        if (url.endsWith('/reaction')) return ok({ ...row, reactions: [...(row.reactions || []), { emoji: body.emoji, userId: ME }] });
        if (url.endsWith('/assign')) return ok({ ...row, assigneeId: body.assigneeId, assignedBy: ME, resolved: false });
        return ok({ ...row, ...(body || {}) });
    }),
    apiRequestWithoutCompnay: vi.fn((method, url, form) => {
        upload.calls.push({ method, url, path: form.get('path'), companyId: form.get('companyId'), file: form.get('file') });
        return Promise.resolve({ data: { status: true, statusText: form.get('path') } });
    }),
}));
vi.mock('@/composable', () => ({
    useGetterFunctions: () => ({ getUser: (id) => ({ Employee_Name: NAMES[id] || 'Someone' }) }),
    useCustomComposable: () => ({
        checkBucketStorage: () => true,
        getWasabiImageLink: (companyId, key) => { signedLink.calls.push({ companyId, key }); return Promise.resolve('https://files.test/signed'); },
        debounce: (fn) => fn,
    }),
}));
vi.mock('vuex', async (importOriginal) => ({
    ...(await importOriginal()),
    useStore: () => ({ getters: {
        'settings/companyUsers': [{ userId: PRIYA, status: 2 }, { userId: OMAR, status: 2 }],
        'settings/companyUserDetail': { roleType: 3 },
    } }),
}));
vi.mock('vue-router', () => ({ useRoute: () => ({ params: { cid: 'company-1' }, query: {} }), useRouter: () => router }));

import PageComments from '@/components/molecules/Pages/PageComments.vue';
import ReactionBar from '@/components/atom/ReactionBar/ReactionBar.vue';
import CommentAssignment from '@/components/molecules/CommentThread/CommentAssignment.vue';
import AssignedCommentsCard from '@/components/molecules/Home/AssignedCommentsCard.vue';
import { insertMention } from '@/components/molecules/Pages/pageComments';
import { commentHtml, commentPlainText } from '@/utils/commentHtml';
import { renderNotice } from '@/views/Inbox/renderNotice';
import en from '@/locales/en';

const socket = { id: 'sock', on: vi.fn(), off: vi.fn(), emit: vi.fn() };
const provide = { $socket: ref(socket), $userId: ref(ME), $companyId: ref('company-1') };
const mountPanel = async () => {
    const wrapper = mount(PageComments, { props: { pageId: 'p1', blocks: [] }, global: { provide } });
    await flushPromises();
    return wrapper;
};
const pickerSettles = () => new Promise((resolve) => setTimeout(resolve, 260));
const offered = () => [...document.body.querySelectorAll('.dmp__name')].map((node) => node.textContent.trim());
const type = async (field, text) => {
    field.element.value = text;
    field.element.setSelectionRange(text.length, text.length);
    await field.trigger('input');
    await pickerSettles();
    await flushPromises();
};
const lastCall = (method, part) => api.calls.filter((c) => c.method === method && c.url.includes(part)).at(-1);

beforeEach(() => {
    document.body.innerHTML = '<div id="my-dropdown"></div>';
    api.calls.length = 0;
    upload.calls.length = 0;
    signedLink.calls.length = 0;
    api.limit = 500;
    api.people = [ME, PRIYA];
    api.docs = [{ _id: DOC, title: 'Handbook' }];
    api.assigned = [];
    api.rows = [
        { _id: 'c1', userId: PRIYA, message: 'Check the numbers', createdAt: '2026-09-30T10:00:00Z', reactions: [{ emoji: '🎉', userId: PRIYA }] },
        { _id: 'r1', userId: ME, parentId: 'c1', message: 'On it', createdAt: '2026-09-30T10:05:00Z', mediaURL: KEY, mediaOriginalName: 'brief.pdf', mediaSize: 2048 },
    ];
    vi.clearAllMocks();
});

describe('mentions in a doc comment', () => {
    it('offers only the people who can read the doc', async () => {
        const wrapper = await mountPanel();
        await type(wrapper.find('.pcm__compose textarea'), '@');
        expect(offered()).toEqual(['Priya Shah', 'Handbook']);
        wrapper.unmount();
    });

    it('offers nobody while the readers are not known', async () => {
        api.people = [];
        api.docs = [];
        const wrapper = await mountPanel();
        await type(wrapper.find('.pcm__compose textarea'), '@');
        expect(offered()).toEqual([]);
        wrapper.unmount();
    });

    it('finds docs and tasks through the shared picker and writes them into the text', async () => {
        const wrapper = await mountPanel();
        const field = wrapper.find('.pcm__compose textarea');
        await type(field, 'See @Hand');
        expect(offered()).toEqual(['Handbook', 'Fix it']);
        await field.trigger('keydown', { key: 'Enter' });
        await flushPromises();
        expect(field.element.value).toBe(`See @[Handbook](doc_${DOC}) `);
        expect(wrapper.emitted('close')).toBeUndefined();
        wrapper.unmount();
    });

    it('writes a person, a doc and a task each in a form the server reads', () => {
        expect(insertMention('@pr', 0, 3, { type: 'user', id: PRIYA, label: 'Priya Shah' }).text).toBe(`@[Priya Shah](${PRIYA}) `);
        expect(insertMention('@ha', 0, 3, { type: 'doc', id: DOC, label: 'Hand(book) [v2]' }).text).toBe(`@[Handbook v2](doc_${DOC}) `);
        expect(insertMention('@ah', 0, 3, { type: 'task', id: TASK, label: 'AH-1 Fix it' }).text).toBe(`@[AH-1 Fix it](task_${TASK}) `);
    });

    it('shows a doc or task mention as a link the reader can follow, and a person as before', () => {
        const host = document.createElement('div');
        host.innerHTML = commentHtml(`@[AH-1 <Fix> it](task_${TASK}) @[Handbook](doc_${DOC}) @[Priya Shah](${PRIYA})`, { links: true, refs: true });
        const [task, doc] = host.querySelectorAll('span.mention');
        expect(task.dataset).toMatchObject({ mention: 'task', id: TASK });
        expect(task.textContent).toBe('@AH-1 <Fix> it');
        expect(task.getAttribute('role')).toBe('link');
        expect(doc.dataset).toMatchObject({ mention: 'doc', id: DOC });
        expect(host.querySelector('b.mentioned').textContent).toBe('@Priya Shah');
        expect(host.querySelectorAll('*')).toHaveLength(3);
        expect(commentPlainText(`@[AH-1 Fix it](task_${TASK}) and @[Handbook](doc_${DOC})`)).toBe('@AH-1 Fix it and @Handbook');
    });

    it('opens the doc a comment mentions', async () => {
        api.rows = [{ _id: 'c1', userId: PRIYA, message: `Read @[Handbook](doc_${DOC})`, createdAt: '2026-09-30T10:00:00Z' }];
        const wrapper = await mountPanel();
        await wrapper.find('.pcm__text span.mention').trigger('click');
        expect(router.push).toHaveBeenCalledWith({ name: 'PageEditor', params: { cid: 'company-1', pageId: DOC } });
        wrapper.unmount();
    });
});

describe('assigning a doc comment', () => {
    it('assigns a thread to someone who can read the doc', async () => {
        const wrapper = await mountPanel();
        const control = wrapper.findComponent(CommentAssignment);
        expect(control.props('people').map((p) => p.id)).toEqual([ME, PRIYA]);
        await control.props('actions').assign(api.rows[0], PRIYA);
        await flushPromises();
        expect(lastCall('put', '/assign')).toEqual({ method: 'put', url: '/api/v2/pages/p1/comments/c1/assign', body: { assigneeId: PRIYA } });
        expect(wrapper.find('[data-test="assigned-to"]').text()).toBe('Comments.assigned_to');
        wrapper.unmount();
    });

    it('leaves resolving an assigned thread to the people on it', async () => {
        api.rows = [{ _id: 'c1', userId: PRIYA, message: 'Check', createdAt: '2026-09-30T10:00:00Z', assigneeId: OMAR, assignedBy: PRIYA }];
        const wrapper = await mountPanel();
        expect(wrapper.findAll('button').some((b) => b.text().includes('Docs.comment_resolve'))).toBe(false);
        expect(wrapper.find('[data-test="resolve"]').exists()).toBe(false);
        wrapper.unmount();

        api.rows = [{ _id: 'c1', userId: PRIYA, message: 'Check', createdAt: '2026-09-30T10:00:00Z', assigneeId: ME, assignedBy: PRIYA }];
        const mine = await mountPanel();
        await mine.find('[data-test="resolve"]').trigger('click');
        await flushPromises();
        expect(lastCall('put', '/resolve')).toEqual({ method: 'put', url: '/api/v2/pages/p1/comments/c1/resolve', body: { resolved: true } });
        expect(mine.findAll('.pcm__thread')).toHaveLength(0);
        mine.unmount();
    });

    it('offers no assignment on a reply', async () => {
        const wrapper = await mountPanel();
        expect(wrapper.findAllComponents(CommentAssignment)).toHaveLength(1);
        wrapper.unmount();
    });

    it('lets the shared control talk to a doc instead of a task', async () => {
        const assign = vi.fn(async () => ({ assigneeId: PRIYA, assignedBy: ME, resolved: false }));
        const wrapper = mount(CommentAssignment, {
            props: { comment: { _id: 'c1', userId: ME, assigneeId: ME, assignedBy: ME }, people: [], actions: { assign, resolve: assign } },
            global: { provide },
        });
        await wrapper.find('[data-test="resolve"]').trigger('click');
        await flushPromises();
        expect(assign).toHaveBeenCalledWith(expect.objectContaining({ _id: 'c1' }), true);
        expect(api.calls).toEqual([]);
    });
});

describe('reactions on a doc comment', () => {
    it('shows who reacted with a count and toggles the reader’s own', async () => {
        const wrapper = await mountPanel();
        const bars = wrapper.findAllComponents(ReactionBar);
        expect(bars).toHaveLength(2);
        expect(bars[0].find('.reaction-bar__chip').text()).toContain('🎉');
        expect(bars[0].find('.reaction-bar__count').text()).toBe('1');
        expect(bars[0].find('.reaction-bar__chip').attributes('title')).toBe('Priya Shah');
        bars[0].vm.$emit('toggle', '🎉');
        await flushPromises();
        expect(lastCall('put', '/reaction')).toEqual({ method: 'put', url: '/api/v2/pages/p1/comments/c1/reaction', body: { emoji: '🎉' } });
        expect(wrapper.findAllComponents(ReactionBar)[0].find('.reaction-bar__count').text()).toBe('2');
        wrapper.unmount();
    });

    it('reacts on a reply and follows a live update from the room', async () => {
        const wrapper = await mountPanel();
        wrapper.findAllComponents(ReactionBar)[1].vm.$emit('toggle', '🚀');
        await flushPromises();
        expect(lastCall('put', '/reaction').url).toBe('/api/v2/pages/p1/comments/r1/reaction');
        const update = socket.on.mock.calls.find(([event]) => event === 'pageCommentUpdate')[1];
        update({ fullDocument: { _id: 'c1', reactions: [] } });
        await flushPromises();
        expect(wrapper.findAllComponents(ReactionBar)[0].find('.reaction-bar__chip').exists()).toBe(false);
        wrapper.unmount();
    });
});

describe('a file on a doc comment', () => {
    it('shows the file by name and opens it through a signed link', async () => {
        const open = vi.spyOn(window, 'open').mockImplementation(() => null);
        const wrapper = await mountPanel();
        const chip = wrapper.find('[data-test="comment-file"]');
        expect(chip.text()).toContain('brief.pdf');
        await chip.trigger('click');
        await flushPromises();
        expect(signedLink.calls).toEqual([{ companyId: 'company-1', key: KEY }]);
        expect(open).toHaveBeenCalledWith('https://files.test/signed', '_blank', 'noopener');
        open.mockRestore();
        wrapper.unmount();
    });

    it('uploads the picked file into the doc’s comment folder and sends it with the comment', async () => {
        const wrapper = await mountPanel();
        const file = new File(['spec'], 'brief v2.pdf', { type: 'application/pdf' });
        const input = wrapper.find('[data-test="comment-attach-input"]');
        Object.defineProperty(input.element, 'files', { value: [file], configurable: true });
        await input.trigger('change');
        expect(wrapper.find('[data-test="comment-draft-file"]').text()).toContain('brief v2.pdf');

        const send = wrapper.findAll('.pcm__compose button').find((b) => b.text() === 'Docs.comment_send');
        expect(send.attributes('disabled')).toBeUndefined();
        await send.trigger('click');
        await flushPromises();

        expect(upload.calls).toHaveLength(1);
        expect(upload.calls[0].companyId).toBe('company-1');
        expect(upload.calls[0].path).toMatch(/^Pages\/p1\/Comments\/\d+_brief_v2\.pdf$/);
        expect(lastCall('post', '/comments').body).toEqual({ message: '', mediaURL: upload.calls[0].path, mediaOriginalName: 'brief v2.pdf', mediaSize: file.size });
        expect(wrapper.find('[data-test="comment-draft-file"]').exists()).toBe(false);
        wrapper.unmount();
    });

    it('drops a picked file again before sending', async () => {
        const wrapper = await mountPanel();
        const input = wrapper.find('[data-test="comment-attach-input"]');
        Object.defineProperty(input.element, 'files', { value: [new File(['x'], 'a.txt', { type: 'text/plain' })], configurable: true });
        await input.trigger('change');
        await wrapper.find('[data-test="comment-draft-file"] button').trigger('click');
        expect(wrapper.find('[data-test="comment-draft-file"]').exists()).toBe(false);
        expect(upload.calls).toEqual([]);
        wrapper.unmount();
    });
});

describe('a doc at its comment limit', () => {
    it('says so in plain words and stops new comments', async () => {
        api.limit = 2;
        const wrapper = await mountPanel();
        expect(wrapper.find('[data-test="comment-limit"]').text()).toBe('Docs.comments_limit');
        const send = wrapper.findAll('.pcm__compose button').find((b) => b.text() === 'Docs.comment_send');
        expect(send.attributes('disabled')).toBeDefined();
        expect(wrapper.findAll('button').some((b) => b.text() === 'Docs.comment_reply')).toBe(false);
        wrapper.unmount();
    });

    it('says nothing below the limit', async () => {
        const wrapper = await mountPanel();
        expect(wrapper.find('[data-test="comment-limit"]').exists()).toBe(false);
        wrapper.unmount();
    });
});

describe('assigned doc comments on Home and in the Inbox', () => {
    it('lists a doc comment with its doc, opens the doc at the comment and resolves it there', async () => {
        api.assigned = [{ _id: 'c1', kind: 'doc', pageId: 'p1', pageTitle: 'Launch plan', message: 'Check the numbers', assignedBy: PRIYA }];
        api.rows = [{ _id: 'c1', userId: PRIYA, message: 'Check the numbers', assigneeId: ME, assignedBy: PRIYA }];
        const wrapper = mount(AssignedCommentsCard, { global: { provide, stubs: { ShellIcon: true } } });
        await flushPromises();
        const row = wrapper.find('[data-test="assigned-comment"]');
        expect(row.text()).toContain('Launch plan');
        expect(row.text()).toContain('Check the numbers');
        await row.find('button').trigger('click');
        expect(wrapper.emitted('open')).toBeUndefined();
        expect(router.push).toHaveBeenCalledWith({ name: 'PageEditor', params: { cid: 'company-1', pageId: 'p1' }, query: { comment: 'c1' } });
        await row.find('.hc-assigned__resolve').trigger('click');
        await flushPromises();
        expect(lastCall('put', '/resolve')).toEqual({ method: 'put', url: '/api/v2/pages/p1/comments/c1/resolve', body: { resolved: true } });
        expect(wrapper.findAll('[data-test="assigned-comment"]')).toHaveLength(0);
    });

    it('writes the Inbox line for an assigned doc comment with the doc title as text', () => {
        const t = createI18n({ legacy: false, locale: 'en', messages: { en } }).global.t;
        const html = renderNotice(
            { key: 'doc_comment_assigned', changeType: 'doc_comment', message: `Check @[Handbook](doc_${DOC})`, changeData: { pageTitle: '<b>Plan</b>' } },
            { t, changeText: (x) => x },
        );
        const host = document.createElement('div');
        host.innerHTML = html;
        expect(host.querySelector('b')).toBeNull();
        expect(host.textContent).toBe('on <b>Plan</b>: Check @Handbook');
    });
});
