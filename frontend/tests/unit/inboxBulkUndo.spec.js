import fs from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

const { apiRequest, route, router } = vi.hoisted(() => ({
    apiRequest: vi.fn(),
    route: { query: {} },
    router: { replace: vi.fn(() => Promise.resolve()), push: vi.fn(() => Promise.resolve()), hasRoute: () => false },
}));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('vue-router', () => ({ useRoute: () => route, useRouter: () => router }));
vi.mock('vuex', async (importOriginal) => ({ ...(await importOriginal()), useStore: () => ({ getters: {} }) }));
vi.mock('@/composable', () => ({
    useCustomComposable: () => ({ changeText: (text) => text }),
    useGetterFunctions: () => ({ getUser: () => ({ Employee_Name: 'Ada', Time_Zone: 'UTC' }) }),
}));
vi.mock('@/composable/agentProposals', () => ({ sendProposalDecision: vi.fn() }));
vi.mock('@/components/organisms/Header/helper', () => ({ useHelper: () => ({ openRoute: vi.fn() }) }));
vi.mock('@/components/organisms/Shell/shellState', () => ({ openPanel: vi.fn() }));

import Inbox from '@/views/Inbox/Inbox.vue';
import en from '@/locales/en';

const N1 = '64a000000000000000000001';
const M1 = '64a000000000000000000002';
const CLEARED_AT = '2026-09-26T10:00:00.123Z';
const row = (id, extra = {}) => ({
    sourceType: 'notification',
    sourceId: id,
    key: 'task_status',
    kind: 'update',
    message: `row ${id}`,
    unread: true,
    createdAt: '2026-09-24T09:00:00.000Z',
    duplicateIds: [],
    ...extra,
});
const ok = (data) => Promise.resolve({ data: { status: true, data } });
const unreadCleared = [{ sourceType: 'notification', sourceId: N1 }, { sourceType: 'mention', sourceId: M1 }];

beforeEach(() => {
    route.query = {};
    window.localStorage.clear();
    apiRequest.mockImplementation((method, url) => {
        if (method === 'get' && url.endsWith('/counts')) return ok({ primary: 2, other: 0, later: 0 });
        if (method === 'get') return ok({ items: [row(N1), row(M1, { sourceType: 'mention', kind: 'mention', key: 'mention' })], approvals: [], proposals: [], hasMore: false, nextSkip: 0 });
        if (url.endsWith('/clear-all')) return ok({ tab: 'primary', count: 2, clearedAt: CLEARED_AT, unread: unreadCleared });
        if (url.endsWith('/read-all')) return ok({ tab: 'primary', items: unreadCleared });
        return ok({ count: 2 });
    });
});

let wrapper;
afterEach(() => { if (wrapper) wrapper.unmount(); wrapper = null; });

const mountInbox = async () => {
    wrapper = mount(Inbox, { attachTo: document.body, global: { stubs: { UserProfile: true, ShellIcon: true } } });
    await flushPromises();
};
const posts = (p) => apiRequest.mock.calls.filter(([m, url]) => m === 'post' && url === `/api/v1/inbox${p}`);
const lists = () => apiRequest.mock.calls.filter(([m, url]) => m === 'get' && !url.endsWith('/counts'));
const undoButton = () => wrapper.find('.ibx__undo-btn');

describe('Clear all', () => {
    it('offers Undo, and Undo restores exactly the rows it cleared', async () => {
        await mountInbox();
        await wrapper.find('[data-action="clear-all"]').trigger('click');
        await flushPromises();
        expect(wrapper.findAll('.ibx__card')).toHaveLength(0);
        expect(wrapper.find('.ibx__undo').text()).toContain('Inbox.cleared_all');
        expect(undoButton().exists()).toBe(true);

        const before = lists().length;
        await undoButton().trigger('click');
        await flushPromises();
        expect(posts('/restore-all')).toHaveLength(1);
        expect(posts('/restore-all')[0][2]).toEqual({ clearedAt: CLEARED_AT, unread: unreadCleared });
        expect(lists().length).toBe(before + 1);
        expect(wrapper.findAll('.ibx__card')).toHaveLength(2);
    });

    it('offers no Undo when the server did not say what it cleared', async () => {
        apiRequest.mockImplementation((method, url) => {
            if (method === 'get' && url.endsWith('/counts')) return ok({ primary: 1, other: 0, later: 0 });
            if (method === 'get') return ok({ items: [row(N1)], approvals: [], proposals: [], hasMore: false, nextSkip: 0 });
            return ok({ tab: 'primary', count: 1 });
        });
        await mountInbox();
        await wrapper.find('[data-action="clear-all"]').trigger('click');
        await flushPromises();
        expect(wrapper.find('.ibx__undo').exists()).toBe(true);
        expect(undoButton().exists()).toBe(false);
    });
});

describe('Mark all read', () => {
    it('offers Undo, and Undo marks exactly those rows unread again', async () => {
        await mountInbox();
        const markAll = wrapper.findAll('.ibx__markall').find((b) => b.text() === 'Inbox.mark_all_read');
        await markAll.trigger('click');
        await flushPromises();
        expect(posts('/read-all')).toHaveLength(1);
        expect(wrapper.find('.ibx__undo').text()).toContain('Inbox.marked_all_read');

        await undoButton().trigger('click');
        await flushPromises();
        expect(posts('/read')).toHaveLength(1);
        expect(posts('/read')[0][2]).toEqual({ items: unreadCleared, read: 'false' });
        expect(wrapper.findAll('.ibx__card')).toHaveLength(2);
    });
});

describe('The key hint', () => {
    it('lists every row key the Inbox answers, reply and open included', async () => {
        await mountInbox();
        const hint = wrapper.find('.ibx__keys');
        expect(hint.attributes('title')).toBe('Inbox.keys_hint_full');
        expect(hint.text().split(/\s+/)).toEqual(['j', 'k', '↵', 'r', 'e', 's']);
        expect(en.Inbox.keys_hint_full).toMatch(/\br\b/);
        expect(en.Inbox.keys_hint_full).toMatch(/Enter/);
    });

    it('retires the old hint from every locale', () => {
        const dir = path.resolve(__dirname, '../../src/locales');
        const stale = fs.readdirSync(dir)
            .filter((f) => /\.(js|json)$/.test(f))
            .filter((f) => /(^|[\s"'.])keys_hint["']?\s*:/m.test(fs.readFileSync(path.join(dir, f), 'utf8')));
        expect(stale).toEqual([]);
    });
});
