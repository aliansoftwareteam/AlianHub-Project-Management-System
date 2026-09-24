import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

const { apiRequest, route, router, openRoute } = vi.hoisted(() => ({
    apiRequest: vi.fn(),
    route: { query: {} },
    router: { replace: vi.fn(() => Promise.resolve()), push: vi.fn(() => Promise.resolve()), hasRoute: () => false },
    openRoute: vi.fn(),
}));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('vue-router', () => ({ useRoute: () => route, useRouter: () => router }));
vi.mock('vuex', async (importOriginal) => ({ ...(await importOriginal()), useStore: () => ({ getters: {} }) }));
vi.mock('@/composable', () => ({
    useCustomComposable: () => ({ changeText: (text) => text }),
    useGetterFunctions: () => ({ getUser: () => ({ Employee_Name: 'Ada', Time_Zone: 'UTC' }) }),
}));
vi.mock('@/composable/agentProposals', () => ({ sendProposalDecision: vi.fn() }));
vi.mock('@/components/organisms/Header/helper', () => ({ useHelper: () => ({ openRoute }) }));
vi.mock('@/components/organisms/Shell/shellState', () => ({ openPanel: vi.fn() }));

import Inbox from '@/views/Inbox/Inbox.vue';

const TABS = ['primary', 'other', 'later', 'done', 'cleared'];
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

let rowsByTab;
const serve = () => apiRequest.mockImplementation((method, url) => {
    if (method === 'get' && url.endsWith('/counts')) return ok({ primary: 2, other: 1, later: 0 });
    if (method === 'get') {
        const tab = new URL(url, 'http://x').searchParams.get('tab');
        return ok({ items: rowsByTab[tab] || [], approvals: [], proposals: [], hasMore: false, nextSkip: 0 });
    }
    return ok({ count: 1 });
});
const posts = (path) => apiRequest.mock.calls.filter(([m, url]) => m === 'post' && url === `/api/v1/inbox${path}`);
const listCalls = () => apiRequest.mock.calls.filter(([m, url]) => m === 'get' && !url.endsWith('/counts'));

let wrapper;
const mountInbox = async () => {
    wrapper = mount(Inbox, {
        attachTo: document.body,
        global: { stubs: { UserProfile: true, ShellIcon: true } },
    });
    await flushPromises();
    return wrapper;
};
const topTabs = () => wrapper.find('.ibx__tabs[role="tablist"]');
const cards = () => wrapper.findAll('.ibx__card');

beforeEach(() => {
    route.query = {};
    rowsByTab = { primary: [row('64a000000000000000000001'), row('64a000000000000000000002')], cleared: [row('64a000000000000000000009', { unread: false, clearedAt: '2026-09-23T09:00:00.000Z' })] };
    window.localStorage.clear();
    serve();
});
afterEach(() => { if (wrapper) wrapper.unmount(); wrapper = null; });

describe('Inbox tabs', () => {
    it('are a real tablist of Primary, Other, Later, Done and Cleared', async () => {
        await mountInbox();
        const tabs = topTabs().findAll('[role="tab"]');
        expect(tabs.map((t) => t.attributes('data-tab'))).toEqual(TABS);
        expect(tabs.map((t) => t.attributes('aria-selected'))).toEqual(['true', 'false', 'false', 'false', 'false']);
        expect(tabs.map((t) => t.attributes('tabindex'))).toEqual(['0', '-1', '-1', '-1', '-1']);
        const panelId = tabs[0].attributes('aria-controls');
        const panel = wrapper.find(`#${panelId}`);
        expect(panel.exists()).toBe(true);
        expect(panel.attributes('role')).toBe('tabpanel');
        expect(topTabs().attributes('aria-label')).toBeTruthy();
    });

    it('move with the arrow keys, and load the tab they land on', async () => {
        await mountInbox();
        await topTabs().find('[data-tab="primary"]').trigger('keydown', { key: 'ArrowRight' });
        await flushPromises();
        const other = topTabs().find('[data-tab="other"]');
        expect(other.attributes('aria-selected')).toBe('true');
        expect(document.activeElement).toBe(other.element);
        expect(listCalls().at(-1)[1]).toContain('tab=other');

        await other.trigger('keydown', { key: 'End' });
        await flushPromises();
        expect(topTabs().find('[data-tab="cleared"]').attributes('aria-selected')).toBe('true');
        await topTabs().find('[data-tab="cleared"]').trigger('keydown', { key: 'ArrowRight' });
        await flushPromises();
        expect(topTabs().find('[data-tab="primary"]').attributes('aria-selected')).toBe('true');
    });
});

describe('Inbox keyboard triage', () => {
    it('e clears the row under the cursor', async () => {
        await mountInbox();
        await cards()[0].trigger('keydown', { key: 'e' });
        await flushPromises();
        expect(posts('/clear')).toHaveLength(1);
        expect(posts('/clear')[0][2].items[0]).toEqual(expect.objectContaining({ sourceType: 'notification', sourceId: '64a000000000000000000001' }));
        expect(cards()).toHaveLength(1);
    });

    it('arrow keys move between rows', async () => {
        await mountInbox();
        await cards()[0].trigger('keydown', { key: 'ArrowDown' });
        expect(cards()[1].classes()).toContain('is-cursor');
        await cards()[1].trigger('keydown', { key: 'ArrowUp' });
        expect(cards()[0].classes()).toContain('is-cursor');
    });

    it('s opens the snooze menu with its presets, and a preset snoozes the row', async () => {
        await mountInbox();
        await cards()[0].trigger('keydown', { key: 's' });
        await flushPromises();
        const menu = wrapper.find('[role="menu"]');
        expect(menu.exists()).toBe(true);
        expect(menu.findAll('[role="menuitem"]').map((m) => m.attributes('data-preset'))).toEqual(['later_today', 'tomorrow', 'next_week', 'until_change', 'custom']);
        expect(document.activeElement).toBe(menu.find('[role="menuitem"]').element);

        await menu.find('[data-preset="tomorrow"]').trigger('click');
        await flushPromises();
        expect(posts('/snooze')).toHaveLength(1);
        const body = posts('/snooze')[0][2];
        expect(body.items[0].sourceId).toBe('64a000000000000000000001');
        expect(new Date(body.until).getTime()).toBeGreaterThan(Date.now());
        expect(wrapper.find('[role="menu"]').exists()).toBe(false);
        expect(cards()).toHaveLength(1);
    });

    it('Escape closes the snooze menu without snoozing', async () => {
        await mountInbox();
        await cards()[0].trigger('keydown', { key: 's' });
        await wrapper.find('[role="menu"]').trigger('keydown', { key: 'Escape' });
        expect(wrapper.find('[role="menu"]').exists()).toBe(false);
        expect(posts('/snooze')).toHaveLength(0);
    });

    it('ignores the shortcuts while typing in a field', async () => {
        await mountInbox();
        await cards()[0].trigger('keydown', { key: 's' });
        await wrapper.find('[data-preset="custom"]').trigger('click');
        const input = wrapper.find('input[type="datetime-local"]');
        expect(input.exists()).toBe(true);
        await input.trigger('keydown', { key: 'e' });
        await flushPromises();
        expect(posts('/clear')).toHaveLength(0);
    });
});

describe('Cleared and Clear all', () => {
    it('Clear all clears the current tab on the server', async () => {
        await mountInbox();
        await wrapper.find('[data-action="clear-all"]').trigger('click');
        await flushPromises();
        expect(posts('/clear-all')).toHaveLength(1);
        expect(posts('/clear-all')[0][2]).toEqual(expect.objectContaining({ tab: 'primary' }));
        expect(cards()).toHaveLength(0);
    });

    it('a cleared row can be restored', async () => {
        route.query = { tab: 'cleared' };
        await mountInbox();
        expect(cards()).toHaveLength(1);
        expect(wrapper.find('[data-action="clear-all"]').exists()).toBe(false);
        await wrapper.find('[data-action="restore"]').trigger('click');
        await flushPromises();
        expect(posts('/restore')).toHaveLength(1);
        expect(posts('/restore')[0][2].items[0].sourceId).toBe('64a000000000000000000009');
        expect(cards()).toHaveLength(0);
    });
});

describe('browser-stored Later from before', () => {
    it('moves to a server snooze on first load and the local key goes', async () => {
        const key = 'alianhub.inbox.later.company-1.user-1';
        window.localStorage.setItem(key, JSON.stringify({ 'notification:64a000000000000000000005': 1 }));
        await mountInbox();
        expect(posts('/snooze')).toHaveLength(1);
        expect(posts('/snooze')[0][2].items).toEqual([{ sourceType: 'notification', sourceId: '64a000000000000000000005' }]);
        expect(window.localStorage.getItem(key)).toBeNull();
        expect(listCalls()[0][1]).not.toContain('exclude=');
    });
});
