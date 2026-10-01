import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { ref } from 'vue';

const api = vi.hoisted(() => ({ rows: [], calls: [] }));

vi.mock('@/services', () => ({
    apiRequest: vi.fn((method, url, body) => {
        api.calls.push({ method, url, body });
        if (method === 'get') return Promise.resolve({ data: { status: true, data: api.rows } });
        if (method === 'post') return Promise.resolve({ data: { status: true, data: { _id: 'new', userId: 'user-1', createdAt: '2026-09-30T11:00:00Z', ...body } } });
        const id = url.split('/comments/')[1].split('/')[0];
        const row = api.rows.find((r) => r._id === id) || {};
        return Promise.resolve({ data: { status: true, data: { ...row, ...(body || {}) } } });
    }),
}));
vi.mock('@/composable', () => ({ useGetterFunctions: () => ({ getUser: (id) => ({ Employee_Name: id === 'user-1' ? 'Me' : 'Priya Shah' }) }) }));
vi.mock('vuex', async (importOriginal) => ({
    ...(await importOriginal()),
    useStore: () => ({ getters: {
        'settings/companyUsers': [{ userId: 'u2', status: 2 }, { userId: 'bot', status: 2, isAgent: true }, { userId: 'gone', status: 2, isDelete: true }],
        'settings/companyUserDetail': { roleType: 3 },
    } }),
}));

import PageComments from '@/components/molecules/Pages/PageComments.vue';

const socket = { id: 'sock', on: vi.fn(), off: vi.fn(), emit: vi.fn() };
const mountPanel = async (props = {}) => {
    const wrapper = mount(PageComments, {
        props: { pageId: 'p1', blocks: [{ id: 'intro', type: 'paragraph', data: { text: 'The intro' } }], ...props },
        global: { provide: { $socket: ref(socket), $userId: ref('user-1') } },
    });
    await flushPromises();
    return wrapper;
};

beforeEach(() => {
    api.calls.length = 0;
    api.rows = [
        { _id: 'c1', userId: 'u2', message: '&lt;img src=x onerror=alert(1)&gt; see @[Me](6f0000000000000000000a01)', blockId: 'intro', createdAt: '2026-09-30T10:00:00Z' },
        { _id: 'r1', userId: 'user-1', parentId: 'c1', message: 'Mine', createdAt: '2026-09-30T10:05:00Z' },
    ];
    vi.clearAllMocks();
});

describe('the doc comments panel', () => {
    it('joins the doc room and shows threads with their text escaped', async () => {
        const wrapper = await mountPanel();
        expect(socket.emit).toHaveBeenCalledWith('joinCommentRoom', { roomName: 'pagecomments_p1**sock', socketId: 'sock' });
        expect(wrapper.find('.pcm__text img').exists()).toBe(false);
        expect(wrapper.find('.pcm__text').text()).toContain('<img src=x onerror=alert(1)>');
        expect(wrapper.find('.pcm__text .mentioned').text()).toBe('@Me');
        expect(wrapper.find('.pcm__anchor-text').text()).toBe('The intro');
        expect(wrapper.emitted('count').at(-1)).toEqual([1]);
    });

    it('offers edit only on the reader’s own comment', async () => {
        const wrapper = await mountPanel();
        const items = wrapper.findAll('.pcm__item');
        expect(items[0].text()).not.toContain('Docs.comment_edit');
        expect(items[1].text()).toContain('Docs.comment_edit');
    });

    it('offers only people with a live seat to mention, never an agent', async () => {
        const wrapper = await mountPanel();
        const field = wrapper.find('.pcm__compose textarea');
        field.element.value = '@';
        field.element.setSelectionRange(1, 1);
        await field.trigger('input');
        expect(wrapper.findAll('.pcm__compose .pci__name').map((option) => option.text())).toEqual(['Priya Shah']);
    });

    it('posts a new comment on the block picked from the doc', async () => {
        const wrapper = await mountPanel({ pickBlock: () => ({ id: 'intro', text: 'The intro' }) });
        const onBlock = wrapper.findAll('button').find((b) => b.text() === 'Docs.comment_on_block');
        await onBlock.trigger('click');
        await wrapper.find('.pcm__compose textarea').setValue('Is this right?');
        const send = wrapper.findAll('.pcm__compose button').find((b) => b.text() === 'Docs.comment_send');
        await send.trigger('click');
        await flushPromises();
        expect(api.calls.at(-1)).toEqual({ method: 'post', url: '/api/v2/pages/p1/comments', body: { message: 'Is this right?', blockId: 'intro' } });
    });

    it('resolves a thread and moves it to the resolved tab', async () => {
        const wrapper = await mountPanel();
        const resolve = wrapper.findAll('button').find((b) => b.text().includes('Docs.comment_resolve'));
        await resolve.trigger('click');
        await flushPromises();
        expect(api.calls.at(-1)).toEqual({ method: 'put', url: '/api/v2/pages/p1/comments/c1/resolve', body: { resolved: true } });
        expect(wrapper.findAll('.pcm__thread')).toHaveLength(0);
        expect(wrapper.emitted('count').at(-1)).toEqual([0]);
    });

    it('applies a live update from the room', async () => {
        const wrapper = await mountPanel();
        const insert = socket.on.mock.calls.find(([event]) => event === 'pageCommentInsert')[1];
        insert({ fullDocument: { _id: 'c2', userId: 'u2', message: 'Fresh', createdAt: '2026-09-30T10:10:00Z' } });
        await flushPromises();
        expect(wrapper.findAll('.pcm__thread')).toHaveLength(2);
    });
});
