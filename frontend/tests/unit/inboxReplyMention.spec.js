import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

const { apiRequest, route, router, users } = vi.hoisted(() => ({
    apiRequest: vi.fn(),
    route: { query: {} },
    router: { replace: vi.fn(() => Promise.resolve()), push: vi.fn(() => Promise.resolve()), hasRoute: () => false },
    users: {},
}));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('vue-router', () => ({ useRoute: () => route, useRouter: () => router }));
vi.mock('vuex', async (importOriginal) => ({ ...(await importOriginal()), useStore: () => ({ getters: {} }) }));
vi.mock('@/composable', () => ({
    useCustomComposable: () => ({ changeText: (text) => text }),
    useGetterFunctions: () => ({ getUser: (id) => users[id] || { Employee_Name: 'Ghost User', ghostUser: true, Time_Zone: 'UTC' } }),
}));
vi.mock('@/composable/agentProposals', () => ({ sendProposalDecision: vi.fn() }));
vi.mock('@/components/organisms/Header/helper', () => ({ useHelper: () => ({ openRoute: vi.fn() }) }));
vi.mock('@/components/organisms/Shell/shellState', () => ({ openPanel: vi.fn() }));

import Inbox from '@/views/Inbox/Inbox.vue';

const ADA = '64b000000000000000000001';
const mentionRow = (extra = {}) => ({
    sourceType: 'mention',
    sourceId: '64a000000000000000000001',
    kind: 'mention',
    key: 'mention',
    type: 'task',
    message: 'can you check this?',
    actorId: ADA,
    taskId: '74b000000000000000000001',
    projectId: '84c000000000000000000001',
    sprintId: '94d000000000000000000001',
    unread: true,
    createdAt: '2026-09-24T09:00:00.000Z',
    duplicateIds: [],
    ...extra,
});
const ok = (data) => Promise.resolve({ data: { status: true, data } });

let primaryRows;
beforeEach(() => {
    route.query = {};
    Object.keys(users).forEach((k) => delete users[k]);
    users[ADA] = { Employee_Name: 'Ada Lovelace', Time_Zone: 'UTC' };
    users['user-1'] = { Employee_Name: 'Me Myself', Time_Zone: 'UTC' };
    primaryRows = [mentionRow()];
    window.localStorage.clear();
    apiRequest.mockImplementation((method, url) => {
        if (method === 'get' && url.endsWith('/counts')) return ok({ primary: 1, other: 0, later: 0 });
        if (method === 'get') return ok({ items: primaryRows, approvals: [], proposals: [], hasMore: false, nextSkip: 0 });
        if (url === '/api/v1/comments') return ok({ _id: '64c000000000000000000001' });
        return ok({ count: 1 });
    });
});

let wrapper;
afterEach(() => { if (wrapper) wrapper.unmount(); wrapper = null; });

const reply = async (text) => {
    wrapper = mount(Inbox, { attachTo: document.body, global: { stubs: { UserProfile: true, ShellIcon: true } } });
    await flushPromises();
    await wrapper.find('.ibx__card').trigger('keydown', { key: 'r' });
    await flushPromises();
    await wrapper.find('.ibx__reply textarea').setValue(text);
    await wrapper.find('.ibx__reply textarea').trigger('keydown', { key: 'Enter', metaKey: true });
    await flushPromises();
    const sent = apiRequest.mock.calls.filter(([m, url]) => m === 'post' && url === '/api/v1/comments');
    expect(sent).toHaveLength(1);
    return sent[0][2].data;
};

describe('A reply from the Inbox', () => {
    it('mentions the person it answers, the way the comment box writes a mention', async () => {
        const data = await reply('Looking now');
        expect(data.mentionIds).toEqual([ADA]);
        expect(data.message).toBe(`@[Ada Lovelace](${ADA}) Looking now`);
        expect(data.objId).toEqual({ projectId: '84c000000000000000000001', sprintId: '94d000000000000000000001', taskId: '74b000000000000000000001' });
    });

    it('names who it will notify in the reply box', async () => {
        wrapper = mount(Inbox, { attachTo: document.body, global: { stubs: { UserProfile: true, ShellIcon: true } } });
        await flushPromises();
        await wrapper.find('.ibx__card').trigger('keydown', { key: 'r' });
        await flushPromises();
        expect(wrapper.find('[data-reply-mentions]').text()).toBe('Inbox.reply_mentions');
    });

    it('does not mention you when you answer your own item', async () => {
        primaryRows = [mentionRow({ actorId: 'user-1' })];
        const data = await reply('Note to self');
        expect(data.mentionIds).toEqual([]);
        expect(data.message).toBe('Note to self');
    });

    it('does not mention an agent', async () => {
        primaryRows = [mentionRow({ agent: true })];
        const data = await reply('Thanks');
        expect(data.mentionIds).toEqual([]);
        expect(data.message).toBe('Thanks');
    });

    it('does not mention someone who has left the company', async () => {
        delete users[ADA];
        const data = await reply('Thanks');
        expect(data.mentionIds).toEqual([]);
        expect(data.message).toBe('Thanks');
    });

    it('does not repeat a mention the text already holds', async () => {
        const data = await reply(`@[Ada Lovelace](${ADA}) again`);
        expect(data.mentionIds).toEqual([ADA]);
        expect(data.message).toBe(`@[Ada Lovelace](${ADA}) again`);
    });

    it('still escapes the typed text', async () => {
        const data = await reply('<b>hi</b>');
        expect(data.message).toBe(`@[Ada Lovelace](${ADA}) &lt;b&gt;hi&lt;/b&gt;`);
    });
});
